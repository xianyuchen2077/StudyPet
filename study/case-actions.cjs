'use strict';
const {packFor,createCasePlan,validateCasePlan}=require('./case-plan.cjs');
const clone=v=>JSON.parse(JSON.stringify(v)),text=(v,n=5000)=>typeof v==='string'?v.trim().slice(0,n):'';
function fault(message,code='INVALID_INPUT'){const e=Error(message);e.code=code;throw e;}
function applyCaseAction(s,action,p,{id,stamp,stopRound,clearInvitation,checkpoint}){
 s.caseDrafts=s.caseDrafts||{};
 const getTask=()=>{const t=s.tasks.find(t=>t.id===(p.taskId||s.activeTaskId));if(!t?.caseId)fault('先打开一份材料任务。');return t;};
 const getDraft=()=>{const pack=packFor(p.caseId);let d=s.caseDrafts[pack.id];if(!d)d=s.caseDrafts[pack.id]={caseId:pack.id,intent:pack.intent,status:'intent',modules:[]};return d;};
 const editable=()=>{const d=getDraft();if(d.status==='confirmed')fault('大纲已经确认，请从当前任务继续。');return d;};
 const candidate=()=>{const d=editable();if(d.status!=='candidate')fault('先生成一份候选大纲。');return d;};
 if(action==='case.draft'){const d=editable();for(const k of ['intent','priorKnowledge','difficulty'])if(k in p)d[k]=text(p[k]);return {kind:'draft'};}
 if(action==='case.plan.generate'){
  const d=editable();if(p.expectedIntent!==undefined&&text(p.expectedIntent)!==d.intent)fault('目标已修改，旧的模拟结果未写入。','CASE_STALE');if(!d.intent)fault('先用一句话说说自己的目标。');
  Object.assign(d,createCasePlan(p.caseId,d),{status:'candidate'});return {kind:'draft'};
 }
 if(action==='case.plan.edit'){
  const d=candidate(),m=d.modules.find(m=>m.id===p.moduleId);if(!m)fault('这块内容已经改变。');const value=text(p.value,1000);if(!value)fault('保留一句自己认可的描述即可。');
  if(['title','goal','check'].includes(p.field))m[p.field]=value;else if(p.field==='firstStep')m.steps[0].text=value;else if(p.field==='firstCheck')m.steps[0].check=value;else fault('这个内容不能在这里修改。');validateCasePlan(p.caseId,d);return {kind:'draft'};
 }
 if(action==='case.plan.move'){
  const d=candidate(),i=d.modules.findIndex(m=>m.id===p.moduleId),j=i+(p.direction==='up'?-1:1);if(i<0)fault('这块内容已经改变。');if(j>=0&&j<d.modules.length)[d.modules[i],d.modules[j]]=[d.modules[j],d.modules[i]];return {kind:'draft'};
 }
 if(action==='case.plan.merge'){
  const d=candidate(),i=d.modules.findIndex(m=>m.id===p.moduleId);if(i<=0)fault('第一块前面没有可合并的内容。');const a=d.modules[i-1],b=d.modules[i];a.title=`${a.title} / ${b.title}`.slice(0,1000);a.pages=[...new Set([...a.pages,...b.pages])].sort((x,y)=>x-y);a.steps.push(...b.steps);a.prerequisites=[...new Set([...a.prerequisites,...b.prerequisites])];d.modules.splice(i,1);validateCasePlan(p.caseId,d);return {kind:'draft'};
 }
 if(action==='case.plan.confirm'){
  const d=getDraft(),old=s.tasks.find(t=>t.id===d.taskId);if(old)return {kind:'none',data:{taskId:old.id}};
  const plan=validateCasePlan(p.caseId,d),selected=plan.modules.find(m=>m.id===p.moduleId)||plan.modules[0],pack=packFor(p.caseId),taskId=id();
  for(const r of s.rounds)if(r.status==='running')stopRound(s,r);
  const steps=[],modules=plan.modules.map(m=>{const stepIds=m.steps.map(v=>{const stepId=id();steps.push({id:stepId,moduleId:m.id,text:v.text,check:v.check,completed:false});return stepId;});const value={...clone(m),stepIds,status:'pending',bookmarkPage:m.startPage};delete value.steps;return value;});
  s.tasks.push({id:taskId,caseId:pack.id,kind:pack.kind,title:plan.title,successCheck:plan.successCheck,status:'ready',currentModuleId:selected.id,currentStepId:modules.find(m=>m.id===selected.id).stepIds[0],modules,steps,prerequisiteChecks:{},materialMode:'document',material:{id:'practice',label:pack.subtitle,position:`PDF 第${selected.startPage}页`,page:selected.startPage,available:true},checkpoint:null});
  s.activeTaskId=taskId;Object.assign(d,{status:'confirmed',taskId});clearInvitation(s);return {kind:'plan',data:{taskId}};
 }
 if(action==='case.module.select'){
  const t=getTask(),m=t.modules.find(m=>m.id===p.moduleId);if(!m)fault('这块内容已经不在当前大纲中。');
  if(t.currentModuleId===m.id){m.currentStepId=t.currentStepId;m.bookmarkPage=t.material.page;return {kind:'edit'};}
  if(t.currentModuleId!==m.id){const previous=t.modules.find(v=>v.id===t.currentModuleId);if(previous){previous.currentStepId=t.currentStepId;previous.bookmarkPage=t.material.page;previous.checkpoint=checkpoint(t);}for(const r of s.rounds)if(r.taskId===t.id&&r.status==='running')stopRound(s,r);}
  t.currentModuleId=m.id;t.currentStepId=m.currentStepId&&t.steps.some(v=>v.id===m.currentStepId&&!v.completed)?m.currentStepId:m.stepIds.find(k=>!t.steps.find(v=>v.id===k)?.completed)||null;
  t.material.page=m.bookmarkPage||m.startPage;t.material.position=`PDF 第${t.material.page}页`;t.checkpoint=m.checkpoint||null;s.activeTaskId=t.id;clearInvitation(s);return {kind:'edit'};
 }
 if(action==='case.page'){
  const t=getTask(),pack=packFor(t.caseId);if(!Number.isInteger(p.page)||p.page<1||p.page>pack.pageCount)fault('这个 PDF 页码不存在。');
  t.material.page=p.page;t.material.position=`PDF 第${p.page}页`;const m=t.modules.find(m=>m.id===t.currentModuleId);m.bookmarkPage=p.page;
  const r=[...s.rounds].reverse().find(r=>r.taskId===t.id&&r.status!=='ended');
  if(s.prefs.recording&&!s.prefs.recordingPaused&&r?.status==='running'&&p.record===true)s.events.push({id:id(),taskId:t.id,moduleId:m.id,roundId:r.id,time:stamp().slice(11,16),observation:`打开 ${pack.subtitle} · PDF 第${p.page}页`,source:'local-material',explanation:'',hidden:false,inaccurate:false});return {kind:'draft'};
 }
 if(action==='case.prerequisite'){
  const t=getTask(),allowed=packFor(t.caseId).modules.flatMap(m=>m.prerequisites||[]);if(!allowed.includes(p.key)||!['known','unsure','unchecked'].includes(p.value))fault('请选择这份材料相关的知识项。');
  t.prerequisiteChecks=t.prerequisiteChecks||{};if(p.value==='unchecked')delete t.prerequisiteChecks[p.key];else t.prerequisiteChecks[p.key]=p.value;return {kind:'edit'};
 }
 if(action==='case.step.smaller'){
  const t=getTask(),m=t.modules.find(m=>m.id===t.currentModuleId),v=t.steps.find(v=>v.id===t.currentStepId);if(!v)fault('先选择一条眼前小步。');
  v.text=t.caseId==='hci'&&m.id==='hta'?'只看第62页的 Plan 说明，找出它交代的顺序或条件':t.caseId==='control'?'先从原题中找出一个“已给条件”和一个“要验证的要求”':`先打开第${m.startPage}页，找一个自己想弄清的问题`;v.check='用自己的话说一句即可，不需要一次做完整块。';return {kind:'edit'};
 }
 if(action==='case.module.finish'){
  const t=getTask(),m=t.modules.find(m=>m.id===t.currentModuleId);if(!['reviewed','needs-review'].includes(m.status))m.status='looked';m.lookedAt=stamp();return {kind:'edit'};
 }
 if(action==='case.review.suggest'){
  const t=getTask(),d=s.reflectionDrafts[t.id],m=t.modules.find(m=>m.id===p.moduleId);
  if(!d||d.id!==p.id||d.moduleId!==p.moduleId||!m||p.expectedText!==undefined&&text(p.expectedText)!==d.text)fault('原稿或板块已改变，旧建议未写入。','CASE_STALE');
  if(p.expected&&['text','uncertainty','nextIntent'].some(k=>text(p.expected[k])!==text(d[k])))fault('原稿已修改，请按新内容重新整理。','CASE_STALE');
  d.proposal={text:d.text,uncertainty:d.uncertainty,nextIntent:d.nextIntent||(t.caseId==='hci'?`先对照第${m.startPage}页附近的原文，核对自己还说不清的一点`:'先核对本题条件与一个不熟悉的前置知识，再进入实际求解'),question:m.question,adjustment:d.uncertainty?'把这个不确定点写成一个小问题，先回原文核对；也可以暂时保留。':'先合上材料自己解释，再对照原文；是否继续由你决定。',source:'模拟建议 · 未调用 API',simulation:true};return {kind:'draft'};
 }
 fault('这个材料操作暂不支持。','UNKNOWN_ACTION');
}
module.exports={applyCaseAction};
