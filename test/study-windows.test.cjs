const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const target=path.join(__dirname,'../study/windows.cjs');
let createStudyWindows;if(fs.existsSync(target))({createStudyWindows}=require(target));
function setup(){
 assert.equal(typeof createStudyWindows,'function','需要新增桌宠与学习面板的窗口协调器');
 const created=[];
 class Window extends EventEmitter {
  constructor(options){super();this.options=options;this.bounds={x:1000,y:500,width:options.width,height:options.height};this.focusCount=0;this.showCount=0;this.destroyed=false;this.sent=[];this.webContents=new EventEmitter();this.webContents.send=(...args)=>this.sent.push(args);this.webContents.setWindowOpenHandler=()=>{};created.push(this);}
  loadFile(file){this.file=file;return Promise.resolve();}setPosition(x,y){this.bounds.x=x;this.bounds.y=y;}getBounds(){return {...this.bounds};}setBounds(b){this.bounds={...b};}isDestroyed(){return this.destroyed;}isMinimized(){return false;}isVisible(){return false;}restore(){}show(){this.showCount++;}showInactive(){this.showCount++;}focus(){this.focusCount++;}center(){}close(){const e={preventDefault(){this.prevented=true;}};this.emit('close',e);if(!e.prevented){this.destroyed=true;this.emit('closed');}}
 }
 const screen={getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1536,height:864}}),getDisplayMatching:()=>({workArea:{x:0,y:0,width:1536,height:864}})};
 const w=createStudyWindows({BrowserWindow:Window,screen,Menu:{buildFromTemplate:items=>({popup(){},items})},rootDir:path.join(__dirname,'..'),onCloseRequest:()=>{}});
 return {w,created};
}
test('系统邀请只更新桌宠，不创建/聚焦学习面板',()=>{
 const {w,created}=setup();w.ensurePet();w.publish({invitation:{message:'要写一句吗？'},prefs:{},runtime:{}});
 assert.equal(created.length,1);assert.match(created[0].file,/pet.html$/);assert.equal(created[0].focusCount,0);
 assert.ok(created[0].bounds.width>=340);assert.ok(created[0].sent.some(x=>x[0]==='study:state'));
});
test('只有用户打开才创建并聚焦面板，重复打开复用同一窗口',()=>{
 const {w,created}=setup();w.ensurePet();w.openPanel('home');const panel=created[1];panel.emit('ready-to-show');panel.webContents.emit('did-finish-load');
 w.openPanel('feedback');assert.equal(created.length,2);assert.ok(panel.focusCount>=1);assert.match(panel.file,/panel.html$/);
 assert.ok(panel.sent.some(x=>x[0]==='study:navigate'&&x[1]==='feedback'));
 const focused=panel.focusCount;w.publish({invitation:{message:'邀请'},prefs:{},runtime:{}});assert.equal(panel.focusCount,focused);
});
test('关闭学习面板前等待草稿握手，完成后保留桌宠',()=>{
 const {w,created}=setup();w.ensurePet();w.openPanel();created[1].close();assert.equal(created[1].destroyed,false);
 w.closePanel();assert.equal(created[1].destroyed,true);assert.equal(created[0].destroyed,false);
});
