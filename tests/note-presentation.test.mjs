import test from 'node:test';
import assert from 'node:assert/strict';
import {compactNoteIntroduction} from '../domain/note-presentation.mjs';
test('legacy introductions shrink without discarding learning content',()=>{
 const original='## 자료 검토 주의사항\n\n- 자료 · 3쪽: 압력 불일치\n- 자료 · 28쪽: 도표 누락\n\n## 자료 범위·출제 근거·검수 상태 및 확인 필요\n\n# 1. 자료 식별\n과목명 불일치, 올해 실제 시험 범위 확인 필요\n\n## 시험 직전 핵심\n\n# 2. 공식\n$$\nP V = n R T\n$$';
 const result=compactNoteIntroduction(original);assert.ok(result.split("\n").filter(x=>x.startsWith("- ")).length<=3);assert.match(result,/압력 불일치/);assert.match(result,/# 2. 공식[\s\S]*P V = n R T/);assert.doesNotMatch(result,/# 1. 자료 식별/);
 assert.equal(compactNoteIntroduction('## 개념\n\n본문'), '## 개념\n\n본문');
});

import {legacyEquationTex} from '../domain/note-math.mjs';
test('legacy equations retain indices and turn unambiguous quotients into fractions',()=>{
 assert.equal(legacyEquationTex('P₁V₁=P₂V₂'), 'P_{1}V_{1}=P_{2}V_{2}');
 assert.equal(legacyEquationTex('P=nRT/V'), 'P=\\frac{nRT}{V}');
 assert.equal(legacyEquationTex('u_rms=√(3RT/M)'), 'u_{\\mathrm{rms}}=\\sqrt{\\frac{3RT}{M}}');
 assert.equal(legacyEquationTex('W=Δ(½mu²)'), 'W=\\Delta (\\frac{1}{2}mu^{2})');
 assert.equal(legacyEquationTex('과목=위험사회'),null);
});
