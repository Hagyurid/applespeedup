/** Device-only recovery, scoped to the verified session user. No network writes. */
export function createDraftStore(userId,onError=()=>{}){
 const prefix=userId?'aplus:draft:'+encodeURIComponent(userId)+':':null;
 let warned=false;
 const failure=()=>{if(!warned){warned=true;onError('기기 임시 저장을 사용할 수 없습니다. 서버 저장 완료를 확인하고 화면을 닫으세요.')}};
 return {
  read(key){if(!prefix)return null;try{return JSON.parse(globalThis.localStorage.getItem(prefix+key)||'null')}catch{failure();return null}},
  write(key,value){if(!prefix)return;try{globalThis.localStorage.setItem(prefix+key,JSON.stringify(value))}catch{failure()}},
  remove(key){if(!prefix)return;try{globalThis.localStorage.removeItem(prefix+key)}catch{failure()}}
 };
}
