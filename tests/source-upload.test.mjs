import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSourceUpload} from '../web/source-upload.js';
test('click and submit explicitly activate once and show failures next to the source button',async()=>{
 const form={},button={},messages=[];let release,calls=0;
 const waiting=new Promise(resolve=>{release=resolve});
 bindSourceUpload({form,button,canWrite:()=>true,isBusy:()=>false,feedback:(text,kind)=>messages.push({text,kind}),submit:async()=>{calls++;await waiting;throw Error('파일 크기를 확인하세요.')}});
 assert.equal(form.noValidate,true);assert.equal(button.type,'button');let prevented=0;
 const first=button.onclick({preventDefault:()=>prevented++});await form.onsubmit({preventDefault:()=>prevented++});
 assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(messages[0].kind,'progress');release();await first;
 assert.equal(messages.at(-1).text,'파일 크기를 확인하세요.');assert.equal(messages.at(-1).kind,'error');assert.equal(button.disabled,false);assert.equal(prevented,2);
});
test('read-only and busy activation do not send a storage request',async()=>{
 const form={},button={},messages=[];let writes=false,busy=false,calls=0;
 bindSourceUpload({form,button,canWrite:()=>writes,isBusy:()=>busy,feedback:text=>messages.push(text),submit:async()=>calls++});
 await button.onclick({preventDefault(){}});writes=true;busy=true;await button.onclick({preventDefault(){}});
 assert.equal(calls,0);assert.equal(messages.length,2);
});
