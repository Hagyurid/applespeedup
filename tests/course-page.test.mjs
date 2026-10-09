import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../web/connected.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../web/connected.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/connected.css',import.meta.url),'utf8');

test('강의 관리에는 과목 등록 패널만 보인다',()=>{
  const courses=html.split('id="page-courses"')[1]?.split('id="page-sources"')[0];
  assert.ok(courses,'강의 관리 페이지 누락');
  assert.match(courses,/id="course-form"/);
  assert.match(courses,/id="courseName"/);
  assert.match(courses,/id="characteristics"/);
  assert.equal((courses.match(/class="card workspace-card"/g)||[]).length,1,'강의 관리에 패널은 하나만 남겨야 함');
  for(const id of ['offering-form','fact-form','factsList','professor','section','factConfidence','factKey']) {
    assert.doesNotMatch(courses,new RegExp('id="'+id+'"'),'불필요한 입력: '+id);
  }
  assert.match(courses,/id="offering" hidden/,'기존 DB 호환을 위한 보이지 않는 강의 ID가 필요');
});

test('전사본·GPT·정리본 화면은 유지한다',()=>{
  for(const id of ['page-sources','page-gpt','page-notes','source-form','search-form','note-form','copyPrompt','noteList']) {
    assert.ok(html.includes('id="'+id+'"'),'필수 화면이 제거됨: '+id);
  }
  assert.match(css,/\.course-layout\{grid-template-columns:minmax\(0,720px\)\}/);
});

test('삭제한 교수·학년도 입력 폼을 더는 호출하지 않는다',()=>{
  for(const old of ["$('offering-form')","$('fact-form')","$('factsList')","renderFacts()"]){
    assert.ok(!script.includes(old),'삭제한 UI 참조가 남음: '+old);
  }
  assert.doesNotMatch(script,/createOffering|call\('\/api\/offerings'/);
  assert.match(script,/call\(\x60\/api\/v2\/materials/);
  assert.match(script,/await refreshOfferingData\(\)/);
});
