/** Mechanical extraction only: no OCR or model correction. Bounded ZIP/CFB readers. */
import {inflateRawSync} from 'node:zlib';
const MAX=16*1024*1024;
const bad=()=>{throw Error('Unsupported or damaged document');};
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const utf8=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const utf16=b=>new TextDecoder('utf-16le',{fatal:true}).decode(b);
export function unzip(bytes){
 const v=view(bytes),files=new Map();let end=-1,total=0;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))bad();
 const count=v.getUint16(end+10,true);if(count>4000)bad();let pos=v.getUint32(end+16,true);
 for(let i=0;i<count;i++){
  if(pos+46>bytes.length||v.getUint32(pos,true)!==0x02014b50)bad();
  const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),size=v.getUint32(pos+20,true),expanded=v.getUint32(pos+24,true);
  const n=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
  const name=utf8(bytes.subarray(pos+46,pos+46+n));pos+=46+n+extra+comment;
  total+=expanded;if(flags&1||expanded>MAX||total>MAX||offset+30>bytes.length||v.getUint32(offset,true)!==0x04034b50)bad();
  const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);if(start+size>bytes.length)bad();
  let data=bytes.subarray(start,start+size);if(method===8)data=new Uint8Array(inflateRawSync(data,{maxOutputLength:MAX}));else if(method!==0)bad();
  if(data.length!==expanded)bad();files.set(name,data);
 }
 return files;
}
const entity=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,n)=>n[0]==='#'?String.fromCodePoint(n[1].toLowerCase()==='x'?parseInt(n.slice(2),16):Number(n.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[n.toLowerCase()]);
function xmlText(xml){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))bad();
 return entity(xml.replace(/<\/(?:w|hp|a):p\s*>/g,'\n').replace(/<(?:w|hp|a):(?:tab|br|lineBreak)\b[^>]*\/?\s*>/g,'\n').replace(/<[^>]*>/g,'')).trim();
}
function compound(bytes){
 const v=view(bytes);if(bytes.length<512||v.getUint32(0,true)!==0xe011cfd0||v.getUint32(4,true)!==0xe11ab1a1)bad();
 const shift=v.getUint16(30,true);if(![9,12].includes(shift)||v.getUint16(32,true)!==6)bad();
 const size=1<<shift,sectors=Math.floor(bytes.length/size)-1;
 const sector=n=>{if(n>=sectors)bad();return bytes.subarray((n+1)*size,(n+2)*size);};
 const fatIds=[];for(let i=0;i<109;i++){const n=v.getUint32(76+i*4,true);if(n<0xfffffffa)fatIds.push(n);}
 let dif=v.getUint32(68,true);const visited=new Set();
 for(let i=0;i<v.getUint32(72,true);i++){if(visited.has(dif)||i>sectors)bad();visited.add(dif);const d=view(sector(dif));for(let j=0;j<size/4-1;j++){const n=d.getUint32(j*4,true);if(n<0xfffffffa)fatIds.push(n);}dif=d.getUint32(size-4,true);}
 if(fatIds.length>sectors||new Set(fatIds).size!==fatIds.length)bad();
 const fat=[];for(const id of fatIds){const d=view(sector(id));for(let i=0;i<size;i+=4)fat.push(d.getUint32(i,true));}
 function chain(start,table,unit,read,length=MAX){const blocks=[],seen=new Set();let n=start,total=0;while(n<0xfffffffa){if(seen.has(n)||total>=MAX||n>=table.length)bad();seen.add(n);const b=read(n);blocks.push(b);total+=b.length;n=table[n];}const out=new Uint8Array(Math.min(total,length));let pos=0;for(const b of blocks){out.set(b.subarray(0,out.length-pos),pos);pos+=Math.min(b.length,out.length-pos);}return out;}
 const directory=chain(v.getUint32(48,true),fat,size,sector),entries=[];
 for(let pos=0;pos+128<=directory.length;pos+=128){const d=view(directory.subarray(pos,pos+128)),n=d.getUint16(64,true);entries.push({name:n>=2&&n<=64?utf16(directory.subarray(pos,pos+n-2)):'',type:d.getUint8(66),left:d.getUint32(68,true),right:d.getUint32(72,true),child:d.getUint32(76,true),start:d.getUint32(116,true),length:d.getUint32(120,true)});}
 const root=entries[0];if(root?.type!==5)bad();
 const mini=chain(root.start,fat,size,sector,root.length),miniRaw=chain(v.getUint32(60,true),fat,size,sector),miniFat=[];
 for(let i=0;i+4<=miniRaw.length;i+=4)miniFat.push(view(miniRaw).getUint32(i,true));
 const streams=new Map(),treeSeen=new Set();
 function walk(id,path){if(id>=entries.length)return;if(treeSeen.has(id))bad();treeSeen.add(id);const e=entries[id];walk(e.left,path);const name=path+e.name;if(e.type===1)walk(e.child,name+'/');if(e.type===2){if(e.length>MAX)bad();streams.set(name,e.length<4096?chain(e.start,miniFat,64,n=>mini.subarray(n*64,n*64+64),e.length):chain(e.start,fat,size,sector,e.length));}walk(e.right,path);}
 walk(root.child,'');return streams;
}
function hwp(bytes){
 const files=compound(bytes),header=files.get('FileHeader');if(!header||utf8(header.subarray(0,17))!=='HWP Document File')bad();
 const flags=view(header).getUint32(36,true);if(flags&6)bad();const texts=[];
 for(const [name,data] of [...files].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}))){if(!/^BodyText\/Section\d+$/.test(name))continue;const b=flags&1?new Uint8Array(inflateRawSync(data,{maxOutputLength:MAX})):data,v=view(b);let pos=0;
  while(pos+4<=b.length){const h=v.getUint32(pos,true);pos+=4;let length=h>>>20;if(length===4095){if(pos+4>b.length)bad();length=v.getUint32(pos,true);pos+=4;}if(pos+length>b.length)bad();if((h&1023)===67){let text='';for(let i=pos;i+1<pos+length;i+=2){const c=v.getUint16(i,true);if(c>=32)text+=String.fromCharCode(c);else if([10,13].includes(c))text+='\n';else if(c===24)text+='-';else if(c===30||c===31)text+=' ';else if(c!==0){i+=14;}}texts.push(text);}pos+=length;}
 }
 return texts.join('\n').trim();
}
export function extractOriginal(bytes,mime){
 try{
  if(mime==='application/x-hwp')return {text:hwp(bytes)};
  const files=unzip(bytes);
  if(mime.endsWith('wordprocessingml.document'))return {text:xmlText(utf8(files.get('word/document.xml')||bad()))};
  if(mime==='application/vnd.hancom.hwpx')return {text:[...files].filter(([n])=>/^Contents\/section\d+\.xml$/.test(n)).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([,b])=>xmlText(utf8(b))).join('\n')};
  if(mime.endsWith('presentationml.presentation')){const pages=[...files].filter(([n])=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([name,b])=>({name,text:xmlText(utf8(b))}));if(!pages.length)bad();return {text:JSON.stringify(pages),pages};}
 }catch{return {text:null,error:'원본 내용을 읽지 못했습니다. 암호·배포용·구형 또는 손상 파일인지 확인하거나 TXT/PDF로 저장해 등록해 주세요.'};}
 return {text:null};
}
