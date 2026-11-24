const test=require('node:test');
const assert=require('node:assert/strict');
const {classify,createRules,defaultRules}=require('../study/focus-rules.cjs');
const {createFocusWatch}=require('../study/focus-watch.cjs');
const {createStudyEngine}=require('../study/engine.cjs');

async function setup(seed) {
  let stored=seed?structuredClone(seed):null;
  let clock=new Date('2026-11-24T09:00:00.000Z');
  const engine=createStudyEngine({
    read:async()=>stored,
    write:async value=>{stored=structuredClone(value);},
    now:()=>clock.toISOString()
  });
  await engine.init();
  return {engine,advance:ms=>{clock=new Date(clock.getTime()+ms);},stored:()=>structuredClone(stored)};
}
const act=(e,action,payload={})=>e.dispatch(action,payload);
async function startRound(engine) {
  await act(engine,'draft.suggest',{intent:'想复习操作系统的进程和线程，但总分不清。',scope:'button'});
  const draft=engine.snapshot().intentDrafts[0];
  await act(engine,'plan.confirm',{draftId:draft.id});
  await act(engine,'round.start',{});
}

test('前台窗口分类：娱乐页面先于学习页面',()=>{
  assert.equal(classify({process:'chrome',title:'【合集】高数速成_哔哩哔哩_bilibili - Google Chrome'},defaultRules).kind,'entertainment');
  assert.equal(classify({process:'chrome',title:'推荐 - 抖音'},defaultRules).app,'douyin');
  assert.equal(classify({process:'chrome',title:'taobao.com 购物车'},defaultRules).kind,'entertainment');
  assert.equal(classify({process:'Code',title:'engine.cjs - Visual Studio Code'},defaultRules).kind,'study');
  assert.equal(classify({process:'explorer',title:'此电脑'},defaultRules).kind,'neutral');
  assert.equal(classify({process:'chrome',title:'StudyPet · 学习面板'},defaultRules).kind,'self');
  // 规则可以按需替换，便于把某个站点设为允许。
  const rules=createRules({entertainment:defaultRules.entertainment.filter(item=>item.app!=='zhihu')});
  assert.equal(classify({process:'chrome',title:'如何自学操作系统 - 知乎'},rules).kind,'neutral');
});

test('连续停留达到阈值才产生一次候选，离开后重新计时',()=>{
  const fired=[];
  const watch=createFocusWatch({platform:'win32',autoStart:false,thresholdSec:20,cooldownMs:30000,rearmMs:10000,
    spawnFn:()=>{throw Error('tests must not spawn');},onCandidate:c=>fired.push(c)});
  watch.inject({pid:4242,process:'chrome',title:'抖音 - Google Chrome'},0);
  watch.inject({pid:4242,process:'chrome',title:'抖音 - Google Chrome'},10000);
  assert.equal(fired.length,0);
  watch.inject({pid:4242,process:'chrome',title:'抖音 - Google Chrome'},21000);
  assert.equal(fired.length,1);
  assert.equal(fired[0].label,'抖音');
  assert.equal(fired[0].seconds,21);
  watch.inject({pid:4242,process:'chrome',title:'抖音 - Google Chrome'},26000);
  assert.equal(fired.length,1,'同一段停留不再重复提醒');
  watch.inject({pid:4242,process:'chrome',title:'engine.cjs - Visual Studio Code'},30000);
  watch.inject({pid:4242,process:'chrome',title:'抖音 - Google Chrome'},32000);
  assert.equal(fired.length,1,'刚离开又切回时先不提醒');
  watch.inject({pid:4242,process:'chrome',title:'抖音 - Google Chrome'},52000);
  assert.equal(fired.length,2,'离开足够久并且过了冷却才重新计时');
});

test('短暂的娱乐页面与自己的窗口不会提醒',()=>{
  const fired=[];
  const watch=createFocusWatch({autoStart:false,thresholdSec:20,spawnFn:()=>{throw Error('no spawn');},onCandidate:c=>fired.push(c),selfPids:[999]});
  watch.inject({pid:999,process:'studypet',title:'抖音'},0);
  watch.inject({pid:1,process:'chrome',title:'百度一下'},1000);
  watch.inject({pid:1,process:'chrome',title:'bilibili 首页'},8000);
  watch.inject({pid:1,process:'chrome',title:'Visual Studio Code'},10000);
  assert.equal(fired.length,0);
});

