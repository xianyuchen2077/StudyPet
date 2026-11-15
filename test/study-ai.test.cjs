const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {normalizeInput,validateResult,buildMessages}=require('../study/ai-contract.cjs');
const {createAISettings}=require('../study/ai-settings.cjs');
const {createAIService}=require('../study/ai-service.cjs');

const plan={goal:'解释 TCP 三次握手的目的',why:'先建立连接过程的心智模型',successCheck:'不看图，说明每次握手确认了什么',steps:[{action:'画出客户端和服务器两列',check:'能标出双方初始状态'},{action:'标出 SYN 与 ACK',check:'说明对应的确认关系'}]};
const review={summary:'我能画出三次消息，但解释第三次的作用还不流畅',uncertainty:'第三次握手的作用',nextStep:'用丢失第三次消息的情形解释',question:'服务器收到第二次消息就能确认双方都准备好了吗？',adjustment:'先口头解释，再对照教材修正'};
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('cipher:'+s),decryptString:b=>b.toString().slice(7)};
async function settings(initial=null){let disk=initial;const s=createAISettings({read:async()=>disk,write:async value=>{disk=value;},secure});await s.init();return {s,disk:()=>disk};}
async function configured(){const {s}=await settings();await s.save({mode:'deepseek',model:'deepseek-flash',apiKey:'test-key-not-real',remember:true});return s;}
async function server(t,handler){const srv=http.createServer(handler);await new Promise(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>{srv.closeAllConnections?.();srv.close();});return `http://127.0.0.1:${srv.address().port}/chat/completions`;}
function answer(res,value,finish='stop'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:finish,message:{content:typeof value==='string'?value:JSON.stringify(value)}}],usage:{prompt_tokens:200,completion_tokens:100}}));}

