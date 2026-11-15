const test=require('node:test'),assert=require('node:assert/strict');
const {createStudyEngine}=require('../study/engine.cjs');
const {scenarioState}=require('../study/fixtures.cjs');
let serial=0;const next=()=>String(++serial);
test('具体学科意向形成资源归属目标和可动手的看图首步',async()=>{
 const e=createStudyEngine();await e.init();await e.dispatch('draft.suggest',{intent:'想复习操作系统的进程和线程，但总分不清。',scope:'resources'});
 const d=e.snapshot().intentDrafts[0];assert.match(d.title,/同一进程.*线程.*资源/);assert.match(d.firstStep,/双线程.*共享区/);assert.match(d.suggestions[0],/全局变量.*栈.*自测/);assert.equal(e.snapshot().tasks.length,0);
 await e.dispatch('draft.refine',{draftId:d.id,kind:'smaller'});assert.match(e.snapshot().intentDrafts[0].firstStep,/先找出.*全局变量/);
 await e.dispatch('plan.confirm',{draftId:d.id});await e.dispatch('round.start');assert.equal(e.snapshot().tasks[0].steps.length,1);assert.equal(e.snapshot().rounds[0].status,'running');
});
test('接续和回顾情境围绕同一个资源知识点，含具体题目与解释',()=>{
 for(const scenario of ['resume','reflection']){
  const s=scenarioState(scenario,'2026-11-13T08:00:00Z',next);assert.match(s.tasks[0].title,/线程.*资源/);assert.equal(s.tasks[0].checkpoint.position,'第2题／线程的调用栈');assert.match(s.tasks[0].checkpoint.nextAction,/栈/);assert.match(s.tasks[0].material.label,/分类自测/);
  if(scenario==='reflection'){assert.match(s.events[0].observation,/图解/);assert.match(s.events[1].observation,/自测/);assert.match(s.events[1].explanation,/栈/);}
 }
});
test('在分类自测第二题暂停时保留真实材料位置，而不是默认图解位置',async()=>{
 const e=createStudyEngine();await e.init();await e.dispatch('draft.suggest',{scope:'resources'});await e.dispatch('plan.confirm');await e.dispatch('round.start');
 await e.dispatch('round.pause',{materialId:'tutorial',position:'第2题／线程的调用栈'});
 const t=e.snapshot().tasks[0];assert.equal(t.material.id,'tutorial');assert.equal(t.checkpoint.position,'第2题／线程的调用栈');assert.equal(e.snapshot().rounds[0].status,'paused');
 await e.dispatch('round.start');assert.equal(e.snapshot().rounds.length,1);
});
test('自动保留材料位置不会覆盖用户自己修改的材料名称',async()=>{
 const e=createStudyEngine();await e.init();await e.dispatch('draft.suggest',{scope:'resources'});await e.dispatch('plan.confirm');await e.dispatch('material.replace',{id:'practice',label:'我的双线程图解'});await e.dispatch('round.start');await e.dispatch('round.pause',{materialId:'practice',position:'双线程示意图／共享区'});assert.equal(e.snapshot().tasks[0].material.label,'我的双线程图解');
});
