import {test} from 'node:test';import assert from 'node:assert/strict';
import {SOURCE_TYPES,MODES,chooseSources,makeRequest,validateOffering,splitTranscript,validateNote,nextStep,markStep,safeText} from '../domain/core.mjs';
const c={id:'c1',name:'촉매반응공학',characteristics:'계산형'};const o={id:'o1',courseId:'c1',year:2026,term:'2',professor:'김교수',notes:'현재 슬라이드 우선'};
const ss=[{id:'new',offeringId:'o1',type:'lecture_slides',extractStatus:'ready'},{id:'old',offeringId:'o2',type:'past_exam',extractStatus:'ready'},{id:'tr',offeringId:'o1',type:'transcript',extractStatus:'ready'},{id:'oldcurrent',offeringId:'o1',type:'past_exam',extractStatus:'ready'}];
test('9 creation modes and transcript type exist',()=>{assert.equal(Object.keys(MODES).length,9);assert.equal(SOURCE_TYPES.transcript,'강의 전사본');});
test('validate academic offering',()=>{assert.equal(validateOffering(o).year,2026);assert.throws(()=>validateOffering({...o,year:'twenty'}));});
test('source selection must never include another offering',()=>{assert.deepEqual(chooseSources({sources:ss,offeringId:'o1',mode:'detailed_note'}).map(x=>x.id),['new','tr','oldcurrent']);});
test('GPT request includes offering and distinguishes past exams',()=>{const r=makeRequest({course:c,offering:o,sources:ss,mode:'exam_paper',scope:'5주차'});assert.match(r.text,/offering_id=o1/);assert.match(r.text,/과거 자료 \(참고 전용\)/);assert.doesNotMatch(r.text,/id=old[\s,]/);});
test('missing source makes warning not fake ready',()=>{const r=makeRequest({course:c,offering:o,sources:[],mode:'outline'});assert.ok(r.warnings.length);});
test('text chunks preserve original',()=>{const s='첫 번째 부분입니다.\n\n두 번째 부분도 있습니다.';assert.equal(splitTranscript(s,200).join('\n\n'),s);});
test('note validation rejects blank',()=>{assert.ok(validateNote({offeringId:'o1',title:' ',content:''}).length);});
test('job resume is deterministic',()=>{let j={completedSteps:[]};assert.equal(nextStep(j),'context');j=markStep(j,'context');assert.equal(nextStep(j),'sources');for(const s of ['sources','outline','generate','verify','save'])j=markStep(j,s);assert.equal(nextStep(j),'complete');});
test('HTML display sanitization',()=>{assert.equal(safeText('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');});

// Scientific notation must survive text chunking without NFKC flattening.
test('transcript chunks retain superscripts and Unicode scientific symbols',()=>{
  assert.equal(splitTranscript('D² / s · μ · ½')[0],'D² / s · μ · ½');
});
