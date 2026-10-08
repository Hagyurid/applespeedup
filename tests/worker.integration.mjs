/** Actual built Worker in workerd/Miniflare, with real local D1/R2 emulation.
 * Identity headers emulate Sites dispatch; this does NOT test live ChatGPT login.
 * No persistence or network calls: each run starts empty and is disposed afterward.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const workerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=workerRequire('miniflare');
const server=resolve('dist/server');
const modules=['index.js',...readdirSync(server,{recursive:true}).filter(p=>/\.(js|mjs)$/.test(p)&&p!=='index.js')].map(path=>({type:'ESModule',path:resolve(server,path)}));
const mf=new Miniflare({modules,modulesRoot:server,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  bindings:{APLUS_WRITES_ENABLED:'true'},d1Databases:['DB'],r2Buckets:['BUCKET'],assets:{directory:resolve('dist/client'),routerConfig:{has_user_worker:true}}});
const alice={'oai-authenticated-user-id':'test-alice','oai-authenticated-user-email':'test-alice@example.com'};
const bob={'oai-authenticated-user-id':'test-bob','oai-authenticated-user-email':'test-bob@example.com'};
const request=(path,{headers=alice,method='GET',json,body}={})=>mf.dispatchFetch('https://app.example'+path,{method,redirect:'manual',headers:{...headers,...(json?{'content-type':'application/json'}:{})},...(json?{body:JSON.stringify(json)}:body!==undefined?{body}:{})});
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
try{
  const db=await mf.getD1Database('DB');
  const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
  for(const {tag} of journal.entries)for(const s of readFileSync(`drizzle/${tag}.sql`,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();
  await check('fresh D1 has no imported records',async()=>assert.equal((await db.prepare('SELECT count(*) AS n FROM courses').first()).n,0));
  await check('anonymous API and spoofed client user are denied',async()=>{
    assert.equal((await request('/api/courses',{headers:{}})).status,401);
    assert.equal((await request('/api/courses',{headers:{'x-user-id':'test-alice'}})).status,401);
  });
  await check('protected HTML redirects anonymous requests to Sites sign-in',async()=>{
    const r=await request('/',{headers:{}});assert.ok([302,303,307,308].includes(r.status));assert.match(r.headers.get('location'),/\/signin-with-chatgpt/);
  });
  await check('signed-in HTML serves the retained workspace and external module',async()=>{
    const r=await request('/');assert.equal(r.status,200);const html=await r.text();assert.match(html,/학습 작업 공간/);assert.match(html,/id="note-form"/);assert.match(html,/\/web\/connected.js/);
    const script=await request('/web/connected.js');assert.equal(script.status,200);assert.match(await script.text(),/\/api\/session/);
    assert.equal((await request('/domain/core.mjs')).status,200);
    assert.equal((await request('/favicon.svg')).status,200);
  });
  const c=await (await request('/api/courses',{method:'POST',json:{name:'Worker 검증 과목'}})).json();assert.ok(c.id);
  const o=await (await request('/api/offerings',{method:'POST',json:{course_id:c.id,year:2026,term:'2',professor:'검증 교수',section:'01'}})).json();assert.ok(o.id);
  const old=await (await request('/api/offerings',{method:'POST',json:{course_id:c.id,year:2025,term:'2',professor:'검증 교수',section:'01'}})).json();assert.ok(old.id);
  let source;
  const upload=()=>request('/api/assets',{method:'POST',headers:{...alice,'content-type':'application/octet-stream','x-offering-id':o.id,'x-source-type':'transcript','x-source-title':encodeURIComponent('전사본 검증'),'x-file-name':encodeURIComponent('전사본.txt')},body:new TextEncoder().encode('확산 저항과 Thiele modulus, D² / s.')});
  await check('R2 upload, duplicate suppression, download and scoped D1 search work',async()=>{
    const r=await upload();assert.equal(r.status,201);source=await r.json();assert.equal(source.extract_status,'ready');
    const second=await (await upload()).json();assert.equal(second.source_id,source.source_id);assert.equal(second.reused,true);
    assert.equal((await request('/api/files/'+source.source_id)).status,200);
    const hits=await (await request(`/api/search?offering_id=${o.id}&query=Thiele`)).json();assert.equal(hits[0].source_id,source.source_id);assert.match(hits[0].content,/D²/);
    assert.deepEqual(await (await request(`/api/search?offering_id=${old.id}&query=Thiele`)).json(),[]);
  });
  await check('PDF bytes remain pending and downloadable without claimed extraction',async()=>{
    const r=await request('/api/assets',{method:'POST',headers:{...alice,'content-type':'application/octet-stream','x-offering-id':o.id,'x-source-type':'lecture_slides','x-source-title':'PDF','x-file-name':'test.pdf'},body:new TextEncoder().encode('%PDF-1.4\n% local fixture; no parser')});assert.equal(r.status,201);
    const p=await r.json();assert.equal(p.extract_status,'pending');assert.equal((await request('/api/files/'+p.source_id)).status,200);
  });
  let note;
  await check('D1 note revision history and stale-edit protection survive the built Worker',async()=>{
    const body={offering_id:o.id,title:'정리본',content_markdown:'# 검증',request_id:'worker-test-note'};
    note=await (await request('/api/notes',{method:'POST',json:body})).json();assert.equal(note.revision,1);
    const same=await (await request('/api/notes',{method:'POST',json:body})).json();assert.equal(same.id,note.id);
    const edit={offering_id:o.id,note_id:note.id,expected_revision:1,title:'정리본',content_markdown:'# 수정'};
    assert.equal((await request('/api/notes',{method:'POST',json:edit})).status,201);assert.equal((await request('/api/notes',{method:'POST',json:edit})).status,409);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM note_versions WHERE note_id=?').bind(note.id).first()).n,2);
  });
  await check('another signed-in identity cannot read or alter saved data',async()=>{
    assert.deepEqual(await (await request('/api/courses',{headers:bob})).json(),[]);
    for(const path of [`/api/sources?offering_id=${o.id}`,`/api/search?offering_id=${o.id}&query=Thiele`,`/api/files/${source.source_id}`,`/api/notes?note_id=${note.id}`])assert.equal((await request(path,{headers:bob})).status,404);
    assert.equal((await request('/api/notes',{method:'POST',headers:bob,json:{offering_id:o.id,title:'금지',content_markdown:'금지'}})).status,404);
  });
  await check('concurrent note edits permit exactly one revision and preserve its history',async()=>{
    const edit={offering_id:o.id,note_id:note.id,expected_revision:2,title:'정리본',content_markdown:'# 동시 수정'};
    const responses=await Promise.all([request('/api/notes',{method:'POST',json:edit}),request('/api/notes',{method:'POST',json:{...edit,content_markdown:'# 다른 수정'}})]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM note_versions WHERE note_id=?').bind(note.id).first()).n,3);
  });
  await check('incomplete Site MCP stays closed',async()=>assert.equal((await request('/mcp',{method:'POST',json:{jsonrpc:'2.0',id:1,method:'tools/list'}})).status,503));
  console.log(`Worker integration: ${checks} checks passed. Live login and browser interaction remain unverified.`);
}finally{await mf.dispose();}
