import {test} from 'node:test';
import assert from 'node:assert/strict';
import {D1TestDatabase} from './helpers/storage.mjs';
import {createAiPipeline} from '../sites/ai-pipeline.mjs';
import {createD1Repository} from '../sites/repository.mjs';

function fixture(){
 const db=new D1TestDatabase();
 db.db.exec(`
 INSERT INTO users(id,email) VALUES ('u1','a@example.com'),('u2','b@example.com');
 INSERT INTO courses(id,owner_user_id,name) VALUES ('c1','u1','촉매반응공학');
 INSERT INTO offerings(id,course_id,year,term) VALUES ('o1','c1',2026,'2');
 `);
 return {db,ai:createAiPipeline(db),repo:createD1Repository(db)};
}
test('unreviewed scan and transcript cannot be included in generated notes',async()=>{
 const {ai,repo}=fixture();
 await repo.registerUploadedAsset('u1',{id:'scan',offering_id:'o1',source_type:'past_exam',title:'스캔 기출',storage_key:'r2/scan',sha256:'hash'});
 await assert.rejects(()=>ai.beginGeneration('u1',{course_id:'c1',mode:'detailed_note',source_ids:['scan']}),/REVIEW_INCOMPLETE/);
 await ai.saveReviewedPage('u1',{source_id:'scan',page_num:1,recognized_text:'k=I/0?',corrected_text:'k = ? (미확인)',unresolved:['분모 기호 판독 불가']});
 await assert.rejects(()=>ai.finalizeSourceReview('u1',{source_id:'scan',total_pages:1}),/REVIEW_INCOMPLETE/);
 await assert.rejects(()=>ai.beginGeneration('u1',{course_id:'c1',mode:'detailed_note',source_ids:['scan']}),/REVIEW_INCOMPLETE/);
});
test('evidence-based reviewed pages become searchable only after full review',async()=>{
 const {db,ai,repo}=fixture();
 await repo.registerUploadedAsset('u1',{id:'scan',offering_id:'o1',source_type:'lecture_slides',title:'강의 자료',storage_key:'r2/scan',sha256:'hash'});
 await ai.saveReviewedPage('u1',{source_id:'scan',page_num:1,recognized_text:'Thie1e',corrected_text:'Thiele modulus',evidence_source_ids:['scan']});
 await assert.rejects(()=>ai.finalizeSourceReview('u1',{source_id:'scan',total_pages:2}),/REVIEW_INCOMPLETE/);
 await ai.saveReviewedPage('u1',{source_id:'scan',page_num:2,recognized_text:'eta = 1',corrected_text:'eta = 1'});
 const done=await ai.finalizeSourceReview('u1',{source_id:'scan',total_pages:2});
 assert.equal(done.review_status,'reviewed');
 const hits=await repo.searchSourceContent('u1',{offering_id:'o1',query:'Thiele'});
 assert.equal(hits[0].page_num,1);
 assert.equal(db.db.prepare('SELECT extract_status FROM source_assets WHERE id=?').get('scan').extract_status,'ready');
 const raw=await ai.getReviewedPage('u1',{source_id:'scan',page_num:1});
 assert.equal(raw.recognized_text,'Thie1e');assert.equal(raw.corrected_text,'Thiele modulus');
});
test('outline is persisted before generation; every section automatically saves note revision',async()=>{
 const {db,ai,repo}=fixture();
 await repo.registerUploadedAsset('u1',{id:'src',offering_id:'o1',source_type:'transcript',title:'전사본',text:'확산 저항에 대한 설명입니다.',sha256:'hash'});
 await ai.saveReviewedPage('u1',{source_id:'src',page_num:1,recognized_text:'확산 저항에 대한 설명입니다.',corrected_text:'확산 저항에 대한 설명입니다.'});
 await ai.finalizeSourceReview('u1',{source_id:'src',total_pages:1});
 const run=await ai.beginGeneration('u1',{course_id:'c1',mode:'detailed_note',scope:'1주차',source_ids:['src']});
 assert.equal(run.status,'awaiting_outline');
 await assert.rejects(()=>ai.saveGeneratedSection('u1',{run_id:run.run_id,section_index:1,content_markdown:'미리 작성'}),/OUTLINE_REQUIRED/);
 await ai.saveGenerationOutline('u1',{run_id:run.run_id,sections:[{title:'기초'},{title:'응용'}]});
 assert.deepEqual((await ai.getGenerationProgress('u1',{run_id:run.run_id})).outline.map(x=>x.title),['기초','응용']);
 const first=await ai.saveGeneratedSection('u1',{run_id:run.run_id,section_index:1,content_markdown:'첫 번째 자동 저장'});
 assert.equal(first.autosaved,true);assert.equal(first.status,'generating');assert.ok(first.note_id);
 assert.match((await repo.getNote('u1',{note_id:first.note_id})).content_markdown,/첫 번째 자동 저장/);
 const second=await ai.saveGeneratedSection('u1',{run_id:run.run_id,section_index:2,content_markdown:'두 번째 자동 저장'});
 assert.equal(second.note_id,first.note_id);assert.equal(second.status,'complete');assert.equal(second.revision,2);
 const again=await ai.saveGeneratedSection('u1',{run_id:run.run_id,section_index:2,content_markdown:'두 번째 자동 저장'});
 assert.equal(again.revision,2);
 assert.equal(db.db.prepare('SELECT count(*) AS n FROM note_versions WHERE note_id=?').get(first.note_id).n,2);
 const note=await repo.getNote('u1',{note_id:first.note_id});assert.match(note.content_markdown,/첫 번째 자동 저장/);assert.match(note.content_markdown,/두 번째 자동 저장/);
 await assert.rejects(()=>ai.saveGeneratedSection('u1',{run_id:run.run_id,section_index:1,content_markdown:'임의 덮어쓰기'}),/REVISION_CONFLICT/);
 await assert.rejects(()=>ai.getGenerationProgress('u2',{run_id:run.run_id}),/NOT_FOUND|FORBIDDEN/);
});
test('different course evidence not allowed; malformed GPT inputs rejected',async()=>{
 const {db,ai,repo}=fixture();
 db.db.exec("INSERT INTO courses(id,owner_user_id,name) VALUES ('c2','u2','다른 과목'); INSERT INTO offerings(id,course_id,year,term) VALUES ('o2','c2',2026,'2');");
 await repo.registerUploadedAsset('u1',{id:'a',offering_id:'o1',source_type:'transcript',title:'교정',text:'반응속도 계수',sha256:'a'});
 await repo.registerUploadedAsset('u2',{id:'b',offering_id:'o2',source_type:'transcript',title:'상대편',text:'다른 과목',sha256:'b'});
 await assert.rejects(()=>ai.saveReviewedPage('u1',{source_id:'a',page_num:1,recognized_text:'입력',corrected_text:'교정',evidence_source_ids:['b']}),/NOT_FOUND|FORBIDDEN/);
 await assert.rejects(()=>ai.saveReviewedPage('u1',{source_id:'a',page_num:1,recognized_text:'입력',corrected_text:'교정',unresolved:[''] }),/BAD_REQUEST/);
 await assert.rejects(()=>ai.beginGeneration('u1',{course_id:'c1',mode:'detailed_note',source_ids:['b']}),/NOT_FOUND|FORBIDDEN/);
});
