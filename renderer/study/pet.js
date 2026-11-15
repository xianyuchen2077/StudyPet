const api=window.studyAPI;
let snapshot=null,pending=false,errorTimer=null,dismissedError=null,lastError=null;
const escapeText=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(state){
  snapshot=state;
  const currentRound=[...state.rounds].reverse().find(r=>r.taskId===state.activeTaskId&&r.status!=='ended');
  let pose=currentRound?.status==='running'?'study':currentRound?.status==='paused'?'rest':'idle';
  let label=pose==='study'?'学习中':pose==='rest'?'暂离':'双击，打开学习面板';
  if(state.invitation){pose='idle';label='等你决定';}
  if(state.runtime.view==='reflection'){pose='review';label='回顾中';}
  if(state.runtime.error&&dismissedError!==state.runtime.error.message){pose='error';label='有一项操作待处理';}
  document.querySelector('#pet-hit').innerHTML=window.StudyPetArt.cat(pose);
  document.querySelector('#pet-caption').textContent=label;
  document.querySelector('#pet-record').textContent=state.prefs.recording?(state.prefs.recordingPaused?'模拟记录暂停':'模拟记录开启'):'模拟记录关闭';
  const bubble=document.querySelector('#invitation');bubble.hidden=!state.invitation;
  if(state.invitation)bubble.innerHTML=`<div>${escapeText(state.invitation.message)}</div><div class="actions"><button class="primary" data-response="accept" ${pending?'disabled':''}>${state.invitation.node==='resume'?'看看':'写一句'}</button><button data-response="later" ${pending?'disabled':''}>稍后</button><button data-response="reject" ${pending?'disabled':''}>这次不用</button></div>`;
  if(!state.runtime.error){lastError=null;dismissedError=null;clearTimeout(errorTimer);}
  else if(lastError!==state.runtime.error.message){lastError=state.runtime.error.message;clearTimeout(errorTimer);errorTimer=setTimeout(()=>{dismissedError=lastError;if(snapshot)render(snapshot);},4500);}
}
document.querySelector('#pet-hit').addEventListener('dblclick',()=>api.openPanel());
document.querySelector('#pet-hit').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();api.openPanel();}});
document.addEventListener('contextmenu',event=>{event.preventDefault();api.showPetMenu();});
document.querySelector('#invitation').addEventListener('click',async event=>{
  const button=event.target.closest('[data-response]');if(!button||pending)return;
  pending=true;render(snapshot);
  try{await api.dispatch('invitation.respond',{response:button.dataset.response});}finally{pending=false;if(snapshot)render(snapshot);}
});
api.onState(render);
api.getState().then(result=>{if(result.state)render(result.state);});
