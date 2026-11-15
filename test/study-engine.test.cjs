const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const enginePath = path.join(__dirname, '../study/engine.cjs');
let createStudyEngine;
if (fs.existsSync(enginePath)) ({createStudyEngine} = require(enginePath));

async function setup(seed) {
  assert.equal(typeof createStudyEngine, 'function', '现有框架需要新增学习工作流引擎');
  let stored = seed ? structuredClone(seed) : null;
  const writes = [];
  let diskFails = false;
  const engine = createStudyEngine({
    read: async()=>stored,
    write: async value=>{ if(diskFails)throw Error('磁盘不可写'); stored=structuredClone(value);writes.push(stored); },
    now: ()=> '2026-11-13T08:00:00.000Z'
  });
  await engine.init();
  return {engine,writes,stored:()=>structuredClone(stored),failDisk:value=>diskFails=value};
}
async function act(e,action,payload={}) {const r=await e.dispatch(action,payload);assert.equal(r.ok,true,`${action}: ${r.error}`);return r;}
function current(s) {return s.tasks.find(t=>t.id===s.activeTaskId);}
async function candidate(e) {await act(e,'draft.suggest',{intent:'想复习操作系统的进程和线程，但总分不清。',scope:'button'});return e.snapshot().intentDrafts.find(d=>d.id===e.snapshot().startupDraftId);}
async function start(e) {const d=await candidate(e);await act(e,'plan.confirm',{draftId:d.id});await act(e,'round.start',{});return current(e.snapshot());}

