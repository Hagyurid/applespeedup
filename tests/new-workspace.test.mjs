import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {D1TestDatabase} from './helpers/storage.mjs';
import {createD1Repository} from '../sites/repository.mjs';
import {createAiPipeline} from '../sites/ai-pipeline.mjs';

const html=readFileSync(new URL('../web/connected.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../web/connected.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/connected.css',import.meta.url),'utf8');

test('Six responsive workspaces retain course registration, transcript, GPT, notes, SolvePad and CASIO',()=>{
 for(const id of ['page-courses','page-sources','page-gpt','page-notes','page-solvepad','page-casio','globalCourse','sourcePicker','jobSelect','copyResume','noteVersion','restoreNoteVersion','notePreview','solveInk','solveAnswer','solveQuestionList','casioForm']){
   assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.doesNotMatch(html,/iframe|\/legacy\//);
 const courses=html.split('id="page-courses"')[1].split('id="page-sources"')[0];
 assert.doesNotMatch(courses,/id="offering-form"|id="fact-form"/);
 assert.match(css,/\.mobile-nav\{grid-template-columns:repeat\(6/);
});
test('Source picker only adds reviewed items and sends explicit source ID list',()=>{
 assert.match(js,/reviewed_with_issues/);
 assert.match(js,/state\.selectedIds\.clear\(\)/);
 assert.match(js,/selectedSources\(\)\.filter\(isReviewed\)/);
 assert.match(js,/get_course_verified_text/);
 assert.match(js,/save_course_outline/);
 assert.match(js,/save_course_part/);
});
test('Review gate means completed OCR and transcript pages only are visible',async()=>{
 const db=new D1TestDatabase();const repo=createD1Repository(db),ai=createAiPipeline(db);
 db.db.exec("INSERT INTO users(id,email) VALUES('u1','x@example.com');INSERT INTO courses(id,owner_user_id,name) VALUES('c1','u1','Catalysis');INSERT INTO offerings(id,course_id,year,term) VALUES('o1','c1',2026,'2');");
 await repo.registerUploadedAsset('u1',{id:'pdf1',offering_id:'o1',source_type:'past_exam',title:'Handwritten',storage_key:'k',sha256:'ab'});
 assert.equal((await repo.listSources('u1',{offering_id:'o1'}))[0].review_status,'pending_review');
 await assert.rejects(()=>ai.getVerifiedSourceText('u1',{source_id:'pdf1'}),/REVIEW_INCOMPLETE/);
 await ai.saveReviewedPage('u1',{source_id:'pdf1',page_num:1,recognized_text:'raw scan',corrected_text:'verified OCR'});
 await ai.finalizeSourceReview('u1',{source_id:'pdf1',total_pages:1});
 assert.equal((await repo.listSources('u1',{offering_id:'o1'}))[0].review_status,'reviewed');
 const text=await ai.getVerifiedSourceText('u1',{source_id:'pdf1'});
 assert.equal(text.pages[0].content,'verified OCR');
 assert.equal(text.text_origin,'corrected_text');
});
