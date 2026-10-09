/** Portable request handler for ChatGPT Sites-compatible host runtimes.
 * The embedding host MUST provide a session/OAuth token verifier through authenticate(request).
 * This module deliberately has NO fallback anonymous identity and never reads x-user-id.
 */
import {createD1Repository} from './repository.mjs';
import {createAiPipeline} from './ai-pipeline.mjs';
import {createCourseLibrary,handleCourseRequest} from './course-v2.mjs';
import {handleMessage} from './mcp-core.mjs';
import {storeAsset,downloadAsset,fileLimits} from './assets.mjs';
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
const fail=(status,message)=>json({error:message},status);
async function readBody(request,max){
  const len=Number(request.headers.get('content-length'));
  if(len>max)return null;
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader();const chunks=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();return null;}chunks.push(value);}}
  finally{reader.releaseLock();}
  const out=new Uint8Array(total);let pos=0;for(const c of chunks){out.set(c,pos);pos+=c.byteLength;}return out;
}
const decode=(b)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
function statusOf(err){if(['FORBIDDEN'].includes(err?.code))return 403;if(err?.code==='NOT_FOUND')return 404;if(err?.code==='REVISION_CONFLICT')return 409;if(err?.code==='REVIEW_INCOMPLETE'||err?.code==='OUTLINE_REQUIRED')return 422;if(['BAD_REQUEST','BAD_FILE'].includes(err?.code))return 400;return 500;}
export function createHttpHandler({db,bucket,authenticate,allowedOrigin}={}){
  if(!db||typeof authenticate!=='function')throw Error('Verified authentication and a D1 binding are required');
  const repo={...createD1Repository(db),...createAiPipeline(db,bucket),...createCourseLibrary(db,bucket)};
  return async function handle(request){
    const url=new URL(request.url),method=request.method;
    if(url.pathname==='/health'&&method==='GET')return json({status:'ready',service:'aplus-accelerator',backend:'configured'});
    if(!url.pathname.startsWith('/api/')&&url.pathname!=='/mcp')return fail(404,'Not found');
    if(method==='OPTIONS')return fail(405,'Method not allowed');
    // Reject cross-origin browser mutations. OAuth / SameSite / CSRF checks must also be enforced by the host.
    const origin=request.headers.get('origin');
    if(origin&&origin!==(allowedOrigin||url.origin))return fail(403,'Origin denied');
    let principal;
    try{principal=await authenticate(request);}catch{return fail(401,'Authentication required');}
    if(!principal||typeof principal.id!=='string'||!principal.id.trim())return fail(401,'Authentication required');
    const userId=principal.id;
    try{
      if(url.pathname.startsWith('/api/v2/'))return await handleCourseRequest(request,{db,bucket,userId});
      if(url.pathname==='/mcp'){
        if(method!=='POST')return fail(405,'Method not allowed');
        const accept=request.headers.get('accept')||'';
        if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return fail(406,'MCP Accept header required');
        if(!request.headers.get('content-type')?.startsWith('application/json'))return fail(415,'JSON required');
        const raw=await readBody(request,2*1024*1024);if(!raw)return fail(413,'Request too large');
        let body;try{body=decode(raw);}catch{return fail(400,'Invalid JSON');}
        // No batch messages on the modern Streamable HTTP transport.
        if(Array.isArray(body))return fail(400,'Batch requests not accepted');
        const result=await handleMessage(body,{authenticate:async()=>userId,repo});
        if(result===null)return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
        return json(result);
      }
      if(method==='GET'&&url.pathname==='/api/courses')return json(await repo.listCourses(userId));
      if(method==='GET'&&url.pathname==='/api/offerings')return json(await repo.listOfferings(userId,{course_id:url.searchParams.get('course_id')}));
      if(method==='GET'&&url.pathname==='/api/course-context')return json(await repo.getCourseContext(userId,{offering_id:url.searchParams.get('offering_id')}));
      if(method==='GET'&&url.pathname==='/api/sources')return json(await repo.listSources(userId,{offering_id:url.searchParams.get('offering_id')}));
      if(method==='GET'&&url.pathname==='/api/search')return json(await repo.searchSourceContent(userId,{offering_id:url.searchParams.get('offering_id'),query:url.searchParams.get('query')}));
      if(method==='GET'&&url.pathname==='/api/notes-list')return json(await repo.listNotes(userId,{offering_id:url.searchParams.get('offering_id')}));
      if(method==='GET'&&url.pathname==='/api/notes'){
        const note_id=url.searchParams.get('note_id');if(!note_id)return fail(400,'note_id required');
        return json(await repo.getNote(userId,{note_id}));
      }
      if(method==='GET'&&url.pathname.startsWith('/api/files/')){
        const sourceId=url.pathname.slice('/api/files/'.length);
        if(!sourceId||sourceId.includes('/'))return fail(404,'Not found');
        return await downloadAsset({bucket,repository:repo,userId,sourceId});
      }
      if(method==='POST'&&url.pathname==='/api/assets'){
        if(!request.headers.get('content-type')?.startsWith('application/octet-stream'))return fail(415,'Binary body required');
        const raw=await readBody(request,fileLimits.maxBytes);if(!raw)return fail(413,'Upload too large');
        const filename=decodeURIComponent(request.headers.get('x-file-name')||'');
        const file={name:filename,size:raw.byteLength,arrayBuffer:async()=>raw.buffer};
        let weeks;try{weeks=JSON.parse(request.headers.get('x-source-weeks')||'[]');}catch{return fail(400,'Invalid source weeks');}
        const rawYear=request.headers.get('x-exam-year');
        const exam_year=rawYear===null||rawYear===''?null:Number(rawYear);
        const result=await storeAsset({bucket,repository:repo,userId,file,
          offeringId:request.headers.get('x-offering-id'),sourceType:request.headers.get('x-source-type'),
          title:decodeURIComponent(request.headers.get('x-source-title')||''),provenance:decodeURIComponent(request.headers.get('x-source-provenance')||''),weeks,exam_year});
        return json(result,201);
      }
      if(method==='POST'&&url.pathname==='/api/ai/source-page-image'){
        const mime_type=request.headers.get('content-type')||'';
        if(!['image/png','image/jpeg'].includes(mime_type))return fail(415,'PNG/JPEG image required');
        const source_id=request.headers.get('x-source-id')||'';
        const page_num=Number(request.headers.get('x-page-num'));
        if(!source_id||!Number.isInteger(page_num)||page_num<1||page_num>1000)return fail(400,'Invalid source page');
        const bytes=await readBody(request,1024*1024);
        if(!bytes)return fail(413,'Preview image too large');
        return json(await repo.saveSourcePageImage(userId,{source_id,page_num,bytes,mime_type}),201);
      }
      if(method==='GET'&&url.pathname==='/api/ai/progress')return json(await repo.getGenerationProgress(userId,{run_id:url.searchParams.get('run_id')}));
      if(method==='GET'&&url.pathname==='/api/ai/reviewed-page')return json(await repo.getReviewedPage(userId,{source_id:url.searchParams.get('source_id'),page_num:Number(url.searchParams.get('page_num'))}));
      if(method==='POST'&&url.pathname.startsWith('/api/ai/')){
        const actions={
          '/api/ai/review-page':'saveReviewedPage',
          '/api/ai/finalize-review':'finalizeSourceReview',
          '/api/ai/begin-generation':'beginGeneration',
          '/api/ai/save-outline':'saveGenerationOutline',
          '/api/ai/save-section':'saveGeneratedSection'
        };
        const name=actions[url.pathname];
        if(!name)return fail(404,'Not found');
        if(!request.headers.get('content-type')?.startsWith('application/json'))return fail(415,'JSON required');
        const raw=await readBody(request,2*1024*1024);if(!raw)return fail(413,'Request too large');
        let body;try{body=decode(raw);}catch{return fail(400,'Invalid JSON');}
        if(!body||typeof body!=='object'||Array.isArray(body))return fail(400,'JSON object required');
        return json(await repo[name](userId,body),201);
      }
      if(method==='POST'&&['/api/courses','/api/offerings','/api/transcripts','/api/facts','/api/notes','/api/jobs','/api/checkpoints'].includes(url.pathname)){
        if(!request.headers.get('content-type')?.startsWith('application/json'))return fail(415,'JSON required');
        const raw=await readBody(request,2*1024*1024);if(!raw)return fail(413,'Request too large');
        let body;try{body=decode(raw);}catch{return fail(400,'Invalid JSON');}
        if(!body||typeof body!=='object'||Array.isArray(body))return fail(400,'JSON object required');
        const actions={
          '/api/courses':()=>repo.createCourse(userId,body),
          '/api/offerings':()=>repo.createOffering(userId,body),
          '/api/transcripts':()=>repo.ingestTranscript(userId,body),
          '/api/facts':()=>repo.saveCourseFact(userId,body),
          '/api/notes':()=>repo.saveNote(userId,body),
          '/api/jobs':()=>repo.createJob(userId,body),
          '/api/checkpoints':()=>repo.saveCheckpoint(userId,body)
        };
        return json(await actions[url.pathname](),201);
      }
      return fail(404,'Not found');
    }catch(err){
      // Never expose SQL/R2 stack traces or secret metadata to the caller.
      const status=statusOf(err);
      return fail(status,status===500?'Request failed':({403:'Not authorized',404:'Not found',409:'Revision conflict',422:'Prerequisite review or outline required',400:'Invalid request'})[status]);
    }
  };
}
