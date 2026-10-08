import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1Repository} from '../sites/repository.mjs';
import {handleMessage} from '../sites/mcp-core.mjs';

class D1Mock {
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../sites/schema.sql',import.meta.url),'utf8'));}
  prepare(sql){return {bind:(...args)=>({
    first: async()=>this.db.prepare(sql).get(...args)||null,
    all: async()=>({results:this.db.prepare(sql).all(...args)}),
    run: async()=>({meta:{changes:Number(this.db.prepare(sql).run(...args).changes)}})
  })};}
  async batch(items){
    const result=[];this.db.exec('BEGIN TRANSACTION');
    try {for(const item of items){result.push(await item.run());}this.db.exec('COMMIT');return result;}
    catch(err){this.db.exec('ROLLBACK');throw err;}
  }
  seed(){
    const db=this.db;
    db.prepare('INSERT INTO users(id,email) VALUES(?,?)').run('u1','user1@example.com');
    db.prepare('INSERT INTO users(id,email) VALUES(?,?)').run('u2','user2@example.com');
    db.prepare('INSERT INTO users(id,email) VALUES(?,?)').run('u3','user3@example.com');
    db.prepare('INSERT INTO courses(id,owner_user_id,name,characteristics) VALUES(?,?,?,?)').run('course1','u1','촉매반응공학','수식·계산 중심');
    db.prepare("INSERT INTO course_members(course_id,user_id,role) VALUES('course1','u2','viewer')").run();
    db.prepare("INSERT INTO offerings(id,course_id,year,term,professor) VALUES('current','course1',2026,'2','테스트 교수')").run();
    db.prepare("INSERT INTO offerings(id,course_id,year,term,professor) VALUES('old','course1',2025,'2','이전 교수')").run();
    db.prepare("INSERT INTO course_facts(id,course_id,offering_id,fact_key,fact_value,provenance,confidence) VALUES('fact1','course1','current','exam_type','계산형','시험 안내','official')").run();
  }
}
const db=new D1Mock();db.seed();const repo=createD1Repository(db);
const call=(user,name,args)=>handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}, {authenticate:async()=>user,repo});
const unpack=x=>JSON.parse(x.result.content[0].text);
const isError=x=>x.result.isError;

test('read course/offering context and facts by year',async()=>{
  const c=unpack(await call('u1','get_course_context',{offering_id:'current'}));
  assert.equal(c.course.name,'촉매반응공학');assert.equal(c.offering.year,2026);assert.equal(c.facts[0].confidence,'official');
  const prev=unpack(await call('u1','get_course_context',{offering_id:'old'}));assert.equal(prev.facts.length,0);
});

test('text transcript ingestion and scoped search/read via MCP',async()=>{
  const r=await repo.ingestTranscript('u1',{offering_id:'current',title:'5주차 강의 전사본',text:'확산 저항과 유효계수를 설명합니다.\n\nThiele modulus 라는 표현을 사용합니다.'});
  assert.equal(r.extract_status,'ready');
  const list=unpack(await call('u1','list_sources',{offering_id:'current'}));
  assert.equal(list.length,1);assert.equal(list[0].source_type,'transcript');
  const matches=unpack(await call('u1','search_source_content',{offering_id:'current',query:'Thiele'}));
  assert.equal(matches.length,1);assert.equal(matches[0].source_id,r.source_id);
  assert.equal(unpack(await call('u1','search_source_content',{offering_id:'old',query:'Thiele'})).length,0);
  const content=unpack(await call('u1','get_source_content',{source_id:r.source_id}));assert.equal(content.length,1);
  assert.match(content[0].content,/확산 저항/);
});

test('private auth, viewer may read but not write',async()=>{
  assert.ok(isError(await call('u3','get_course_context',{offering_id:'current'})));
  const result=await call('u2','save_note',{offering_id:'current',title:'무단 수정',content_markdown:'데이터'});
  assert.equal(result.result.content[0].text,'Not authorized');
  await assert.rejects(()=>repo.ingestTranscript('u2',{offering_id:'current',title:'bad',text:'cannot edit'}),{code:'FORBIDDEN'});
});

test('save note, fetch content, optimistic revision and preserve history',async()=>{
  const created=unpack(await call('u1','save_note',{offering_id:'current',title:'Week 5',content_markdown:'# 물질전달'}));
  assert.equal(created.revision,1);
  const fetched=unpack(await call('u1','get_note',{note_id:created.id}));assert.equal(fetched.content_markdown,'# 물질전달');
  const updated=unpack(await call('u1','save_note',{offering_id:'current',note_id:created.id,expected_revision:1,title:'Week 5',content_markdown:'# 수정된 내용'}));
  assert.equal(updated.revision,2);
  const conflict=await call('u1','save_note',{offering_id:'current',note_id:created.id,expected_revision:1,title:'Week 5',content_markdown:'# 오래된 수정'});
  assert.equal(conflict.result.content[0].text,'Revision conflict');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM note_versions WHERE note_id=?').bind(created.id).first()).n,2);
});

test('create job, checkpoint and read ownership',async()=>{
  const created=unpack(await call('u1','create_job',{offering_id:'current',mode:'detailed_note',scope:'Week 5'}));
  assert.equal(created.status,'pending');
  const changed=unpack(await call('u1','save_checkpoint',{job_id:created.job_id,step:'sources',status:'done'}));
  assert.deepEqual(changed.completed_steps,['sources']);
  const fetched=unpack(await call('u1','get_job',{job_id:created.job_id}));assert.equal(fetched.status,'partial');
  assert.equal((await call('u2','get_job',{job_id:created.job_id})).result.content[0].text,'Not authorized');
});

test('MCP parameter validation rejects improper integers and arbitrary fields',async()=>{
  const out=await call('u1','get_source_content',{source_id:'abc',limit:200});assert.equal(out.error.code,-32602);
  const out2=await call('u1','get_note',{note_id:'abc',sql:'DROP TABLE courses'});assert.equal(out2.error.code,-32602);
});
