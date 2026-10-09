import test from 'node:test';
import assert from 'node:assert/strict';
import {D1TestDatabase} from './helpers/storage.mjs';
import {createCourseLibrary,handleCourseRequest,MAX_COURSE_UPLOAD_BYTES} from '../sites/course-v2.mjs';
test('50 MiB PDF reaches storage without raising page count or image limits',async()=>{
 const db=new D1TestDatabase();db.db.exec("INSERT INTO users(id,email) VALUES('u','u@test.io');INSERT INTO courses(id,owner_user_id,name) VALUES('c','u','과목');");
 let storedSize=0;const bucket={put:async(key,bytes)=>{storedSize=bytes.byteLength},delete:async()=>{}};
 const bytes=new Uint8Array(MAX_COURSE_UPLOAD_BYTES);bytes.set([37,80,68,70,45]);
 const saved=await createCourseLibrary(db,bucket).upload('u',{course_id:'c',source_type:'lecture_slides',filename:'large.pdf',buffer:bytes});
 assert.ok(saved.id);assert.equal(storedSize,50*1024*1024);assert.equal(db.db.prepare('SELECT page_count FROM course_materials').get().page_count,0);
});
test('HTTP rejects oversized or mismatched declared upload size before storing',async()=>{
 const db=new D1TestDatabase();let writes=0;const bucket={put:async()=>writes++,delete:async()=>{}};
 const request=size=>new Request('https://site.test/api/v2/upload',{method:'POST',headers:{'x-upload-size':String(size),'content-type':'application/octet-stream'},body:new Uint8Array([37,80,68,70,45])});
 const oversized=await handleCourseRequest(request(MAX_COURSE_UPLOAD_BYTES+1),{db,bucket,userId:'u'});assert.equal(oversized.status,413);
 const mismatch=await handleCourseRequest(request(6),{db,bucket,userId:'u'});assert.equal(mismatch.status,400);assert.equal(writes,0);
});
