import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('document history migration keeps existing notes and generation progress',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  for(let i=0;i<=5;i++){
   const tag=['0000_talented_pixie','0001_source_weeks','0002_ai_workflow_guard','0003_source_page_images','0004_course_library','0005_course_pdf_pages'][i];
   for(const sql of readFileSync(`drizzle/${tag}.sql`,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))db.exec(sql);
  }
  db.exec("INSERT INTO users(id,email) VALUES('u','u@example.com'); INSERT INTO courses(id,owner_user_id,name) VALUES('c','u','과목');");
  db.exec("INSERT INTO course_documents(id,course_id,title,content_markdown,revision) VALUES('d','c','기존 정리본','기존 본문',3);");
  db.exec("INSERT INTO course_generation_jobs(id,course_id,user_id,mode,document_id,status) VALUES('j','c','u','detailed_note','d','generating');");
  for(const sql of readFileSync('drizzle/0006_document_versions.sql','utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))db.exec(sql);
  const version=db.prepare("SELECT revision,title,content_markdown FROM course_document_versions WHERE document_id='d'").get();
  assert.deepEqual({...version},{revision:3,title:'기존 정리본',content_markdown:'기존 본문'});
  assert.equal(db.prepare("SELECT document_revision FROM course_generation_jobs WHERE id='j'").get().document_revision,3);
 }finally{db.close()}
});
