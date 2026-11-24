const path=require('node:path');

function createStudyWindows({BrowserWindow,screen,Menu,rootDir,testMode=false,alwaysOnTop=false,onCloseRequest=()=>{},onQuit=()=>{}}) {
  let pet=null,panel=null,lastState=null,allowClose=false,pendingTarget='home';
  const alive=w=>w&&!w.isDestroyed();
  const preload=path.join(rootDir,'study/preload.cjs');
  function lockNavigation(w) {
    w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    w.webContents.on('will-navigate',event=>event.preventDefault());
  }
  function sendState(w){if(alive(w)&&lastState)w.webContents.send('study:state',lastState);}
  function ensurePet() {
    if(alive(pet))return pet;
    pet=new BrowserWindow({width:210,height:230,transparent:true,frame:false,alwaysOnTop,resizable:false,skipTaskbar:true,show:false,title:'StudyPet 桌宠',webPreferences:{preload,nodeIntegration:false,contextIsolation:true,sandbox:true}});
    const work=screen.getPrimaryDisplay().workArea;
    pet.setPosition(work.x+work.width-230,work.y+work.height-250);
    lockNavigation(pet);
    pet.loadFile(path.join(rootDir,'renderer/study/pet.html'));
    pet.webContents.on('did-finish-load',()=>sendState(pet));
    pet.on('ready-to-show',()=>{if(!testMode&&alive(pet))pet.showInactive();});
    pet.on('close',event=>{if(!allowClose){event.preventDefault();onQuit();}});
    pet.on('closed',()=>pet=null);
    return pet;
  }
  function openPanel(target=null) {
    if(target)pendingTarget=target;
    if(alive(panel)) {
      if(panel.isMinimized())panel.restore();
      if(!testMode){panel.show();panel.focus();}
      if(target)panel.webContents.send('study:navigate',target);return panel;
    }
    const work=screen.getPrimaryDisplay().workArea;
    panel=new BrowserWindow({width:Math.min(1280,work.width-60),height:Math.min(840,work.height-45),minWidth:940,minHeight:600,show:false,title:'StudyPet · 学习伙伴（低保真演示）',autoHideMenuBar:true,webPreferences:{preload,nodeIntegration:false,contextIsolation:true,sandbox:true}});
    lockNavigation(panel);
    panel.loadFile(path.join(rootDir,'renderer/study/panel.html'));
    panel.webContents.on('did-finish-load',()=>{sendState(panel);if(alive(panel))panel.webContents.send('study:navigate',pendingTarget);});
    panel.on('ready-to-show',()=>{if(!testMode&&alive(panel)){panel.show();panel.focus();}});
    panel.on('close',event=>{if(!allowClose){event.preventDefault();onCloseRequest('panel');}});
    panel.on('closed',()=>panel=null);
    return panel;
  }
  function publish(state) {
    lastState=state;
    if(alive(pet)) {
      const alert=!!state.focus?.alert;
      const old=pet.getBounds(),width=state.invitation?380:alert?400:210,height=state.invitation?350:alert?360:230;
      if(Math.abs(old.width-width)>1||Math.abs(old.height-height)>1) {
        const work=screen.getDisplayMatching(old).workArea;
        pet.setBounds({x:Math.max(work.x,Math.min(work.x+work.width-width,old.x+old.width-width)),y:Math.max(work.y,Math.min(work.y+work.height-height,old.y+old.height-height)),width,height});
      }
      // A reminder is useless if it stays behind a full-screen video: raise the
      // pet without taking keyboard focus, then fall back to the user's setting.
      if(!testMode) {
        if(alert) {if(typeof pet.setAlwaysOnTop==='function')pet.setAlwaysOnTop(true,'pop-up-menu');if(typeof pet.moveTop==='function')pet.moveTop();}
        else if(typeof pet.setAlwaysOnTop==='function')pet.setAlwaysOnTop(alwaysOnTop);
      }
      sendState(pet);
    }
    sendState(panel);
    // Never show/focus/create a panel from a system state update.
  }
  function closePanel() {if(alive(panel)){allowClose=true;panel.close();allowClose=false;}}
  function closeAll() {allowClose=true;if(alive(panel))panel.close();if(alive(pet))pet.close();}
  function showPetMenu() {
    Menu.buildFromTemplate([{label:'打开学习面板',click:()=>openPanel('home')},{label:'记录与邀请',click:()=>openPanel('preferences')},{type:'separator'},{label:'退出 StudyPet',click:onQuit}]).popup({window:pet});
  }
  function requestClose(reason) {if(alive(panel)){panel.webContents.send('study:close-requested',{reason});return true;}return false;}
  return {ensurePet,openPanel,publish,closePanel,closeAll,showPetMenu,requestClose,getWindows:()=>({pet,panel})};
}
module.exports={createStudyWindows};
