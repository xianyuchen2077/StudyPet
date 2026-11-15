const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('学习桥仅暴露限定IPC，事件监听可注销',async()=>{
 const file=path.join(__dirname,'../study/preload.cjs');assert.ok(fs.existsSync(file),'需要新增学习演示的隔离桥');
 let name,api;const calls=[],listeners=new Map();
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(n,a)=>{name=n;api=a;}},ipcRenderer:{invoke:async(...x)=>{calls.push(x);return {ok:true};},send:(...x)=>calls.push(x),on:(n,f)=>listeners.set(n,f),removeListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}}})});
 assert.equal(name,'studyAPI');await api.dispatch('round.start',{taskId:'t'});assert.equal(calls[0][0],'study:dispatch');assert.equal(calls[0][1],'round.start');
 let received;const off=api.onState(s=>received=s);listeners.get('study:state')({}, {value:1});assert.equal(received.value,1);off();assert.equal(listeners.size,0);
 assert.equal(api.captureScreen,undefined);assert.equal(api.sendMessage,undefined);assert.equal(api.storeSet,undefined);
 await api.getAISettings();assert.equal(calls.at(-1)[0],'study:ai-settings');await api.cancelAI('r');assert.equal(calls.at(-1)[0],'study:ai-cancel');
 assert.equal(api.getAPIKey,undefined);assert.equal(api.setEndpoint,undefined);
});
