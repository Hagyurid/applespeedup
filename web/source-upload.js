/** Explicit activation: native form validation must not silently swallow this button. */
export function bindSourceUpload({form,button,submit,feedback,canWrite,isBusy}){
 let pending=false;
 async function activate(event){
  event?.preventDefault();
  if(pending)return;
  if(!canWrite()){feedback('로그인 확인이 끝난 뒤 저장할 수 있습니다.','error');return;}
  if(isBusy()){feedback('현재 작업이 끝나면 다시 저장해 주세요.','error');return;}
  pending=true;button.disabled=true;feedback('자료 저장 요청 중…','progress');
  try{await submit();}catch(error){feedback(error.message,'error');}
  finally{pending=false;button.disabled=!canWrite();}
 }
 form.noValidate=true;button.type='button';button.onclick=activate;form.onsubmit=activate;
 return activate;
}
