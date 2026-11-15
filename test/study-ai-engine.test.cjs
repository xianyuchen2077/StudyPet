const test=require('node:test'),assert=require('node:assert/strict');
const {createStudyEngine}=require('../study/engine.cjs');
const result={goal:'解释 TCP 三次握手',why:'先说清每次消息确认什么',successCheck:'合上教材画过程并解释',steps:[{action:'画出双方的初始状态',check:'说出两列各代表谁'},{action:'标出 SYN 与 ACK',check:'解释每次确认的含义'}]};
const fields=['intent','title','firstStep','priorKnowledge','difficulty','successCheck','materialMode'];
const expected=d=>Object.fromEntries(fields.map(k=>[k,d[k]||'']));
async function setup(){const engine=createStudyEngine();await engine.init();await engine.dispatch('draft.startup',{newDraft:true,intent:'学习 TCP 三次握手',priorKnowledge:'知道客户端和服务端',difficulty:'总在背流程',materialMode:'external'});return engine;}
test('AI 计划只更新候选，用户确认后保存检验方式，外部材料需用户准备',async()=>{
 const e=await setup(),d=e.snapshot().intentDrafts[0];const r=await e.dispatch('draft.aiCandidate',{draftId:d.id,expected:expected(d),result,source:{model:'deepseek-flash',requestId:'req1'}});
 assert.equal(r.ok,true);assert.equal(e.snapshot().tasks.length,0);const candidate=e.snapshot().intentDrafts[0];assert.equal(candidate.firstCheck,result.steps[0].check);
 await e.dispatch('plan.confirm',{draftId:d.id});const s=e.snapshot(),task=s.tasks[0];assert.equal(task.successCheck,result.successCheck);assert.equal(task.steps.length,1);assert.equal(task.steps[0].check,result.steps[0].check);assert.equal(task.materialMode,'external');assert.equal(task.material.available,false);
 assert.equal((await e.dispatch('round.start',{taskId:task.id})).code,'MATERIAL_UNAVAILABLE');assert.equal((await e.dispatch('round.start',{taskId:task.id,manualReady:true})).ok,true);
});
test('新一轮的阶段自检不会继承上轮结束草稿，旧草稿可恢复并保存到原轮次',async()=>{
 const e=await setup(),d=e.snapshot().intentDrafts[0];await e.dispatch('draft.aiCandidate',{draftId:d.id,expected:expected(d),result});await e.dispatch('plan.confirm',{draftId:d.id});const t=e.snapshot().tasks[0];await e.dispatch('round.start',{taskId:t.id,manualReady:true});const first=e.snapshot().rounds[0].id;await e.dispatch('round.end',{taskId:t.id});
 await e.dispatch('reflection.draft',{taskId:t.id,newDraft:true,text:'上一轮尚未确认的总结',phase:'end',roundId:first});const old=e.snapshot().reflectionDrafts[t.id];await e.dispatch('round.start',{taskId:t.id,manualReady:true});const second=e.snapshot().rounds.at(-1).id;
 await e.dispatch('reflection.draft',{taskId:t.id,newDraft:true,text:'这一轮我想重新自检',phase:'stage',roundId:second});const s=e.snapshot();assert.equal(s.reflectionDrafts[t.id].roundId,second);assert.equal(s.reflectionDraftArchive[0].id,old.id);assert.equal(s.reflectionDraftArchive[0].text,old.text);
 await e.dispatch('reflection.draft',{taskId:t.id,id:old.id,roundId:first,text:old.text,phase:'end'});await e.dispatch('reflection.save',{taskId:t.id,id:old.id,roundId:first});assert.equal(e.snapshot().reflections[0].roundId,first);assert.equal(e.snapshot().reflectionDraftArchive[0].roundId,second);
});
test('过期 AI 结果不能覆盖修改后的草稿或已经确认的任务',async()=>{
 const e=await setup(),d=e.snapshot().intentDrafts[0],old=expected(d);await e.dispatch('draft.startup',{draftId:d.id,intent:'改学拥塞控制'});
 const stale=await e.dispatch('draft.aiCandidate',{draftId:d.id,expected:old,result});assert.equal(stale.code,'AI_STALE');assert.equal(e.snapshot().intentDrafts[0].title,'');
 await e.dispatch('draft.startup',{draftId:d.id,title:'我定的目标',firstStep:'画一张图'});await e.dispatch('plan.confirm',{draftId:d.id});assert.equal((await e.dispatch('draft.aiCandidate',{draftId:d.id,expected:expected(e.snapshot().intentDrafts[0]),result})).code,'AI_STALE');
});
test('阶段/结束建议保留用户原稿与正在进行的轮次，修改后旧结果失效',async()=>{
 const e=await setup(),d=e.snapshot().intentDrafts[0];await e.dispatch('draft.aiCandidate',{draftId:d.id,expected:expected(d),result});await e.dispatch('plan.confirm',{draftId:d.id});const t=e.snapshot().tasks[0];await e.dispatch('round.start',{taskId:t.id,manualReady:true});
 await e.dispatch('reflection.draft',{taskId:t.id,newDraft:true,text:'我知道三次消息的名字',uncertainty:'第三次的意义',phase:'stage'});const r=e.snapshot().reflectionDrafts[t.id];
 const proposal={summary:'我能说出消息名称',uncertainty:'第三次的意义',nextStep:'尝试解释第三次的作用',question:'少了第三次消息会怎样？',adjustment:'先口头解释，再画图'};
 const p={taskId:t.id,id:r.id,expected:{text:r.text,uncertainty:r.uncertainty,nextIntent:'',phase:'stage'},result:proposal};assert.equal((await e.dispatch('reflection.aiCandidate',p)).ok,true);
 assert.equal(e.snapshot().reflectionDrafts[t.id].text,r.text);assert.equal(e.snapshot().reflections.length,0);assert.equal(e.snapshot().rounds[0].status,'running');assert.equal(e.snapshot().reflectionDrafts[t.id].proposal.question,proposal.question);
 await e.dispatch('reflection.draft',{taskId:t.id,id:r.id,text:'我改过原话'});assert.equal(e.snapshot().reflectionDrafts[t.id].proposal,null);assert.equal((await e.dispatch('reflection.aiCandidate',p)).code,'AI_STALE');
 assert.equal((await e.dispatch('reflection.aiCandidate',{...p,expected:{...p.expected,text:'我改过原话'}})).ok,true);
 await e.dispatch('round.end',{taskId:t.id});await e.dispatch('reflection.draft',{taskId:t.id,id:r.id,phase:'end'});assert.equal(e.snapshot().reflectionDrafts[t.id].proposal,null);await e.dispatch('reflection.save',{taskId:t.id,id:r.id});assert.equal(e.snapshot().reflections[0].phase,'end');
});
