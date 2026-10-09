import test from 'node:test';
import assert from 'node:assert/strict';
import {bindWorkspaceUI} from '../web/workspace-ui.js';
function fixture(){
 const nodes=new Map(),properties=new Map(),events={},viewportEvents={};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,dataset:{},attrs:{},listeners:{},classes:new Set(),classList:{toggle(cls,on){const set=nodes.get(id).classes;on?set.add(cls):set.delete(cls)}},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this.listeners[k]=fn}});return nodes.get(id)};
 const document={getElementById:node,querySelector:node,body:{dataset:{}},documentElement:{style:{setProperty:(k,v)=>properties.set(k,v)}}};
 const window={innerHeight:900,visualViewport:{height:720.5,addEventListener:(k,fn)=>{viewportEvents[k]=fn}},addEventListener:(k,fn)=>{events[k]=fn}};
 return {ui:bindWorkspaceUI({document,window}),node,document,window,properties,viewportEvents};
}
test('all view controls collapse and reopen their own panels without server calls',()=>{
 const f=fixture();
 for(const [button,target,container,cls] of [['toggleWorkspace','workspaceSidebar','.workspace-shell','sidebar-collapsed'],['toggleNoteList','noteListPanel','.notes-layout','list-collapsed'],['toggleProblemList','solveIndex','solveWorkspace','list-collapsed'],['toggleProblemView','solveQuestionPanel','solveSheet','question-collapsed']]){
  const b=f.node(button);assert.equal(b.dataset.uiOnly,'true');b.listeners.click();assert.equal(f.node(target).hidden,true);assert.equal(f.node(container).classes.has(cls),true);assert.equal(b.attrs['aria-expanded'],'false');
  b.listeners.click();assert.equal(f.node(target).hidden,false);assert.equal(f.node(container).classes.has(cls),false);assert.equal(b.attrs['aria-expanded'],'true');
 }
});
test('study shell uses the visible viewport, changes on resize and restores normal pages',()=>{
 const f=fixture();f.ui.setPage('notes');assert.equal(f.document.body.dataset.workspacePage,'notes');assert.equal(f.node('.workspace-shell').classes.has('is-study-workspace'),true);
 assert.equal(f.node('toggleNoteList').hidden,false);assert.equal(f.node('toggleProblemList').hidden,true);assert.equal(f.properties.get('--workspace-height'),'720px');
 f.window.visualViewport.height=580;f.viewportEvents.resize();assert.equal(f.properties.get('--workspace-height'),'580px');
 f.ui.setPage('solvepad');assert.equal(f.node('toggleProblemList').hidden,false);assert.equal(f.node('toggleNoteList').hidden,true);
 f.ui.setPage('sources');assert.equal(f.node('.workspace-shell').classes.has('is-study-workspace'),false);
});
