const path=require('node:path');
const fs=require('node:fs');
const {createStudyEngine}=require('./engine.cjs');
const {createStudyWindows}=require('./windows.cjs');
const {createAISettings}=require('./ai-settings.cjs');
const {createAIService}=require('./ai-service.cjs');
const {bindAIIPC}=require('./ai-ipc.cjs');
const {createFocusWatch}=require('./focus-watch.cjs');

async function startStudyApp() {
  const {app,BrowserWindow,ipcMain,screen,Menu,safeStorage}=require('electron');
  const dataArg=process.argv.find(x=>x.startsWith('--study-data-dir='));
  const dataDir=dataArg?path.resolve(dataArg.slice('--study-data-dir='.length)):path.join(app.getPath('appData'),'StudyPet-OS-Demo');
  fs.mkdirSync(dataDir,{recursive:true});
  app.setName('StudyPet');app.setPath('userData',dataDir);
  if(!app.requestSingleInstanceLock()){app.quit();return null;}
  const testMode=process.argv.includes('--study-test');
  const rootDir=path.join(__dirname,'..');
  // Reuse the framework's installed store adapter in a separate StudyPet profile.
  const store=require('../store');
  const KEY='studyDemo.v1';
  const aiFile=path.join(dataDir,'study-ai.json');
  const aiSettings=createAISettings({secure:safeStorage,read:async()=>{
    try{return JSON.parse(await fs.promises.readFile(aiFile,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
  },write:async value=>{
    const temp=aiFile+'.tmp';await fs.promises.writeFile(temp,JSON.stringify(value),{encoding:'utf8',mode:0o600});await fs.promises.rename(temp,aiFile);
  }});
  const aiService=createAIService({settings:aiSettings});
  let exitAllowed=false,quitting=false,inviteTimer=null,inviteKey=null,focusTimer=null,focusAlertId=null,watchRunning=false,watchStatus={kind:'stopped',label:'监测已暂停'};
  const targets=new Set(['home','guide','plan','study','resume','tasks','feedback','reflection','preferences','case']);
  const windows=createStudyWindows({BrowserWindow,screen,Menu,rootDir,testMode,alwaysOnTop:store.get('alwaysOnTop',false),onCloseRequest:reason=>requestClose(reason),onQuit:()=>requestClose('quit')});
  const focusWatch=createFocusWatch({
    scriptPath:path.join(__dirname,'focus-sampler.ps1'),
    autoStart:false,
    onCandidate:candidate=>{
      // 采样只给出候选；是否真的提醒仍由引擎按轮次、许可、冷却与次数上限决定。
      const state=engine.snapshot();
      if(!state.focus?.enabled||state.prefs.quiet)return;
      engine.dispatch('focus.candidate',{app:candidate.app,label:candidate.label,seconds:candidate.seconds}).catch(()=>{});
    },
    onStatus:status=>{watchStatus=status;},
    onError:error=>{console.warn('[StudyPet] 前台窗口采样：',error.message);watchStatus={kind:'error',label:`监测暂时不可用：${error.message}`};}
  });
  function syncFocusWatch(state) {
    // 不只在一轮学习中采样：桌宠本身就是「该开始/该回来了」的提醒入口。
    // 但暂停轮次、关闭监测、安静学习或测试模式下会立刻结束子进程。
    const want=!!state.focus?.enabled&&!state.prefs.quiet&&!testMode;
    if(want!==watchRunning) {watchRunning=want;if(want)focusWatch.resume();else focusWatch.pause();}
    if(want)focusWatch.setThresholdSec(state.focus.thresholdSec);
  }
  const engine=createStudyEngine({read:async()=>store.get(KEY,null),write:async state=>{store.set(KEY,state);},onChange:state=>{
    syncFocusWatch(state);
    // 渲染进程只需要「是否在采样」和一句状态，窗口标题不上屏、不出主进程内存。
    const watch={running:focusWatch.isRunning(),kind:watchStatus?.kind||'stopped',label:watchStatus?.label||''};
    windows.publish({...state,runtime:{...state.runtime,watch}});
    if(state.invitation?.key!==inviteKey){
      clearTimeout(inviteTimer);inviteKey=state.invitation?.key||null;
      if(inviteKey){const key=inviteKey;inviteTimer=setTimeout(()=>{if(engine.snapshot().invitation?.key===key)engine.dispatch('invitation.respond',{response:'ignored'});},20000);inviteTimer.unref();}
    }
    const alertId=state.focus?.alert?.id||null;
    if(alertId!==focusAlertId){
      clearTimeout(focusTimer);focusAlertId=alertId;
      if(focusAlertId){const key=focusAlertId;focusTimer=setTimeout(()=>{const s=engine.snapshot();if(s.focus?.alert?.id===key)engine.dispatch('focus.respond',{response:'snooze'});},30000);focusTimer.unref();}
    }
  }});
  function owned(event) {const list=windows.getWindows();return [list.pet,list.panel].some(w=>w&&!w.isDestroyed()&&w.webContents===event.sender);}
  function senderError(){return {ok:false,error:'此窗口不能执行学习操作',code:'SENDER_REJECTED',state:engine.snapshot()};}
  bindAIIPC({ipcMain,settings:aiSettings,service:aiService,engine,networkEnabled:false,ownsPanel:event=>{
    const panel=windows.getWindows().panel;return !!panel&&!panel.isDestroyed()&&panel.webContents===event.sender;
  }});
  async function requestClose(reason) {
    if(exitAllowed)return;
    aiService.cancel();
    if(windows.requestClose(reason))return;
    if(reason!=='quit')return;
    const result=await engine.dispatch('app.pauseForQuit');
    if(result.ok){finishQuit();return;}
    const panel=windows.openPanel('home');
    panel.webContents.once('did-finish-load',()=>windows.requestClose('quit'));
  }
  function finishQuit(){exitAllowed=true;aiService.cancel();clearTimeout(inviteTimer);clearTimeout(focusTimer);focusWatch.stop();windows.closeAll();app.quit();}
  ipcMain.handle('study:get-state',event=>owned(event)?{ok:true,state:engine.snapshot()}:senderError());
  ipcMain.handle('study:dispatch',async(event,action,payload={})=>{
    if(!owned(event))return senderError();
    if(typeof action!=='string'||action.length>70||!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>60000)return {ok:false,error:'操作内容太长或格式不正确',code:'INVALID_INPUT',state:engine.snapshot()};
    const before=engine.snapshot().invitation;
    const result=await engine.dispatch(action,payload);
    if(action==='invitation.respond'&&payload.response==='accept'&&before)windows.openPanel(before.node==='resume'?'resume':'reflection');
    // 学习者点了“我回来了”才打开面板：回到当前小步，不再替他觉得已经专注。
    if(action==='focus.respond'&&payload.response==='back')windows.openPanel(result.data?.mode==='idle'?'home':'study');
    return result;
  });
  ipcMain.on('study:open-panel',(event,target)=>{
    if(!owned(event))return;
    const panel=windows.getWindows().panel;
    const restored=targets.has(engine.snapshot().runtime.view)?engine.snapshot().runtime.view:'home';
    windows.openPanel(target===undefined?(panel&&!panel.isDestroyed()?null:restored):(targets.has(target)?target:'home'));
  });
  ipcMain.on('study:pet-menu',event=>{if(owned(event))windows.showPetMenu();});
  ipcMain.handle('study:close-ready',async(event,options={})=>{
    if(!owned(event))return senderError();
    aiService.cancel();
    if(options.reason==='quit') {
      if(quitting)return {ok:true};quitting=true;
      const result=await engine.dispatch('app.pauseForQuit');
      if(!result.ok&&!options.discard){quitting=false;return result;}
      setTimeout(finishQuit,60);return {ok:true};
    }
    setTimeout(()=>windows.closePanel(),30);return {ok:true};
  });
  app.on('before-quit',event=>{if(!exitAllowed){event.preventDefault();requestClose('quit');}});
  app.on('will-quit',()=>{clearTimeout(focusTimer);focusWatch.stop();});
  app.on('window-all-closed',()=>{if(exitAllowed)app.quit();});
  app.on('activate',()=>windows.openPanel('home'));
  app.on('second-instance',()=>windows.openPanel(null));
  await app.whenReady();
  await aiSettings.init();
  Menu.setApplicationMenu(null);
  await engine.init();
  windows.ensurePet();windows.publish(engine.snapshot());
  if(!process.argv.includes('--pet-only'))windows.openPanel('home');
  if(process.argv.includes('--dev'))windows.getWindows().panel?.webContents.openDevTools({mode:'detach'});
  return {engine,windows};
}
module.exports={startStudyApp};
if(require.main===module)startStudyApp().catch(error=>{console.error('StudyPet启动失败:',error.message);process.exitCode=1;});
