'use strict';
// 前台窗口采样 → 娱乐页面判定 → 候选提醒。
//
// 设计约束（与 docs/technical-design-and-feasibility.md 一致）：
// - 只读前台窗口的进程名与标题，不截图、不读控件内容；
// - 只有「连续停留在娱乐页面达到阈值」才产生一条候选线索；
// - 一条线索不是「判定你分心」，提醒语气与响应权都交给学习者；
// - 暂停轮次、关闭监测、应用退出时立刻结束子进程；
// - 纯 Node 逻辑可单独测试（inject 注入样本，不依赖 Windows）。

const {spawn}=require('node:child_process');
const fs=require('node:fs');
const rulesModule=require('./focus-rules.cjs');

const DEFAULT_INTERVAL_MS=2000;
const DEFAULT_THRESHOLD_MS=20000;
const DEFAULT_COOLDOWN_MS=180000;
const DEFAULT_REARM_MS=60000;

function decodeTitle(sample) {
  if(sample&&typeof sample.titleB64==='string'&&sample.titleB64) {
    try{return Buffer.from(sample.titleB64,'base64').toString('utf8');}catch{return typeof sample.title==='string'?sample.title:'';}
  }
  return typeof sample?.title==='string'?sample.title:'';
}

function createFocusWatch(options={}) {
  const platform=options.platform||process.platform;
  const scriptPath=options.scriptPath||null;
  const spawnFn=options.spawnFn||spawn;
  const rules=options.rules||rulesModule.defaultRules;
  const onCandidate=options.onCandidate||(()=>{});
  const onStatus=options.onStatus||(()=>{});
  const onError=options.onError||(()=>{});
  const selfPids=new Set([process.pid,...(options.selfPids||[])]);
  const intervalMs=Math.max(500,Number(options.intervalMs)||DEFAULT_INTERVAL_MS);
  const cooldownMs=Math.max(30000,Number(options.cooldownMs)||DEFAULT_COOLDOWN_MS);
  const rearmMs=Math.max(10000,Number(options.rearmMs)||DEFAULT_REARM_MS);
  const retryMs=Math.max(5000,Number(options.retryMs)||15000);

  let child=null,wanted=options.autoStart!==false,starting=false,retryTimer=null;
  let segment=null,leaveAt=null,nextAllowedAt=0;
  let lastStatus=null,lastError=null;
  let threshold=Number(options.thresholdSec)*1000>0?Number(options.thresholdSec)*1000:DEFAULT_THRESHOLD_MS;
  const debug=typeof options.debug==='function'?options.debug:()=>{};

  function setStatus(value) {
    lastStatus=value;
    try{onStatus(value);}catch{}
  }

  function handleSample(sample,at=Date.now()) {
    if(!sample||typeof sample!=='object')return null;
    const pid=Number(sample.pid);
    if(Number.isFinite(pid)&&selfPids.has(pid))return null;
    const title=decodeTitle(sample);
    if(!title&&!sample.process)return null;
    const result=rulesModule.classify({pid:Number.isFinite(pid)?pid:0,process:sample.process||'',title},rules);
    if(result.kind==='self')return null;
    setStatus({kind:result.kind,app:result.app,label:result.label,title:title.slice(0,120),at});

    if(result.kind!=='entertainment') {
      if(segment?.kind==='entertainment')leaveAt=at;
      segment={kind:result.kind,app:result.app,label:result.label,since:at};
      return null;
    }
    if(!segment||segment.kind!=='entertainment'||segment.app!==result.app) {
      // 离开不到 rearmMs 又回到同一个页面，视为同一段停留；离开更久则重新计时。
      const recentlyLeft=leaveAt!==null&&at-leaveAt<rearmMs;
      segment={kind:'entertainment',app:result.app,label:result.label,since:at};
      if(!recentlyLeft)nextAllowedAt=0;
      leaveAt=null;
    }
    const stayed=at-segment.since;
    if(stayed<threshold||at<nextAllowedAt)return null;
    nextAllowedAt=at+cooldownMs;
    const candidate={app:result.app,label:result.label,seconds:Math.round(stayed/1000),at};
    debug('candidate',candidate);
    try{onCandidate(candidate);}catch(error){onError(error);}
    return candidate;
  }

  function stopChild(reason='pause') {
    clearTimeout(retryTimer);retryTimer=null;
    if(!child)return;
    const current=child;child=null;
    try{current.stdin?.end();}catch{}
    try{current.kill();}catch{}
    debug('sampler stopped',reason);
  }

  function spawnSampler() {
    if(child||starting)return;
    if(platform!=='win32'){setStatus({kind:'unsupported',label:'当前系统暂不支持前台窗口采样'});return;}
    if(!scriptPath||!fs.existsSync(scriptPath)){onError(new Error('缺少前台采样脚本'));setStatus({kind:'error',label:'采样脚本缺失'});return;}
    starting=true;
    const exe=options.powershellPath||'powershell.exe';
    let proc;
    try{
      proc=spawnFn(exe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath,'-IntervalMs',String(intervalMs)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    }catch(error){starting=false;onError(error);scheduleRetry();return;}
    child=proc;starting=false;
    proc.stdout.setEncoding('utf8');
    let buffer='';
    proc.stdout.on('data',chunk=>{
      buffer+=chunk;
      const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';
      for(const line of lines){
        const trimmed=line.trim();if(!trimmed)continue;
        try{handleSample(JSON.parse(trimmed));}catch(error){debug('bad sample',trimmed.slice(0,80));}
      }
    });
    proc.stderr.on('data',chunk=>{lastError=String(chunk).slice(0,400);});
    proc.on('error',error=>{lastError=error.message;onError(error);});
    proc.on('exit',code=>{
      if(child===proc)child=null;
      if(wanted)scheduleRetry(code);
      else setStatus({kind:'stopped',label:'监测已暂停'});
    });
    setStatus({kind:'starting',label:'正在读取前台窗口'});
    debug('sampler started');
  }

  function scheduleRetry(code) {
    if(retryTimer||!wanted)return;
    setStatus({kind:'error',label:lastError?`监测暂时不可用：${lastError}`:'监测暂时不可用'});
    debug('sampler exited',code);
    retryTimer=setTimeout(()=>{retryTimer=null;if(wanted&&!child)spawnSampler();},retryMs);
    retryTimer.unref?.();
  }

  function start() {wanted=true;if(!child)spawnSampler();}
  function pause() {wanted=false;stopChild('pause');segment=null;leaveAt=null;setStatus({kind:'stopped',label:'监测已暂停'});}
  function stop() {wanted=false;stopChild('quit');segment=null;clearTimeout(retryTimer);retryTimer=null;}

  return {
    start,pause,resume:start,stop,
    isRunning:()=>!!child,
    status:()=>({running:!!child,wanted,segment:segment?{kind:segment.kind,app:segment.app,label:segment.label}:null,last:lastStatus,error:lastError}),
    setThresholdSec:seconds=>{threshold=Math.max(5,Math.min(180,Number(seconds)||20))*1000;},
    inject:(sample,at)=>handleSample(sample,at)
  };
}

module.exports={createFocusWatch,decodeTitle,DEFAULT_INTERVAL_MS,DEFAULT_THRESHOLD_MS,DEFAULT_COOLDOWN_MS,DEFAULT_REARM_MS};
