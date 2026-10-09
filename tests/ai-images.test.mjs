import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHttpHandler} from '../sites/http.mjs';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';
import {createCourseLibrary} from '../sites/course-v2.mjs';
const setup=()=>{
 const db=new D1TestDatabase(),bucket=new R2TestBucket();
 db.db.exec("INSERT INTO users(id,email) VALUES('u1','a@example.com'),('u2','b@example.com'); INSERT INTO courses(id,owner_user_id,name) VALUES('c1','u1','반응공학');");
 const repo=createCourseLibrary(db,bucket);
 const handler=createHttpHandler({db,bucket,authenticate:async request=>request.headers.get('authorization')==='Bearer a'?{id:'u1'}:request.headers.get('authorization')==='Bearer b'?{id:'u2'}:null});
 return {db,bucket,repo,handler};
};
test('A PDF preview is stored privately and available as a real MCP image',async()=>{
 const {repo,handler,bucket}=setup();
 const pdf=new Uint8Array(90);pdf.set([37,80,68,70,45],0);
 const {id}=await repo.upload('u1',{course_id:'c1',title:'손글씨 기출',source_type:'past_exam',filename:'scan.pdf',buffer:pdf});
 await repo.setPdfPageCount('u1',{material_id:id,page_count:1});
 const raster=new Uint8Array(90);raster.set([137,80,78,71,13,10,26,10],0);
 const response=await handler(new Request('https://site.example/api/v2/page-image',{method:'POST',headers:{
  authorization:'Bearer a','content-type':'image/png','x-material-id':id,'x-page-num':'1'
 },body:raster}));
 assert.equal(response.status,201);assert.equal(bucket.map.size,2);
 const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_course_page_image',arguments:{material_id:id,page_num:1}}};
 const invoke=user=>handler(new Request('https://site.example/mcp',{method:'POST',headers:{authorization:user,'content-type':'application/json','accept':'application/json, text/event-stream'},body:JSON.stringify(body)}));
 const mcp=await (await invoke('Bearer a')).json();
 assert.equal(mcp.result.content[0].type,'image');
 assert.deepEqual(new Uint8Array(Buffer.from(mcp.result.content[0].data,'base64')),raster);
 assert.equal((await (await invoke('Bearer b')).json()).result.isError,true);
});
test('Page upload rejects invalid bytes and unauthorized users',async()=>{
 const {repo,handler,bucket}=setup();
 const pdf=new Uint8Array(90);pdf.set([37,80,68,70,45],0);
 const {id}=await repo.upload('u1',{course_id:'c1',title:'자료',source_type:'lecture_slides',filename:'scan.pdf',buffer:pdf});
 await repo.setPdfPageCount('u1',{material_id:id,page_count:1});
 const request=(user,bytes)=>handler(new Request('https://site.example/api/v2/page-image',{method:'POST',headers:{
  authorization:user,'content-type':'image/png','x-material-id':id,'x-page-num':'1'
 },body:bytes}));
 assert.equal((await request('Bearer a',new Uint8Array(90))).status,400);
 const image=new Uint8Array(90);image.set([137,80,78,71,13,10,26,10],0);
 assert.equal((await request('Bearer b',image)).status,404);
 assert.equal(bucket.map.size,1);
});
test('PDF preparation saves text for each image and resumes an existing page',async()=>{
 const {repo,handler}=setup();
 const pdf=new Uint8Array(90);pdf.set([37,80,68,70,45]);
 const {id}=await repo.upload('u1',{course_id:'c1',title:'여러 페이지',source_type:'lecture_slides',filename:'lecture.pdf',buffer:pdf});
 await repo.setPdfPageCount('u1',{material_id:id,page_count:2});
 const image=new Uint8Array(90);image.set([255,216,255]);
 const save=(user,page,text)=>handler(new Request('https://site.example/api/v2/page-text',{method:'POST',headers:{authorization:user,'content-type':'application/json'},body:JSON.stringify({material_id:id,page_num:page,text})}));
 for(const page of [1,2]){
  await repo.uploadPageImage('u1',{material_id:id,page_num:page,mime_type:'image/jpeg',bytes:image});
  assert.equal((await save('Bearer a',page,`페이지 ${page} 원문`)).status,201);
 }
 assert.equal((await save('Bearer a',1,'이어하기 원문')).status,201);
 assert.deepEqual((await repo.pageStatus('u1',{material_id:id})).prepared_pages,[1,2]);
 assert.equal((await repo.getOriginalText('u1',{material_id:id,page_num:1})).pages[0].extracted_text,'이어하기 원문');
 assert.equal((await repo.getOriginalText('u1',{material_id:id,page_num:2})).pages[0].extracted_text,'페이지 2 원문');
 assert.equal((await save('Bearer b',1,'변조')).status,404);
});