test('只发送白名单文本，支持其他学科，提示词要求自主解释和可检验的小步',()=>{
 const input=normalizeInput({kind:'plan',context:{intent:'学习 TCP 三次握手',priorKnowledge:'知道客户端/服务端',difficulty:'背不住过程',screenshots:['secret'],apiKey:'secret'}});
 assert.equal(input.context.intent,'学习 TCP 三次握手');assert.equal(input.context.apiKey,undefined);assert.equal(input.context.screenshots,undefined);
 const messages=buildMessages(input);assert.match(messages[0].content,/JSON/i);assert.match(messages[0].content,/用户/);assert.match(messages[0].content,/掌握/);assert.ok(!JSON.stringify(messages).includes('secret'));
 assert.throws(()=>normalizeInput({kind:'chat',context:{}}));assert.throws(()=>normalizeInput({kind:'plan',context:{intent:'x'.repeat(5001)}}));
});
test('模型结果校验完整结构和长度，空、截断、错误步骤不能当成计划',()=>{
 assert.equal(validateResult('plan',plan).steps.length,2);
 assert.throws(()=>validateResult('plan',{goal:'x',steps:[]}));assert.throws(()=>validateResult('plan',{...plan,steps:[{action:'',check:''}]}));
 assert.throws(()=>validateResult('review',{summary:42}));assert.equal(validateResult('review',review).question,review.question);
});
test('密钥只在主进程取得，持久层加密，公有设置不回显密钥',async()=>{
 const {s,disk}=await settings();assert.equal(s.publicState().mode,'local');
 await s.save({mode:'deepseek',model:'deepseek-flash',apiKey:'test-key-not-real',remember:true});
 assert.equal(s.credentials().apiKey,'test-key-not-real');assert.equal(s.publicState().hasKey,true);assert.ok(!JSON.stringify(s.publicState()).includes('test-key'));
 assert.ok(!JSON.stringify(disk()).includes('test-key'));const reopened=(await settings(disk())).s;assert.equal(reopened.credentials().apiKey,'test-key-not-real');
 await s.save({mode:'local',model:'deepseek-flash',apiKey:'',remember:true});assert.equal(s.publicState().hasKey,true);
 await s.save({mode:'local',model:'deepseek-flash',forgetKey:true,remember:true});assert.equal(s.publicState().hasKey,false);
});
test('设置保存失败回滚，加密不可用时可仅本次会话使用',async()=>{
 let fail=false;const s=createAISettings({read:async()=>null,write:async()=>{if(fail)throw Error('disk');},secure});await s.init();
 await s.save({mode:'deepseek',model:'deepseek-flash',apiKey:'old-key',remember:true});fail=true;
 await assert.rejects(()=>s.save({mode:'deepseek',model:'deepseek-v4-pro',apiKey:'new-key',remember:true}));assert.equal(s.credentials().apiKey,'old-key');assert.equal(s.publicState().model,'deepseek-flash');
 const session=createAISettings({read:async()=>null,write:async()=>{},secure:{isEncryptionAvailable:()=>false}});await session.init();
 await assert.rejects(()=>session.save({mode:'deepseek',model:'deepseek-flash',apiKey:'session-key',remember:true}));
 await session.save({mode:'deepseek',model:'deepseek-flash',apiKey:'session-key',remember:false});assert.equal(session.publicState().sessionOnly,true);
});
test('本地模式/无密钥/未确认发送不触网',async()=>{
 const {s}=await settings();let calls=0;const service=createAIService({settings:s,transport:()=>{calls++;}});
 assert.equal((await service.request({requestId:'local-1',kind:'plan',context:{intent:'TCP'},consent:true})).code,'AI_DISABLED');
 await s.save({mode:'deepseek',model:'deepseek-flash',remember:true});assert.equal((await service.request({requestId:'local-2',kind:'plan',context:{intent:'TCP'},consent:true})).code,'AI_KEY_MISSING');
 await s.save({mode:'deepseek',model:'deepseek-flash',apiKey:'fake',remember:true});assert.equal((await service.request({requestId:'local-3',kind:'plan',context:{intent:'TCP'}})).code,'AI_CONSENT_REQUIRED');assert.equal(calls,0);
});
test('真实 HTTP 模拟：DeepSeek JSON 协议、关闭思考、限额、返回来源，不泄露 Key',async t=>{
 let seen;const endpoint=await server(t,(req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{seen={headers:req.headers,body:JSON.parse(body)};answer(res,plan);});});
 const service=createAIService({settings:await configured(),endpoint,allowLoopbackForTests:true});
 const result=await service.request({requestId:'http-plan',kind:'plan',context:{intent:'学习 TCP'},consent:true});
 assert.equal(result.ok,true);assert.equal(result.result.goal,plan.goal);assert.equal(seen.headers.authorization,'Bearer test-key-not-real');assert.equal(seen.body.response_format.type,'json_object');assert.equal(seen.body.thinking.type,'disabled');assert.ok(seen.body.max_tokens<=2000);assert.equal(seen.body.stream,false);assert.equal(result.source.model,'deepseek-flash');assert.ok(!JSON.stringify(result).includes('test-key'));
});
test('没有自己的理解时，模型只能给自检问题/策略，不能代写收获',async t=>{
 const endpoint=await server(t,(_req,res)=>answer(res,review));const service=createAIService({settings:await configured(),endpoint,allowLoopbackForTests:true});
 const result=await service.request({requestId:'empty-review',kind:'review',context:{phase:'stage',goal:'TCP',selfReport:'',uncertainty:'',nextIntent:'',evidence:[]},consent:true});
 assert.equal(result.ok,true);assert.equal(result.result.summary,'');assert.equal(result.result.uncertainty,'');assert.equal(result.result.question,review.question);
});
test('错误响应、空 JSON、非 JSON、截断、超时均保留草稿路径且不自动重试',async t=>{
 let calls=0;const endpoint=await server(t,(req,res)=>{calls++;if(calls===1){res.statusCode=401;res.end('test-key-not-real private server text');}else if(calls===2)answer(res,'   ');else if(calls===3)answer(res,'<html>bad</html>');else if(calls===4)answer(res,plan,'length');else if(calls===5){res.statusCode=429;res.end('busy');}else setTimeout(()=>answer(res,plan),100);});
 const service=createAIService({settings:await configured(),endpoint,allowLoopbackForTests:true,timeoutMs:40});
 for(const [i,code] of ['AI_AUTH','AI_INVALID_RESPONSE','AI_INVALID_RESPONSE','AI_TRUNCATED','AI_RATE_LIMIT','AI_TIMEOUT'].entries()){
  const result=await service.request({requestId:`bad-${i}`,kind:'plan',context:{intent:'TCP'},consent:true});assert.equal(result.code,code);assert.ok(!JSON.stringify(result).includes('test-key'));assert.equal(result.ok,false);
 }
 assert.equal(calls,6);
});
test('取消在途请求，重复/并发调用拒绝，重定向不携带 Key 跟随',async t=>{
 let calls=0;const endpoint=await server(t,(_req,res)=>{calls++;setTimeout(()=>answer(res,plan),200);});
 const service=createAIService({settings:await configured(),endpoint,allowLoopbackForTests:true});
 const first=service.request({requestId:'cancel-me',kind:'plan',context:{intent:'TCP'},consent:true});await new Promise(r=>setTimeout(r,15));
 assert.equal((await service.request({requestId:'second',kind:'plan',context:{intent:'TCP'},consent:true})).code,'AI_BUSY');service.cancel('cancel-me');assert.equal((await first).code,'AI_CANCELLED');
 const redirect=await server(t,(_req,res)=>{res.writeHead(302,{Location:'https://example.com/'});res.end();});const s2=createAIService({settings:await configured(),endpoint:redirect,allowLoopbackForTests:true});assert.equal((await s2.request({requestId:'redirect',kind:'plan',context:{intent:'TCP'},consent:true})).code,'AI_HTTP');assert.equal(calls,1);
 assert.throws(()=>createAIService({settings:{},endpoint:'https://example.com'}));
});
