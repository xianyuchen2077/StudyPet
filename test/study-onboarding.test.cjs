const test=require('node:test'),assert=require('node:assert/strict');
const {createStudyEngine}=require('../study/engine.cjs');
const {catalog}=require('../study/case-plan.cjs');
const moduleFor={hci:'hta',control:'requirements'};
async function setup(options={}){const e=createStudyEngine(options);await e.init();return e;}
async function walkCase(e,key){
 const mid=moduleFor[key];
 await e.dispatch('case.draft',{caseId:key,intent:catalog[key].intent});
 assert.equal((await e.dispatch('case.plan.generate',{caseId:key})).ok,true);
 const confirm=await e.dispatch('case.plan.confirm',{caseId:key,moduleId:mid});assert.equal(confirm.ok,true,confirm.error);
 const t=e.snapshot().tasks.find(v=>v.caseId===key);
 assert.equal((await e.dispatch('round.start',{taskId:t.id})).ok,true);
 const step=t.steps.find(v=>v.id===t.currentStepId);
 assert.equal((await e.dispatch('step.complete',{taskId:t.id,stepId:step.id})).ok,true);
 const round=e.snapshot().rounds.find(r=>r.taskId===t.id);
 const draft=await e.dispatch('reflection.draft',{taskId:t.id,moduleId:mid,roundId:round.id,phase:'stage',newDraft:true,text:'这是我的解释'});
 assert.equal(draft.ok,true,draft.error);
 const d=e.snapshot().reflectionDrafts[t.id];
 assert.equal((await e.dispatch('reflection.save',{taskId:t.id,id:d.id,moduleId:mid,roundId:round.id})).ok,true);
 return t.id;
}
test('全新安装时两个演示案例三步都未完成，引导未完成',async()=>{
 const e=await setup();const s=e.snapshot();
 assert.equal(s.onboarding.completedAt,null);
 assert.equal(s.runtime.tutorial.allDone,false);
 assert.deepEqual(Object.keys(s.runtime.tutorial.cases),['hci','control']);
 for(const c of Object.values(s.runtime.tutorial.cases)){assert.equal(c.plan,false);assert.equal(c.step,false);assert.equal(c.review,false);}
});
test('没走完两个案例时不能进入正式使用',async()=>{
 const e=await setup();
 const early=await e.dispatch('onboarding.complete');
 assert.equal(early.ok,false);assert.equal(early.code,'ONBOARDING_INCOMPLETE');
 await walkCase(e,'hci');
 const half=e.snapshot();assert.equal(half.runtime.tutorial.cases.hci.done,true);assert.equal(half.runtime.tutorial.allDone,false);
 assert.equal((await e.dispatch('onboarding.complete')).ok,false);
});
test('两个案例都走完后完成引导：写入完成时间、演示任务收进教程、当前任务清空',async()=>{
 const e=await setup();
 await walkCase(e,'hci');await walkCase(e,'control');
 const before=e.snapshot();assert.equal(before.runtime.tutorial.allDone,true);
 const r=await e.dispatch('onboarding.complete');assert.equal(r.ok,true,r.error);
 const s=e.snapshot();
 assert.ok(s.onboarding.completedAt);
 assert.equal(s.runtime.tutorial.completedAt,s.onboarding.completedAt);
 assert.deepEqual(s.tasks.map(t=>t.tutorial),[true,true]);
 assert.equal(s.activeTaskId,null);
 // 引导完成幂等：再点一次不报错、不改变完成时间。
 assert.equal((await e.dispatch('onboarding.complete')).ok,true);
 assert.equal(e.snapshot().onboarding.completedAt,s.onboarding.completedAt);
});
test('完成引导后仍可回看演示案例，重新打开引导不删任务与回顾',async()=>{
 const e=await setup();
 await walkCase(e,'hci');await walkCase(e,'control');
 await e.dispatch('onboarding.complete');
 const taskIds=e.snapshot().tasks.map(t=>t.id),reflectionIds=e.snapshot().reflections.map(r=>r.id);
 const reset=await e.dispatch('onboarding.reset');assert.equal(reset.ok,true);
 const s=e.snapshot();
 assert.equal(s.onboarding.completedAt,null);
 assert.deepEqual(s.tasks.map(t=>t.id),taskIds);
 assert.deepEqual(s.reflections.map(r=>r.id),reflectionIds);
 // 进度由旧任务推导，重置后仍显示已完成的三步，避免让用户重做一遍。
 assert.equal(s.runtime.tutorial.allDone,true);
});
test('只完成一小步、没保存回顾不算走完案例',async()=>{
 const e=await setup();
 await e.dispatch('case.draft',{caseId:'hci',intent:catalog.hci.intent});
 await e.dispatch('case.plan.generate',{caseId:'hci'});
 const confirm=await e.dispatch('case.plan.confirm',{caseId:'hci',moduleId:'hta'});
 const t=e.snapshot().tasks[0];
 await e.dispatch('round.start',{taskId:t.id});await e.dispatch('step.complete',{taskId:t.id,stepId:t.currentStepId});
 const c=e.snapshot().runtime.tutorial.cases.hci;
 assert.equal(c.plan,true);assert.equal(c.step,true);assert.equal(c.review,false);assert.equal(c.done,false);
 await e.dispatch('reflection.draft',{taskId:t.id,moduleId:'hta',phase:'stage',newDraft:true,text:'先存草稿'});
 assert.equal(e.snapshot().runtime.tutorial.cases.hci.review,false);
});
test('新手引导可以随时跳过，已做的任务和回顾都保留',async()=>{
 const e=await setup();
 await walkCase(e,'hci');
 const taskIds=e.snapshot().tasks.map(t=>t.id),reflectionIds=e.snapshot().reflections.map(r=>r.id);
 const r=await e.dispatch('onboarding.skip');assert.equal(r.ok,true,r.error);
 const s=e.snapshot();
 assert.ok(s.onboarding.completedAt);assert.equal(s.onboarding.skipped,true);assert.equal(s.runtime.tutorial.skipped,true);
 assert.equal(s.activeTaskId,null);
 assert.deepEqual(s.tasks.map(t=>t.id),taskIds);
 assert.deepEqual(s.reflections.map(r=>r.id),reflectionIds);
 assert.equal((await e.dispatch('onboarding.skip')).ok,true);
});
test('跳过之后可在设置里重新打开引导',async()=>{
 const e=await setup();
 await e.dispatch('onboarding.skip');
 await e.dispatch('onboarding.reset');
 const s=e.snapshot();
 assert.equal(s.onboarding.completedAt,null);
 assert.equal(s.onboarding.skipped,false);
 assert.equal(s.runtime.tutorial.completedAt,null);
});
