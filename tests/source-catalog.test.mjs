import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Repository} from '../sites/repository.mjs';
import {storeAsset} from '../sites/assets.mjs';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';

function setup(){
  const db=new D1TestDatabase();
  db.db.prepare("INSERT INTO users(id,email) VALUES('u1','user1@example.com')").run();
  db.db.prepare("INSERT INTO courses(id,owner_user_id,name) VALUES('c1','u1','촉매반응공학')").run();
  db.db.prepare("INSERT INTO offerings(id,course_id,year,term) VALUES('o1','c1',2026,'2')").run();
  return {db,repo:createD1Repository(db),bucket:new R2TestBucket()};
}
test('source catalog uses entered title and weeks, not original filename',async()=>{
  const {repo}=setup();
  const r=await repo.registerUploadedAsset('u1',{id:'src1',offering_id:'o1',source_type:'lecture_slides',title:'내가 직접 쓴 제목',file_name:'IMG_0927.pdf',sha256:'sha1',storage_key:'mock',weeks:[3,1]});
  assert.equal(r.source_id,'src1');
  const [item]=await repo.listSources('u1',{offering_id:'o1'});
  assert.equal(item.title,'내가 직접 쓴 제목');
  assert.equal(item.file_name,'IMG_0927.pdf');
  assert.deepEqual(item.weeks,[1,3]);
  assert.equal(item.exam_year,null);
});
test('past exam supports year, rejects weeks; ordinary sources reject exam year',async()=>{
  const {repo}=setup();
  await repo.registerUploadedAsset('u1',{id:'exam1',offering_id:'o1',source_type:'past_exam',title:'기말고사',file_name:'unlabeled.pdf',sha256:'sha2',storage_key:'mock',exam_year:2024});
  const [item]=await repo.listSources('u1',{offering_id:'o1'});
  assert.equal(item.exam_year,2024);
  assert.deepEqual(item.weeks,[]);
  await assert.rejects(()=>repo.registerUploadedAsset('u1',{id:'bad1',offering_id:'o1',source_type:'past_exam',title:'기출',sha256:'s3',storage_key:'mock',weeks:[1],exam_year:2024}),/BAD_REQUEST/);
  await assert.rejects(()=>repo.registerUploadedAsset('u1',{id:'bad2',offering_id:'o1',source_type:'transcript',title:'전사본',sha256:'s4',storage_key:'mock',exam_year:2024}),/BAD_REQUEST/);
});
test('reupload of identical PDF updates user catalog data and preserves R2 original',async()=>{
  const {repo,bucket}=setup();
  const bytes=new TextEncoder().encode('%PDF-1.4\nscanned content');
  const file={name:'scan_original.pdf',size:bytes.length,arrayBuffer:async()=>bytes.buffer};
  const a=await storeAsset({bucket,repository:repo,userId:'u1',offeringId:'o1',file,sourceType:'past_exam',title:'시험자료 최초 제목',exam_year:2023});
  const b=await storeAsset({bucket,repository:repo,userId:'u1',offeringId:'o1',file,sourceType:'past_exam',title:'사용자가 바꾼 기말고사',exam_year:2024});
  assert.equal(b.reused,true);assert.equal(b.metadata_updated,true);assert.equal(a.source_id,b.source_id);
  assert.equal(bucket.map.size,1);
  const [src]=await repo.listSources('u1',{offering_id:'o1'});
  assert.equal(src.title,'사용자가 바꾼 기말고사');assert.equal(src.exam_year,2024);
  assert.equal(src.file_name,'scan_original.pdf');assert.equal(src.extract_status,'pending');
});
test('pasted transcript duplicate honors new user-entered title and week',async()=>{
  const {repo}=setup();
  const a=await repo.ingestTranscript('u1',{offering_id:'o1',title:'첫 이름',text:'반응속도론 녹취록',weeks:[1]});
  const b=await repo.ingestTranscript('u1',{offering_id:'o1',title:'수정한 이름',text:'반응속도론 녹취록',weeks:[2]});
  assert.equal(b.source_id,a.source_id);assert.equal(b.metadata_updated,true);
  const [src]=await repo.listSources('u1',{offering_id:'o1'});
  assert.equal(src.title,'수정한 이름');assert.deepEqual(src.weeks,[2]);
});