test('学习轮次内的专注提醒：一条待回应、可回应、有冷却与每轮上限',async()=>{
  const {engine,advance,stored}=await setup();
  await startRound(engine);
  const first=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:32});
  assert.equal(first.ok,true);
  assert.ok(engine.snapshot().focus.alert);
  assert.match(engine.snapshot().focus.alert.message,/哔哩哔哩/);
  assert.equal(engine.snapshot().rounds[0].focusPrompts,1);
  assert.equal(engine.snapshot().focus.records.length,1);
  assert.equal(stored().focus.records.length,1,'提醒记录随状态一起保存');

  const second=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:90});
  assert.equal(second.data.suppressed,'pending');

  const back=await act(engine,'focus.respond',{response:'back'});
  assert.equal(back.ok,true);
  assert.equal(engine.snapshot().focus.alert,null);
  assert.equal(engine.snapshot().focus.records[0].response,'back');

  advance(60000);
  const cooled=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:40});
  assert.equal(cooled.data.suppressed,'cooldown');

  advance(180000);
  const again=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:40});
  assert.equal(again.ok,true);

  const snooze=await act(engine,'focus.respond',{response:'snooze'});
  assert.equal(snooze.ok,true);
  assert.ok(engine.snapshot().focus.snoozeUntil);
  const duringSnooze=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:40});
  assert.equal(duringSnooze.data.suppressed,'snooze');

  // 演示入口可以越过冷却，但同样需要一轮正在学习的轮次。
  const demo=await act(engine,'focus.demo',{app:'douyin',label:'抖音',seconds:22});
  assert.equal(demo.ok,true);
  assert.equal(engine.snapshot().focus.alert.app,'douyin');
});

test('暂停或结束轮次后提醒消失；没有进行中的轮次用更长的停留门槛',async()=>{
  const {engine,advance}=await setup();
  const short=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:30});
  assert.equal(short.data.suppressed,'short');
  const idle=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:95});
  assert.equal(idle.ok,true);
  assert.equal(engine.snapshot().focus.alert.mode,'idle');
  assert.equal(engine.snapshot().focus.alert.roundId,null);
  assert.match(engine.snapshot().focus.alert.message,/还没开始/);
  await act(engine,'focus.respond',{response:'back'});
  advance(180000);
  await startRound(engine);
  await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:30});
  assert.ok(engine.snapshot().focus.alert);
  assert.equal(engine.snapshot().focus.alert.mode,'round');
  await act(engine,'round.pause',{});
  assert.equal(engine.snapshot().focus.alert,null);
});

test('关闭专注监测后不再接受候选；旧存档缺少字段也能启动',async()=>{
  const legacy={schemaVersion:1,tasks:[],rounds:[],events:[],reflections:[],intentDrafts:[],reflectionDrafts:{},caseDrafts:{},
    prefs:{recording:false,recordingPaused:false,invitations:false,nodes:{resume:true,stage:true,end:true},quiet:false},invitation:null,consumedInvitations:[]};
  const {engine}=await setup(legacy);
  assert.equal(engine.snapshot().focus.enabled,true);
  await act(engine,'focus.update',{enabled:false,thresholdSec:45});
  assert.equal(engine.snapshot().focus.enabled,false);
  assert.equal(engine.snapshot().focus.thresholdSec,45);
  await startRound(engine);
  const off=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:30});
  assert.equal(off.data.suppressed,'disabled');
  await act(engine,'focus.update',{enabled:true});
  const on=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:30});
  assert.equal(on.ok,true);
  await act(engine,'prefs.update',{quiet:true});
  assert.equal(engine.snapshot().focus.alert,null,'安静学习时清掉待回应提醒');
  const quiet=await act(engine,'focus.candidate',{app:'bilibili',label:'哔哩哔哩',seconds:30});
  assert.equal(quiet.data.suppressed,'quiet');
});
