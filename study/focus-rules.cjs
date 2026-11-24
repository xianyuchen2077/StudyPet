'use strict';
// 专注监测的可编辑规则。只使用前台窗口标题与进程名，不读取窗口内容、不截图。
// 规则按顺序匹配，先命中娱乐类；同一标题同时命中学习类时仍以娱乐类为准，
// 避免「哔哩哔哩 · 某个课程视频」被当成学习而漏掉提醒。

const ENTERTAINMENT = [
  {app:'douyin',label:'抖音',keys:['抖音','douyin','tiktok']},
  {app:'bilibili',label:'哔哩哔哩',keys:['哔哩哔哩','bilibili','b站']},
  {app:'kuaishou',label:'快手',keys:['快手','kuaishou']},
  {app:'xiaohongshu',label:'小红书',keys:['小红书','xiaohongshu','rednote']},
  {app:'weibo',label:'微博',keys:['微博','weibo']},
  {app:'zhihu',label:'知乎',keys:['知乎','zhihu']},
  {app:'youtube',label:'YouTube',keys:['youtube']},
  {app:'netflix',label:'Netflix',keys:['netflix']},
  {app:'iqiyi',label:'爱奇艺',keys:['爱奇艺','iqiyi']},
  {app:'tencent-video',label:'腾讯视频',keys:['腾讯视频','v.qq.com']},
  {app:'youku',label:'优酷',keys:['优酷','youku']},
  {app:'mango-tv',label:'芒果TV',keys:['芒果tv','mgtv']},
  {app:'douyu',label:'斗鱼',keys:['斗鱼','douyu']},
  {app:'huya',label:'虎牙',keys:['虎牙','huya']},
  {app:'twitch',label:'Twitch',keys:['twitch']},
  {app:'steam',label:'Steam',keys:['steam']},
  {app:'game',label:'游戏',keys:['wegame','英雄联盟','league of legends','原神','genshin','王者荣耀']},
  {app:'taobao',label:'淘宝',keys:['淘宝','taobao']},
  {app:'jd',label:'京东',keys:['京东','jd.com']},
  {app:'pinduoduo',label:'拼多多',keys:['拼多多','pinduoduo']},
  {app:'toutiao',label:'今日头条',keys:['今日头条','toutiao']},
  {app:'novel',label:'小说',keys:['起点中文网','晋江文学城','番茄小说','qidian','jjwxc']}
];

const STUDY = [
  {app:'vscode',label:'代码编辑',keys:['visual studio code','vscode']},
  {app:'pycharm',label:'PyCharm',keys:['pycharm','intellij','idea64']},
  {app:'jupyter',label:'Jupyter',keys:['jupyter','notebook']},
  {app:'office',label:'文档',keys:['microsoft word','powerpoint','excel','wps','acrobat','pdf']},
  {app:'zotero',label:'文献',keys:['zotero','endnote','arxiv','cnki','知网','万方']},
  {app:'course',label:'课程平台',keys:['学习通','超星','中国大学mooc','coursera','edx','canvas','moodle','blackboard']},
  {app:'coding',label:'编程练习',keys:['leetcode','力扣','codeforces','codewars','overleaf','github','stack overflow','developer.mozilla.org','docs.python.org']},
  {app:'terminal',label:'终端',keys:['windows terminal','powershell','command prompt','cmd.exe']},
  {app:'reference',label:'参考',keys:['wikipedia','维基百科','mathworks','matlab']}
];

// 本应用自己的窗口不参与判断，避免点开桌宠时被误认为分心。
const IGNORED_TITLES = ['studypet','yuns桌面助手','学习面板','学习伙伴'];
const IGNORED_PROCESSES = ['studypet'];

function createRules({entertainment=ENTERTAINMENT,study=STUDY}={}) {
  return {
    entertainment:entertainment.map(item=>({...item,keys:item.keys.map(key=>String(key).toLowerCase())})),
    study:study.map(item=>({...item,keys:item.keys.map(key=>String(key).toLowerCase())})),
    ignoredTitles:IGNORED_TITLES,
    ignoredProcesses:IGNORED_PROCESSES
  };
}

const defaultRules = createRules();

function match(item,haystack) {
  for(const key of item.keys)if(haystack.includes(key))return key;
  return null;
}

// sample: {pid, process, title}
function classify(sample,rules=defaultRules) {
  const title=typeof sample?.title==='string'?sample.title:'';
  const processName=typeof sample?.process==='string'?sample.process.toLowerCase():'';
  if(!title&&!processName)return {kind:'neutral',app:null,label:'未知窗口',matched:null};
  const haystack=`${title} ${processName}`.toLowerCase();
  if(rules.ignoredTitles.some(value=>haystack.includes(value))||rules.ignoredProcesses.some(value=>processName===value))return {kind:'self',app:null,label:'StudyPet',matched:null};
  for(const item of rules.entertainment){const matched=match(item,haystack);if(matched)return {kind:'entertainment',app:item.app,label:item.label,matched};}
  for(const item of rules.study){const matched=match(item,haystack);if(matched)return {kind:'study',app:item.app,label:item.label,matched};}
  return {kind:'neutral',app:null,label:'其他窗口',matched:null};
}

module.exports={classify,createRules,defaultRules,ENTERTAINMENT,STUDY,IGNORED_TITLES};
