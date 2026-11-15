/* Optional cloud help. No credentials, request prompts or network state enter the learning store. */
(function(){
  'use strict';
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create({api,onChange,onNotice}){
    let settings={mode:'local',model:'deepseek-flash',hasKey:false,encryptionAvailable:true},config={...settings,remember:true},secret='',preview=null,active=null,error='',saving=false;
    const supported=()=>typeof api?.requestAI==='function';
    const ready=()=>supported()&&!settings.simulationOnly&&settings.mode==='deepseek'&&settings.hasKey;
    async function init(){
      if(!api?.getAISettings)return;
      try{const r=await api.getAISettings();if(r.ok){settings=r.settings;config={...settings,remember:!settings.sessionOnly};}else error=r.error;}catch{error='暂时未能读取 AI 设置，可以继续本地学习。';}
      onChange();
    }
    function settingsView(locked=false){
      if(settings.simulationOnly)return '<div class="card ai-settings"><h2>当前：模拟建议模式</h2><p>课件与作业案例使用模拟拆解和整理结果，未调用真实 API。</p><p class="small">无需填写密钥。现有 API 框架保留，但本版主进程已停用真实请求。</p></div>';
      const disable=locked||saving?' disabled':'';
      return `<div class="card ai-settings"><h2>DeepSeek 辅助</h2><p class="small">帮你拆小任务、阶段自检和结束复盘。只在你确认本次发送内容后调用。</p>${!supported()?'<p class="small">当前预览未连接桌面 API，可以继续手写和离线示例。</p>':''}
        <div class="split"><div class="field"><label for="ai-mode">辅助方式</label><select id="ai-mode" data-ai-field="mode"${disable}><option value="local"${config.mode==='local'?' selected':''}>本地 · 手写与离线示例</option><option value="deepseek"${config.mode==='deepseek'?' selected':''}>DeepSeek API</option></select></div><div class="field"><label for="ai-model">模型</label><select id="ai-model" data-ai-field="model"${disable}><option value="deepseek-flash"${config.model==='deepseek-flash'?' selected':''}>deepseek-flash</option><option value="deepseek-v4-pro"${config.model==='deepseek-v4-pro'?' selected':''}>deepseek-v4-pro</option></select></div></div>
        <div class="field"><label for="ai-key">API Key · 仅在本机填写</label><input type="password" id="ai-key" data-ai-field="apiKey" maxlength="512" autocomplete="off" spellcheck="false" placeholder="${settings.hasKey?'已配置；留空沿用原密钥':'填写你的 DeepSeek API Key'}"${disable}></div>
        <label class="checkline"><input id="ai-remember" type="checkbox" data-ai-field="remember"${config.remember?' checked':''}${disable}>在本机安全保存密钥</label><p class="small">${settings.encryptionAvailable?'保存时由系统加密；分享项目不会包含你的密钥。':'本机加密不可用，请取消保存，仅用于本次会话。'} ${settings.sessionOnly?'当前密钥仅在本次会话有效。':''}留空不会删除已有密钥。</p>
        ${error||settings.problem?`<p class="error" role="alert">${e(error||settings.problem)}</p>`:''}
        <div class="actions compact"><button type="button" data-action="ai-save-settings"${disable}>${saving?'正在保存…':'保存 AI 设置'}</button>${settings.hasKey?`<button type="button" class="link" data-action="ai-forget-key"${disable}>清除本机密钥并停用</button>`:''}</div><p class="small">当前：${settings.mode==='deepseek'?'DeepSeek API':'本地模式'} · ${settings.hasKey?'密钥已配置':'未配置密钥'}。实际调用按 DeepSeek 账户计费；没有后台自动请求。</p></div>`;
    }
    function restoreSecret(){const input=document.querySelector('#ai-key');if(input)input.value=secret;}
    function open(options){
      if(active){onNotice('已有请求在处理中，可以先取消。');return;}
      error='';preview={...options,selected:new Set()};onChange();document.querySelector('#ai-preview-cancel')?.focus({preventScroll:true});
    }
    function previewView(){
      if(!preview)return '';
      const {kind,context}=preview;
      const pairs=kind==='plan'?[['学习意向',context.intent],['已有基础',context.priorKnowledge],['起步困难',context.difficulty],['当前目标',context.goal],['当前首步',context.action],['检验方式',context.successCheck],['材料',context.materialMode==='os-example'?'内置：同一进程中线程共享与独立资源':'你自己准备的教材、笔记或练习']]:[['复盘时机',context.phase==='stage'?'学习中途 · 本轮仍可继续':'结束复盘'],['学习目标',context.goal],['眼前一步',context.action],['检验方式',context.successCheck],['我写的理解',context.selfReport],['还不确定',context.uncertainty],['下一步意向',context.nextIntent]];
      const events=preview.evidence||[];
      return `<div class="scrim"><section class="modal ai-preview" role="dialog" aria-modal="true" aria-labelledby="ai-preview-title"><h2 id="ai-preview-title">${kind==='plan'?'请 DeepSeek 帮我拆小任务':'请 DeepSeek 帮我梳理这一次'}</h2><p class="small">仅发送下面这些文字。建议回来后仍由你修改、确认。</p><dl class="ai-context">${pairs.filter(([,v])=>v).map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>
        ${kind==='review'?`<details><summary>可选：附上过程线索（默认不发送）</summary><p class="small">最多选择 8 条。观察和你的解释会分别发送。</p>${events.length?events.map(v=>`<label class="checkline ai-evidence"><input type="checkbox" data-ai-evidence="${e(v.id)}"${preview.selected.has(v.id)?' checked':''}><span>${e(v.time||'')} ${e(v.observation)}<small>${v.source==='seed'?'预置示例，非电脑监测':'本轮模拟操作'}${v.explanation?` · 我的解释：${e(v.explanation)}`:''}</small></span></label>`).join(''):'<p class="small">没有可发送的有效线索，也能只根据自己的文字复盘。</p>'}</details>`:''}
        ${!ready()?`<p class="error">${settings.simulationOnly?'当前版本只使用模拟建议，不发送 API 请求。请从首页的课件或作业案例进入。':'当前尚未启用 DeepSeek 或没有密钥。可以去设置，也可以继续手写、使用离线示例。'}</p>`:''}${error?`<p class="error" role="alert">${e(error)}</p>`:''}<p class="small">${settings.simulationOnly?'本次不会发送内容。':e(settings.model)+' · 本次请求可能产生 API 费用。'}</p><div class="actions"><button type="button" id="ai-preview-cancel" data-action="ai-preview-cancel">先不用</button>${ready()?'<button type="button" class="primary" data-action="ai-send">确认发送这一次</button>':'<button type="button" class="primary" data-action="ai-go-settings">去设置</button>'}</div></section></div>`;
    }
    function banner(){return active?`<div class="ai-pending" role="status"><span>DeepSeek 正在${active.kind==='plan'?'整理小步':'整理这次复盘'}…可以继续学习。</span><button type="button" class="link" data-action="ai-cancel" data-stop="true">取消本次请求</button></div>`:'';}
    function cancel(message){
      const ticket=active;active=null;
      if(ticket){api.cancelAI?.(ticket.id).catch(()=>{});if(message)onNotice(message);onChange();}
    }
    async function run(options){
      const id=crypto.randomUUID();const ticket={id,kind:options.kind};active=ticket;onChange();
      const context={...options.context};if(options.kind==='review')context.evidence=(options.evidence||[]).filter(v=>options.selected.has(v.id));
      try{
        const r=await api.requestAI({requestId:id,kind:options.kind,context,taskId:options.taskId,reflectionId:options.reflectionId,consent:true});
        if(active!==ticket)return;
        active=null;onChange();
        if(!r.ok){onNotice(r.error||'AI 暂时没有返回建议，原稿仍保留。');return;}
        if(!options.valid()){onNotice('原稿或当前任务已改变，旧建议未写入。可根据新原稿重新请求。');return;}
        await options.apply(r);
      }catch{if(active===ticket){active=null;onChange();onNotice('暂时没有收到 AI 建议，原稿仍保留。可继续手写或手动重试。');}}
    }
    async function handle(action){
      if(action==='ai-preview-cancel'){preview=null;error='';onChange();return true;}
      if(action==='ai-cancel'){cancel('本次 AI 请求已取消，自己的文字仍保留。');return true;}
      if(action==='ai-send'){
        if(!preview||!ready())return true;
        const options=preview;preview=null;onChange();void run(options);return true;
      }
      if(action==='ai-save-settings'||action==='ai-forget-key'){
        if(!api?.saveAISettings){error='请从桌面 StudyPet 打开 API 设置。';onChange();return true;}
        saving=true;error='';cancel();onChange();
        try{
          const forget=action==='ai-forget-key';const r=await api.saveAISettings({mode:forget?'local':config.mode,model:config.model,apiKey:forget?'':secret,remember:config.remember,forgetKey:forget});
          if(r.ok){secret='';settings=r.settings;config={...settings,remember:!settings.sessionOnly};onNotice(forget?'本机密钥已清除，已切回本地模式。':'AI 设置已保存；只有你主动请求才会发送内容。');}else error=r.error||'设置还没保存，可以重试。';
        }catch{error='设置暂未保存，输入仍保留，可以重试。';}finally{saving=false;onChange();}
        return true;
      }
      return false;
    }
    function input(el){
      if(el.dataset.aiField){const k=el.dataset.aiField;if(k==='apiKey')secret=el.value;else config[k]=k==='remember'?el.checked:el.value;return true;}
      if(el.dataset.aiEvidence&&preview){if(el.checked&&preview.selected.size>=8){el.checked=false;error='一次最多发送 8 条线索。';onChange();return true;}if(el.checked)preview.selected.add(el.dataset.aiEvidence);else preview.selected.delete(el.dataset.aiEvidence);return true;}
      return false;
    }
    function closePreview(){preview=null;error='';onChange();}
    return {init,ready,settingsView,restoreSecret,open,previewView,banner,handle,input,cancel,closePreview,hasPreview:()=>!!preview,clearSecret:()=>{secret='';}};
  }
  window.StudyPetAI={create};
})();
