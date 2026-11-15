'use strict';
function bindAIIPC({ipcMain,ownsPanel,settings,service,engine,networkEnabled=true}){
  const rejected=()=>({ok:false,code:'SENDER_REJECTED',error:'只有学习面板可以使用 AI 辅助。'});
  ipcMain.handle('study:ai-settings',event=>ownsPanel(event)?{ok:true,settings:{...settings.publicState(),simulationOnly:!networkEnabled}}:rejected());
  ipcMain.handle('study:ai-save-settings',async(event,input)=>{
    if(!ownsPanel(event))return rejected();service.cancel();
    try{return {ok:true,settings:{...await settings.save(input),simulationOnly:!networkEnabled}};}catch{return {ok:false,code:'AI_SETTINGS',error:'设置未能保存。请检查密钥格式；加密不可用时可取消本机保存。',settings:{...settings.publicState(),simulationOnly:!networkEnabled}};}
  });
  ipcMain.handle('study:ai-cancel',(event,id)=>ownsPanel(event)?{ok:true,cancelled:service.cancel(typeof id==='string'?id:undefined)}:rejected());
  ipcMain.handle('study:ai-request',async(event,input)=>{
    if(!ownsPanel(event))return rejected();
    if(!networkEnabled)return {ok:false,code:'AI_SIMULATION_ONLY',error:'当前版本使用模拟建议，没有调用真实 API。'};
    if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>24000||!input.context||typeof input.context!=='object'||Array.isArray(input.context))return {ok:false,code:'AI_INVALID_INPUT',error:'本次发送内容格式不正确或过长。'};
    if(input.kind==='review'){
      const s=engine.snapshot(),t=s.tasks.find(t=>t.id===input.taskId&&t.id===s.activeTaskId);
      if(!t)return {ok:false,code:'AI_STALE',error:'当前任务已改变，请重新打开自己的回顾。'};
      const draft=input.reflectionId?[s.reflectionDrafts?.[t.id],...(s.reflectionDraftArchive||[]),...(s.reflections||[])].find(v=>v?.id===input.reflectionId&&v.taskId===t.id):null;
      if(input.reflectionId&&!draft)return {ok:false,code:'AI_STALE',error:'这份回顾已经改变，请重新打开。'};
      const ids=new Set((Array.isArray(input.context.evidence)?input.context.evidence:[]).map(v=>v?.id));
      input={...input,context:{...input.context,goal:draft?.contextGoal||t.title,action:draft?.contextAction??(t.steps.find(v=>v.id===t.currentStepId)?.text||''),successCheck:draft?.contextSuccessCheck??(t.successCheck||''),evidence:s.events.filter(v=>ids.has(v.id)&&v.taskId===t.id&&(!draft||v.roundId===draft.roundId)&&!v.hidden&&!v.inaccurate).map(v=>({id:v.id,time:v.time||'',observation:v.observation,explanation:v.explanation||'',source:v.source}))}};
    }
    return service.request(input);
  });
}
module.exports={bindAIIPC};
