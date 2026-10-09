/** Transport-neutral JSON-RPC handler. It does NOT supply authentication or storage.
 * Host must provide verified auth(request)->userId and authorized repository methods.
 * With no auth/repo, fails CLOSED. MCP deployment in Sites must validate runtime integration.
 */
const tools = [
 {name:'list_course_materials',description:'List only the current authorized course materials and their review statuses',inputSchema:{type:'object',properties:{course_id:{type:'string'}},required:['course_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_course_original_text',description:'Read one PDF text page or a transcript chunk for cross-checking. Continue with next_offset and page_num; not a generation source.',inputSchema:{type:'object',properties:{material_id:{type:'string'},page_num:{type:'integer',minimum:1},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:40000}},required:['material_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_course_verified_text',description:'Read a reviewed page with evidence_ids and unresolved concerns. It is available immediately after review save; never treat unresolved claims as facts. Continue next_offset and page_num.',inputSchema:{type:'object',properties:{material_id:{type:'string'},page_num:{type:'integer',minimum:1},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:40000}},required:['material_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_course_page_image',description:'Read original PNG/JPEG page image for ChatGPT handwriting recognition',inputSchema:{type:'object',properties:{material_id:{type:'string'},page_num:{type:'integer',minimum:1}},required:['material_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_course_page_images',description:'Read 1 to 8 consecutive original PDF page images in one tool call for page-by-page GPT verification',inputSchema:{type:'object',properties:{material_id:{type:'string'},start_page:{type:'integer',minimum:1},count:{type:'integer',minimum:1,maximum:8}},required:['material_id','start_page','count'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_course_page_status',description:'Read the actual PDF page count and which page previews are ready for OCR',inputSchema:{type:'object',properties:{material_id:{type:'string'}},required:['material_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'save_course_review_page',description:'Save review in one step: original, correction, evidence and unresolved concerns. All pages saved automatically enable generation; concerns remain visible.',inputSchema:{type:'object',properties:{material_id:{type:'string'},page_num:{type:'integer',minimum:1},raw_text:{type:'string'},corrected_text:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}},unresolved:{type:'array',items:{type:'string'}}},required:['material_id','page_num','raw_text','corrected_text'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'start_course_generation',description:'Create generation from reviewed files, including files with unresolved issues; returns review_concerns to respect in every output. Require an outline.',inputSchema:{type:'object',properties:{course_id:{type:'string'},mode:{type:'string'},scope:{type:'string'},source_ids:{type:'array',items:{type:'string'}}},required:['course_id','mode','source_ids'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'save_course_outline',description:'Save generation outline before any content creation. Each section is an object with a title.',inputSchema:{type:'object',properties:{job_id:{type:'string'},sections:{type:'array',items:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}}},required:['job_id','sections'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'save_course_part',description:'Write generated part and automatically save complete rolling note',inputSchema:{type:'object',properties:{job_id:{type:'string'},section_index:{type:'integer'},content_markdown:{type:'string'}},required:['job_id','section_index','content_markdown'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'save_course_problem_pack',description:'Save a SolvePad-compatible structured problem pack',inputSchema:{type:'object',properties:{course_id:{type:'string'},title:{type:'string'},pack:{type:'object'}},required:['course_id','title','pack'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'save_course_casio_project',description:'Save a CASIO program blueprint, TXT and manual for selected course',inputSchema:{type:'object',properties:{course_id:{type:'string'},title:{type:'string'},blueprint_json:{type:'string'},program_text:{type:'string'},manual_text:{type:'string'}},required:['course_id','title'],additionalProperties:false},annotations:{readOnlyHint:false}},
 {name:'list_course_jobs',description:'List generation jobs owned by the signed-in user in this course',inputSchema:{type:'object',properties:{course_id:{type:'string'}},required:['course_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'get_course_generation_progress',description:'Resume an owned job using saved outline, source IDs, completed part indices and document ID',inputSchema:{type:'object',properties:{job_id:{type:'string'}},required:['job_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
];
const invoke={list_course_materials:'listMaterials',get_course_original_text:'getOriginalText',get_course_verified_text:'verifiedText',get_course_page_image:'getPageImage',get_course_page_images:'getPageImages',get_course_page_status:'pageStatus',save_course_review_page:'saveReview',start_course_generation:'startJob',save_course_outline:'saveOutline',save_course_part:'savePart',save_course_problem_pack:'savePack',save_course_casio_project:'saveCasio',list_course_jobs:'listJobs',get_course_generation_progress:'getJobProgress'};
const activeTools=tools;
function jsonrpc(id,result){return {jsonrpc:'2.0',id,result};}
function error(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}};}
export async function handleMessage(body,{authenticate,repo,allowWrites=true}={}){
 if(!body||body.jsonrpc!=='2.0'||typeof body.method!=='string')return error(body?.id??null,-32600,'Invalid Request');
 if(body.method==='initialize')return jsonrpc(body.id,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'aplus-accelerator',version:'0.11.0'}});
 if(body.method==='notifications/initialized')return null;
 if(body.method==='ping')return jsonrpc(body.id,{});
 // Prevent unauthenticated tools/list and calls, even if the site URL is public.
 const userId=await authenticate?.();if(!userId)return error(body.id,-32001,'Authentication required');
 if(body.method==='tools/list')return jsonrpc(body.id,{tools:activeTools});
 if(body.method!=='tools/call')return error(body.id,-32601,'Method not found');
 const name=body.params?.name,args=body.params?.arguments||{};
 const tool=activeTools.find(t=>t.name===name);if(!tool)return error(body.id,-32602,'Unknown tool');
 if(!allowWrites&&!tool.annotations?.readOnlyHint)return jsonrpc(body.id,{content:[{type:'text',text:'Site writes are locked'}],isError:true});
 for(const required of tool.inputSchema.required){if(args[required]===undefined||args[required]===null||args[required]==='')return error(body.id,-32602,`Missing ${required}`);}
 if(Object.keys(args).some(k=>!(k in tool.inputSchema.properties)))return error(body.id,-32602,'Unexpected parameter');
 for(const [key,val] of Object.entries(args)){const schema=tool.inputSchema.properties[key];if(schema.type==='string' && (typeof val!=='string'||val.length>500000))return error(body.id,-32602,`Invalid ${key}`);if(schema.type==='integer' && (!Number.isInteger(val)||(schema.minimum!==undefined&&val<schema.minimum)||(schema.maximum!==undefined&&val>schema.maximum)))return error(body.id,-32602,`Invalid ${key}`);if(schema.type==='array' && (!Array.isArray(val)||val.length>80))return error(body.id,-32602,`Invalid ${key}`);}
 if(!repo || typeof repo[invoke[name]]!=='function')return error(body.id,-32002,'Storage backend is not configured');
 try{const result=await repo[invoke[name]](userId,args);if(result?.__mcpImage)return jsonrpc(body.id,{content:[{type:'image',mimeType:result.mimeType,data:result.data}],isError:false});if(result?.__mcpImages)return jsonrpc(body.id,{content:result.images.flatMap(p=>[{type:'text',text:JSON.stringify({page_num:p.page_num})},{type:'image',mimeType:p.mimeType,data:p.data}]),isError:false});return jsonrpc(body.id,{content:[{type:'text',text:JSON.stringify(result)}],isError:false});}
 catch(err){ // Never leak SQL/path/secret internal errors.
   const publicErr=err?.code==='FORBIDDEN'?'Not authorized':err?.code==='REVISION_CONFLICT'?'Revision conflict':err?.code==='NOT_FOUND'?'Not found':err?.code==='BAD_REQUEST'?'Invalid input':err?.code==='REVIEW_INCOMPLETE'?'Source review required':err?.code==='OUTLINE_REQUIRED'?'Outline required':'Request failed';
   return jsonrpc(body.id,{content:[{type:'text',text:publicErr}],isError:true});
 }
}
export function toolSpecs(){return activeTools;}
