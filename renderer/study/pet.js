const api=window.studyAPI;
let snapshot=null,pending=false,errorTimer=null,dismissedError=null,lastError=null;
const escapeText=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(state){
  snapshot=state;
  const currentRound=[...state.rounds].reverse().find(r=>r.taskId===state.activeTaskId&&r.status!=='ended');
  let pose=currentRound?.status==='running'?'study':currentRound?.status==='paused'?'rest':'idle';
  let label=pose==='study'?'学习中':pose==='rest'?'暂离':'双击打开';
  if(state.invitation){pose='idle';label='等你决定';}
  if(state.focus?.alert&&!state.invitation){pose='idle';label='该回来啦';}
  if(!state.invitation&&!state.focus?.alert&&state.runtime.tutorial&&!state.runtime.tutorial.completedAt){pose='idle';label='新手引导';}
  if(state.runtime.view==='reflection'){pose='review';label='回顾中';}
  if(state.runtime.error&&dismissedError!==state.runtime.error.message){pose='error';label='待处理';}
  document.querySelector('#pet-hit').innerHTML=window.StudyPetArt.cat(pose);
  document.querySelector('#pet-caption').textContent=label;
  document.querySelector('#pet-record').textContent=`${state.prefs.recording?(state.prefs.recordingPaused?'记录暂停':'记录中'):'记录关'}·监测${state.focus?.enabled?'开':'关'}`;
  const bubble=document.querySelector('#invitation'),focusAlert=state.focus?.alert||null,showAlert=!!focusAlert&&!state.invitation;
  bubble.hidden=!(state.invitation||showAlert);
  bubble.classList.toggle('focus',showAlert);
  if(showAlert)bubble.innerHTML=`<div class="focus-head">专注提醒 · 还来得及回来</div><div>${escapeText(focusAlert.message)}</div><div class="actions"><button class="primary" data-focus="back" ${pending?'disabled':''}>我回来了</button><button data-focus="snooze" ${pending?'disabled':''}>再给我5分钟</button><button data-focus="ignore" ${pending?'disabled':''}>这次不用</button></div>`;
  else if(state.invitation)bubble.innerHTML=`<div>${escapeText(state.invitation.message)}</div><div class="actions"><button class="primary" data-response="accept" ${pending?'disabled':''}>${state.invitation.node==='resume'?'看看':'写一句'}</button><button data-response="later" ${pending?'disabled':''}>稍后</button><button data-response="reject" ${pending?'disabled':''}>这次不用</button></div>`;
  if(!state.runtime.error){lastError=null;dismissedError=null;clearTimeout(errorTimer);}
  else if(lastError!==state.runtime.error.message){lastError=state.runtime.error.message;clearTimeout(errorTimer);errorTimer=setTimeout(()=>{dismissedError=lastError;if(snapshot)render(snapshot);},4500);}
}
const hit=document.querySelector('#pet-hit');
let dragStartedAt=0,dragged=false;
hit.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  dragStartedAt=Date.now();dragged=false;
  if(typeof hit.setPointerCapture==='function'&&event.pointerId!==undefined){try{hit.setPointerCapture(event.pointerId);}catch{}}
  api.startPetDrag();
});
function endDrag(event){
  if(!dragStartedAt)return;
  // 按住超过 180ms 视为拖动，避免松手后的 dblclick 把面板叫出来
  if(Date.now()-dragStartedAt>180)dragged=true;
  dragStartedAt=0;api.endPetDrag();
  if(typeof hit.hasPointerCapture==='function'&&event&&event.pointerId!==undefined&&hit.hasPointerCapture(event.pointerId)){try{hit.releasePointerCapture(event.pointerId);}catch{}}
}
hit.addEventListener('pointerup',endDrag);
hit.addEventListener('pointercancel',endDrag);
window.addEventListener('blur',()=>endDrag(null));
hit.addEventListener('dragstart',event=>event.preventDefault());
hit.addEventListener('dblclick',()=>{if(dragged){dragged=false;return;}api.openPanel();});
hit.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();api.openPanel();}});
const menuButton=document.querySelector('.drag-handle');
menuButton.addEventListener('click',event=>{event.stopPropagation();api.showPetMenu();});
menuButton.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();api.showPetMenu();}});
document.addEventListener('contextmenu',event=>{event.preventDefault();api.showPetMenu();});
document.querySelector('#invitation').addEventListener('click',async event=>{
  const button=event.target.closest('[data-response],[data-focus]');
  if(!button||pending)return;
  pending=true;render(snapshot);
  try{
    if(button.dataset.focus)await api.dispatch('focus.respond',{response:button.dataset.focus});
    else await api.dispatch('invitation.respond',{response:button.dataset.response});
  }finally{pending=false;if(snapshot)render(snapshot);}
});
api.onState(render);
api.getState().then(result=>{if(result.state)render(result.state);});
