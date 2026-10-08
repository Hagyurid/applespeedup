/** Authenticated R2 asset storage; the public web server must NEVER expose bucket keys. */
import {contentHash} from './content.mjs';
const accepted = Object.freeze({
  '.txt': { mime: 'text/plain', ready: true },
  '.md': { mime: 'text/markdown', ready: true },
  '.pdf': { mime: 'application/pdf', ready: false },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ready: false },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ready: false },
});
const MAX_BYTES = 8 * 1024 * 1024;
function error(code){const e=new Error(code);e.code=code;throw e;}
function mimeFor(name){const ext=String(name).toLowerCase().match(/\.[a-z0-9]+$/)?.[0];return ext ? accepted[ext] : undefined;}
export async function storeAsset({bucket,repository,userId,offeringId,file,sourceType,title,provenance=''}){
  if(!bucket?.put||!bucket?.get||!bucket?.delete)error('STORAGE_NOT_CONFIGURED');
  // Authorization always happens BEFORE the byte stream is stored in R2.
  await repository.assertOfferingAccess(userId,offeringId,true);
  const name=String(file?.name||'');
  const info=mimeFor(name);
  if(!info||!file||file.size<1||file.size>MAX_BYTES)error('BAD_FILE');
  const acceptedType=['lecture_slides','transcript','textbook','past_exam','exam_trend','syllabus','other'];
  if(!acceptedType.includes(sourceType))error('BAD_REQUEST');
  const nameLabel=String(title||'').trim();
  if(!nameLabel||nameLabel.length>200)error('BAD_REQUEST');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.byteLength!==file.size)error('BAD_FILE');
  // Extension and magic bytes are checked for PDFs and ZIP-family document files.
  const ext=name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if(ext==='.pdf' && !new TextDecoder().decode(bytes.subarray(0,5)).startsWith('%PDF-'))error('BAD_FILE');
  if((ext==='.docx'||ext==='.pptx') && !(bytes[0]===0x50&&bytes[1]===0x4b))error('BAD_FILE');
  const sourceId=crypto.randomUUID();
  const key=`sources/${offeringId}/${sourceId}`;
  const digest=await contentHash(bytes);
  let text=null;
  if(info.ready){
    // Reject invalid UTF-8 instead of silently persisting replacement characters.
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{error('BAD_FILE');}
    if(!text.trim()||text.length>1500000)error('BAD_FILE');
  }
  const duplicate=await repository.findDuplicateAsset(userId,{offering_id:offeringId,source_type:sourceType,sha256:digest});
  if(duplicate)return {...duplicate,sha256:digest,reused:true};
  await bucket.put(key,bytes,{httpMetadata:{contentType:info.mime}});
  try{
    const result=await repository.registerUploadedAsset(userId,{
      id:sourceId,offering_id:offeringId,source_type:sourceType,title:nameLabel,
      file_name:name.slice(0,200),mime_type:info.mime,storage_key:key,sha256:digest,
      provenance:String(provenance).slice(0,400),text
    });
    if(result.source_id!==sourceId)await bucket.delete(key);
    return {...result,sha256:digest};
  }catch(e){try{await bucket.delete(key);}catch{/* R2 cleanup must be monitored in production */}throw e;}
}
export async function downloadAsset({bucket,repository,userId,sourceId}){
  if(!bucket?.get)error('STORAGE_NOT_CONFIGURED');
  const meta=await repository.getAssetMetadata(userId,{source_id:sourceId});
  if(!meta.storage_key)error('NOT_FOUND');
  const obj=await bucket.get(meta.storage_key);
  if(!obj)error('NOT_FOUND');
  // Always download, preventing inline HTML/script execution from user-uploaded bytes.
  const asciiName=(meta.file_name||'source').replace(/[\\/\x00-\x1f"\r\n]/g,'_');
  return new Response(obj.body, {status:200,headers:{
    'Content-Type':meta.mime_type||'application/octet-stream',
    'Content-Disposition':`attachment; filename="${asciiName.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(asciiName)}`,
    'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'
  }});
}
export const fileLimits={maxBytes:MAX_BYTES,extensions:Object.keys(accepted)};
