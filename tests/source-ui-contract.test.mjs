import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../web/connected.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../web/connected.js',import.meta.url),'utf8');

test('source form separates user title from original filename',()=>{
  assert.match(html,/id="sourceTitle" required/);
  assert.match(html,/자료 제목 \(직접 입력\)/);
  assert.match(js,/name=\$\('sourceTitle'\)\.value\.trim\(\)/);
  assert.match(js,/\('X-Filename'\)|'X-Filename'/);
  assert.doesNotMatch(js,/sourceTitle'\)\.value\s*=\s*.*file\.name/);
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
