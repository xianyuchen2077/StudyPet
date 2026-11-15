const GOAL = '分清同一进程中线程共享与独立的资源';
const FIRST_STEP = '看一张双线程示意图，找出共享区';
const SMALLER_STEP = '先找出图里的全局变量区';
const INTENT = '想复习操作系统的进程和线程，但总分不清。';
const SUGGESTIONS = ['用全局变量和栈做两道分类自测', '不看资料，解释为什么线程栈各自独立'];
const CONCEPT_GOAL = '用自己的话说清进程和线程的区别';
const CONCEPT_FIRST_STEP = '先看一个进程里两个线程的示意图';
const CONCEPT_SUGGESTIONS = ['比较进程共享区与每个线程自己的栈', '用一个双线程程序例子解释资源归属'];
function emptyState() {
  return {schemaVersion:1,scenario:'startup',activeTaskId:null,startupDraftId:null,editorDraft:null,tasks:[],intentDrafts:[],caseDrafts:{},reflectionDrafts:{},reflectionDraftArchive:[],rounds:[],events:[],reflections:[],
    prefs:{recording:false,recordingPaused:false,invitations:false,nodes:{resume:true,stage:true,end:true},quiet:false},invitation:null,consumedInvitations:[]};
}
function material(id='practice') {return {id,label:id==='tutorial'?'资源分类自测':'进程与线程图解',position:id==='tutorial'?'第2题／线程的调用栈':'双线程示意图／共享区',available:true};}
function scenarioState(scenario,stamp,id) {
  const s=emptyState();
  if(!['startup','resume','reflection'].includes(scenario))throw Error('请选择一个已有演示情境');
  s.scenario=scenario;
  if(scenario==='startup')return s;
  const taskId=id(),step1=id(),step2=id(),roundId=id(),draftId=id();
  const task={id:taskId,title:GOAL,status:'active',currentStepId:step2,steps:[{id:step1,text:FIRST_STEP,completed:true},{id:step2,text:SUGGESTIONS[0],completed:false}],material:material('tutorial'),
    checkpoint:{position:'第2题／线程的调用栈',nextAction:'先解释为什么每个线程有自己的栈，再核对答案',stepId:step2,source:'上次由我确认（演示）',confirmedAt:stamp}};
  s.tasks.push(task);s.activeTaskId=taskId;
  s.rounds.push({id:roundId,taskId,status:scenario==='resume'?'paused':'ended',startedAt:stamp,pausedAt:stamp,endedAt:scenario==='reflection'?stamp:null,source:'seed'});
  s.intentDrafts.push({id:draftId,intent:INTENT,scope:'resources',title:GOAL,firstStep:FIRST_STEP,suggestions:[SUGGESTIONS[1]],status:'confirmed',taskId});
  s.intentDrafts.push({id:id(),intent:'之后想复习线程同步与互斥',title:'',firstStep:'',suggestions:[],status:'intent'});
  if(scenario==='reflection') {
    s.events=[['14:10','打开进程与线程图解'],['14:14','切到资源分类自测'],['14:17','回到图解核对资源归属']].map(([time,observation],i)=>({id:id(),taskId,roundId,time,observation,source:'seed',explanation:i===1?'想核对线程栈是共享还是各自维护':'',hidden:false,inaccurate:false}));
  }
  return s;
}
module.exports={emptyState,material,scenarioState,GOAL,FIRST_STEP,SUGGESTIONS,SMALLER_STEP,INTENT,CONCEPT_GOAL,CONCEPT_FIRST_STEP,CONCEPT_SUGGESTIONS};
