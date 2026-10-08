import {test} from 'node:test';
import assert from 'node:assert/strict';
import {D1TestDatabase,R2TestBucket} from './helpers/storage.mjs';
import {handleSitesRequest} from '../sites/runtime.mjs';
import {readSitesPrincipal} from '../sites/auth.mjs';

function suite(){
  const DB=new D1TestDatabase(),BUCKET=new R2TestBucket();
  const request=(path,{user='alice',method='GET',body,headers={}}={})=>handleSitesRequest(new Request('https://app.example'+path,{method,headers:{
    ...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.com'}:{}),
    ...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),{DB,BUCKET,APLUS_WRITES_ENABLED:'true'});
  return {DB,BUCKET,request};
}
async function lecture(s,user='alice',year=2026,section='01'){
  const c=await (await s.request('/api/courses',{user,method:'POST',body:{name:'촉매반응공학'}})).json();
  const o=await (await s.request('/api/offerings',{user,method:'POST',body:{course_id:c.id,year,term:'2',professor:'교수',section}})).json();
  return o.id;
}

test('Sites adapter requires both dispatch headers; caller tokens, JSON IDs and bypass are not identities',async()=>{
  const s=suite();
  for(const headers of [{'x-user-id':'alice'}, {'authorization':'Bearer alice'},{'OAI-Sites-Authorization':'Bearer service'}, {'oai-authenticated-user-id':'alice'}]){
    const r=await s.request('/api/courses',{user:null,method:'POST',body:{name:'금지',user_id:'alice'},headers});assert.equal(r.status,401);
  }
  assert.equal(s.DB.db.prepare('SELECT count(*) AS n FROM users').get().n,0);
});

test('Verified login enrolls a stable user; display-name decoding is optional and never authorization',async()=>{
  const s=suite();
  const r=await s.request('/api/session',{headers:{'oai-authenticated-user-full-name':encodeURIComponent('김규리'),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}});
  assert.equal(r.status,200);assert.equal((await r.json()).display_name,'김규리');
  await s.request('/api/courses');assert.equal(s.DB.db.prepare('SELECT count(*) AS n FROM users').get().n,1);
  const bad=readSitesPrincipal(new Request('https://app.example',{headers:{'oai-authenticated-user-id':'a','oai-authenticated-user-email':'a@example.com','oai-authenticated-user-full-name':'%broken','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}}));
  assert.equal(bad.displayName,'a@example.com');
});

test('Sites adapter denies cross-site requests without enrolling users and fails closed on missing storage',async()=>{
  const s=suite();assert.equal((await s.request('/api/courses',{method:'POST',body:{name:'blocked'},headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal(s.DB.db.prepare('SELECT count(*) AS n FROM users').get().n,0);
  const r=await handleSitesRequest(new Request('https://app.example/api/courses',{headers:{'oai-authenticated-user-id':'a','oai-authenticated-user-email':'a@example.com'}}),{});assert.equal(r.status,503);
});

test('Course and offering duplicates reuse records; academic years and class sections remain distinct',async()=>{
  const s=suite(),first=await lecture(s),again=await lecture(s),otherSection=await lecture(s,'alice',2026,'02'),old=await lecture(s,'alice',2025,'01');
  assert.equal(first,again);assert.notEqual(first,otherSection);assert.notEqual(first,old);
  assert.equal(s.DB.db.prepare('SELECT count(*) AS n FROM courses').get().n,1);
});

test('Sites real handler denies another user course, transcript, source, file, note and writes',async()=>{
  const s=suite(),oid=await lecture(s);const cid=s.DB.db.prepare('SELECT course_id FROM offerings WHERE id=?').get(oid).course_id;
  const t=await (await s.request('/api/transcripts',{method:'POST',body:{offering_id:oid,title:'Week 2',text:'반응 속도'}})).json();
  const n=await (await s.request('/api/notes',{method:'POST',body:{offering_id:oid,title:'정리',content_markdown:'본문'}})).json();
  assert.deepEqual(await (await s.request('/api/courses',{user:'bob'})).json(),[]);
  for(const path of [`/api/offerings?course_id=${cid}`,`/api/course-context?offering_id=${oid}`,`/api/sources?offering_id=${oid}`,`/api/search?offering_id=${oid}&query=반응`,`/api/files/${t.source_id}`,`/api/notes?note_id=${n.id}`])assert.equal((await s.request(path,{user:'bob'})).status,404);
  assert.equal((await s.request('/api/transcripts',{user:'bob',method:'POST',body:{offering_id:oid,title:'침입',text:'금지'}})).status,404);
});

test('Identical uploads and pasted transcripts deduplicate per lecture and type, with one R2 object',async()=>{
  const s=suite(),oid=await lecture(s);
  // env binding names must be explicit, as in the Worker.
  const env={DB:s.DB,BUCKET:s.BUCKET,APLUS_WRITES_ENABLED:'true'};
  const send=()=>handleSitesRequest(new Request('https://app.example/api/assets',{method:'POST',headers:{'oai-authenticated-user-id':'alice','oai-authenticated-user-email':'alice@example.com','content-type':'application/octet-stream','x-offering-id':oid,'x-source-type':'transcript','x-source-title':encodeURIComponent('전사본'),'x-file-name':'week.txt'},body:new TextEncoder().encode('물질전달의 저항')}),env);
  const first=await (await send()).json(),next=await (await send()).json();assert.equal(first.source_id,next.source_id);assert.equal(next.reused,true);assert.equal(s.BUCKET.map.size,1);
  const pasted=await (await s.request('/api/transcripts',{method:'POST',body:{offering_id:oid,title:'복사한 전사본',text:'물질전달의 저항'}})).json();assert.equal(first.source_id,pasted.source_id);
  const old=await lecture(s,'alice',2025);const oldSource=await (await s.request('/api/transcripts',{method:'POST',body:{offering_id:old,title:'이전 강의',text:'물질전달의 저항'}})).json();assert.notEqual(oldSource.source_id,first.source_id);
});

test('A retried note creation has one saved version; stale edits cannot overwrite it',async()=>{
  const s=suite(),oid=await lecture(s),body={offering_id:oid,title:'정리',content_markdown:'본문',request_id:'stable-request-123'};
  const first=await (await s.request('/api/notes',{method:'POST',body})).json(),second=await (await s.request('/api/notes',{method:'POST',body})).json();assert.equal(first.id,second.id);assert.equal(second.reused,true);
  const edit={offering_id:oid,note_id:first.id,expected_revision:1,title:'정리',content_markdown:'수정'};
  assert.equal((await s.request('/api/notes',{method:'POST',body:edit})).status,201);assert.equal((await s.request('/api/notes',{method:'POST',body:edit})).status,409);
  assert.equal(s.DB.db.prepare('SELECT count(*) AS n FROM note_versions WHERE note_id=?').get(first.id).n,2);
  assert.equal((await s.request('/api/notes',{method:'POST',body:{...body,content_markdown:'다른 내용'}})).status,409);
});

test('Site plugin remains unavailable until its separate connection milestone',async()=>{
  const s=suite();assert.equal((await s.request('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).status,503);
});

test('A hosted preview defaults to read-only; a caller cannot enable writes in headers or JSON',async()=>{
  const DB=new D1TestDatabase(),BUCKET=new R2TestBucket();
  const headers={'oai-authenticated-user-id':'alice','oai-authenticated-user-email':'alice@example.com','content-type':'application/json','x-writes-enabled':'true'};
  const r=await handleSitesRequest(new Request('https://app.example/api/courses',{method:'POST',headers,body:JSON.stringify({name:'blocked',APLUS_WRITES_ENABLED:'true'})}),{DB,BUCKET});
  assert.equal(r.status,423);assert.equal(DB.db.prepare('SELECT count(*) AS n FROM users').get().n,0);
  const session=await handleSitesRequest(new Request('https://app.example/api/session',{headers}),{DB,BUCKET});
  assert.equal((await session.json()).mutations_enabled,false);
});
