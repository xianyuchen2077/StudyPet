'use strict';
const https=require('node:https'),http=require('node:http');
const {normalizeInput,validateResult,buildMessages}=require('./ai-contract.cjs');
const ENDPOINT='https://api.deepseek.com/chat/completions';
const messages={AI_DISABLED:'当前使用本地模式，可以手写或使用标明的离线示例。',AI_KEY_MISSING:'请先在“设置 → DeepSeek”中填写 API Key。',AI_CONSENT_REQUIRED:'请先查看本次发送内容，再确认发送。',AI_BUSY:'已有一个 AI 请求在处理中，可以先取消。',AI_AUTH:'DeepSeek 未接受这枚密钥，请在设置中核对。',AI_BALANCE:'DeepSeek 余额不足，请在服务平台检查。',AI_RATE_LIMIT:'DeepSeek 暂时限流，原稿仍保留，可稍后手动重试。',AI_TIMEOUT:'等待 AI 超时，原稿仍保留，可手写或手动重试。',AI_CANCELLED:'本次请求已取消，原稿保留。',AI_NETWORK:'暂时无法连接 DeepSeek，请检查网络后手动重试。',AI_HTTP:'DeepSeek 暂时无法完成请求，原稿仍保留。',AI_INVALID_RESPONSE:'AI 返回的内容为空或格式不完整，原稿仍保留，可手动重试。',AI_TRUNCATED:'AI 返回内容被截断，未采用任何内容，可手动重试。'};
function failure(code){const err=Error(messages[code]||messages.AI_INVALID_RESPONSE);err.code=code;return err;}
// Injectable loopback is for automated tests only; renderers cannot set endpoint.
function createAIService({settings,endpoint=ENDPOINT,allowLoopbackForTests=false,timeoutMs=45000,transport}={}){
  const url=new URL(endpoint);
  if(endpoint!==ENDPOINT&&!(allowLoopbackForTests&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password))throw Error('Only official DeepSeek endpoint is allowed');
  const send=transport||(url.protocol==='https:'?https:http).request;
  let active=null;
  function cancel(requestId){if(active&&(!requestId||active.id===requestId)){active.cancelled=true;active.abort?.();return true;}return false;}
  async function request(input){
    let ticket,timer;
    try{
      if(!input?.consent)throw failure('AI_CONSENT_REQUIRED');
      const credentials=settings.credentials();
      if(credentials.mode!=='deepseek')throw failure('AI_DISABLED');if(!credentials.apiKey)throw failure('AI_KEY_MISSING');
      if(active)throw failure('AI_BUSY');
      if(typeof input.requestId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(input.requestId))throw failure('AI_INVALID_INPUT');
      const normalized=normalizeInput(input);
      ticket={id:input.requestId,cancelled:false,timedOut:false};active=ticket;
      const body=JSON.stringify({model:credentials.model,messages:buildMessages(normalized),thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:1600,stream:false});
      const response=await new Promise((resolve,reject)=>{
        const req=send(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),Authorization:`Bearer ${credentials.apiKey}`}},res=>{
          if(res.statusCode!==200){res.resume();reject(failure(({401:'AI_AUTH',402:'AI_BALANCE',429:'AI_RATE_LIMIT'})[res.statusCode]||'AI_HTTP'));return;}
          const chunks=[];let bytes=0;
          res.on('data',chunk=>{bytes+=chunk.length;if(bytes>128*1024){reject(failure('AI_INVALID_RESPONSE'));req.destroy();}else chunks.push(chunk);});
          res.on('error',()=>reject(failure('AI_NETWORK')));
          res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(failure('AI_INVALID_RESPONSE'));}});
        });
        ticket.abort=()=>{req.destroy();reject(failure(ticket.timedOut?'AI_TIMEOUT':'AI_CANCELLED'));};
        req.on('error',()=>reject(failure(ticket.timedOut?'AI_TIMEOUT':ticket.cancelled?'AI_CANCELLED':'AI_NETWORK')));
        timer=setTimeout(()=>{ticket.timedOut=true;ticket.abort();},timeoutMs);
        req.end(body);
      });
      if(ticket.cancelled)throw failure('AI_CANCELLED');
      const choice=response?.choices?.[0];if(choice?.finish_reason==='length')throw failure('AI_TRUNCATED');
      if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw failure('AI_INVALID_RESPONSE');
      let json;try{json=JSON.parse(choice.message.content);}catch{throw failure('AI_INVALID_RESPONSE');}
      const result=validateResult(normalized.kind,json);
      if(normalized.kind==='review'&&!normalized.context.selfReport&&!normalized.context.uncertainty){result.summary='';result.uncertainty='';}
      const usage={};for(const k of ['prompt_tokens','completion_tokens'])if(Number.isSafeInteger(response.usage?.[k])&&response.usage[k]>=0)usage[k]=response.usage[k];
      return {ok:true,requestId:ticket.id,result,source:{provider:'DeepSeek',model:credentials.model,usage},receivedAt:new Date().toISOString()};
    }catch(error){const code=messages[error.code]?error.code:error.code==='AI_INVALID_INPUT'?'AI_INVALID_INPUT':'AI_INVALID_RESPONSE';return {ok:false,requestId:input?.requestId,code,error:code==='AI_INVALID_INPUT'?'发送内容格式或长度不正确，请精简后重试。':messages[code]};}
    finally{clearTimeout(timer);if(ticket&&active===ticket)active=null;}
  }
  return {request,cancel,isBusy:()=>!!active};
}
module.exports={createAIService,ENDPOINT};
