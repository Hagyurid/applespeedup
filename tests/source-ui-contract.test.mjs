import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../web/connected.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../web/connected.js',import.meta.url),'utf8');

test('source form uses the filename without a separate title input',()=>{
  assert.doesNotMatch(html,/id="sourceTitle"/);
  assert.doesNotMatch(js,/sourceTitle/);
  assert.match(js,/name=file\?\.name/);
  assert.match(html,/GPT 생성 자료/);
  assert.doesNotMatch(html,/전사본 원문 사용/);

});
test('past exam year is exclusive to ordinary source weeks',()=>{
  assert.match(html,/id="weeksField"/);
  assert.match(html,/id="examYearField" hidden/);
  assert.match(js,/sourceType'\)\.value==='past_exam'/);
  assert.match(js,/\$\('weeksField'\)\.hidden=exam/);
  assert.match(js,/\$\('examYearField'\)\.hidden=!exam/);
  assert.match(js,/const weeks=type==='past_exam'\?\[\]:sourceWeeks\(\)/);
  assert.match(js,/X-Weeks/);
  assert.match(js,/X-Exam-Year/);
});
