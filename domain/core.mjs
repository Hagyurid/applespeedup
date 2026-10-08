/** 에쁠가속기 shared deterministic domain functions. No AI calls here. */
export const SOURCE_TYPES = Object.freeze({
  lecture_slides:'강의 슬라이드', transcript:'강의 전사본', textbook:'교재',
  past_exam:'과거 기출', exam_trend:'시험 경향', syllabus:'강의계획서', other:'기타'
});
export const MODES = Object.freeze({
  outline:'목차·단원 매핑', detailed_note:'상세 정리본', subnote:'2단 필기용 서브노트',
  exam_paper:'시험형 문제집', exam_cram:'시험 직전 압축본', exam_trends:'출제 경향 분석',
  transcript_fix:'전사본 교정', errors:'오답노트', calculator:'CASIO PRGM 설계'
});
export const DEFAULT_PRESETS = {
  outline: {detail:'중간',format:'웹 목차',rules:['현재 강의자료의 목차와 페이지를 근거로 구성','과거 기출은 목차의 사실 근거로 사용하지 않음','중복 단원과 누락 페이지 확인']},
  detailed_note: {detail:'상세',format:'웹 정리본',rules:['강의 슬라이드 우선, 교재·교정 전사본 보충','정의·수식·기호·단위·가정·예제 분리','원본 파일과 페이지 근거 표시','없는 내용과 불확실한 내용 명시']},
  subnote: {detail:'상세',format:'A4 2단(오른쪽 필기 여백)',rules:['본문 왼쪽, 필기 여백 오른쪽','구조화된 수식으로 보관하고 출력마다 적합한 수식으로 변환','인쇄 가능한 흑백 구성']},
  exam_paper: {detail:'시험형',format:'문제집·정답·상세해설',rules:['실제 올해 시험 범위를 우선','과거 기출은 문항 형식과 난이도 참고','문제 수·시간·배점 합계 검사','정답지와 해설 분리']},
  exam_cram: {detail:'압축',format:'시험 직전 노트',rules:['시험 범위와 빈출 개념 근거 분리','핵심 식의 성립 조건 표기','불확실한 출제 예측 확정 금지']},
  exam_trends: {detail:'분석',format:'경향 보고서',rules:['연도·교수별 기출을 구분','관측 사실과 추정 분리','올해 동일 출제 단정 금지']},
  transcript_fix: {detail:'원문 충실',format:'교정 전사본',rules:['원문 내용 유지, 뜻을 임의로 추가하지 않기','의미 불명확한 발화는 [불명확]','수치·수식·고유명은 강의자료와 대조','교정 로그 작성']},
  errors: {detail:'개인 학습',format:'오답 노트',rules:['실제 사용자 답과 정답을 구분','오답 원인 추측은 추정으로 표시','재발 방지 체크포인트']},
  calculator: {detail:'정밀',format:'CASIO 프로그램 설계',rules:['수식·입력·출력·단위를 구조화','지원 명령어와 기종 확인','실제 기기 동작은 별도 검증']}
};
export function normalizeText(s) { return String(s??'').normalize('NFKC').trim(); }
export function id(prefix='id') { return `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`; }
export function validateOffering(x){
  if(!x||!x.courseId||!Number.isInteger(Number(x.year))||Number(x.year)<1990||Number(x.year)>2100||![1,2,'여름','겨울'].includes(isNaN(Number(x.term))?x.term:Number(x.term))) throw new Error('과목·학년도·학기를 확인하세요.');
  return {...x,year:Number(x.year)};
}
export function chooseSources({sources,offeringId,mode}) {
  const priorities = {
    outline:['lecture_slides','syllabus','transcript','textbook'],
    exam_paper:['lecture_slides','past_exam','exam_trend','transcript','textbook'],
    exam_trends:['past_exam','exam_trend','lecture_slides'],
    transcript_fix:['transcript','lecture_slides','textbook'],
    detailed_note:['lecture_slides','textbook','transcript','exam_trend','past_exam'],
    subnote:['lecture_slides','textbook','transcript'],
    exam_cram:['lecture_slides','past_exam','exam_trend','transcript'],
    errors:['past_exam','lecture_slides','textbook'],
    calculator:['lecture_slides','textbook','past_exam']
  };
  const types=priorities[mode]||priorities.detailed_note;
  return sources.filter(s=>s.offeringId===offeringId && types.includes(s.type))
    .sort((a,b)=>types.indexOf(a.type)-types.indexOf(b.type));
}
export function makeRequest({course,offering,sources,mode,scope='전체',preset,jobId}){
  if(!course||!offering||!MODES[mode]) throw Error('과목·학년도·작업 유형을 선택하세요.');
  const picked=chooseSources({sources,offeringId:offering.id,mode});
  const current=picked.filter(s=>s.type!=='past_exam'&&s.type!=='exam_trend');
  const legacy=picked.filter(s=>s.type==='past_exam'||s.type==='exam_trend');
  const p=preset||DEFAULT_PRESETS[mode];
  const lines=[
    '@에쁠가속기 아래 작업을 실행해 줘. 자료와 결과물의 실제 내용은 반드시 플러그인 MCP로 조회·저장해.',
    `작업 ID: ${jobId||'신규'}`,
    `과목: ${course.name} (course_id=${course.id})`,
    `학년도 강의: ${offering.year}년 ${offering.term}학기, ${offering.professor||'교수 미지정'} (offering_id=${offering.id})`,
    `작업: ${MODES[mode]} (mode=${mode}), 범위: ${scope}`,
    `과목 특성: ${course.characteristics||'미등록'}`,
    `현재 강의 설명: ${offering.notes||'미등록'}`,
    `자료 후보 (MCP에서 원문 조회할 ID): ${current.map(s=>`${s.id}[${SOURCE_TYPES[s.type]}]`).join(', ')||'없음'}`,
    `과거 자료 (참고 전용): ${legacy.map(s=>`${s.id}[${SOURCE_TYPES[s.type]}]`).join(', ')||'없음'}`,
    `제작 상세도: ${p.detail}, 출력 템플릿: ${p.format}`,
    ...p.rules.map((r,i)=>`규칙 ${i+1}: ${r}`),
    '현재 강의 범위의 사실 근거와 전년도 출제 스타일을 구별해. 전년도 내용이 올해 범위에 포함된다고 단정하지 마.',
    '내용을 만들기 전에 과목·자료·이미 저장된 결과물·진행 상태를 조회해. 중복 저장을 방지해.',
    '단원별로 작성·저장하고 체크포인트를 기록해. 사용자가 승인해야 하는 위험한 변경은 승인받아.',
    '실제 파일을 읽지 않았으면 읽었다고 말하지 마. 지원하지 않는 도구를 호출할 수 없다면 중단 이유를 알려줘.',
    '끝나면 저장된 결과물과 확인이 필요한 항목만 간결히 알려줘.'
  ];
  return {text:lines.join('\n'), sourceIds:picked.map(x=>x.id),warnings:[...(current.length?[]:['현재 강의 관련 자료가 없습니다.']),...(picked.some(s=>s.extractStatus!=='ready')?['원문 추출이 안 된 자료가 있습니다.']:[])]};
}
export function splitTranscript(text,max=1800){
  const t=normalizeText(text); if(!t)return [];
  const blocks=t.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);let chunks=[];let cur='';
  for(const b of blocks){ if((cur.length+b.length+2)>max && cur){chunks.push(cur);cur='';} if(b.length>max){if(cur){chunks.push(cur);cur='';}for(let i=0;i<b.length;i+=max)chunks.push(b.slice(i,i+max));}else cur+=`${cur?'\n\n':''}${b}`; }
  if(cur)chunks.push(cur);return chunks;
}
export function validateNote(note){
  const errors=[];if(!note||!note.offeringId)errors.push('강의 ID 누락');if(!note?.title?.trim())errors.push('제목 누락');if(!note?.content?.trim())errors.push('본문 누락');return errors;
}
export function nextStep(job){
  const steps=['context','sources','outline','generate','verify','save'];
  const done=new Set(job?.completedSteps||[]);
  return steps.find(s=>!done.has(s))||'complete';
}
export function markStep(job,step){
  const valid=['context','sources','outline','generate','verify','save'];
  if(!valid.includes(step)) throw Error('잘못된 단계');
  const done=[...new Set([...(job.completedSteps||[]),step])];
  return {...job,completedSteps:done,status:done.length===valid.length?'complete':'partial',updatedAt:new Date().toISOString()};
}
export function safeText(raw){return String(raw??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
