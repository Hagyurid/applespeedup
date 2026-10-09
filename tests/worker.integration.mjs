/** Actual built Worker in workerd/Miniflare, with real local D1/R2 emulation.
 * Identity headers emulate Sites dispatch; this does NOT test live ChatGPT login.
 * No persistence or network calls: each run starts empty and is disposed afterward.
 */
import assert from 'node:assert/strict';
import {documents} from './helpers/document-fixtures.mjs';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const workerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=workerRequire('miniflare');
const server=resolve('dist/server');
const modules=['index.js',...readdirSync(server,{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&p!=='index.js')].map(path=>({type:'ESModule',path:resolve(server,path)}));
const mf=new Miniflare({modules,modulesRoot:server,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  bindings:{APLUS_WRITES_ENABLED:'true'},d1Databases:['DB'],r2Buckets:['BUCKET'],assets:{directory:resolve('dist/client'),routerConfig:{has_user_worker:true}}});
const alice={'oai-authenticated-user-id':'test-alice','oai-authenticated-user-email':'test-alice@example.com'};
const bob={'oai-authenticated-user-id':'test-bob','oai-authenticated-user-email':'test-bob@example.com'};
const request=(path,{headers=alice,method='GET',json,body}={})=>mf.dispatchFetch('https://app.example'+path,{method,redirect:'manual',headers:{...headers,...(json?{'content-type':'application/json'}:{})},...(json?{body:JSON.stringify(json)}:body!==undefined?{body}:{})});
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
try{
  const db=await mf.getD1Database('DB');
  const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
  for(const {tag} of journal.entries)for(const s of readFileSync(`drizzle/${tag}.sql`,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();
  await check('fresh D1 has no imported records',async()=>assert.equal((await db.prepare('SELECT count(*) AS n FROM courses').first()).n,0));
  await check('anonymous API and spoofed client user are denied',async()=>{
    assert.equal((await request('/api/courses',{headers:{}})).status,401);
    assert.equal((await request('/api/courses',{headers:{'x-user-id':'test-alice'}})).status,401);
  });
  await check('protected HTML redirects anonymous requests to Sites sign-in',async()=>{
    const r=await request('/',{headers:{}});assert.ok([302,303,307,308].includes(r.status));assert.match(r.headers.get('location'),/\/signin-with-chatgpt/);
  });
  await check('signed-in HTML serves the retained workspace and external module',async()=>{
    const r=await request('/');assert.equal(r.status,200);const html=await r.text();assert.match(html,/강의 관리/);assert.match(html,/data-page-panel="sources"/);assert.match(html,/data-page-target="notes"/);assert.match(html,/id="note-form"/);assert.match(html,/\/web\/connected.js/);
    assert.match(html,/<meta[^>]*name="viewport"[^>]*content="[^"]*width=device-width/);
    assert.match(html,/id="toggleWorkspace"/);assert.match(html,/id="solvePenOnly"/);
    const script=await request('/web/connected.js?v=workspace-pen-1');assert.equal(script.status,200);assert.match(await script.text(),/\/api\/session/);
    assert.equal((await request('/domain/core.mjs')).status,200);
    assert.equal((await request('/favicon.svg')).status,200);
  });
  await check('every browser module dependency is published as JavaScript',async()=>{
    const visited=new Set();
    async function walk(path){
      if(visited.has(path))return;visited.add(path);
      const response=await request(path);assert.equal(response.status,200,path);
      assert.match(response.headers.get('content-type')||'',/javascript/,path);
      const source=await response.text();
      for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)){
        const spec=match[1];if(!spec.startsWith('.')&&!spec.startsWith('/'))continue;
        await walk(new URL(spec,'https://app.example'+path).pathname);
      }
    }
    await walk('/web/connected.js');assert.ok(visited.has('/domain/note-math.mjs'));assert.ok(visited.has('/domain/note-presentation.mjs'));
  });
  const c=await (await request('/api/courses',{method:'POST',json:{name:'Worker 검증 과목'}})).json();assert.ok(c.id);
  const o=await (await request('/api/offerings',{method:'POST',json:{course_id:c.id,year:2026,term:'2',professor:'검증 교수',section:'01'}})).json();assert.ok(o.id);
  const old=await (await request('/api/offerings',{method:'POST',json:{course_id:c.id,year:2025,term:'2',professor:'검증 교수',section:'01'}})).json();assert.ok(old.id);
  let source;
  const upload=()=>request('/api/assets',{method:'POST',headers:{...alice,'content-type':'application/octet-stream','x-offering-id':o.id,'x-source-type':'transcript','x-source-title':encodeURIComponent('전사본 검증'),'x-file-name':encodeURIComponent('전사본.txt')},body:new TextEncoder().encode('확산 저항과 Thiele modulus, D² / s.')});
  await check('R2 upload, duplicate suppression, download and scoped D1 search work',async()=>{
    const r=await upload();assert.equal(r.status,201);source=await r.json();assert.equal(source.extract_status,'ready');
    const second=await (await upload()).json();assert.equal(second.source_id,source.source_id);assert.equal(second.reused,true);
    assert.equal((await request('/api/files/'+source.source_id)).status,200);
    const hits=await (await request(`/api/search?offering_id=${o.id}&query=Thiele`)).json();assert.equal(hits[0].source_id,source.source_id);assert.match(hits[0].content,/D²/);
    assert.deepEqual(await (await request(`/api/search?offering_id=${old.id}&query=Thiele`)).json(),[]);
  });
  await check('PDF bytes remain pending and downloadable without claimed extraction',async()=>{
    const r=await request('/api/assets',{method:'POST',headers:{...alice,'content-type':'application/octet-stream','x-offering-id':o.id,'x-source-type':'lecture_slides','x-source-title':'PDF','x-file-name':'test.pdf'},body:new TextEncoder().encode('%PDF-1.4\n% local fixture; no parser')});assert.equal(r.status,201);
    const p=await r.json();assert.equal(p.extract_status,'pending');assert.equal((await request('/api/files/'+p.source_id)).status,200);
  });
  let note;
  await check('D1 note revision history and stale-edit protection survive the built Worker',async()=>{
    const body={offering_id:o.id,title:'정리본',content_markdown:'# 검증',request_id:'worker-test-note'};
    note=await (await request('/api/notes',{method:'POST',json:body})).json();assert.equal(note.revision,1);
    const same=await (await request('/api/notes',{method:'POST',json:body})).json();assert.equal(same.id,note.id);
    const edit={offering_id:o.id,note_id:note.id,expected_revision:1,title:'정리본',content_markdown:'# 수정'};
    assert.equal((await request('/api/notes',{method:'POST',json:edit})).status,201);assert.equal((await request('/api/notes',{method:'POST',json:edit})).status,409);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM note_versions WHERE note_id=?').bind(note.id).first()).n,2);
  });
  await check('another signed-in identity cannot read or alter saved data',async()=>{
    assert.deepEqual(await (await request('/api/courses',{headers:bob})).json(),[]);
    for(const path of [`/api/sources?offering_id=${o.id}`,`/api/search?offering_id=${o.id}&query=Thiele`,`/api/files/${source.source_id}`,`/api/notes?note_id=${note.id}`])assert.equal((await request(path,{headers:bob})).status,404);
    assert.equal((await request('/api/notes',{method:'POST',headers:bob,json:{offering_id:o.id,title:'금지',content_markdown:'금지'}})).status,404);
  });
  await check('concurrent note edits permit exactly one revision and preserve its history',async()=>{
    const edit={offering_id:o.id,note_id:note.id,expected_revision:2,title:'정리본',content_markdown:'# 동시 수정'};
    const responses=await Promise.all([request('/api/notes',{method:'POST',json:edit}),request('/api/notes',{method:'POST',json:{...edit,content_markdown:'# 다른 수정'}})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM note_versions WHERE note_id=?').bind(note.id).first()).n,3);
  });
  await check('MCP publishes course tools only to the authenticated user',async()=>{
    const r=await request('/mcp',{method:'POST',headers:{...alice,accept:'application/json, text/event-stream'},json:{jsonrpc:'2.0',id:1,method:'tools/list'}});
    assert.equal(r.status,200);const list=(await r.json()).result.tools;
    assert.ok(list.some(x=>x.name==='get_course_page_image'));assert.ok(list.every(x=>x.name!=='list_sources'));
  });
  await check('course transcript review, PDF page image and SolvePad ink persist through the Worker',async()=>{
    const text=await (await request('/api/v2/text',{method:'POST',json:{course_id:c.id,title:'녹음 전사본',source_type:'transcript',content:'티엘 모듈러스'}})).json();
    const invoke=async(name,args,headers=alice)=>{
      const r=await request('/mcp',{method:'POST',headers:{...headers,accept:'application/json, text/event-stream'},json:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
      assert.equal(r.status,200);return (await r.json()).result;
    };
    assert.equal(JSON.parse((await invoke('get_course_original_text',{material_id:text.id})).content[0].text).original_text,'티엘 모듈러스');
    assert.equal((await invoke('save_course_review_page',{material_id:text.id,page_num:1,raw_text:'티엘 모듈러스',corrected_text:'Thiele modulus'})).isError,false);
    assert.equal(JSON.parse((await invoke('get_course_verified_text',{material_id:text.id})).content[0].text).pages[0].corrected_text,'Thiele modulus');
    const pdf=await (await request('/api/v2/upload',{method:'POST',headers:{...alice,'content-type':'application/octet-stream','x-course-id':c.id,'x-source-type':'lecture_slides','x-title':encodeURIComponent('자료'),'x-filename':'scan.pdf'},body:new TextEncoder().encode('%PDF-1.4 local page')})).json();
    assert.ok(pdf.id);
    assert.equal((await request('/api/v2/pdf-pages',{method:'POST',json:{material_id:pdf.id,page_count:1}})).status,201);
    const image=new Uint8Array(90);image.set([137,80,78,71,13,10,26,10]);
    assert.equal((await request('/api/v2/page-image',{method:'POST',headers:{...alice,'content-type':'image/png','x-material-id':pdf.id,'x-page-num':'1'},body:image})).status,201);
    assert.equal((await invoke('get_course_page_image',{material_id:pdf.id,page_num:1})).content[0].type,'image');
    assert.equal((await invoke('get_course_page_image',{material_id:pdf.id,page_num:1},bob)).isError,true);
    const pack=await (await request('/api/v2/pack',{method:'POST',json:{course_id:c.id,title:'연습',pack:{schemaVersion:'solvepad.problemPack.v5',questions:[{id:'q1',promptMd:'2+2',answer:{value:'4'},solution:'2+2=4'}]}}})).json();
    assert.ok(pack.id);
    assert.equal((await request('/api/v2/attempt',{method:'POST',json:{pack_id:pack.id,question_id:'q1',answer:'4',strokes:[[{color:'#222',width:4,points:[{x:.1,y:.2},{x:.2,y:.3}]}]],result:'correct',bookmarked:true}})).status,201);
    const attempts=await (await request('/api/v2/attempts?pack_id='+pack.id)).json();
    assert.equal(attempts.length,1);assert.equal(JSON.parse(attempts[0].data_json).strokes[0][0].points.length,2);
    assert.equal((await request('/api/v2/attempts?pack_id='+pack.id,{headers:bob})).status,404);
  });
  await check('course MCP outline, progress, section autosave and version history survive the built Worker',async()=>{
    const text=await (await request('/api/v2/text',{method:'POST',json:{course_id:c.id,title:'교정할 전사',source_type:'transcript',content:'원본'}})).json();
    const invoke=async(name,args)=>{
      const r=await request('/mcp',{method:'POST',headers:{...alice,accept:'application/json, text/event-stream'},json:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
      assert.equal(r.status,200);const result=(await r.json()).result;assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.content[0].text);
    };
    await invoke('save_course_review_page',{material_id:text.id,page_num:1,raw_text:'원본',corrected_text:'교정본',unresolved:['수식 확인 필요']});
    const job=await invoke('start_course_generation',{course_id:c.id,mode:'detailed_note',source_ids:[text.id]});
    assert.equal(job.review_concerns[0].unresolved[0],'수식 확인 필요');
    const outline=await invoke('save_course_outline',{job_id:job.id,sections:[{title:'기초'},{title:'응용'}]});
    assert.equal(outline.document_id,job.id);
    const first=await invoke('save_course_part',{job_id:job.id,section_index:1,content_markdown:'검토한 첫 절'});
    const progress=await invoke('get_course_generation_progress',{job_id:job.id});
    assert.deepEqual(progress.saved_parts,[1]);assert.equal(progress.document_id,first.document_id);
    const versions=await (await request('/api/v2/note-versions?id='+job.id)).json();
    assert.equal(versions.length,2);
    const previous=await (await request('/api/v2/note-version?id='+job.id+'&revision=1')).json();
    assert.match(previous.content_markdown,/작성 중/);
    assert.equal((await request('/api/v2/note-versions?id='+job.id,{headers:bob})).status,404);
    const reference='generated:'+job.id;
    assert.match((await invoke('get_course_generation_source',{material_id:reference})).original_text,/검토한 첫 절/);
    const reused=await invoke('start_course_generation',{course_id:c.id,mode:'exam_cram',source_ids:[reference]});
    assert.ok(reused.document_revisions[reference]);
  });
  await check('original DOCX, reviewed transcripts and extra requests survive the built Worker',async()=>{
    const doc=await (await request('/api/v2/upload',{method:'POST',headers:{...alice,'content-type':'application/octet-stream','x-course-id':c.id,'x-source-type':'other','x-title':encodeURIComponent('워드 원문'),'x-filename':'original.docx'},body:Buffer.from(documents.docx,'base64')})).json();
    const invoke=async(name,args)=>{const r=await request('/mcp',{method:'POST',headers:{...alice,accept:'application/json, text/event-stream'},json:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});const result=(await r.json()).result;assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.content[0].text);};
    const raw=await invoke('get_course_generation_source',{material_id:doc.id});assert.equal(raw.original_text,'교정하지 않은 DOCX 원문 123');assert.equal(raw.used_original,true);
    const transcript=await (await request('/api/v2/text',{method:'POST',json:{course_id:c.id,title:'원문 전사',content:'그대로',source_type:'transcript'}})).json();
    await invoke('save_course_review_page',{material_id:transcript.id,page_num:1,raw_text:'그대로',corrected_text:'검수본'});
    const job=await invoke('start_course_generation',{course_id:c.id,mode:'detailed_note',source_ids:[doc.id,transcript.id],additional_requests:'표 포함'});
    const progress=await invoke('get_course_generation_progress',{job_id:job.id});assert.equal(progress.additional_requests,'표 포함');assert.deepEqual(progress.original_source_ids,[]);
  });
  await check('native exam and CASIO MCP outputs complete once without creating notes',async()=>{
    const invoke=async(name,args)=>{const r=await request('/mcp',{method:'POST',headers:{...alice,accept:'application/json, text/event-stream'},json:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});const result=(await r.json()).result;assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.content[0].text);};
    const source=await (await request('/api/v2/text',{method:'POST',json:{course_id:c.id,title:'원문',source_type:'other',content:'기체 법칙'}})).json();
    for(const mode of ['exam_paper','calculator']){
      const job=await invoke('start_course_generation',{course_id:c.id,mode,source_ids:[source.id]});
      await invoke('save_course_outline',{job_id:job.id,sections:[{title:'문제 또는 코드'}]});
      const args={course_id:c.id,job_id:job.id,title:'전용 결과'};
      if(mode==='exam_paper')args.pack={questions:[{id:'q1',promptMd:'기체 압력 $P_{1}$\n\n$$\nP=\\frac{nRT}{V}\n$$',choices:[{value:'1',text:'$P_{1}$'}],answer:{value:'1',displayMd:'$P=\\frac{nRT}{V}$'},solution:'$$\nV=\\frac{nRT}{P}\n$$',hints:['$T_{1}$을 확인하세요.']}]};else args.program_text='1+1';
      const tool=mode==='exam_paper'?'save_course_problem_pack':'save_course_casio_project';
      const saved=await invoke(tool,args);if(mode==='exam_paper'){const stored=await (await request('/api/v2/pack?id='+saved.id)).json();assert.deepEqual(stored.pack.questions,args.pack.questions);}const retried=await invoke(tool,args);assert.equal(saved.id,retried.id);
      const progress=await invoke('get_course_generation_progress',{job_id:job.id});assert.equal(progress.status,'complete');assert.equal(progress.document_id,null);assert.equal(progress.output_id,saved.id);
      const notes=await (await request('/api/v2/notes?course_id='+c.id)).json();assert.equal(notes.some(n=>n.id===job.id),false);
    }
  });
  console.log(`Worker integration: ${checks} checks passed. Live login and browser interaction remain unverified.`);
}finally{await mf.dispose();}