test('模糊意向和候选不会先变成正式任务',async()=>{
 const {engine:e}=await setup();const d=await candidate(e);
 assert.equal(e.snapshot().tasks.length,0);assert.equal(e.snapshot().rounds.length,0);
 assert.equal(d.intent,'想复习操作系统的进程和线程，但总分不清。');assert.equal(d.suggestions.length,2);
});
test('只确认目标和首步；材料就绪后才开始，不重复创建',async()=>{
 const {engine:e}=await setup();const d=await candidate(e);
 await act(e,'plan.confirm',{draftId:d.id});const s=e.snapshot();
 assert.equal(s.tasks.length,1);assert.equal(current(s).steps.length,1);assert.equal(s.rounds.length,0);
 await act(e,'plan.confirm',{draftId:d.id});await act(e,'round.start');await act(e,'round.start');
 assert.equal(e.snapshot().tasks.length,1);assert.equal(e.snapshot().rounds.length,1);
 assert.equal(e.snapshot().intentDrafts[0].suggestions.length,2);
});
test('首步可以再拆小；只存意向不启动',async()=>{
 const {engine:e}=await setup();const d=await candidate(e);await act(e,'draft.refine',{draftId:d.id,kind:'smaller'});
 assert.match(e.snapshot().intentDrafts[0].firstStep,/先找出/);assert.equal(e.snapshot().rounds.length,0);
});
test('计划保存失败保留草稿；重试只生成一个任务',async()=>{
 const {engine:e}=await setup();const d=await candidate(e);await act(e,'demo.failNext',{kind:'plan'});
 const fail=await e.dispatch('plan.confirm',{draftId:d.id,title:'我自己改的目标',firstStep:'只打开练习文件'});
 assert.equal(fail.ok,false);assert.equal(e.snapshot().tasks.length,0);assert.equal(e.snapshot().intentDrafts[0].title,'我自己改的目标');
 await act(e,'plan.confirm',{draftId:d.id});assert.equal(e.snapshot().tasks.length,1);assert.equal(current(e.snapshot()).steps[0].text,'只打开练习文件');
});
test('材料打不开不新开轮次，替换后可以开始',async()=>{
 const {engine:e}=await setup();const d=await candidate(e);await act(e,'plan.confirm',{draftId:d.id});
 await act(e,'material.replace',{available:false,label:'失效练习文件'});const bad=await e.dispatch('round.start',{});
 assert.equal(bad.ok,false);assert.equal(bad.code,'MATERIAL_UNAVAILABLE');assert.equal(e.snapshot().rounds.length,0);
 await act(e,'material.replace',{available:true,id:'practice',label:'可用练习示例'});await act(e,'round.start');assert.equal(e.snapshot().rounds.length,1);
});
test('轮次写入失败不能宣称已开始',async()=>{
 const {engine:e}=await setup();const d=await candidate(e);await act(e,'plan.confirm',{draftId:d.id});await act(e,'demo.failNext',{kind:'round'});
 assert.equal((await e.dispatch('round.start',{})).ok,false);assert.equal(e.snapshot().rounds.length,0);
 await act(e,'round.start');assert.equal(e.snapshot().rounds[0].status,'running');
});
test('T2修改检查点后接续同一暂停轮次；结束后新开',async()=>{
 const {engine:e}=await setup();await act(e,'demo.load',{scenario:'resume'});const oldId=e.snapshot().rounds[0].id;
 await act(e,'checkpoint.confirm',{position:'教程03:20',nextAction:'先检查连接目标'});await act(e,'round.start');
 assert.equal(e.snapshot().rounds.length,1);assert.equal(e.snapshot().rounds[0].id,oldId);assert.equal(current(e.snapshot()).checkpoint.position,'教程03:20');
 await act(e,'round.end');await act(e,'round.start');assert.equal(e.snapshot().rounds.length,2);assert.equal(e.snapshot().rounds[0].status,'ended');
});
test('结束轮次不完成步骤、任务或回顾',async()=>{
 const {engine:e}=await setup();await start(e);await act(e,'round.end');const s=e.snapshot();
 assert.equal(s.rounds[0].status,'ended');assert.equal(current(s).steps[0].completed,false);assert.notEqual(current(s).status,'completed');assert.equal(s.reflections.length,0);
});
test('完成一步不接受后续候选，不自动选下一步',async()=>{
 const {engine:e}=await setup();await start(e);await act(e,'step.complete');const s=e.snapshot();
 assert.equal(current(s).steps.length,1);assert.equal(current(s).steps[0].completed,true);assert.equal(current(s).currentStepId,null);assert.equal(s.rounds[0].status,'running');
});
test('记录许可和邀请许可独立；只有许可内模拟事件被记录',async()=>{
 const {engine:e}=await setup();await start(e);assert.equal(e.snapshot().prefs.recording,false);
 await act(e,'demo.event',{material:'tutorial'});assert.equal(e.snapshot().events.length,0);
 await act(e,'prefs.update',{recording:true});assert.equal(e.snapshot().prefs.invitations,false);
 await act(e,'demo.event',{material:'tutorial'});assert.equal(e.snapshot().events.length,1);assert.equal(e.snapshot().events[0].source,'simulation');
 await act(e,'prefs.update',{recordingPaused:true});await act(e,'demo.event',{material:'practice'});assert.equal(e.snapshot().events.length,1);assert.equal(e.snapshot().rounds[0].status,'running');
});
test('主动邀请可拒绝且同节点不再追问；安静学习不冒泡',async()=>{
 const {engine:e}=await setup();await start(e);await act(e,'demo.node',{node:'stage'});assert.equal(e.snapshot().invitation,null);
 await act(e,'prefs.update',{invitations:true});assert.equal(e.snapshot().prefs.recording,false);
 await act(e,'demo.node',{node:'stage'});assert.ok(e.snapshot().invitation);
 await act(e,'invitation.respond',{response:'reject'});await act(e,'demo.node',{node:'stage'});assert.equal(e.snapshot().invitation,null);
 await act(e,'round.end');await act(e,'prefs.update',{quiet:true});await act(e,'demo.node',{node:'end'});assert.equal(e.snapshot().invitation,null);
});
test('T3无记录也可回顾；失败保留输入，重试仅一份，下一步另行入计划',async()=>{
 const {engine:e}=await setup();await start(e);await act(e,'round.end');
 const text='能跟着做，收起教程后还不熟。';const nextIntent='自己重做并解释连接方式';
 await act(e,'demo.failNext',{kind:'reflection'});const fail=await e.dispatch('reflection.save',{text,nextIntent});
 assert.equal(fail.ok,false);assert.equal(e.snapshot().reflections.length,0);assert.equal(e.snapshot().reflectionDrafts[e.snapshot().activeTaskId].text,text);
 await act(e,'reflection.save',{text,nextIntent});await act(e,'reflection.save',{text,nextIntent});let s=e.snapshot();
 assert.equal(s.reflections.length,1);assert.equal(current(s).steps.length,1);assert.equal(s.rounds.filter(r=>r.status==='running').length,0);
 await act(e,'step.save',{text:nextIntent,fromReflectionId:s.reflections[0].id});await act(e,'step.save',{text:nextIntent,fromReflectionId:s.reflections[0].id});
 s=e.snapshot();assert.equal(current(s).steps.length,2);assert.equal(s.rounds.filter(r=>r.status==='running').length,0);
});
test('整理候选不改用户原话和已保存回顾',async()=>{
 const {engine:e}=await setup();await act(e,'demo.load',{scenario:'reflection'});await act(e,'reflection.draft',{text:'我还解释不清连接目标',nextIntent:'先自己试一次'});
 await act(e,'reflection.suggest',{bad:true});let s=e.snapshot();assert.equal(s.reflections.length,0);assert.equal(s.reflectionDrafts[s.activeTaskId].text,'我还解释不清连接目标');assert.match(s.reflectionDrafts[s.activeTaskId].proposal.nextIntent,/整本/);
 await act(e,'reflection.save',{text:'我还解释不清连接目标',nextIntent:'先自己试一次'});s=e.snapshot();assert.equal(s.reflections[0].nextIntent,'先自己试一次');
});
test('用户解释可纠正，原始观察不改；删线索保留自己文字',async()=>{
 const {engine:e}=await setup();await act(e,'demo.load',{scenario:'reflection'});const event=e.snapshot().events[1];
 await act(e,'event.explain',{id:event.id,explanation:'在核对连接',observation:'我已学会'});assert.equal(e.snapshot().events[1].observation,event.observation);
 await act(e,'reflection.save',{text:'还不熟',evidenceIds:[event.id]});await act(e,'event.delete',{id:event.id});
 const r=e.snapshot().reflections[0];assert.equal(r.text,'还不熟');assert.equal(r.evidenceIds.length,0);assert.equal(r.evidenceMissing,true);
});
test('存储失败时停止记录立即生效，失败的新授权不启用',async()=>{
 const ctx=await setup();const e=ctx.engine;await start(e);ctx.failDisk(true);
 assert.equal((await e.dispatch('prefs.update',{recording:true})).ok,false);assert.equal(e.snapshot().prefs.recording,false);
 ctx.failDisk(false);await act(e,'prefs.update',{recording:true});ctx.failDisk(true);
 assert.equal((await e.dispatch('prefs.update',{recording:false})).ok,false);assert.equal(e.snapshot().prefs.recording,false);
 await act(e,'demo.event',{material:'tutorial'});assert.equal(e.snapshot().events.length,0);
});
test('暂停/结束写入失败仍停止，重试不会新开轮次',async()=>{
 const ctx=await setup();const e=ctx.engine;await start(e);ctx.failDisk(true);assert.equal((await e.dispatch('round.pause')).ok,false);assert.equal(e.snapshot().rounds[0].status,'paused');
 ctx.failDisk(false);await act(e,'persistence.retry');assert.equal(e.snapshot().rounds.length,1);assert.equal(ctx.stored().rounds[0].status,'paused');
});
test('重新打开应用先待接续，不把未结束轮次静默继续',async()=>{
 const ctx=await setup();await start(ctx.engine);const another=await setup(ctx.stored());assert.equal(another.engine.snapshot().rounds[0].status,'paused');assert.equal(another.engine.snapshot().rounds.length,1);
});
test('任务删除清理关联数据，重置只产生默认演示状态',async()=>{
 const {engine:e}=await setup();await act(e,'demo.load',{scenario:'reflection'});await act(e,'reflection.save',{text:'我的理解'});const id=e.snapshot().activeTaskId;
 await act(e,'task.delete',{taskId:id});let s=e.snapshot();assert.equal(s.tasks.length,0);assert.equal(s.events.length,0);assert.equal(s.reflections.length,0);
 await act(e,'demo.load',{scenario:'startup'});s=e.snapshot();assert.equal(s.tasks.length,0);assert.equal(s.prefs.recording,false);assert.equal(s.prefs.invitations,false);
});
test('新意向可以在已有确认任务后建立；选择新任务不自动开始',async()=>{
 const {engine:e}=await setup();const first=await start(e);const d=await candidate(e);await act(e,'plan.confirm',{draftId:d.id,title:'整理组件笔记'});
 assert.equal(e.snapshot().tasks.length,2);assert.equal(e.snapshot().rounds[0].status,'paused');
 await act(e,'task.select',{taskId:first.id});assert.equal(e.snapshot().rounds.filter(r=>r.status==='running').length,0);
});
test('切换任务保存失败只停止旧轮次，不提前变更确认选择',async()=>{
 const ctx=await setup();const e=ctx.engine;const first=await start(e);const d=await candidate(e);await act(e,'plan.confirm',{draftId:d.id,title:'第二个任务'});const second=current(e.snapshot());
 await act(e,'task.select',{taskId:first.id});await act(e,'round.start');ctx.failDisk(true);
 assert.equal((await e.dispatch('task.select',{taskId:second.id})).ok,false);assert.equal(e.snapshot().activeTaskId,first.id);assert.equal(e.snapshot().rounds[0].status,'paused');
});
test('排序不暂停学习；完成失败不提前标为完成，完成暂停任务也结束旧轮',async()=>{
 const ctx=await setup();const e=ctx.engine;const t=await start(e);await act(e,'task.move',{direction:'up'});assert.equal(e.snapshot().rounds[0].status,'running');
 ctx.failDisk(true);assert.equal((await e.dispatch('task.complete')).ok,false);assert.notEqual(current(e.snapshot()).status,'completed');assert.equal(e.snapshot().rounds[0].status,'ended');
 ctx.failDisk(false);await act(e,'task.complete');assert.equal(current(e.snapshot()).status,'completed');await act(e,'task.reopen');assert.equal(e.snapshot().rounds[0].status,'ended');
 await act(e,'round.start');await act(e,'round.pause');await act(e,'task.complete');assert.equal(e.snapshot().rounds.at(-1).status,'ended');assert.equal(e.snapshot().activeTaskId,t.id);
});
test('用户可以改任务、增改排序小步并明确选择当前一步',async()=>{
 const {engine:e}=await setup();await start(e);await act(e,'task.save',{title:'自己定义的按钮练习'});await act(e,'step.save',{text:'先检查连接目标'});let t=current(e.snapshot());const v=t.steps[1];
 await act(e,'step.save',{stepId:v.id,text:'自己重做按钮'});await act(e,'step.move',{stepId:v.id,direction:'up'});await act(e,'step.select',{stepId:v.id});t=current(e.snapshot());assert.equal(t.title,'自己定义的按钮练习');assert.equal(t.steps[0].text,'自己重做按钮');assert.equal(t.currentStepId,v.id);
 await act(e,'step.complete');await act(e,'step.reopen',{stepId:v.id});assert.equal(current(e.snapshot()).steps[0].completed,false);assert.equal(current(e.snapshot()).currentStepId,null);
});
test('关闭单个邀请节点会立即收起该节点已出现的气泡',async()=>{
 const ctx=await setup();const e=ctx.engine;await act(e,'demo.load',{scenario:'resume'});await act(e,'round.start');await act(e,'prefs.update',{invitations:true});await act(e,'demo.node',{node:'stage'});assert.ok(e.snapshot().invitation);
 ctx.failDisk(true);assert.equal((await e.dispatch('prefs.update',{nodes:{stage:false}})).ok,false);assert.equal(e.snapshot().invitation,null);assert.equal(e.snapshot().prefs.nodes.stage,false);
});
test('停止许可不等待较早的慢写入，旧回执也不能重新开启',async()=>{
 let held=false,release,enteredResolve;const entered=new Promise(r=>enteredResolve=r);
 const e=createStudyEngine({read:async()=>null,write:async()=>{if(held){held=false;enteredResolve();await new Promise(r=>release=r);}}});await e.init();await start(e);await act(e,'prefs.update',{recording:true,invitations:true});
 held=true;const older=e.dispatch('task.save',{title:'正在保存的任务名'});await entered;
 const stop=e.dispatch('prefs.update',{recording:false,invitations:false});
 const immediate=e.snapshot();release();
 assert.equal(immediate.prefs.recording,false);assert.equal(immediate.prefs.invitations,false);assert.equal(immediate.runtime.pendingSave,true);
 await older;assert.equal(e.snapshot().prefs.recording,false);await stop;assert.equal(e.snapshot().prefs.invitations,false);
});
test('结束当前任务的一轮不会结束其他任务的暂停轮次',async()=>{
 const {engine:e}=await setup();const a=await start(e);const oldId=e.snapshot().rounds[0].id;const d=await candidate(e);await act(e,'plan.confirm',{draftId:d.id,title:'另一个按钮练习'});await act(e,'round.start');await act(e,'round.end');
 assert.equal(e.snapshot().rounds.find(r=>r.id===oldId).status,'paused');await act(e,'task.select',{taskId:a.id});await act(e,'round.start');assert.equal(e.snapshot().rounds.filter(r=>r.taskId===a.id).length,1);assert.equal(e.snapshot().rounds.find(r=>r.id===oldId).status,'running');
});
test('重置写入失败保留任务，同时立即停止原轮次',async()=>{
 const {engine:e}=await setup();const t=await start(e);await act(e,'demo.failNext',{kind:'any'});assert.equal((await e.dispatch('demo.load',{scenario:'startup'})).ok,false);assert.equal(e.snapshot().tasks[0].id,t.id);assert.equal(e.snapshot().rounds[0].status,'paused');
});
test('抽屉输入可单独保存草稿，重开仍在而正式内容不变',async()=>{
 const ctx=await setup();const e=ctx.engine;const t=await start(e);await act(e,'editor.draft',{mode:'task',taskId:t.id,fields:{title:'还没有确认的新目标'},returnView:'tasks'});
 assert.equal(current(e.snapshot()).title,t.title);const reopened=await setup(ctx.stored());assert.equal(reopened.engine.snapshot().editorDraft.fields.title,'还没有确认的新目标');
 await act(e,'task.save',{title:'还没有确认的新目标'});assert.equal(e.snapshot().editorDraft,null);assert.equal(current(e.snapshot()).title,'还没有确认的新目标');
});
test('抽屉保存失败保留编辑，取消仅清理草稿；保留材料的布尔字段',async()=>{
 const ctx=await setup();const e=ctx.engine;const t=await start(e);await act(e,'editor.draft',{mode:'material',taskId:t.id,fields:{materialId:'tutorial',resumeAfter:true},returnView:'study'});assert.equal(e.snapshot().editorDraft.fields.resumeAfter,true);
 ctx.failDisk(true);assert.equal((await e.dispatch('material.replace',{id:'tutorial'})).ok,false);assert.equal(e.snapshot().editorDraft.fields.materialId,'tutorial');assert.equal(current(e.snapshot()).material.id,'practice');
 ctx.failDisk(false);await act(e,'editor.clear');assert.equal(e.snapshot().editorDraft,null);assert.equal(current(e.snapshot()).material.id,'practice');
});
test('确认检查点或删除所属任务时清理对应编辑草稿',async()=>{
 const {engine:e}=await setup();const t=await start(e);await act(e,'editor.draft',{mode:'checkpoint',taskId:t.id,fields:{position:'03:20',nextAction:'检查连接目标'},returnView:'resume'});await act(e,'checkpoint.confirm',{position:'03:20',nextAction:'检查连接目标'});assert.equal(e.snapshot().editorDraft,null);
 await act(e,'editor.draft',{mode:'step',taskId:t.id,fields:{text:'尚未确认的修改'},returnView:'tasks'});await act(e,'task.delete',{taskId:t.id});assert.equal(e.snapshot().editorDraft,null);
});
