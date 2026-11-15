const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {catalog,createCasePlan,validateCasePlan}=require('../study/case-plan.cjs');
const {createStudyEngine}=require('../study/engine.cjs');
const {bindAIIPC}=require('../study/ai-ipc.cjs');
const root=path.resolve(__dirname,'..');
async function setup(key='hci',options={}){const e=createStudyEngine(options);await e.init();await e.dispatch('case.draft',{caseId:key,intent:catalog[key].intent});await e.dispatch('case.plan.generate',{caseId:key});return e;}
async function confirmed(key='hci'){const e=await setup(key);const r=await e.dispatch('case.plan.confirm',{caseId:key,moduleId:key==='hci'?'hta':'requirements'});assert.equal(r.ok,true,r.error);return e;}
test('两份材料含全部原页和核对文本；HCI覆盖97页且作业关键约束完整',()=>{
 assert.equal(catalog.hci.pageCount,97);assert.equal(catalog.control.pageCount,2);
 for(const pack of Object.values(catalog)){assert.equal(pack.pages.length,pack.pageCount);assert.ok(fs.existsSync(path.join(root,'renderer/study',pack.pdf)));for(const p of pack.pages)assert.ok(fs.existsSync(path.join(root,'renderer/study',p.image)));}
 const course=createCasePlan('hci',{intent:'学习整份课件'});assert.equal(course.modules.length,7);assert.deepEqual([...new Set(course.modules.flatMap(m=>m.pages))].sort((a,b)=>a-b),Array.from({length:97},(_,i)=>i+1));
 const raw=JSON.stringify(catalog.control);for(const text of ['2%','0.707','0.7','Kp','Ki','Kd','MATLAB','-3.5','23.52'])assert.ok(raw.includes(text),text);
 assert.equal(createCasePlan('control',{}).modules.length,6);
});
test('计划约束拒绝不存在页码和空首步，来源明确为模拟而非真实模型',()=>{
 const p=createCasePlan('hci',{});assert.equal(p.source,'simulation');assert.equal(validateCasePlan('hci',p).modules.length,7);
 const bad=structuredClone(p);bad.modules[0].pages=[999];assert.throws(()=>validateCasePlan('hci',bad));bad.modules[0].pages=[1];bad.modules[0].steps[0].text='';assert.throws(()=>validateCasePlan('hci',bad));
});
test('生成、编辑和合并只改变候选；确认幂等，创建一个根任务且不自动开始',async()=>{
 const e=await setup();assert.equal(e.snapshot().tasks.length,0);assert.equal(e.snapshot().caseDrafts.hci.modules.length,7);
 await e.dispatch('case.plan.edit',{caseId:'hci',moduleId:'hta',field:'goal',value:'我想分清层级与执行计划'});
 await e.dispatch('case.plan.merge',{caseId:'hci',moduleId:'personas'});assert.equal(e.snapshot().caseDrafts.hci.modules.length,6);
 await e.dispatch('case.plan.confirm',{caseId:'hci',moduleId:'hta'});await e.dispatch('case.plan.confirm',{caseId:'hci',moduleId:'hta'});const s=e.snapshot(),t=s.tasks[0];assert.equal(s.tasks.length,1);assert.equal(s.rounds.length,0);assert.equal(t.currentModuleId,'hta');assert.equal(t.modules.find(m=>m.id==='hta').goal,'我想分清层级与执行计划');assert.equal(t.material.page,61);assert.equal(t.status,'ready');
});
test('大纲保存失败保留候选；旧生成不能覆盖后来修改的意向',async()=>{
 const e=await setup();const old=e.snapshot().caseDrafts.hci.intent;await e.dispatch('case.draft',{caseId:'hci',intent:'今天先学HTA'});assert.equal((await e.dispatch('case.plan.generate',{caseId:'hci',expectedIntent:old})).code,'CASE_STALE');
 await e.dispatch('demo.failNext',{kind:'plan'});assert.equal((await e.dispatch('case.plan.confirm',{caseId:'hci',moduleId:'hta'})).ok,false);assert.equal(e.snapshot().tasks.length,0);assert.ok(e.snapshot().caseDrafts.hci.modules.length);assert.equal((await e.dispatch('case.plan.confirm',{caseId:'hci',moduleId:'hta'})).ok,true);
});
test('分页书签、模块选择和轮次关联正确，切换不隐式开始且不丢旧位置',async()=>{
 const e=await confirmed();const t=e.snapshot().tasks[0];await e.dispatch('round.start',{taskId:t.id});await e.dispatch('case.page',{taskId:t.id,page:64});await e.dispatch('round.pause',{taskId:t.id});const first=e.snapshot().rounds[0].id;
 const secondStep=t.modules.find(m=>m.id==='hta').stepIds[1];await e.dispatch('step.select',{taskId:t.id,stepId:secondStep});
 await e.dispatch('case.module.select',{taskId:t.id,moduleId:'hta'});assert.equal(e.snapshot().tasks[0].currentStepId,secondStep);
 await e.dispatch('case.module.select',{taskId:t.id,moduleId:'users'});assert.equal(e.snapshot().tasks[0].modules.find(m=>m.id==='hta').bookmarkPage,64);assert.equal(e.snapshot().rounds.filter(r=>r.status==='running').length,0);
 await e.dispatch('round.start',{taskId:t.id});assert.notEqual(e.snapshot().rounds.at(-1).id,first);assert.equal(e.snapshot().rounds.at(-1).moduleId,'users');
 await e.dispatch('case.module.select',{taskId:t.id,moduleId:'hta'});assert.equal(e.snapshot().tasks[0].material.page,64);assert.equal(e.snapshot().tasks[0].currentStepId,secondStep);assert.equal(e.snapshot().rounds.at(-1).status,'paused');assert.equal((await e.dispatch('case.page',{taskId:t.id,page:1000})).ok,false);
});
test('每块自述与模拟整理分开，保存不会完成总任务或捏造作业结果',async()=>{
 const e=await confirmed();const t=e.snapshot().tasks[0];await e.dispatch('round.start',{taskId:t.id});const r=e.snapshot().rounds[0];
 await e.dispatch('reflection.draft',{taskId:t.id,moduleId:'hta',roundId:r.id,phase:'stage',newDraft:true,text:'我知道要分层，但还不知道计划怎么写',uncertainty:'执行顺序怎么表示'});const d=e.snapshot().reflectionDrafts[t.id];
 await e.dispatch('case.review.suggest',{taskId:t.id,moduleId:'hta',id:d.id,expectedText:d.text});let s=e.snapshot();assert.equal(s.reflectionDrafts[t.id].text,d.text);assert.match(s.reflectionDrafts[t.id].proposal.source,/模拟/);assert.match(s.reflectionDrafts[t.id].proposal.question,/同时/);assert.equal(s.reflections.length,0);
 await e.dispatch('reflection.save',{taskId:t.id,id:d.id,moduleId:'hta',roundId:r.id});s=e.snapshot();assert.equal(s.reflections[0].moduleId,'hta');assert.equal(s.tasks[0].modules.find(m=>m.id==='hta').status,'needs-review');assert.notEqual(s.tasks[0].status,'completed');assert.equal(s.rounds[0].status,'running');
 await e.dispatch('case.module.finish',{taskId:t.id});assert.equal(e.snapshot().tasks[0].modules.find(m=>m.id==='hta').status,'needs-review');
 await e.dispatch('case.module.select',{taskId:t.id,moduleId:'users'});await e.dispatch('round.start',{taskId:t.id});await e.dispatch('reflection.draft',{taskId:t.id,moduleId:'users',newDraft:true,text:'这是另一块自己的解释',phase:'stage'});assert.equal(e.snapshot().reflectionDrafts[t.id].moduleId,'users');assert.equal(e.snapshot().reflections[0].moduleId,'hta');
 const a=await confirmed('control');assert.ok(a.snapshot().tasks[0].modules.every(m=>m.status==='pending'));assert.equal(a.snapshot().reflections.length,0);
});
test('材料失效演示保留文档页码，可修复引用并恢复原任务',async()=>{
 const e=await confirmed(),t=e.snapshot().tasks[0];await e.dispatch('material.replace',{taskId:t.id,id:t.material.id,label:t.material.label,position:t.material.position,available:false});assert.equal(e.snapshot().tasks[0].material.page,61);assert.equal(e.snapshot().tasks[0].materialMode,'document');assert.equal((await e.dispatch('round.start',{taskId:t.id})).code,'MATERIAL_UNAVAILABLE');await e.dispatch('material.replace',{taskId:t.id,id:t.material.id,available:true});assert.equal(e.snapshot().tasks[0].material.page,61);assert.equal((await e.dispatch('round.start',{taskId:t.id})).ok,true);
});
test('作业前置知识由用户标记；空自述只能获得问题，不能代写收获',async()=>{
 const e=await confirmed('control'),t=e.snapshot().tasks[0];await e.dispatch('case.prerequisite',{taskId:t.id,key:'并联 PID 中 Kp、Ki、Kd 的作用',value:'unsure'});assert.equal(e.snapshot().tasks[0].prerequisiteChecks['并联 PID 中 Kp、Ki、Kd 的作用'],'unsure');
 await e.dispatch('reflection.draft',{taskId:t.id,moduleId:'requirements',newDraft:true,phase:'stage',text:''});const d=e.snapshot().reflectionDrafts[t.id];await e.dispatch('case.review.suggest',{taskId:t.id,moduleId:'requirements',id:d.id,expectedText:''});assert.equal(e.snapshot().reflectionDrafts[t.id].proposal.text,'');assert.ok(e.snapshot().reflectionDrafts[t.id].proposal.question);
});
test('生产模拟开关在主进程拒绝一切真实 AI 请求，即使已配置密钥',async()=>{
 let calls=0;const map=new Map();bindAIIPC({ipcMain:{handle:(n,f)=>map.set(n,f)},ownsPanel:()=>true,networkEnabled:false,settings:{publicState:()=>({mode:'deepseek',hasKey:true})},service:{request:async()=>{calls++;return {ok:true};},cancel:()=>{}},engine:{snapshot:()=>({})}});
 const settings=await map.get('study:ai-settings')({});assert.equal(settings.settings.simulationOnly,true);const r=await map.get('study:ai-request')({},{kind:'plan',context:{intent:'x'},consent:true});assert.equal(r.code,'AI_SIMULATION_ONLY');assert.equal(calls,0);
});
