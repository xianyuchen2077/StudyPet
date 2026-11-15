'use strict';
const catalog=require('../renderer/study/materials/catalog.json');
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=message=>{const error=Error(message);error.code='INVALID_INPUT';throw error;};
function packFor(id){const pack=catalog[id];if(!pack)fail('请选择一份已有的演示材料。');return pack;}
function validateCasePlan(caseId,value){
 const pack=packFor(caseId),str=(v,max=1000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('大纲需要有标题、目标、检验方式和可执行的小步。');return v.trim();};
 if(!value||!Array.isArray(value.modules)||!value.modules.length||value.modules.length>16)fail('大纲的板块数量不正确。');
 const ids=new Set();const modules=value.modules.map(m=>{
  if(!/^[-a-z0-9]{1,80}$/.test(m.id)||ids.has(m.id))fail('板块编号重复或不正确。');ids.add(m.id);
  if(!Array.isArray(m.pages)||!m.pages.length||m.pages.some(p=>!Number.isInteger(p)||p<1||p>pack.pageCount))fail('板块引用了不存在的 PDF 页码。');
  const pages=[...new Set(m.pages)].sort((a,b)=>a-b),startPage=m.startPage||pages[0];if(!pages.includes(startPage))fail('起点不在对应的材料页中。');
  if(!Array.isArray(m.steps)||!m.steps.length||m.steps.length>30)fail('请为板块保留至少一条小步。');
  return {id:m.id,title:str(m.title),goal:str(m.goal),check:str(m.check),pages,startPage,steps:m.steps.map(s=>({text:str(s.text),check:str(s.check)})),question:str(m.question||'不看材料，你能说明这一块还不清楚的地方吗？'),prerequisites:(m.prerequisites||[]).map(v=>str(v))};
 });
 const covered=new Set(modules.flatMap(m=>m.pages));if(covered.size!==pack.pageCount)fail('大纲应保留整份材料的范围，可以合并板块但不要漏页。');
 return {caseId,source:'simulation',title:str(value.title||pack.intent,5000),successCheck:str(value.successCheck||pack.successCheck),modules};
}
function createCasePlan(caseId,fields={}){
 const pack=packFor(caseId),modules=clone(pack.modules);
 const starts={users:5,personas:15,scenarios:28,tasks:41,hta:61,sequence:71,requirements:81};
 for(const m of modules)m.startPage=caseId==='hci'?starts[m.id]:m.pages[0];
 return validateCasePlan(caseId,{title:fields.intent||pack.intent,successCheck:pack.successCheck,modules});
}
module.exports={catalog,packFor,createCasePlan,validateCasePlan};
