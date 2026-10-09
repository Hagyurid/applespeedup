import {test} from 'node:test';
import assert from 'node:assert/strict';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';
import {createCourseLibrary} from '../sites/course-v2.mjs';
import {handleMessage} from '../sites/mcp-core.mjs';
function setup(){
 const db=new D1TestDatabase(),bucket=new R2TestBucket();
 db.db.exec("INSERT INTO users(id,email) VALUES('alice','a@example.com'),('bob','b@example.com'); INSERT INTO courses(id,owner_user_id,name) VALUES('chem','alice','반응공학');");
 const repo=createCourseLibrary(db,bucket);
 const call=(user,name,args,allowWrites=true)=>handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},
   {authenticate:async()=>user,repo,allowWrites});
 return {db,bucket,repo,call};
}
const value=result=>JSON.parse(result.result.content[0].text);
test('ChatGPT transcript correction saves a separate verified copy and blocks other users',async()=>{
 const {repo,call}=setup();
 const {id}=await repo.registerText('alice',{course_id:'chem',title:'녹음 전사본',content:'티엘 모듈러스'});
 assert.equal(value(await call('alice','get_course_original_text',{material_id:id})).original_text,'티엘 모듈러스');
 assert.equal((await call('bob','get_course_original_text',{material_id:id})).result.isError,true);
 assert.equal((await call('alice','save_course_review_page',{material_id:id,page_num:1,raw_text:'티엘 모듈러스',corrected_text:'Thiele modulus'},false)).result.isError,true);
 assert.equal(value(await call('alice','save_course_review_page',{material_id:id,page_num:1,raw_text:'티엘 모듈러스',corrected_text:'Thiele modulus',unresolved:['수식 근거 확인 필요']})).review_status,'needs_review');
 assert.equal((await call('alice','finalize_course_review',{material_id:id,page_count:1})).result.isError,true);
 value(await call('alice','save_course_review_page',{material_id:id,page_num:1,raw_text:'티엘 모듈러스',corrected_text:'Thiele modulus',unresolved:[]}));
 value(await call('alice','finalize_course_review',{material_id:id,page_count:1}));
 assert.equal(value(await call('alice','get_course_verified_text',{material_id:id})).pages[0].corrected_text,'Thiele modulus');
 assert.equal((await repo.getOriginalText('alice',{material_id:id})).original_text,'티엘 모듈러스');
});
test('PDF page count, page image and review completeness stay scoped to the owner',async()=>{
 const {repo,call,bucket}=setup();
 const file=new Uint8Array(90);file.set([37,80,68,70,45],0);
 const {id}=await repo.upload('alice',{course_id:'chem',title:'2쪽 강의자료',source_type:'lecture_slides',filename:'lecture.pdf',buffer:file});
 await repo.setPdfPageCount('alice',{material_id:id,page_count:2});
 const raster=new Uint8Array(90);raster.set([137,80,78,71,13,10,26,10],0);
 await repo.uploadPageImage('alice',{material_id:id,page_num:1,mime_type:'image/png',bytes:raster});
 assert.equal(value(await call('alice','get_course_page_status',{material_id:id})).page_count,2);
 const image=await call('alice','get_course_page_image',{material_id:id,page_num:1});
 assert.equal(image.result.content[0].type,'image');
 assert.deepEqual(new Uint8Array(Buffer.from(image.result.content[0].data,'base64')),raster);
 assert.equal((await call('bob','get_course_page_image',{material_id:id,page_num:1})).result.isError,true);
 await repo.saveReview('alice',{material_id:id,page_num:1,raw_text:'원문',corrected_text:'교정'});
 await assert.rejects(()=>repo.finalizeReview('alice',{material_id:id,page_count:1}),/REVIEW_INCOMPLETE/);
 await assert.rejects(()=>repo.finalizeReview('alice',{material_id:id,page_count:2}),/REVIEW_INCOMPLETE/);
 assert.equal(bucket.map.size,2);
});
