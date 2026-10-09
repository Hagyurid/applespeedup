import test from 'node:test';
import assert from 'node:assert/strict';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';
import {createCourseLibrary} from '../sites/course-v2.mjs';
import {createDraftStore} from '../web/local-drafts.js';
function setup(){const db=new D1TestDatabase(),bucket=new R2TestBucket();db.db.exec("INSERT INTO users(id,email) VALUES('alice','a@test.io'),('bob','b@test.io');INSERT INTO courses(id,owner_user_id,name) VALUES('c','alice','화학');");return {db,bucket,repo:createCourseLibrary(db,bucket)}}
const pdf=()=>{const b=new Uint8Array(80);b.set([37,80,68,70,45]);return b};
test('original search is scoped and unreviewed transcripts stay excluded',async()=>{
 const {repo}=setup();
 await repo.upload('alice',{course_id:'c',source_type:'other',filename:'원문.txt',buffer:new TextEncoder().encode('처음\n반응속도 검색 원문')});
 await repo.registerText('alice',{course_id:'c',content:'전사본에만있는표현'});
 assert.equal((await repo.search('alice',{course_id:'c',query:'반응속도'})).length,1);
 assert.equal((await repo.search('alice',{course_id:'c',query:'전사본에만있는표현'})).length,0);
 await assert.rejects(()=>repo.search('bob',{course_id:'c',query:'반응속도'}),/NOT_FOUND/);
});
test('concurrent pasted retries converge without erasing reviewed text',async()=>{
 const {repo,db}=setup();const input={course_id:'c',content:'동일 전사본 내용',weeks:[1]};
 const saved=await Promise.all([repo.registerText('alice',input),repo.registerText('alice',input)]);
 assert.equal(saved[0].id,saved[1].id);
 await repo.saveReview('alice',{material_id:saved[0].id,page_num:1,raw_text:input.content,corrected_text:'검수본',unresolved:[]});
 await repo.registerText('alice',{...input,weeks:[2]});
 assert.equal(db.db.prepare('SELECT count(*) AS n FROM course_materials').get().n,1);
 assert.equal((await repo.verifiedText('alice',{material_id:saved[0].id})).pages[0].corrected_text,'검수본');
});
test('concurrent devices cannot overwrite an attempt based on a stale revision',async()=>{
 const {repo}=setup();const p=await repo.savePack('alice',{course_id:'c',title:'문제팩',pack:{questions:[{id:'q',promptMd:'문제',answer:{value:'1'},solution:'해설'}]}});
 const input={pack_id:p.id,question_id:'q'};const first=await repo.saveAttempt('alice',{...input,result:'wrong'});assert.equal(first.revision,1);
 const results=await Promise.allSettled([repo.saveAttempt('alice',{...input,expected_revision:1,result:'correct'}),repo.saveAttempt('alice',{...input,expected_revision:1,result:'wrong'})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/REVISION_CONFLICT/);
 assert.equal((await repo.listAttempts('alice',{pack_id:p.id}))[0].revision,2);
 await assert.rejects(()=>repo.saveAttempt('alice',{...input,result:'wrong'}),/REVISION_CONFLICT/);
});
test('failed file deletion remains retryable and cannot be read or used for generation',async()=>{
 const {repo,bucket,db}=setup();const m=await repo.upload('alice',{course_id:'c',source_type:'lecture_slides',filename:'검증.pdf',buffer:pdf()});
 const remove=bucket.delete.bind(bucket);bucket.delete=async()=>{throw Error('simulated failure')};
 await assert.rejects(()=>repo.deleteMaterial('alice',{id:m.id}),/STORAGE_DELETE_FAILED/);
 assert.equal(db.db.prepare('SELECT review_status FROM course_materials').get().review_status,'deletion_pending');
 await assert.rejects(()=>repo.getFile('alice',{id:m.id}),/STORAGE_DELETE_FAILED/);
 assert.equal((await repo.listMaterials('alice',{course_id:'c'}))[0].available_for_generation,false);
 bucket.delete=remove;await repo.deleteMaterial('alice',{id:m.id});assert.equal(bucket.map.size,0);
});
test('course deletion failure blocks subsequent writes and owner can retry',async()=>{
 const {repo,bucket,db}=setup();await repo.upload('alice',{course_id:'c',source_type:'other',filename:'검증.pdf',buffer:pdf()});
 const remove=bucket.delete.bind(bucket);bucket.delete=async()=>{throw Error('simulated failure')};
 await assert.rejects(()=>repo.deleteCourse('alice',{id:'c'}),/STORAGE_DELETE_FAILED/);
 assert.equal(db.db.prepare('SELECT deletion_pending FROM courses').get().deletion_pending,1);
 await assert.rejects(()=>repo.registerText('alice',{course_id:'c',content:'새 쓰기 차단'}),/NOT_FOUND/);
 bucket.delete=remove;await repo.deleteCourse('alice',{id:'c'});assert.equal(bucket.map.size,0);assert.equal(db.db.prepare('SELECT count(*) AS n FROM courses').get().n,0);
});
test('PDF image and text completion are independent, including an empty scanned page',async()=>{
 const {repo}=setup();const m=await repo.upload('alice',{course_id:'c',source_type:'lecture_slides',filename:'검증.pdf',buffer:pdf()});
 await repo.setPdfPageCount('alice',{material_id:m.id,page_count:1});const image=new Uint8Array(80);image.set([255,216,255]);
 await repo.uploadPageImage('alice',{material_id:m.id,page_num:1,mime_type:'image/jpeg',bytes:image});
 let status=await repo.pageStatus('alice',{material_id:m.id});assert.deepEqual(status.prepared_pages,[1]);assert.deepEqual(status.text_ready_pages,[]);
 await repo.savePageText('alice',{material_id:m.id,page_num:1,text:''});status=await repo.pageStatus('alice',{material_id:m.id});assert.deepEqual(status.text_ready_pages,[1]);
});
test('device drafts are isolated by verified user and storage failure warns only once',()=>{
 const previous=globalThis.localStorage,data=new Map();
 globalThis.localStorage={setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k),removeItem:k=>data.delete(k)};
 try{const alice=createDraftStore('alice'),bob=createDraftStore('bob');alice.write('ink:q',{result:'wrong'});assert.equal(bob.read('ink:q'),null);assert.equal(alice.read('ink:q').result,'wrong');alice.remove('ink:q');assert.equal(alice.read('ink:q'),null);
 let errors=0;globalThis.localStorage.setItem=()=>{throw Error('quota')};const limited=createDraftStore('alice',()=>errors++);limited.write('a',{});limited.write('b',{});assert.equal(errors,1);
 }finally{globalThis.localStorage=previous}
});
