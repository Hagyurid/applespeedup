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
 assert.equal(value(await call('alice','save_course_review_page',{material_id:id,page_num:1,raw_text:'티엘 모듈러스',corrected_text:'Thiele modulus',unresolved:['수식 근거 확인 필요']})).review_status,'reviewed_with_issues');
 const reviewed=value(await call('alice','get_course_verified_text',{material_id:id}));
 assert.deepEqual(reviewed.pages[0].unresolved,['수식 근거 확인 필요']);
 const job=value(await call('alice','start_course_generation',{course_id:'chem',mode:'detailed_note',source_ids:[id]}));
 assert.deepEqual(job.review_concerns[0].unresolved,['수식 근거 확인 필요']);
 value(await call('alice','save_course_outline',{job_id:job.id,sections:[{title:'정리'}]}));
 value(await call('alice','save_course_part',{job_id:job.id,section_index:1,content_markdown:'확인된 개념'}));
 assert.match((await repo.getNote('alice',{id:job.id})).content_markdown,/확인 필요[\s\S]*수식 근거 확인 필요/);
 assert.equal((await repo.getJobProgress('alice',{job_id:job.id})).review_concerns.length,1);
 value(await call('alice','save_course_review_page',{material_id:id,page_num:1,raw_text:'티엘 모듈러스',corrected_text:'Thiele modulus',unresolved:[]}));
 assert.equal((await repo.listMaterials('alice',{course_id:'chem'}))[0].review_status,'reviewed');
 assert.equal(value(await call('alice','get_course_verified_text',{material_id:id})).pages[0].corrected_text,'Thiele modulus');
 assert.equal((await repo.getOriginalText('alice',{material_id:id})).original_text,'티엘 모듈러스');
});
test('PDF page count, page image and review completeness stay scoped to the owner',async()=>{
 const {repo,call,bucket,db}=setup();
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
 assert.equal((await repo.verifiedText('alice',{material_id:id})).available_for_generation,false);
 await assert.rejects(()=>repo.startJob('alice',{course_id:'chem',mode:'detailed_note',source_ids:[id]}),/REVIEW_INCOMPLETE/);
 await repo.uploadPageImage('alice',{material_id:id,page_num:2,mime_type:'image/png',bytes:raster});
 await repo.saveReview('alice',{material_id:id,page_num:2,raw_text:'数値',corrected_text:'수치 미확인',unresolved:['단위 판독 필요']});
 assert.equal((await repo.listMaterials('alice',{course_id:'chem'}))[0].review_status,'reviewed_with_issues');
 // Existing saved reviews become usable without a migration or re-save.
 db.db.prepare("UPDATE course_materials SET review_status='pending_review' WHERE id=?").run(id);
 assert.equal((await repo.listMaterials('alice',{course_id:'chem'}))[0].available_for_generation,true);
 const job=await repo.startJob('alice',{course_id:'chem',mode:'detailed_note',source_ids:[id]});
 assert.equal(job.review_concerns[0].page_num,2);
 await assert.rejects(()=>repo.verifiedText('bob',{material_id:id,page_num:2}),/NOT_FOUND/);
 await assert.rejects(()=>repo.saveReview('bob',{material_id:id,page_num:2,raw_text:'raw',corrected_text:'x'}),/NOT_FOUND/);
 assert.equal(bucket.map.size,3);
});
