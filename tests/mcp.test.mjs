import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleMessage,toolSpecs} from '../sites/mcp-core.mjs';
const msg=(method,params,id=1)=>({jsonrpc:'2.0',id,method,params});
test('Course-only MCP discovery needs verified identity',async()=>{
 const init=await handleMessage(msg('initialize',{}));
 assert.equal(init.result.serverInfo.name,'aplus-accelerator');
 assert.equal((await handleMessage(msg('tools/list',{}))).error.code,-32001);
 const result=await handleMessage(msg('tools/list',{}),{authenticate:async()=> 'u1'});
 assert.deepEqual(result.result.tools.map(x=>x.name),toolSpecs().map(x=>x.name));
 assert.ok(result.result.tools.some(x=>x.name==='get_course_page_image'));
 assert.ok(!result.result.tools.some(x=>x.name==='finalize_course_review'));
 assert.ok(result.result.tools.some(x=>x.name==='get_course_original_text'));
 assert.ok(result.result.tools.some(x=>x.name==='get_course_generation_progress'));
 assert.deepEqual(result.result.tools.find(x=>x.name==='save_course_outline').inputSchema.properties.sections.items.required,['title']);
 assert.ok(result.result.tools.every(x=>!['get_note','list_sources','get_source_page_image'].includes(x.name)));
});
test('Resumable course progress uses the verified caller and rejects unknown job tools',async()=>{
 const repo={getJobProgress:async(user,{job_id})=>({user,job_id,status:'outlined',saved_parts:[]})};
 const r=await handleMessage(msg('tools/call',{name:'get_course_generation_progress',arguments:{job_id:'j1'}}),{authenticate:async()=> 'alice',repo});
 assert.deepEqual(JSON.parse(r.result.content[0].text),{user:'alice',job_id:'j1',status:'outlined',saved_parts:[]});
 const legacy=await handleMessage(msg('tools/call',{name:'get_generation_progress',arguments:{run_id:'old'}}),{authenticate:async()=> 'alice',repo});
 assert.equal(legacy.error.code,-32602);
});
test('Read-only MCP works while writes are locked; spoofed and malformed calls fail',async()=>{
 const repo={listMaterials:async(user,{course_id})=>[{user,course_id}]};
 const auth={authenticate:async()=> 'u1',repo,allowWrites:false};
 const read=await handleMessage(msg('tools/call',{name:'list_course_materials',arguments:{course_id:'c1'}}),auth);
 assert.deepEqual(JSON.parse(read.result.content[0].text),[{user:'u1',course_id:'c1'}]);
 const write=await handleMessage(msg('tools/call',{name:'save_course_review_page',arguments:{material_id:'m1',page_num:1,raw_text:'x',corrected_text:'x'}}),auth);
 assert.equal(write.result.isError,true);
 assert.equal((await handleMessage(msg('tools/call',{name:'list_sources',arguments:{offering_id:'o1'}}),auth)).error.code,-32602);
 assert.equal((await handleMessage(msg('tools/call',{name:'get_course_page_image',arguments:{material_id:'m1',page_num:0}}),auth)).error.code,-32602);
});
test('Repository errors never expose private data through course tools',async()=>{
 const repo={getOriginalText:async()=>{throw Error('db_password=secret');}};
 const r=await handleMessage(msg('tools/call',{name:'get_course_original_text',arguments:{material_id:'m1'}}),{authenticate:async()=> 'u1',repo});
 assert.equal(r.result.isError,true);assert.doesNotMatch(r.result.content[0].text,/secret/);
});
