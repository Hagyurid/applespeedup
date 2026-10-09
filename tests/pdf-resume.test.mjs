import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePdfPages} from '../web/pdf-pages.js';
test('PDF retries only the missing text without rendering or reuploading an existing image',async()=>{
 const writes=[],progress=[];let gets=0,destroyed=false;
 const pdf={numPages:2,getPage:async n=>{gets++;assert.equal(n,1);return {getTextContent:async()=>({items:[{str:'복구 텍스트'}]}),cleanup(){}}},destroy:async()=>{destroyed=true}};
 const result=await preparePdfPages({materialId:'m',file:{arrayBuffer:async()=>new ArrayBuffer(0)},json:x=>x,cancelled:()=>false,onProgress:(n)=>progress.push(n),loadPdf:async()=>({getDocument:()=>({promise:Promise.resolve(pdf)})}),call:async(path,payload)=>{if(path.includes('page-status'))return {prepared_pages:[1,2],text_ready_pages:[2]};writes.push({path,payload});return {}}});
 assert.equal(gets,1);assert.equal(writes.filter(x=>x.path==='/api/v2/page-image').length,0);assert.equal(writes.find(x=>x.path==='/api/v2/page-text').payload.text,'복구 텍스트');assert.equal(result.pageCount,2);assert.equal(progress.at(-1),2);assert.equal(destroyed,true);
});
test('PDF waits for in-flight page work before destroying after a failure',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve});let finished=false,destroyed=false;
 const pdf={numPages:2,getPage:async n=>({getTextContent:async()=>{if(n===1)throw Error('text failure');await waiting;finished=true;return {items:[]}},cleanup(){}}),destroy:async()=>{assert.equal(finished,true);destroyed=true}};
 const operation=preparePdfPages({materialId:'m',file:{arrayBuffer:async()=>new ArrayBuffer(0)},json:x=>x,cancelled:()=>false,onProgress(){},loadPdf:async()=>({getDocument:()=>({promise:Promise.resolve(pdf)})}),call:async path=>path.includes('page-status')?{prepared_pages:[1,2],text_ready_pages:[]}: {}});
 const check=assert.rejects(operation,/text failure/);await new Promise(resolve=>setImmediate(resolve));assert.equal(destroyed,false);release();await check;assert.equal(destroyed,true);
});
