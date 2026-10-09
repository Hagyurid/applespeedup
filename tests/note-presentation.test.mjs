import test from 'node:test';
import assert from 'node:assert/strict';
import {compactNoteIntroduction} from '../domain/note-presentation.mjs';
test('legacy introductions shrink without discarding learning content',()=>{
 const original='## 자료 검토 주의사항\n\n- 자료 · 3쪽: 압력 불일치\n- 자료 · 28쪽: 도표 누락\n\n## 자료 범위·출제 근거·검수 상태 및 확인 필요\n\n# 1. 자료 식별\n과목명 불일치, 올해 실제 시험 범위 확인 필요\n\n## 시험 직전 핵심\n\n# 2. 공식\n$$\nP V = n R T\n$$';
 const result=compactNoteIntroduction(original);assert.ok(result.split("\n").filter(x=>x.startsWith("- ")).length<=3);assert.match(result,/압력 불일치/);assert.match(result,/# 2. 공식[\s\S]*P V = n R T/);assert.doesNotMatch(result,/# 1. 자료 식별/);
 assert.equal(compactNoteIntroduction('## 개념\n\n본문'), '## 개념\n\n본문');
});
