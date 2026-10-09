import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCourseLibrary} from '../sites/course-v2.mjs';
import {extractOriginal} from '../sites/office-original.mjs';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';
import {documents} from './helpers/document-fixtures.mjs';
const bytes=s=>new Uint8Array(Buffer.from(s,'base64'));
function setup(){const db=new D1TestDatabase(),bucket=new R2TestBucket();db.db.exec("INSERT INTO users(id,email) VALUES('a','a@test'),('b','b@test'); INSERT INTO courses(id,owner_user_id,name) VALUES('c','a','과목')");return {repo:createCourseLibrary(db,bucket),db,bucket};}
function hwpFixture(){
 const b=Buffer.alloc(19*512),fat=b.subarray(512,1024),dir=b.subarray(1024,1536);
 b.set([208,207,17,224,161,177,26,225]);b.writeUInt16LE(9,30);b.writeUInt16LE(6,32);b.writeUInt32LE(1,44);b.writeUInt32LE(1,48);b.writeUInt32LE(4096,56);b.writeUInt32LE(0xfffffffe,60);b.writeUInt32LE(0xfffffffe,68);for(let i=0;i<109;i++)b.writeUInt32LE(0xffffffff,76+i*4);b.writeUInt32LE(0,76);
 fat.fill(255);fat.writeUInt32LE(0xfffffffd,0);fat.writeUInt32LE(0xfffffffe,4);for(let i=2;i<=17;i++)fat.writeUInt32LE(i===9||i===17?0xfffffffe:i+1,i*4);
 function entry(i,name,type,start,length,right=0xffffffff,child=0xffffffff){const d=dir.subarray(i*128,(i+1)*128),n=Buffer.from(name+'\0','utf16le');d.set(n);d.writeUInt16LE(n.length,64);d[66]=type;d.writeUInt32LE(0xffffffff,68);d.writeUInt32LE(right,72);d.writeUInt32LE(child,76);d.writeUInt32LE(start,116);d.writeUInt32LE(length,120);}
 entry(0,'Root Entry',5,0xfffffffe,0,0xffffffff,1);entry(1,'FileHeader',2,2,4096,2);entry(2,'BodyText',1,0xfffffffe,0,0xffffffff,3);entry(3,'Section0',2,10,4096);
 b.write('HWP Document File',3*512);const t=Buffer.from('한글 원문 유지','utf16le');b.writeUInt32LE((t.length<<20)|67,11*512);b.set(t,11*512+4);return new Uint8Array(b);
}
test('DOCX/HWP/HWPX/general TXT and MD use unchanged text without a review',async()=>{
 const {repo}=setup();
 const formats=[['docx',bytes(documents.docx),'교정하지 않은 DOCX 원문 123'],['hwpx',bytes(documents.hwpx),'교정하지 않은 HWPX 원문 456'],['hwp',hwpFixture(),'한글 원문 유지'],['txt',new TextEncoder().encode('원문  오타 그대로'),'원문  오타 그대로'],['md',new TextEncoder().encode('# 원문\n오타'),'# 원문\n오타']];
 for(const [ext,data,text] of formats){const m=await repo.upload('a',{course_id:'c',title:ext,source_type:'other',filename:'original.'+ext,buffer:data});const content=await repo.generationSource('a',{material_id:m.id});assert.equal(content.original_text,text);assert.equal(content.used_original,true);const j=await repo.startJob('a',{course_id:'c',mode:'detailed_note',source_ids:[m.id]});assert.ok(j.id);await assert.rejects(()=>repo.generationSource('b',{material_id:m.id}),/NOT_FOUND/);}
});
test('transcript bypass is explicit, persisted with extra requests, and keeps a warning in the note',async()=>{
 const {repo}=setup();const m=await repo.registerText('a',{course_id:'c',title:'전사본',content:'원본 오타'});
 await assert.rejects(()=>repo.startJob('a',{course_id:'c',mode:'detailed_note',source_ids:[m.id]}),/REVIEW_INCOMPLETE/);
 const j=await repo.startJob('a',{course_id:'c',mode:'detailed_note',source_ids:[m.id],original_source_ids:[m.id],additional_requests:'  유도 과정 포함  '});
 assert.equal((await repo.generationSource('a',{material_id:m.id,use_original:true})).original_text,'원본 오타');
 const p=await repo.getJobProgress('a',{job_id:j.id});assert.deepEqual(p.original_source_ids,[m.id]);assert.equal(p.additional_requests,'유도 과정 포함');
 await repo.saveOutline('a',{job_id:j.id,sections:[{title:'단원'}]});await repo.savePart('a',{job_id:j.id,section_index:1,content_markdown:'본문'});assert.match((await repo.getNote('a',{id:j.id})).content_markdown,/검수 없이 전사본 원문/);
 await assert.rejects(()=>repo.startJob('a',{course_id:'c',mode:'detailed_note',source_ids:[m.id],additional_requests:'x'.repeat(4001)}),/BAD_REQUEST/);
});
test('PDF/images/PPTX cannot bypass reviews and each PPTX slide has its own original text',async()=>{
 const {repo}=setup();
 const files=[['pdf',new TextEncoder().encode('%PDF-1.4 fixture')],['png',new Uint8Array([137,80,78,71,13,10,26,10])],['pptx',bytes(documents.pptx)]];
 for(const [ext,data] of files){const m=await repo.upload('a',{course_id:'c',title:ext,source_type:'lecture_slides',filename:'visual.'+ext,buffer:data});await assert.rejects(()=>repo.startJob('a',{course_id:'c',mode:'detailed_note',source_ids:[m.id]}),/REVIEW_INCOMPLETE/);await assert.rejects(()=>repo.generationSource('a',{material_id:m.id,use_original:true}),/BAD_REQUEST/);await assert.rejects(()=>repo.startJob('a',{course_id:'c',mode:'detailed_note',source_ids:[m.id],original_source_ids:[m.id]}),/BAD_REQUEST/);
 if(ext==='pptx'){assert.equal((await repo.pageStatus('a',{material_id:m.id})).page_count,2);assert.equal((await repo.getOriginalText('a',{material_id:m.id,page_num:2})).original_text,'두 번째 슬라이드');for(let page_num=1;page_num<=2;page_num++)await repo.saveReview('a',{material_id:m.id,page_num,raw_text:'원문',corrected_text:'검수본',unresolved:['전체 슬라이드 배치 확인 필요']});assert.equal((await repo.generationSource('a',{material_id:m.id,page_num:2})).used_original,false);}}
});
test('damaged and encrypted Office files never masquerade as readable text',()=>{
 assert.equal(extractOriginal(new Uint8Array([80,75,3,4]),'application/vnd.hancom.hwpx').text,null);
 const h=hwpFixture();new DataView(h.buffer).setUint32(3*512+36,2,true);assert.equal(extractOriginal(h,'application/x-hwp').text,null);
});
