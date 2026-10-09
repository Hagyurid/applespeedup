import test from 'node:test';
import assert from 'node:assert/strict';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';
import {createCourseLibrary,handleCourseRequest} from '../sites/course-v2.mjs';

function setup(){
 const db=new D1TestDatabase(),bucket=new R2TestBucket();
 db.db.exec("INSERT INTO users(id,email) VALUES('alice','a@test.io'),('bob','b@test.io'); INSERT INTO courses(id,owner_user_id,name) VALUES('chem','alice','촉매반응공학'),('math','bob','수학');");
 return {db,bucket,repo:createCourseLibrary(db,bucket)};
}
test('course-first registration needs no offering, year, professor or term',async()=>{
 const {repo,db}=setup();
 const item=await repo.registerText('alice',{course_id:'chem',title:'직접 쓴 강의 전사본',source_type:'transcript',weeks:[3,4],content:'삼 주차 속도론 시험'});
 const rows=await repo.listMaterials('alice',{course_id:'chem'});
 assert.equal(rows.length,1);assert.deepEqual(rows[0].weeks,[3,4]);assert.equal(rows[0].title,'직접 쓴 강의 전사본');
 assert.equal(db.db.prepare('SELECT count(*) AS n FROM offerings').get().n,0);
 await assert.rejects(()=>repo.listMaterials('bob',{course_id:'chem'}),/NOT_FOUND/);
 await assert.rejects(()=>repo.verifiedText('alice',{material_id:item.id}),/REVIEW_INCOMPLETE/);
 await repo.saveReview('alice',{material_id:item.id,page_num:1,raw_text:'삼 주차 속도론 시험',corrected_text:'3주차 반응속도론',unresolved:[]});
 await repo.finalizeReview('alice',{material_id:item.id,page_count:1});
 const v=await repo.verifiedText('alice',{material_id:item.id});
 assert.equal(v.pages[0].corrected_text,'3주차 반응속도론');
 assert.equal(v.provenance,'corrected_ocr_or_transcript_only');
});
test('exam metadata is year-only and user title cannot be replaced by upload filename',async()=>{
 const {repo,bucket}=setup();
 const file=new Uint8Array(70);file.set([37,80,68,70,45],0);
 const out=await repo.upload('alice',{course_id:'chem',title:'직접 지정한 기말고사',source_type:'past_exam',weeks:[],exam_year:2024,filename:'scan_final_123.pdf',buffer:file});
 const rows=await repo.listMaterials('alice',{course_id:'chem'});
 assert.equal(rows[0].title,'직접 지정한 기말고사');assert.equal(rows[0].exam_year,2024);
 assert.equal(rows[0].file_name,'scan_final_123.pdf');assert.equal(rows[0].review_status,'pending_review');
 assert.equal(bucket.map.size,1);
 await assert.rejects(()=>repo.upload('alice',{course_id:'chem',title:'기말',source_type:'past_exam',weeks:[1],exam_year:2024,filename:'b.pdf',buffer:file}),/BAD_REQUEST/);
 await assert.rejects(()=>repo.startJob('alice',{course_id:'chem',mode:'detailed_note',source_ids:[out.id]}),/REVIEW_INCOMPLETE/);
});
test('outline is required and every section autosaves the same study note',async()=>{
 const {repo}=setup();
 const id=(await repo.registerText('alice',{course_id:'chem',title:'자료',content:'정상 텍스트'})).id;
 await repo.saveReview('alice',{material_id:id,page_num:1,raw_text:'정상 텍스트',corrected_text:'검토한 텍스트'});
 await repo.finalizeReview('alice',{material_id:id,page_count:1});
 const {id:job}=await repo.startJob('alice',{course_id:'chem',mode:'detailed_note',source_ids:[id]});
 await assert.rejects(()=>repo.savePart('alice',{job_id:job,section_index:1,content_markdown:'본문'}),/OUTLINE_REQUIRED/);
 await repo.saveOutline('alice',{job_id:job,sections:[{title:'기초'},{title:'응용'}]});
 const first=await repo.savePart('alice',{job_id:job,section_index:1,content_markdown:'첫 문단'});
 assert.equal(first.autosaved,true);assert.equal(first.status,'generating');
 const next=await repo.savePart('alice',{job_id:job,section_index:2,content_markdown:'둘째 문단'});
 assert.equal(next.status,'complete');assert.equal(next.document_id,first.document_id);
 const content=await repo.getNote('alice',{id:next.document_id});
 assert.match(content.content_markdown,/첫 문단/);assert.match(content.content_markdown,/둘째 문단/);
 await assert.rejects(()=>repo.savePart('alice',{job_id:job,section_index:1,content_markdown:'덮어쓰기'}),/REVISION_CONFLICT/);
});
test('course notes, SolvePad packs/attempts and CASIO projects are authorized',async()=>{
 const {repo}=setup();
 const note=await repo.saveNote('alice',{course_id:'chem',title:'내 정리본',content_markdown:'# 반응공학'});
 assert.equal((await repo.getNote('alice',{id:note.id})).revision,1);
 const revised=await repo.saveNote('alice',{course_id:'chem',id:note.id,title:'수정본',content_markdown:'# 교정',expected_revision:1});
 assert.equal(revised.revision,2);
 await assert.rejects(()=>repo.saveNote('alice',{course_id:'chem',id:note.id,title:'손상',content_markdown:'bad',expected_revision:1}),/REVISION_CONFLICT/);
 const pack={schemaVersion:'solvepad.problemPack.v5',questions:[{id:'q1',body:'2+2=?'}]};
 const p=await repo.savePack('alice',{course_id:'chem',title:'연습문제',pack});
 assert.equal((await repo.getPack('alice',{id:p.id})).pack.schemaVersion,'solvepad.problemPack.v5');
 await repo.saveAttempt('alice',{pack_id:p.id,question_id:'q1',answer:'4',strokes:[[1,2]],bookmarked:true});
 assert.match((await repo.getAttempt('alice',{pack_id:p.id,question_id:'q1'})).data_json,/"answer":"4"/);
 const cp=await repo.saveCasio('alice',{course_id:'chem',title:'반응기 프로그램',blueprint_json:'{"name":"R"}',program_text:'1->A'});
 assert.equal((await repo.getCasio('alice',{id:cp.id})).title,'반응기 프로그램');
 await assert.rejects(()=>repo.getPack('bob',{id:p.id}),/NOT_FOUND/);
 await assert.rejects(()=>repo.getCasio('bob',{id:cp.id}),/NOT_FOUND/);
});
test('course API returns reviewed-only content and restricts unauthorised search',async()=>{
 const {repo,db,bucket}=setup();
 const id=(await repo.registerText('alice',{course_id:'chem',title:'전사본',content:'반응 속도'})).id;
 const req=(path)=>new Request('https://app.example'+path);
 const before=await handleCourseRequest(req('/api/v2/reviewed?id='+id),{db,bucket,userId:'alice'});
 assert.equal(before.status,422);
 const outsiders=await handleCourseRequest(req('/api/v2/materials?course_id=chem'),{db,bucket,userId:'bob'});
 assert.equal(outsiders.status,404);
 await repo.saveReview('alice',{material_id:id,page_num:1,raw_text:'반응 속도',corrected_text:'반응속도 상수'});
 await repo.finalizeReview('alice',{material_id:id,page_count:1});
 const results=await handleCourseRequest(req('/api/v2/search?course_id=chem&query='+encodeURIComponent('반응속도')),{db,bucket,userId:'alice'});
 assert.equal(results.status,200);
 assert.equal((await results.json())[0].source_title,'전사본');
});
