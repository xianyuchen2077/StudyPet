const {contextBridge,ipcRenderer}=require('electron');
function listen(channel,callback) {
  const listener=(_event,value)=>callback(value);
  ipcRenderer.on(channel,listener);
  return ()=>ipcRenderer.removeListener(channel,listener);
}
contextBridge.exposeInMainWorld('studyAPI',Object.freeze({
  getState:()=>ipcRenderer.invoke('study:get-state'),
  dispatch:(action,payload={})=>ipcRenderer.invoke('study:dispatch',action,payload),
  onState:callback=>listen('study:state',callback),
  onNavigate:callback=>listen('study:navigate',callback),
  openPanel:target=>ipcRenderer.send('study:open-panel',target),
  showPetMenu:()=>ipcRenderer.send('study:pet-menu'),
  getAISettings:()=>ipcRenderer.invoke('study:ai-settings'),
  saveAISettings:settings=>ipcRenderer.invoke('study:ai-save-settings',settings),
  requestAI:input=>ipcRenderer.invoke('study:ai-request',input),
  cancelAI:requestId=>ipcRenderer.invoke('study:ai-cancel',requestId),
  onCloseRequested:callback=>listen('study:close-requested',callback),
  closeReady:options=>ipcRenderer.invoke('study:close-ready',options||{})
}));
