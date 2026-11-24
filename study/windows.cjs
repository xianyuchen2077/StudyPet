const path=require('node:path');

function createStudyWindows({BrowserWindow,screen,Menu,rootDir,testMode=false,alwaysOnTop=false,onCloseRequest=()=>{},onQuit=()=>{},onToggleFocus=()=>{}}) {
  let pet=null,panel=null,lastState=null,allowClose=false,pendingTarget='home',drag=null,dragTimer=null;
  // 桌宠的“应有尺寸”。拖动时每帧按这个尺寸 setBounds，而不是只 setPosition：
  // 只改位置时，Windows/Electron 在某些 DPI 或贴边拖动场景下会顺手把窗口放大，
  // 窗口一大，可移动范围就被挤到屏幕上部 1/3，看起来就像“只能横竖移动”。
  const petSize={width:105,height:115};
  const alive=w=>w&&!w.isDestroyed();
  const preload=path.join(rootDir,'study/preload.cjs');
  function lockNavigation(w) {
    w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    w.webContents.on('will-navigate',event=>event.preventDefault());
  }
  function sendState(w){if(alive(w)&&lastState)w.webContents.send('study:state',lastState);}
  function ensurePet() {
    if(alive(pet))return pet;
    pet=new BrowserWindow({width:105,height:115,transparent:true,frame:false,alwaysOnTop:true,resizable:false,skipTaskbar:true,show:false,title:'StudyPet 桌宠',webPreferences:{preload,nodeIntegration:false,contextIsolation:true,sandbox:true}});
    // 桌宠始终置顶：被浏览器/视频窗口盖住就失去了提醒的意义
    if(typeof pet.setAlwaysOnTop==='function'&&!testMode)pet.setAlwaysOnTop(true,'floating');
    const work=screen.getPrimaryDisplay().workArea;
    pet.setPosition(work.x+work.width-115,work.y+work.height-125);
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
    panel=new BrowserWindow({width:Math.min(1280,work.width-60),height:Math.min(840,work.height-45),minWidth:940,minHeight:600,show:false,backgroundColor:'#f4ead7',title:'StudyPet · 学习伙伴（低保真演示）',autoHideMenuBar:true,webPreferences:{preload,nodeIntegration:false,contextIsolation:true,sandbox:true}});
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
      const old=pet.getBounds(),width=state.invitation?380:alert?400:105,height=state.invitation?350:alert?360:115;
      petSize.width=width;petSize.height=height;
      if(!drag&&(Math.abs(old.width-width)>1||Math.abs(old.height-height)>1)) {
        const work=screen.getDisplayMatching(old).workArea;
        pet.setBounds({x:Math.max(work.x,Math.min(work.x+work.width-width,old.x+old.width-width)),y:Math.max(work.y,Math.min(work.y+work.height-height,old.y+old.height-height)),width,height});
      }
      // A reminder is useless if it stays behind a full-screen video: raise the
      // pet without taking keyboard focus, then fall back to the user's setting.
      if(!testMode) {
        if(alert) {if(typeof pet.setAlwaysOnTop==='function')pet.setAlwaysOnTop(true,'pop-up-menu');if(typeof pet.moveTop==='function')pet.moveTop();}
        else if(typeof pet.setAlwaysOnTop==='function')pet.setAlwaysOnTop(true,'floating');
      }
      sendState(pet);
    }
    sendState(panel);
    // Never show/focus/create a panel from a system state update.
  }
  function closePanel() {if(alive(panel)){allowClose=true;panel.close();allowClose=false;}}
  function closeAll() {endPetDrag();allowClose=true;if(alive(panel))panel.close();if(alive(pet))pet.close();}
  function showPetMenu() {
    const enabled=!!lastState?.focus?.enabled;
    Menu.buildFromTemplate([
      {label:'打开学习面板',click:()=>openPanel('home')},
      {label:'看一眼学习回顾',click:()=>openPanel('feedback')},
      {type:'separator'},
      {label:`专注提醒：${enabled?'已开启':'已关闭'}`,click:()=>{try{const r=onToggleFocus();if(r&&typeof r.catch==='function')r.catch(()=>{});}catch{}}},
      {label:'记录与邀请（设置）',click:()=>openPanel('preferences')},
      {type:'separator'},
      {label:'退出 StudyPet',click:onQuit}
    ]).popup({window:pet});
  }
  // 拖动桌宠：主进程按固定节拍读取系统光标（绝对坐标），用它反推窗口位置。
  // 不采用渲染层的 screenX/screenY：窗口一动，这两个值会跟着抖，形成反馈回路，
  // 表现为光标与桌宠越拖越远、甚至停住不动时桌宠自己下坠。
  function startPetDrag() {
    if(!alive(pet)||typeof screen.getCursorScreenPoint!=='function')return false;
    endPetDrag();
    const point=screen.getCursorScreenPoint(),bounds=pet.getBounds();
    if(bounds.width!==petSize.width||bounds.height!==petSize.height){
      // 以右下角为锚点缩回原尺寸，猫不会突然跑远
      bounds.x=bounds.x+bounds.width-petSize.width;
      bounds.y=bounds.y+bounds.height-petSize.height;
      pet.setBounds({x:bounds.x,y:bounds.y,width:petSize.width,height:petSize.height});
    }
    drag={dx:point.x-bounds.x,dy:point.y-bounds.y,startedAt:Date.now()};
    if(typeof pet.setAlwaysOnTop==='function'&&!testMode)pet.setAlwaysOnTop(true,'pop-up-menu');
    dragTimer=setInterval(()=>{
      if(!drag||!alive(pet)){endPetDrag();return;}
      if(Date.now()-drag.startedAt>120000){endPetDrag();return;}
      const cursor=screen.getCursorScreenPoint(),work=screen.getDisplayMatching(pet.getBounds()).workArea;
      const nx=Math.round(cursor.x-drag.dx),ny=Math.round(cursor.y-drag.dy);
      const x=Math.max(work.x,Math.min(work.x+work.width-petSize.width,nx));
      const y=Math.max(work.y,Math.min(work.y+work.height-petSize.height,ny));
      pet.setBounds({x,y,width:petSize.width,height:petSize.height});
    },8);
    if(dragTimer&&typeof dragTimer.unref==='function')dragTimer.unref();
    return true;
  }
  function endPetDrag() {
    drag=null;
    if(dragTimer){clearInterval(dragTimer);dragTimer=null;}
    if(alive(pet)&&typeof pet.setAlwaysOnTop==='function'&&!testMode)pet.setAlwaysOnTop(true,'floating');
    // 拖动期间被推迟的尺寸变化（邀请/专注提醒展开）在松手后补上
    if(alive(pet)&&lastState){
      const alert=!!lastState.focus?.alert;
      const width=lastState.invitation?380:alert?400:105,height=lastState.invitation?350:alert?360:115;
      if(Math.abs(width-petSize.width)>1||Math.abs(height-petSize.height)>1){
        petSize.width=width;petSize.height=height;
        const old=pet.getBounds(),work=screen.getDisplayMatching(old).workArea;
        pet.setBounds({x:Math.max(work.x,Math.min(work.x+work.width-width,old.x+old.width-width)),y:Math.max(work.y,Math.min(work.y+work.height-height,old.y+old.height-height)),width,height});
      }
    }
  }
  function requestClose(reason) {if(alive(panel)){panel.webContents.send('study:close-requested',{reason});return true;}return false;}
  return {ensurePet,openPanel,publish,closePanel,closeAll,showPetMenu,requestClose,startPetDrag,endPetDrag,getWindows:()=>({pet,panel})};
}
module.exports={createStudyWindows};

