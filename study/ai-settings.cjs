'use strict';
const MODELS=['deepseek-flash','deepseek-v4-pro'];
function fault(message,code='AI_SETTINGS'){const error=Error(message);error.code=code;return error;}
function createAISettings({read,write,secure}){
  let config={mode:'local',model:MODELS[0]},key='',remember=true,problem='',queue=Promise.resolve();
  const encryptionAvailable=()=>!!secure?.isEncryptionAvailable?.();
  function publicState(){return {...config,hasKey:!!key,sessionOnly:!!key&&!remember,encryptionAvailable:encryptionAvailable(),problem};}
  async function init(){
    try{
      const saved=await read();if(!saved)return publicState();
      config={mode:saved.mode==='deepseek'?'deepseek':'local',model:MODELS.includes(saved.model)?saved.model:MODELS[0]};
      if(saved.encryptedKey){
        if(!encryptionAvailable())throw Error('secure unavailable');
        key=secure.decryptString(Buffer.from(saved.encryptedKey,'base64'));
        if(typeof key!=='string'||!key||key.length>512)throw Error('invalid stored key');
      }
    }catch{key='';problem='本机保存的 AI 设置未能读取，请重新填写密钥并保存。';}
    return publicState();
  }
  function save(input){
    const work=queue.then(async()=>{
      if(!input||!['local','deepseek'].includes(input.mode)||!MODELS.includes(input.model))throw fault('请选择支持的 AI 模式和模型。');
      if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>512||/[\r\n\x00-\x1f]/.test(input.apiKey)))throw fault('密钥格式不正确，请重新填写。');
      const nextKey=input.forgetKey?'':input.apiKey?.trim()||key;
      const nextRemember=input.remember!==false;
      if(nextKey&&nextRemember&&!encryptionAvailable())throw fault('本机加密暂不可用，请取消“在本机安全保存”，仅用于本次会话。');
      const nextConfig={mode:input.mode,model:input.model};
      const stored={...nextConfig,version:1};
      try{if(nextKey&&nextRemember)stored.encryptedKey=secure.encryptString(nextKey).toString('base64');await write(stored);}
      catch{throw fault('AI 设置还没保存，原来的设置仍保留，请重试。');}
      config=nextConfig;key=nextKey;remember=nextRemember;problem='';return publicState();
    });queue=work.catch(()=>{});return work;
  }
  return {init,save,publicState,credentials:()=>({...config,apiKey:key})};
}
module.exports={createAISettings,MODELS};
