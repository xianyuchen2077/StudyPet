const {randomUUID} = require('node:crypto');
const {validateResult}=require('./ai-contract.cjs');
const {applyCaseAction}=require('./case-actions.cjs');
const {emptyState,material,scenarioState,GOAL,FIRST_STEP,SUGGESTIONS,SMALLER_STEP,CONCEPT_GOAL,CONCEPT_FIRST_STEP,CONCEPT_SUGGESTIONS} = require('./fixtures.cjs');
const clone = value=>JSON.parse(JSON.stringify(value));
const text = (value,max=5000)=>typeof value==='string'?value.trim().slice(0,max):'';
function issue(message,code='INVALID_INPUT') {const error=Error(message);error.code=code;return error;}

function createStudyEngine({read=async()=>null,write=async()=>{},now=()=>new Date().toISOString(),onChange=()=>{}}={}) {
  let state=emptyState();
  let runtime={error:null,pendingSave:false,failNext:null,view:'home'};
  let queue=Promise.resolve();
  let sequence=0,activeSequence=0,safety=[];
  const stamp=()=>now();
  const id=()=>randomUUID();
  function snapshot() {return {...clone(state),runtime:clone(runtime)};}
  function emit() {onChange(snapshot());}
  function task(s,p={}) {const t=s.tasks.find(x=>x.id===(p.taskId||s.activeTaskId));if(!t)throw issue('先选择一个学习任务');return t;}
  function step(t,stepId) {const v=t.steps.find(x=>x.id===(stepId||t.currentStepId));if(!v)throw issue('请先选一条自己认可的小步');return v;}
  function round(s,taskId) {return [...s.rounds].reverse().find(r=>r.taskId===taskId&&r.status!=='ended');}
  function checkpoint(t) {const v=t.steps.find(x=>x.id===t.currentStepId);return {position:t.material.position||'位置还没有填写',nextAction:(v&&t.checkpoint?.stepId===v.id?t.checkpoint.nextAction:v?.text)||'下一步还没定',stepId:v?.id||null,source:'我主动留下',confirmedAt:stamp(),...(t.caseId?{moduleId:t.currentModuleId,page:t.material.page}:{})};}
  function stopRound(s,r,ended=false) {if(!r)return; r.status=ended?'ended':'paused';if(ended)r.endedAt=stamp();else r.pausedAt=stamp();const t=s.tasks.find(x=>x.id===r.taskId);if(t){t.checkpoint=checkpoint(t);const m=t.modules?.find(m=>m.id===t.currentModuleId);if(m){m.checkpoint=clone(t.checkpoint);m.bookmarkPage=t.material.page;m.currentStepId=t.currentStepId;}}}
  function clearInvitation(s) {if(s.invitation&&!s.consumedInvitations.includes(s.invitation.key))s.consumedInvitations.push(s.invitation.key);s.invitation=null;}
  function clearInvalidInvitation(s) {if(s.invitation&&(!s.prefs.invitations||s.prefs.quiet||!s.prefs.nodes[s.invitation.node]))clearInvitation(s);}
  function retainMaterialPosition(s,p) {
    if(!['practice','tutorial'].includes(p.materialId)||!text(p.position,1000))return;
    const t=s.tasks.find(t=>t.id===(p.taskId||s.activeTaskId));if(!t)return;
    const available=t.material.available;t.material={...(t.material.id===p.materialId?t.material:material(p.materialId)),position:text(p.position,1000),available};
    if(t.caseId&&Number.isInteger(p.page)&&p.page>=1&&p.page<=require('./case-plan.cjs').catalog[t.caseId].pageCount)t.material.page=p.page;
  }
  function applySafety(s,entries) {
    for(const entry of entries) {
      const {action,p}=entry;
      if(action==='prefs.update') {
        for(const [key,limited] of [['recording',false],['invitations',false],['recordingPaused',true],['quiet',true]])if(p[key]===limited)s.prefs[key]=limited;
        for(const node of ['resume','stage','end'])if(p.nodes?.[node]===false)s.prefs.nodes[node]=false;
        clearInvalidInvitation(s);
      } else if(action==='invitation.respond') {
        if(entry.invitation&&!s.consumedInvitations.includes(entry.invitation.key))s.consumedInvitations.push(entry.invitation.key);
        if(!entry.invitation||s.invitation?.key===entry.invitation.key)s.invitation=null;
      } else {
        if(['round.pause','round.end','app.pauseForQuit'].includes(action))retainMaterialPosition(s,p);
        const ended=['round.end','task.complete'].includes(action);
        for(const r of s.rounds) {
          const matches=action==='task.select'?r.taskId!==p.taskId:(action.startsWith('task.')||action==='round.end'||action==='case.module.select')?r.taskId===p.taskId:true;
          if(matches&&(r.status==='running'||(ended&&r.status==='paused')))stopRound(s,r,ended);
        }
        clearInvitation(s);
      }
    }
    return s;
  }
  function immediateSafety(action,p,seq) {
    let required=false;const safePayload={...p};
    if(action==='prefs.update')required=p.recording===false||p.invitations===false||p.recordingPaused===true||p.quiet===true||Object.values(p.nodes||{}).some(x=>x===false);
    if(['round.pause','round.end','app.pauseForQuit','demo.load'].includes(action))required=true;
    if(action==='invitation.respond'&&['accept','reject','later','ignored'].includes(p.response))required=true;
    if(action==='round.end')safePayload.taskId=p.taskId||state.activeTaskId;
    if(['task.select','task.park','task.complete','task.delete'].includes(action)){safePayload.taskId=p.taskId||state.activeTaskId;required=state.tasks.some(t=>t.id===safePayload.taskId);}
    if(action==='case.module.select'){safePayload.taskId=p.taskId||state.activeTaskId;required=state.tasks.some(t=>t.id===safePayload.taskId&&t.modules?.some(m=>m.id===p.moduleId)&&t.currentModuleId!==p.moduleId);}
    if(!required)return null;
    const entry={seq,action,p:safePayload,invitation:state.invitation?clone(state.invitation):null};
    safety.push(entry);state=applySafety(clone(state),[entry]);runtime.pendingSave=true;emit();return entry;
  }
  async function commit(next,{kind='edit',stopImmediately=false,stopState}={}) {
    const committingSequence=activeSequence;
    if(stopImmediately) {state=clone(stopState||next);runtime.pendingSave=true;emit();}
    try {
      if(runtime.failNext&&(runtime.failNext==='any'||runtime.failNext===kind)&&!['draft','invitation','event','context'].includes(kind)) {
        runtime.failNext=null;throw issue('模拟保存失败：还没保存，输入仍在这里。','SAVE_FAILED');
      }
      await write(clone(next));
      safety=safety.filter(entry=>entry.seq>committingSequence);
      state=applySafety(next,safety);runtime.error=null;runtime.pendingSave=safety.length>0;emit();return {ok:true,state:snapshot()};
    } catch(error) {
      throw issue(error.code==='SAVE_FAILED'?error.message:'还没保存，输入仍在这里。可以重试。', 'SAVE_FAILED');
    }
  }
  function draft(s,p={},make=true) {
    const draftId=p.draftId||s.startupDraftId;
    let d=p.newDraft?null:s.intentDrafts.find(x=>x.id===draftId);
    if(make&&d?.status==='confirmed'&&!p.draftId)d=null;
    if(!d&&make) {d={id:id(),intent:'',scope:'resources',title:'',firstStep:'',suggestions:[],status:'intent'};s.intentDrafts.push(d);s.startupDraftId=d.id;}
    if(!d)throw issue('这份意向已经不在了，请重新打开');return d;
  }
  function updateDraft(s,p) {
    const d=draft(s,p);
    if(d.status==='confirmed')return d;
    for(const k of ['intent','scope','title','firstStep','priorKnowledge','difficulty','successCheck','firstCheck','materialMode'])if(k in p)d[k]=text(p[k],k==='intent'?5000:1000);
    if(p.status==='intent'||p.status==='candidate')d.status=p.status;
    return d;
  }
  function reflectDraft(s,t,p) {
    const current=s.reflectionDrafts[t.id];let d=current;
    s.reflectionDraftArchive=s.reflectionDraftArchive||[];
    const targetRound=p.roundId===null?null:p.roundId||[...s.rounds].reverse().find(r=>r.taskId===t.id)?.id||null;
    if(targetRound&&!s.rounds.some(r=>r.id===targetRound&&r.taskId===t.id))throw issue('这轮学习已经不在了');
    if(p.id&&d?.id!==p.id)d=s.reflectionDraftArchive.find(r=>r.id===p.id&&r.taskId===t.id)||s.reflections.find(r=>r.id===p.id&&r.taskId===t.id);
    const targetModule=t.caseId?(p.moduleId||(p.id?d?.moduleId:null)||t.currentModuleId):null,m=targetModule?t.modules.find(m=>m.id===targetModule):null;
    if(targetModule&&!m)throw issue('这块内容已经不在当前任务中');
    if(targetModule&&targetRound&&s.rounds.find(r=>r.id===targetRound)?.moduleId!==targetModule)throw issue('回顾必须保存在对应板块的学习轮次中');
    if(p.id&&d?.moduleId&&d.moduleId!==targetModule)throw issue('不能把早前回顾改属到另一块内容');
    if(!d||p.newDraft||!p.id&&(d.roundId!==targetRound||(d.moduleId||null)!==targetModule))d={id:p.id||id(),taskId:t.id,roundId:targetRound,...(targetModule?{moduleId:targetModule,rootGoal:t.title}:{}),text:'',uncertainty:'',nextIntent:'',proposal:null,contextGoal:m?.goal||t.title,contextAction:t.steps.find(v=>v.id===t.currentStepId)?.text||'',contextSuccessCheck:m?.check||t.successCheck||''};
    else d=clone(d);
    if(current&&current.id!==d.id){
      const saved=s.reflections.find(r=>r.id===current.id);
      const pending=(current.text||current.uncertainty||current.nextIntent||current.proposal)&&(!saved||current.proposal||['text','uncertainty','nextIntent','phase'].some(k=>(saved[k]||'')!==(current[k]||'')));
      if(pending&&!s.reflectionDraftArchive.some(r=>r.id===current.id))s.reflectionDraftArchive.push(clone(current));
    }
    s.reflectionDraftArchive=s.reflectionDraftArchive.filter(r=>r.id!==d.id);
    for(const k of ['text','uncertainty','nextIntent'])if(k in p){const value=text(p[k]);if(d[k]!==value)d.proposal=null;d[k]=value;}
    if(['stage','end'].includes(p.phase)){if(d.phase&&d.phase!==p.phase)d.proposal=null;d.phase=p.phase;}
    if(['user','demo'].includes(p.inputSource))d.inputSource=p.inputSource;
    s.reflectionDrafts[t.id]=d;return d;
  }
  function maybeInvite(s,node) {
    if(!s.prefs.invitations||s.prefs.quiet||!s.prefs.nodes[node]||s.invitation||['reflection','guide','plan','editor'].includes(runtime.view))return;
    const t=s.tasks.find(t=>t.id===s.activeTaskId);if(!t)return;
    const r=[...s.rounds].reverse().find(r=>r.taskId===t.id);
    if(!r||(node==='stage'&&r.status!=='running')||(node==='resume'&&r.status!=='paused')||(node==='end'&&r.status!=='ended'))return;
    const key=`${t.id}:${r.id}:${t.currentModuleId||''}:${node}`;if(s.consumedInvitations.includes(key))return;
    s.invitation={id:id(),key,node,taskId:t.id,roundId:r.id,...(t.caseId?{moduleId:t.currentModuleId}:{}),createdAt:stamp(),message:node==='resume'?'要接着上次那一步吗？':node==='stage'?'这一小段，要不要留一句自己的理解？':'这一轮结束了，要不要留一句自己的理解？'};
  }
  function removeEvidence(s,eventId,deleted=false) {
    for(const r of s.reflections)if(r.evidenceIds?.includes(eventId)){r.evidenceIds=r.evidenceIds.filter(x=>x!==eventId);r.evidenceMissing=true;r.evidenceNote=deleted?'来源已删除':'来源已隐藏或标为不准确';}
  }
  function clearEditor(s,mode,taskId,targetId) {const d=s.editorDraft;const matchesTarget=!['step','explanation'].includes(mode)||(d?.targetId||null)===(targetId||null);if(d?.mode===mode&&d.taskId===taskId&&matchesTarget)s.editorDraft=null;}
  async function handle(action,p={},receipt={}) {
    if(!p||typeof p!=='object'||Array.isArray(p))throw issue('操作参数不正确');
    runtime.error=null;
    if(action==='view.context') {runtime.view=text(p.view,40)||'home';emit();return {ok:true,state:snapshot()};}
    if(action==='error.dismiss') {emit();return {ok:true,state:snapshot()};}
    if(action==='demo.failNext') {runtime.failNext=['plan','round','reflection','edit','any'].includes(p.kind)?p.kind:'any';emit();return {ok:true,state:snapshot()};}
    const next=clone(state);
    if(action==='demo.load') {const result=await commit(scenarioState(p.scenario,stamp(),id),{kind:'reset'});runtime.view='home';return result;}
    if(action==='persistence.retry')return commit(next,{kind:'retry'});
    if(action.startsWith('case.')){const value=applyCaseAction(next,action,p,{id,stamp,stopRound,clearInvitation,checkpoint});if(value.kind==='none')return {ok:true,state:snapshot(),data:value.data};const result=await commit(next,{kind:value.kind});if(value.data)result.data=value.data;return result;}
    if(action==='editor.draft') {
      const t=task(next,p);
      if(!['task','step','checkpoint','material','explanation'].includes(p.mode)||!p.fields||typeof p.fields!=='object'||Array.isArray(p.fields))throw issue('请选择一个可以编辑的对象');
      const fields={};
      for(const [key,value] of Object.entries(p.fields).slice(0,25))if(/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)&&!['constructor','prototype'].includes(key)) {
        if(typeof value==='string')fields[key]=value.slice(0,5000);else if(typeof value==='boolean'||value===null)fields[key]=value;
      }
      next.editorDraft={mode:p.mode,taskId:t.id,targetId:text(p.targetId,100)||(p.mode==='step'?text(fields.stepId,100):'')||null,fields,returnView:['tasks','resume','study','feedback','home'].includes(p.returnView)?p.returnView:'home'};
      return commit(next,{kind:'draft'});
    }
    if(action==='editor.clear'){next.editorDraft=null;return commit(next,{kind:'draft'});}
    if(action==='draft.startup') {const d=updateDraft(next,p);next.startupDraftId=d.id;return commit(next,{kind:'draft'});}
    if(action==='draft.aiCandidate') {
      const d=draft(next,p,false);
      const fields=['intent','title','firstStep','priorKnowledge','difficulty','successCheck','materialMode'];
      if(d.status==='confirmed'||!p.expected||fields.some(k=>text(d[k])!==text(p.expected[k])))throw issue('原稿已修改，这份旧 AI 建议未写入。可以按新原稿重新请求。','AI_STALE');
      const value=validateResult('plan',p.result);
      d.title=value.goal;d.planWhy=value.why;d.successCheck=value.successCheck;d.firstStep=value.steps[0].action;d.firstCheck=value.steps[0].check;
      d.suggestions=value.steps.slice(1).map(v=>v.action);d.suggestionChecks=Object.fromEntries(value.steps.slice(1).map(v=>[v.action,v.check]));
      d.aiSource={provider:'DeepSeek',model:text(p.source?.model,80),requestId:text(p.source?.requestId,100)};
      d.status='candidate';next.startupDraftId=d.id;return commit(next,{kind:'draft'});
    }
    if(action==='draft.suggest') {
      const d=updateDraft(next,p);if(d.status==='confirmed')throw issue('这份计划已经确认，可去我的任务修改');
      const concepts=['concepts','components'].includes(p.scope);
      d.title=concepts?CONCEPT_GOAL:GOAL;
      d.firstStep=concepts?CONCEPT_FIRST_STEP:FIRST_STEP;
      d.suggestions=concepts?[...CONCEPT_SUGGESTIONS]:[...SUGGESTIONS];
      d.materialMode='os-example';d.successCheck=concepts?'合上图解，用一个例子说明进程与线程的区别':'不看图解，解释全局变量与线程栈分别属于谁';
      d.firstCheck='自己指出图中对应的位置，并说一句理由';d.aiSource=null;d.planWhy='先通过一个具体例子区分容易混淆的资源';
      d.status='candidate';next.startupDraftId=d.id;return commit(next,{kind:'draft'});
    }
    if(action==='draft.refine') {
      const d=draft(next,p,false);if(d.status==='confirmed')throw issue('已确认的计划请在我的任务里修改');
      d.firstStep=p.kind==='other'?'先看资源分类自测的第1题：全局变量':SMALLER_STEP;d.status='candidate';return commit(next,{kind:'draft'});
    }
    if(action==='draft.delete') {
      const d=draft(next,p,false);if(d.status==='confirmed')throw issue('已确认的内容请从任务中删除');next.intentDrafts=next.intentDrafts.filter(x=>x.id!==d.id);if(next.startupDraftId===d.id)next.startupDraftId=null;return commit(next);
    }
    if(action==='plan.confirm') {
      const d=updateDraft(next,p);const already=next.tasks.find(t=>t.id===d.taskId);
      if(already)return {ok:true,state:snapshot(),data:{taskId:already.id}};
      if(!d.title||!d.firstStep)throw issue('只需有一个目标和一条眼前可做的首步');
      // Keep only the user's draft in memory on failure; never publish a task early.
      state.intentDrafts=clone(next.intentDrafts);state.startupDraftId=d.id;
      const taskId=id(),stepId=id();
      for(const r of next.rounds)if(r.status==='running')stopRound(next,r);
      const external=d.materialMode==='external';
      next.tasks.push({id:taskId,title:d.title,successCheck:d.successCheck||'',learningReason:d.planWhy||'',materialMode:external?'external':'os-example',status:'ready',currentStepId:stepId,steps:[{id:stepId,text:d.firstStep,check:d.firstCheck||'',completed:false}],material:external?{...material(),label:'自己的学习材料',position:'在自己打开的教材、笔记或练习中学习',available:false}:material(),checkpoint:null});
      next.activeTaskId=taskId;d.taskId=taskId;d.status='confirmed';return commit(next,{kind:'plan'});
    }
    if(action==='round.start') {
      const t=task(next,p);if(t.status==='completed')throw issue('这项任务已标为完成，可以先撤回完成');
      const v=step(t,p.stepId);if(v.completed)throw issue('这一步已完成，请自己选择下一步');
      if(!t.material.available&&!p.manualReady)throw issue('材料没打开，本轮尚未开始或恢复。任务还在。','MATERIAL_UNAVAILABLE');
      if(p.manualReady)t.material.available=true;
      for(const r of next.rounds)if(r.status==='running'&&r.taskId!==t.id)stopRound(next,r);
      let r=round(next,t.id);
      if(t.caseId&&r&&r.moduleId!==t.currentModuleId){r.status='ended';r.endedAt=stamp();r=null;}
      if(r?.status==='running')return {ok:true,state:snapshot()};
      if(r){r.status='running';r.resumedAt=stamp();}
      else {r={id:id(),taskId:t.id,...(t.caseId?{moduleId:t.currentModuleId}:{}),status:'running',startedAt:stamp(),pausedAt:null,endedAt:null,source:'user'};next.rounds.push(r);}
      if(t.caseId){const m=t.modules.find(m=>m.id===t.currentModuleId);if(m.status==='pending')m.status='learning';}
      t.status='active';t.currentStepId=v.id;next.activeTaskId=t.id;clearInvitation(next);return commit(next,{kind:'round'});
    }
    if(['round.pause','round.end','app.pauseForQuit'].includes(action)) {
      const ending=action==='round.end';
      retainMaterialPosition(next,p);
      const endingTaskId=receipt.p?.taskId||p.taskId||next.activeTaskId;
      for(const r of next.rounds)if(ending?(r.taskId===endingTaskId&&['running','paused'].includes(r.status)):r.status==='running')stopRound(next,r,ending);
      clearInvitation(next);if(ending)maybeInvite(next,'end');return commit(next,{kind:'round',stopImmediately:true});
    }
    if(action==='checkpoint.confirm') {
      const t=task(next,p);t.checkpoint={position:text(p.position,1000)||t.material.position||'位置还未填写',nextAction:text(p.nextAction,1000)||t.steps.find(v=>v.id===t.currentStepId)?.text||'下一步还没定',stepId:t.currentStepId,source:'由我核对确认',confirmedAt:stamp()};
      t.material.position=t.checkpoint.position;clearEditor(next,'checkpoint',t.id);return commit(next);
    }
    if(action==='material.replace') {
      const t=task(next,p);const m=material(p.id==='tutorial'?'tutorial':'practice');
      if(t.caseId){t.material={...t.material,label:text(p.label,200)||t.material.label,position:text(p.position,1000)||t.material.position,page:t.material.page||t.modules.find(m=>m.id===t.currentModuleId).bookmarkPage,available:p.available!==false};if(p.available!==false)clearEditor(next,'material',t.id);return commit(next);}
      t.material={...m,label:text(p.label,200)||m.label,position:text(p.position,1000)||m.position,available:p.available!==false};
      if(p.available!==false)clearEditor(next,'material',t.id);
      return commit(next);
    }
    if(action==='task.select') {
      const t=task(next,p),stopped=clone(state);let stopping=false;
      for(const r of next.rounds)if(r.status==='running'&&r.taskId!==t.id){stopRound(next,r);stopping=true;}
      for(const r of stopped.rounds)if(r.status==='running'&&r.taskId!==t.id)stopRound(stopped,r);
      next.activeTaskId=t.id;clearInvitation(next);return commit(next,{stopImmediately:stopping,stopState:stopped});
    }
    if(action==='task.save') {const t=task(next,p);const title=text(p.title,1000);if(!title)throw issue('写一句你想学的事即可');t.title=title;if('successCheck' in p)t.successCheck=text(p.successCheck,1000);clearEditor(next,'task',t.id);return commit(next);}
    if(action==='task.move') {
      const t=task(next,p),i=next.tasks.indexOf(t),j=i+(p.direction==='up'?-1:1);if(j>=0&&j<next.tasks.length)[next.tasks[i],next.tasks[j]]=[next.tasks[j],next.tasks[i]];return commit(next);
    }
    if(['task.park','task.complete','task.reopen'].includes(action)) {
      const t=task(next,p),stopped=clone(state);let stopping=false;
      const mustStop=r=>r.taskId===t.id&&(r.status==='running'||(action==='task.complete'&&r.status==='paused'));
      if(action!=='task.reopen') {
        for(const r of next.rounds)if(mustStop(r)){stopRound(next,r,action==='task.complete');stopping=true;}
        for(const r of stopped.rounds)if(mustStop(r))stopRound(stopped,r,action==='task.complete');
      }
      t.status=action==='task.park'?'parked':action==='task.complete'?'completed':'ready';clearInvitation(next);
      return commit(next,{stopImmediately:stopping,stopState:stopped});
    }
    if(action==='task.delete') {
      const t=task(next,p);const stopping=next.rounds.some(r=>r.taskId===t.id&&r.status==='running');
      // Stop immediately, but retain the task in memory if deletion cannot be saved.
      const stopped=clone(state);for(const r of stopped.rounds)if(r.taskId===t.id&&r.status==='running')stopRound(stopped,r);
      next.tasks=next.tasks.filter(x=>x.id!==t.id);next.rounds=next.rounds.filter(x=>x.taskId!==t.id);next.events=next.events.filter(x=>x.taskId!==t.id);next.reflections=next.reflections.filter(x=>x.taskId!==t.id);next.intentDrafts=next.intentDrafts.filter(x=>x.taskId!==t.id);delete next.reflectionDrafts[t.id];
      next.reflectionDraftArchive=next.reflectionDraftArchive.filter(r=>r.taskId!==t.id);
      for(const [key,d] of Object.entries(next.caseDrafts||{}))if(d.taskId===t.id)delete next.caseDrafts[key];
      if(!next.intentDrafts.some(x=>x.id===next.startupDraftId))next.startupDraftId=null;
      if(next.editorDraft?.taskId===t.id)next.editorDraft=null;
      if(next.activeTaskId===t.id)next.activeTaskId=next.tasks[0]?.id||null;clearInvitation(next);return commit(next,{stopImmediately:stopping,stopState:stopped});
    }
    if(action==='step.save') {
      const t=task(next,p),value=text(p.text,1000);if(!value)throw issue('写一条现在可以动手的事');
      const ref=p.fromReflectionId?next.reflections.find(r=>r.id===p.fromReflectionId&&r.taskId===t.id):null;
      if(ref?.nextStepId&&t.steps.some(v=>v.id===ref.nextStepId))return {ok:true,state:snapshot()};
      let v=p.stepId?t.steps.find(v=>v.id===p.stepId):null;
      if(p.stepId&&!v)throw issue('这条小步已经不在了');
      if(v)v.text=value;else {const mid=ref?.moduleId||t.currentModuleId;v={id:id(),text:value,completed:false,...(t.caseId?{moduleId:mid}:{})};t.steps.push(v);if(t.caseId)t.modules.find(m=>m.id===mid).stepIds.push(v.id);}
      if('check' in p)v.check=text(p.check,1000);
      if(p.select===true)t.currentStepId=v.id;
      if(ref)ref.nextStepId=v.id;
      if(p.fromDraftId){const d=next.intentDrafts.find(x=>x.id===p.fromDraftId);if(d)d.suggestions=d.suggestions.filter(x=>x!==p.acceptedSuggestion);}
      clearEditor(next,'step',t.id,p.stepId);
      return commit(next);
    }
    if(action==='step.select') {const t=task(next,p),v=step(t,p.stepId);if(v.completed)throw issue('可以先撤回这一步的完成');if(t.caseId&&v.moduleId!==t.currentModuleId)throw issue('请先选择这条小步所属的板块');t.currentStepId=v.id;return commit(next);}
    if(action==='step.move') {
      const t=task(next,p),v=step(t,p.stepId),i=t.steps.indexOf(v),j=i+(p.direction==='up'?-1:1);if(j>=0&&j<t.steps.length)[t.steps[i],t.steps[j]]=[t.steps[j],t.steps[i]];return commit(next);
    }
    if(action==='step.complete'||action==='step.reopen') {const t=task(next,p),v=step(t,p.stepId);v.completed=action==='step.complete';if(v.completed&&t.currentStepId===v.id)t.currentStepId=null;return commit(next);}
    if(action==='reflection.draft') {const t=task(next,p);reflectDraft(next,t,p);return commit(next,{kind:'draft'});}
    if(action==='reflection.proposal.clear'){const t=task(next,p),d=next.reflectionDrafts[t.id];if(!d||d.id!==p.id)throw issue('这份回顾已经改变，请重新打开');d.proposal=null;return commit(next,{kind:'draft'});}
    if(action==='reflection.aiCandidate') {
      const t=task(next,p),d=next.reflectionDrafts[t.id];
      if(!d||d.id!==p.id||!p.expected||['text','uncertainty','nextIntent','phase'].some(k=>text(d[k])!==text(p.expected[k])))throw issue('自己的回顾已修改，这份旧 AI 建议未写入。','AI_STALE');
      const value=validateResult('review',p.result);
      d.proposal={text:!d.text&&!d.uncertainty?'':value.summary,uncertainty:!d.text&&!d.uncertainty?'':value.uncertainty,nextIntent:value.nextStep,question:value.question,adjustment:value.adjustment,source:`DeepSeek · ${text(p.source?.model,80)||'AI'} · 仅供核对`,requestId:text(p.source?.requestId,100)};
      return commit(next,{kind:'draft'});
    }
    if(action==='reflection.suggest') {
      const t=task(next,p),d=reflectDraft(next,t,p);if(!d.text&&!d.uncertainty&&!d.nextIntent)throw issue('先写一句自己的理解，我再帮你整理');
      d.proposal={text:d.text,uncertainty:d.uncertainty,nextIntent:p.bad?'把操作系统整本书重学一遍':d.nextIntent,source:'根据你刚才写的内容整理；尚未确认'};return commit(next,{kind:'draft'});
    }
    if(action==='reflection.save') {
      const t=task(next,p),d=reflectDraft(next,t,p);
      // The editable draft survives an unsuccessful save; the confirmed version does not change.
      state.reflectionDrafts[t.id]=clone(d);
      if(!d.text&&!d.uncertainty&&!d.nextIntent)throw issue('可以只写一句，也可以这次跳过');
      const validEvidence=e=>e.taskId===t.id&&!e.hidden&&!e.inaccurate&&(!d.moduleId||e.moduleId===d.moduleId&&e.roundId===d.roundId);
      const evidenceIds=(Array.isArray(p.evidenceIds)?p.evidenceIds:next.events.filter(validEvidence).map(e=>e.id)).filter(k=>next.events.some(e=>e.id===k&&validEvidence(e)));
      const old=next.reflections.find(r=>r.id===d.id),value={...d,proposal:undefined,evidenceIds,savedAt:stamp()};delete value.proposal;
      if(old)Object.assign(old,value);else next.reflections.push(value);
      if(d.moduleId){const m=t.modules.find(m=>m.id===d.moduleId);m.status=d.uncertainty?'needs-review':'reviewed';m.lastReflectionId=d.id;}
      d.savedAt=value.savedAt;d.proposal=null;return commit(next,{kind:'reflection'});
    }
    if(action==='event.explain'||action==='event.mark'||action==='event.delete') {
      const e=next.events.find(x=>x.id===p.id);if(!e)throw issue('这条线索已经不在了');
      if(action==='event.explain'){e.explanation=text(p.explanation);clearEditor(next,'explanation',e.taskId,e.id);}
      if(action==='event.mark'){if(typeof p.hidden==='boolean')e.hidden=p.hidden;if(typeof p.inaccurate==='boolean')e.inaccurate=p.inaccurate;if(e.hidden||e.inaccurate)removeEvidence(next,e.id);}
      if(action==='event.delete'){next.events=next.events.filter(x=>x.id!==e.id);removeEvidence(next,e.id,true);clearEditor(next,'explanation',e.taskId,e.id);}
      return commit(next);
    }
    if(action==='prefs.update') {
      const pref=next.prefs;
      for(const k of ['recording','recordingPaused','invitations','quiet'])if(typeof p[k]==='boolean')pref[k]=p[k];
      if(p.nodes&&typeof p.nodes==='object')for(const k of ['resume','stage','end'])if(typeof p.nodes[k]==='boolean')pref.nodes[k]=p.nodes[k];
      if(!pref.recording)pref.recordingPaused=false;
      clearInvalidInvitation(next);
      const safe=clone(state);let stopping=false;
      for(const [key,limited] of [['recording',false],['invitations',false],['recordingPaused',true],['quiet',true]])if(pref[key]===limited&&safe.prefs[key]!==limited){safe.prefs[key]=limited;stopping=true;}
      for(const k of ['resume','stage','end'])if(!pref.nodes[k]&&safe.prefs.nodes[k]){safe.prefs.nodes[k]=false;stopping=true;}
      clearInvalidInvitation(safe);
      return commit(next,{kind:'prefs',stopImmediately:stopping,stopState:safe});
    }
    if(action==='demo.event') {
      const t=next.tasks.find(t=>t.id===next.activeTaskId),r=t&&round(next,t.id);
      if(!t||r?.status!=='running'||!next.prefs.recording||next.prefs.recordingPaused)return {ok:true,state:snapshot()};
      next.events.push({id:id(),taskId:t.id,roundId:r.id,time:stamp().slice(11,16),observation:p.material==='tutorial'?'切到资源分类自测':'回到进程与线程图解',source:'simulation',explanation:'',hidden:false,inaccurate:false});return commit(next,{kind:'event'});
    }
    if(action==='demo.node') {if(!['resume','stage','end'].includes(p.node))throw issue('请选择一个模拟节点');maybeInvite(next,p.node);if(!next.invitation)return {ok:true,state:snapshot(),data:{suppressed:true}};return commit(next,{kind:'invitation'});}
    if(action==='invitation.respond') {
      const invitation=receipt.invitation||next.invitation;if(!invitation)return commit(next,{kind:'invitation'});
      if(!['accept','reject','later','ignored'].includes(p.response))throw issue('请选择如何回应邀请');
      clearInvitation(next);const result=await commit(next,{kind:'invitation',stopImmediately:true});result.data={node:invitation.node,taskId:invitation.taskId,accepted:p.response==='accept'};return result;
    }
    throw issue('这个操作不在演示范围内','UNKNOWN_ACTION');
  }
  function dispatch(action,p={}) {
    const seq=++sequence;
    const receipt=p&&typeof p==='object'&&!Array.isArray(p)?immediateSafety(action,p,seq):null;
    const work=queue.then(async()=>{
      activeSequence=seq;
      try{return await handle(action,p,receipt||{});}catch(error){runtime.error={message:error.message,code:error.code||'INVALID_INPUT'};emit();return {ok:false,error:error.message,code:error.code||'INVALID_INPUT',state:snapshot()};}
    });queue=work.catch(()=>{});return work;
  }
  async function init() {
    try {
      const saved=await read();
      if(saved&&saved.schemaVersion===1&&Array.isArray(saved.tasks)&&Array.isArray(saved.rounds)) {
        state={...emptyState(),...clone(saved)};state.prefs={...emptyState().prefs,...state.prefs,nodes:{...emptyState().prefs.nodes,...state.prefs?.nodes}};
        let changed=false;
        for(const r of state.rounds)if(r.status==='running'){stopRound(state,r);changed=true;}
        if(state.invitation){clearInvitation(state);changed=true;}
        if(changed)await commit(clone(state),{kind:'recovery',stopImmediately:true});
      }
    } catch(error) {runtime.pendingSave=true;runtime.error={message:'本地数据暂时无法读取或保存，当前先保持停止。可以重试保存。',code:'LOAD_FAILED'};}
    emit();return {ok:!runtime.error,state:snapshot()};
  }
  return {init,dispatch,snapshot};
}
module.exports={createStudyEngine};
