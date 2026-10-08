import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHttpHandler} from '../sites/http.mjs';
import {D1TestDatabase as D1Mock,R2TestBucket as BucketMock} from './helpers/storage.mjs';
function suite(){
  const db=new D1Mock(),bucket=new BucketMock();
  for(const [id,email] of [['u1','user1@example.com'],['u2','user2@example.com'],['u3','user3@example.com']])
    db.db.prepare('INSERT INTO users(id,email) VALUES(?,?)').run(id,email);
  // Test-only auth resolver. Deployment MUST validate signed session/OAuth tokens.
  const handler=createHttpHandler({db,bucket,authenticate:async request=>{
    const credential=request.headers.get('authorization');
    return credential==='Bearer test-user-one'?{id:'u1'}:credential==='Bearer test-user-two'?{id:'u2'}:null;
  }});
  const request=async(path,{method='GET',user='u1',data,headers={}}={})=>{
    const auth=user==='u1'?'test-user-one':user==='u2'?'test-user-two':null;
    let body,requestHeaders={...headers};
    if(data!==undefined){body=JSON.stringify(data);requestHeaders['content-type']='application/json';}
    if(auth)requestHeaders.authorization='Bearer '+auth;
    const response=await handler(new Request('https://aplus.example'+path,{method,headers:requestHeaders,body}));
    return response;
  };
  return {db,bucket,handler,request};
}
test('HTTP requires verified authenticated principal, never trusts x-user-id',async()=>{
  const s=suite();
  const response=await s.request('/api/courses',{user:null,headers:{'x-user-id':'u1'}});
  assert.equal(response.status,401);
  assert.equal((await s.request('/api/courses',{method:'POST',user:null,data:{name:'Test'}})).status,401);
  assert.equal((await s.request('/health',{user:null})).status,200);
});
test('Cross-origin write and malformed payload blocked',async()=>{
  const s=suite();
  assert.equal((await s.request('/api/courses',{method:'POST',data:{name:'Bad'},headers:{origin:'https://foreign.example'}})).status,403);
  assert.equal((await s.request('/mcp',{method:'GET'})).status,405);
  assert.equal((await s.request('/mcp',{method:'POST',data:{jsonrpc:'2.0',id:1,method:'initialize'},headers:{accept:'application/json'}})).status,406);
});
test('Site HTTP API: create course, offering, transcript, searchable through MCP, save note',async()=>{
  const s=suite();
  const c=await s.request('/api/courses',{method:'POST',data:{name:'촉매반응공학',characteristics:'계산형'}});
  assert.equal(c.status,201);const cid=(await c.json()).id;
  const offering=await s.request('/api/offerings',{method:'POST',data:{course_id:cid,year:2026,term:'2',professor:'테스트 교수'}});
  assert.equal(offering.status,201);const oid=(await offering.json()).id;
  const old=await s.request('/api/offerings',{method:'POST',data:{course_id:cid,year:2025,term:'2',professor:'이전 교수'}});
  assert.equal(old.status,201);const oldId=(await old.json()).id;
  const source=await s.request('/api/transcripts',{method:'POST',data:{offering_id:oid,title:'Week 5 녹취 전사본',text:'Thiele modulus에 관한 설명입니다.\n\n교수님이 확산을 강조함.'}});
  assert.equal(source.status,201);const src=(await source.json()).source_id;
  assert.equal((await s.request(`/api/sources?offering_id=${oldId}`)).status,200);
  assert.deepEqual(await (await s.request(`/api/sources?offering_id=${oldId}`)).json(),[]);
  const tool=await s.request('/mcp',{method:'POST',headers:{accept:'application/json, text/event-stream'},
    data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'search_source_content',arguments:{offering_id:oid,query:'Thiele'}}}});
  assert.equal(tool.status,200);
  const results=JSON.parse((await tool.json()).result.content[0].text);
  assert.equal(results[0].source_id,src);
  const note=await s.request('/api/notes',{method:'POST',data:{offering_id:oid,title:'Week 5',content_markdown:'# 유효 계수'}});
  assert.equal(note.status,201);const n=await note.json();
  const update=await s.request('/api/notes',{method:'POST',data:{offering_id:oid,note_id:n.id,expected_revision:1,title:'Week 5',content_markdown:'# 효과도'}});
  assert.equal(update.status,201);
  const conflict=await s.request('/api/notes',{method:'POST',data:{offering_id:oid,note_id:n.id,expected_revision:1,title:'Old',content_markdown:'old'}});
  assert.equal(conflict.status,409);
  assert.equal((await (await s.request(`/api/notes?note_id=${n.id}`)).json()).content_markdown,'# 효과도');
  assert.equal((await s.request('/api/courses',{user:'u2'})).status,200);
  assert.deepEqual(await (await s.request('/api/courses',{user:'u2'})).json(),[]);
  assert.equal((await s.request(`/api/notes?note_id=${n.id}`,{user:'u2'})).status,404);
});
test('R2 text asset stored, searched and securely downloaded',async()=>{
  const s=suite();
  s.db.db.prepare("INSERT INTO courses(id,owner_user_id,name) VALUES('c','u1','반응공학')").run();
  s.db.db.prepare("INSERT INTO offerings(id,course_id,year,term) VALUES('o','c',2026,'2')").run();
  const upload=await s.handler(new Request('https://aplus.example/api/assets',{method:'POST',headers:{
    authorization:'Bearer test-user-one','content-type':'application/octet-stream',
    'x-offering-id':'o','x-source-type':'transcript','x-source-title':encodeURIComponent('5주차 전사본'),'x-file-name':'week5.txt'
  },body:new TextEncoder().encode('확산 저항\n\nThiele modulus')}));
  assert.equal(upload.status,201);const meta=await upload.json();
  assert.equal(meta.extract_status,'ready');assert.equal(s.bucket.map.size,1);
  const file=await s.request(`/api/files/${meta.source_id}`);
  assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/attachment/);
  assert.equal(await file.text(),'확산 저항\n\nThiele modulus');
  assert.equal((await s.request(`/api/files/${meta.source_id}`,{user:'u2'})).status,404);
});
test('R2 PDF stored pending (no fictitious extraction); rejects invalid PDF',async()=>{
  const s=suite();
  s.db.db.prepare("INSERT INTO courses(id,owner_user_id,name) VALUES('c','u1','반응공학')").run();
  s.db.db.prepare("INSERT INTO offerings(id,course_id,year,term) VALUES('o','c',2026,'2')").run();
  const req=(body)=>s.handler(new Request('https://aplus.example/api/assets',{method:'POST',headers:{
    authorization:'Bearer test-user-one','content-type':'application/octet-stream','x-offering-id':'o',
    'x-source-type':'lecture_slides','x-source-title':encodeURIComponent('강의 PDF'),'x-file-name':'week5.pdf'
  },body}));
  assert.equal((await req(new TextEncoder().encode('not really PDF'))).status,400);
  const ok=await req(new TextEncoder().encode('%PDF-1.7\nsynthetic PDF bytes'));
  assert.equal(ok.status,201);assert.equal((await ok.json()).extract_status,'pending');
});
test('MCP initialized notification returns 202 and no body',async()=>{
  const s=suite();
  const response=await s.request('/mcp',{method:'POST',headers:{accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',method:'notifications/initialized'}});
  assert.equal(response.status,202);assert.equal(await response.text(),'');
});
test('Viewer may read own shared class but cannot write notes, upload or transcripts',async()=>{
  const s=suite();
  s.db.db.prepare("INSERT INTO courses(id,owner_user_id,name) VALUES('course','u1','화학반응공학')").run();
  s.db.db.prepare("INSERT INTO course_members(course_id,user_id,role) VALUES('course','u2','viewer')").run();
  s.db.db.prepare("INSERT INTO offerings(id,course_id,year,term) VALUES('current','course',2026,'2')").run();
  const offerings=await (await s.request('/api/offerings?course_id=course',{user:'u2'})).json();
  assert.equal(offerings.length,1);
  const noTranscript=await s.request('/api/transcripts',{user:'u2',method:'POST',data:{offering_id:'current',title:'권한없는 저장',text:'임의내용'}});
  assert.equal(noTranscript.status,403);
  const noNote=await s.request('/api/notes',{user:'u2',method:'POST',data:{offering_id:'current',title:'부적절',content_markdown:'임의'}});
  assert.equal(noNote.status,403);
  const noUpload=await s.handler(new Request('https://aplus.example/api/assets',{method:'POST',headers:{
    authorization:'Bearer test-user-two','content-type':'application/octet-stream','x-offering-id':'current',
    'x-source-type':'transcript','x-source-title':'test','x-file-name':'test.txt'
  },body:new TextEncoder().encode('hello')}));
  assert.equal(noUpload.status,403);
  assert.equal(s.bucket.map.size,0);
});
test('Previous academic years and professor/exam facts stay attributable to each offering',async()=>{
  const s=suite();
  s.db.db.prepare("INSERT INTO courses(id,owner_user_id,name) VALUES('c','u1','촉매반응공학')").run();
  s.db.db.prepare("INSERT INTO offerings(id,course_id,year,term,professor) VALUES('old','c',2025,'2','교수 A')").run();
  s.db.db.prepare("INSERT INTO offerings(id,course_id,year,term,professor) VALUES('now','c',2026,'2','교수 B')").run();
  const fact=await s.request('/api/facts',{method:'POST',data:{offering_id:'old',fact_key:'exam_type',fact_value:'서술형 위주',provenance:'2025 기출',confidence:'observed'}});
  assert.equal(fact.status,201);
  const current=await (await s.request('/api/course-context?offering_id=now')).json();
  assert.equal(current.offering.year,2026);
  assert.equal(current.facts.length,0);
  assert.deepEqual(current.previous_offerings.map(x=>x.id),['old']);
  const prior=await (await s.request('/api/course-context?offering_id=old')).json();
  assert.equal(prior.facts[0].provenance,'2025 기출');
  assert.equal(prior.facts[0].confidence,'observed');
  const bad=await s.request('/api/facts',{method:'POST',data:{offering_id:'now',fact_key:'exam_type',fact_value:'시험 변경',confidence:'guaranteed'}});
  assert.equal(bad.status,400);
});
