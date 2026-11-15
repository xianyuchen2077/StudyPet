const test=require('node:test'),assert=require('node:assert/strict');
const {bindAIIPC}=require('../study/ai-ipc.cjs');
test('AI 桥只允许学习面板，过程线索由主进程筛选，不接受其他任务/隐藏/伪造内容',async()=>{
 const handlers=new Map();let sent,cancelled=0;
 const state={activeTaskId:'t',tasks:[{id:'t',title:'TCP',currentStepId:'s',steps:[{id:'s',text:'画图'}]}],events:[{id:'good',taskId:'t',observation:'切到练习',source:'simulation'},{id:'hidden',taskId:'t',hidden:true,observation:'private'},{id:'other',taskId:'other',observation:'other private'}]};
 bindAIIPC({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},ownsPanel:e=>e.panel===true,engine:{snapshot:()=>state},settings:{publicState:()=>({hasKey:true}),save:async()=>({hasKey:true})},service:{request:async input=>{sent=input;return {ok:true};},cancel:()=>{cancelled++;}}});
 assert.equal((await handlers.get('study:ai-settings')({panel:false})).code,'SENDER_REJECTED');
 assert.equal((await handlers.get('study:ai-request')({panel:true},{kind:'review',taskId:'other',context:{}})).code,'AI_STALE');
 await handlers.get('study:ai-request')({panel:true},{kind:'review',taskId:'t',context:{phase:'stage',evidence:[{id:'good',observation:'forged'},{id:'hidden'},{id:'other'}]}});
 assert.equal(sent.context.goal,'TCP');assert.equal(sent.context.action,'画图');assert.equal(sent.context.evidence.length,1);assert.equal(sent.context.evidence[0].observation,'切到练习');assert.ok(!JSON.stringify(sent).includes('private'));
 state.reflectionDrafts={t:{id:'draft',taskId:'t',roundId:'first',contextGoal:'原来这一轮的目标',contextAction:'原来这一轮的小步',contextSuccessCheck:'原来的检验方式'}};state.events[0].roundId='first';state.events.push({id:'later',taskId:'t',roundId:'second',observation:'later private'});
 await handlers.get('study:ai-request')({panel:true},{kind:'review',taskId:'t',reflectionId:'draft',context:{phase:'end',evidence:[{id:'good'},{id:'later'}]}});assert.equal(sent.context.goal,'原来这一轮的目标');assert.equal(sent.context.action,'原来这一轮的小步');assert.equal(sent.context.evidence.length,1);assert.ok(!JSON.stringify(sent).includes('later private'));
 await handlers.get('study:ai-save-settings')({panel:true},{mode:'local'});assert.equal(cancelled,1);
});
