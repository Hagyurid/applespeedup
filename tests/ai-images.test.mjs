import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHttpHandler} from '../sites/http.mjs';
import {handleMessage} from '../sites/mcp-core.mjs';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';
import {createAiPipeline} from '../sites/ai-pipeline.mjs';
const setup=()=>{
 const db=new D1TestDatabase(),bucket=new R2TestBucket();
 db.db.exec("INSERT INTO users(id,email) VALUES('u1','a@example.com'),('u2','b@example.com'); INSERT INTO courses(id,owner_user_id,name) VALUES('c1','u1','반응공학'); INSERT INTO offerings(id,course_id,year,term) VALUES('o1','c1',2026,'2'); INSERT INTO source_assets(id,offering_id,source_type,title,extract_status) VALUES('s1','o1','past_exam','기출','pending');");
 return {db,bucket,handler:createHttpHandler({db,bucket,authenticate:async req=>req.headers.get('authorization')==='Bearer a'?{id:'u1'}:req.headers.get('authorization')==='Bearer b'?{id:'u2'}:null})};
};
test('page raster is stored in private R2 and delivered to GPT tool as real image',async()=>{
 const {db,bucket,handler}=setup();
 const raster=new Uint8Array(90);raster.set([137,80,78,71,13,10,26,10],0);
 const resp=await handler(new Request('https://site.example/api/ai/source-page-image',{method:'POST',headers:{
  authorization:'Bearer a','content-type':'image/png','x-source-id':'s1','x-page-num':'1'
 },body:raster}));
 assert.equal(resp.status,201);assert.equal(bucket.map.size,1);
 const ai=createAiPipeline(db,bucket);
 const call=(user)=>handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_source_page_image',arguments:{source_id:'s1',page_num:1}}},
  {authenticate:async()=>user,repo:ai});
 const result=await call('u1');
 assert.equal(result.result.content[0].type,'image');
 assert.equal(result.result.content[0].mimeType,'image/png');
 assert.deepEqual(new Uint8Array(Buffer.from(result.result.content[0].data,'base64')),raster);
 assert.equal((await call('u2')).result.isError,true);
});
test('page image endpoint rejects invalid bytes and unauthorized users',async()=>{
 const {handler,bucket}=setup();
 const request=(user,bytes,mime='image/png')=>handler(new Request('https://site.example/api/ai/source-page-image',{method:'POST',headers:{
  authorization:user,'content-type':mime,'x-source-id':'s1','x-page-num':'1'
 },body:bytes}));
 assert.equal((await request('Bearer a',new Uint8Array(60))).status,400);
 assert.equal((await request('Bearer b',new Uint8Array([137,80,78,71,...new Array(80).fill(0)]))).status,404);
 assert.equal(bucket.map.size,0);
});
