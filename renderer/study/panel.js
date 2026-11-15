/* The panel keeps only editable text locally. Confirmed learning data is always
   read from studyAPI; dispatch acknowledgements decide whether a save succeeded. */
(function () {
  'use strict';
  const api = window.studyAPI;
  const main = document.querySelector('#main');
  const overlay = document.querySelector('#overlay');
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cat = (pose='idle',size='') => window.StudyPetArt.cat(pose,size);
  const ui = {view:'home',busy:0,flowBusy:0,closing:false,error:null,notice:'',startup:null,reflection:null,editor:null,modal:null,
    resume:null,materialTab:'practice',found:false,question:false,selfTest:false,badProposal:false,proposalDismissed:false,
    savedReflectionId:null,allTasks:false,details:new Set(),draftTimer:null,draftPromise:null,queuedNavigation:null,pendingTarget:null};
  let state = null;
  const ai=window.StudyPetAI.create({api,onChange:()=>render(),onNotice:showNotice});
  const cases=window.StudyPetCases.create({getState:()=>state,execute,openView:setView,onChange:render,onNotice:showNotice,flushAll:flushDrafts,isLocked:()=>ordinaryLocked(),onEditStep:openEditor});
  const activeTask = () => state?.tasks.find(t=>t.id===state.activeTaskId);
  const unfinished = taskId => [...state.rounds].reverse().find(r=>r.taskId===taskId&&r.status!=='ended');
  const selectedStep = t => t?.steps.find(v=>v.id===t.currentStepId);
  const latestRound = taskId => [...state.rounds].reverse().find(r=>r.taskId===taskId);
  const draftForTask = t => state.intentDrafts.find(d=>d.taskId===t?.id);
  const materialPosition=t=>['external','document'].includes(t.materialMode)?t.material.position:window.OSLearningMaterial.position({taskId:t.id,tab:ui.materialTab});
  const ordinaryLocked = () => !!(ui.busy||ui.flowBusy||ui.closing);
  const disabled = safe => ordinaryLocked()&&!safe?' disabled':'';
  const button = (label,action,{primary=false,link=false,safe=false,attrs='',classes=''}={}) =>
    `<button type="button" data-action="${e(action)}" class="${primary?'primary ':''}${link?'link ':''}${classes}"${safe?' data-stop="true"':''}${disabled(safe)} ${attrs}>${e(label)}</button>`;
  const field = (label,id,model,key,value,{textarea=false,rows=3,placeholder='',max=5000}={}) =>
    `<div class="field"><label for="${id}">${e(label)}</label>${textarea?`<textarea id="${id}" data-model="${model}" data-field="${key}" rows="${rows}" maxlength="${max}" placeholder="${e(placeholder)}"${ordinaryLocked()?' readonly':''}>${e(value)}</textarea>`:`<input id="${id}" data-model="${model}" data-field="${key}" maxlength="${max}" value="${e(value)}" placeholder="${e(placeholder)}"${ordinaryLocked()?' readonly':''}>`}</div>`;
  function heading(title,subtitle,eyebrow='',pose='idle') {
    return `<div class="hero"><div class="hero-copy">${eyebrow?`<div class="eyebrow">${e(eyebrow)}</div>`:''}<h1>${e(title)}</h1>${subtitle?`<p class="intro">${e(subtitle)}</p>`:''}</div>${cat(pose)}</div>`;
  }
  const companion = (text,pose='idle') => `<div class="companion">${cat(pose,'small')}<p>${e(text)}</p></div>`;
  const detail = (key,title,content) => `<details data-detail="${key}"${ui.details.has(key)?' open':''}><summary>${e(title)}</summary>${content}</details>`;
  function errorBox() {
    if(!ui.error)return '';
    return `<div class="error" role="alert"><p>${e(ui.error.message)}</p>${ui.error.code==='SAVE_FAILED'?'<small>原来确认的内容仍保留。你可以在原处重试。</small>':''}</div>`;
  }
  function preserve() {
    const el=document.activeElement;
    return {id:el?.id, start:typeof el?.selectionStart==='number'?el.selectionStart:null,
      end:typeof el?.selectionEnd==='number'?el.selectionEnd:null, direction:el?.selectionDirection,
      scroll:main.scrollTop,drawer:document.querySelector('.drawer-body')?.scrollTop||0};
  }
  function restore(saved) {
    const el=saved.id&&document.getElementById(saved.id);
    if(el){el.focus({preventScroll:true});if(saved.start!==null&&el.setSelectionRange)try{el.setSelectionRange(saved.start,saved.end,saved.direction);}catch{}}
    main.scrollTop=saved.scroll;
    const drawer=document.querySelector('.drawer-body');if(drawer)drawer.scrollTop=saved.drawer;
  }
  function renderChrome() {
    if(!state)return;
    const r=unfinished(state.activeTaskId);
    document.querySelector('#record-state').textContent=state.prefs.recording?(state.prefs.recordingPaused?'模拟记录暂停':'模拟记录开启'):'模拟记录关闭';
    document.querySelector('#round-state').textContent=r?.status==='running'?'本轮进行中':r?.status==='paused'?'本轮已暂停':'慢慢开始就好';
    const tab=ui.view==='case'?cases.navTab():ui.view==='preferences'?'preferences':ui.view==='tasks'?'tasks':['feedback','reflection'].includes(ui.view)?'feedback':'home';
    for(const el of document.querySelectorAll('[data-nav]')){el.disabled=ui.closing;if(el.dataset.nav===tab)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}
    const notice=document.querySelector('#notice');notice.hidden=!ui.notice;
    notice.innerHTML=ui.notice?`<span>${e(ui.notice)}</span>${button('收起提示','notice-dismiss',{link:true,safe:true})}`:'';
    const invitation=document.querySelector('#invitation');invitation.hidden=!state.invitation;
    invitation.innerHTML=state.invitation?`<p>${e(state.invitation.message)}</p><div class="actions">${button(state.invitation.node==='resume'?'看看':'写一句','invite-accept')}${button('稍后','invite-later',{link:true,safe:true})}${button('这次不用','invite-reject',{link:true,safe:true})}</div>`:'';
  }
  function render() {
    if(!state)return;
    const saved=preserve();
    for(const el of document.querySelectorAll('details[data-detail]')){if(el.open)ui.details.add(el.dataset.detail);else ui.details.delete(el.dataset.detail);}
    renderChrome();
    const views={home:homeView,guide:guideView,plan:planView,study:studyView,resume:resumeView,tasks:tasksView,feedback:feedbackView,reflection:reflectionView,preferences:preferencesView,case:()=>cases.render()};
    main.innerHTML=`<section class="page ${ui.view==='case'?'case-page':(!activeTask()?.caseId&&['guide','plan','resume','reflection','preferences'].includes(ui.view))?'narrow':''}" data-view="${e(ui.view)}">${ai.banner()}${cases.banner()}${ui.view==='case'?errorBox():''}${state.editorDraft&&!ui.editor?`<div class="resume-draft"><span>有一份尚未确认的编辑已暂存。</span>${button('继续上次编辑','resume-editor',{link:true})}</div>`:''}${ui.view==='home'&&activeTask()&&!activeTask().caseId?cases.chooser():''}${(views[ui.view]||homeView)()}${ui.view==='feedback'&&activeTask()&&!activeTask().caseId?earlierDraftsView(activeTask().id):''}</section>`;
    overlay.innerHTML=ui.modal?modalView():ai.hasPreview()?ai.previewView():ui.editor?editorView():'';
    for(const el of document.querySelectorAll('details[data-detail]'))if(ui.details.has(el.dataset.detail))el.open=true;
    main.inert=!!(ui.modal||ui.editor||ai.hasPreview());
    document.querySelector('nav').inert=!!(ui.modal||ui.editor||ai.hasPreview());
    ai.restoreSecret();
    restore(saved);
  }
  function homeView() {
    const t=activeTask(),r=t&&unfinished(t.id),step=selectedStep(t);
    if(t?.caseId)return cases.home(t);
    if(!t)return `${heading('今天想学点什么？','还没想清楚也可以，先从一句话开始。','开始学习')}${errorBox()}
      ${cases.chooser()}<div class="actions">${button('帮我找个起点','new-guide',{link:true})}</div>
      <div class="actions">${button('我已有一步，直接写','new-direct',{link:true})}${button('看看暂存意向','go-tasks',{link:true})}</div>${companion('不用一口气规划完整个任务。')}`;
    let title=r?.status==='running'?'返回本轮':t.checkpoint?'上次留在这里':'眼前的一小步';
    let body=t.checkpoint?`<p class="position">${e(t.material.label)}</p><p class="lead">${e(t.checkpoint.position)}</p><p>${e(t.checkpoint.nextAction)}</p><p class="small">${e(t.checkpoint.source)}</p>`:`<p class="lead">${e(step?.text||'眼前小步还没选，可以去任务里选一条。')}</p>`;
    const action=r?.status==='running'?button('返回本轮','go-study',{primary:true}):t.status==='completed'?button('看看我的任务','go-tasks',{primary:true}):step?button(t.checkpoint?'核对后接着做':'从这一步开始',t.checkpoint?'go-resume':'start-current',{primary:true}):button('选择眼前小步','go-tasks',{primary:true});
    return `${heading(title,r?.status==='running'?'按自己的节奏继续；暂停和结束都由你决定。':'先看看位置和下一步，合适再继续。','开始学习',r?.status==='running'?'study':r?.status==='paused'?'rest':'idle')}${errorBox()}
      <div class="card sketch"><div class="meta-row"><span class="pill">${e(t.status==='completed'?'我已标为完成':r?.status==='paused'?'上次已暂停':'当前任务')}</span><span class="small">${e(t.title)}</span></div>${body}<div class="actions">${action}${r?.status==='running'?button('暂停并留点','pause-round',{link:true,safe:true}):''}${button('我的任务','go-tasks',{link:true})}</div></div>
      <div class="actions">${button('想学另一件事','new-guide',{link:true})}${button('自己写一句回顾','go-reflection',{link:true})}</div>${companion('位置不对可以改；是否继续，由你确认。',r?.status==='paused'?'rest':'idle')}`;
  }
  function ensureStartup() {
    if(ui.startup)return ui.startup;
    const d=state.intentDrafts.find(v=>v.id===state.startupDraftId&&v.status!=='confirmed');
    ui.startup=d?{...d,rev:0,savedRev:0}:{id:null,intent:'想复习操作系统的进程和线程，但总分不清',scope:'resources',title:'',firstStep:'',priorKnowledge:'',difficulty:'',successCheck:'',firstCheck:'',materialMode:'external',suggestions:[],status:'intent',rev:0,savedRev:-1};
    return ui.startup;
  }
  function guideView() {
    const d=ensureStartup();
    return `${heading('先说想学的事','先有一句话就够了。一起找出一个容易动手的小目标。','找个起点')}${errorBox()}
      ${field('我的原话','intent','startup','intent',d.intent,{textarea:true,rows:3})}
      ${detail('learning-background','可选：让建议更适合我',`${field('我已经知道什么 · 可不填','prior-knowledge','startup','priorKnowledge',d.priorKnowledge,{max:1000,placeholder:'例如：知道线程是什么，但总混淆资源归属'})}${field('哪里让我难以开始 · 可不填','learning-difficulty','startup','difficulty',d.difficulty,{max:1000,placeholder:'例如：不知道从哪里看起，想先弄清一个区别'})}`)}
      <label class="checkline"><input type="checkbox" id="use-built-in"${d.materialMode==='os-example'?' checked':''}${disabled()}>使用内置的“线程资源归属”示例材料</label>
      <div class="actions">${button('请 DeepSeek 帮我拆小','ai-plan',{primary:true})}${button('我自己写','direct-plan',{link:true})}</div>
      ${detail('offline-start','或试试离线的操作系统示例',`<p class="small">固定示例，不调用模型。只适用于进程与线程这个知识点。</p><div class="choice-row">${button('先分清共享与独立资源','suggest-resources')}${button('先解释进程与线程的区别','suggest-concepts')}</div>`)}
      <div class="actions">${button('只存意向','save-intent',{link:true})}${button('返回','go-home',{link:true})}</div><div id="draft-state" class="draft-state">${draftStatus(d)}</div>${companion('只挑眼下的小结果，其他以后再说。')}`;
  }
  function planView() {
    const d=ensureStartup(),failed=ui.error?.action==='plan.confirm';
    return `${heading('先从这一小步试试','目标、首步和检验方式都由你来定。','候选 · 尚未加入计划')}${errorBox()}
      <p class="ai-source">${d.aiSource?`DeepSeek · ${e(d.aiSource.model)} · 可修改的建议`:d.planWhy?'离线操作系统示例 · 固定内容':'我自己的草稿'}${d.planWhy?`<br>${e(d.planWhy)}`:''}</p>
      ${field('目标候选 · 可以改','plan-title','startup','title',d.title,{max:1000})}
      <div class="card sketch">${field('眼前首步 · 尚未确认','plan-step','startup','firstStep',d.firstStep,{textarea:true,rows:2,max:1000})}
      <div class="actions compact">${button('我来改','focus-first-step',{link:true})}${button('再拆小','refine-smaller',{link:true})}${button('换个起点','refine-other',{link:true})}</div></div>
      <div class="plan-check">${field('这次如何检验自己懂了 · 可改可留空','plan-check','startup','successCheck',d.successCheck,{max:1000,placeholder:'例如：合上图解，说明全局变量与线程栈分别属于谁'})}</div>
      ${d.firstCheck?detail('first-check','这一步的自检方式 · 可改',field('我怎么判断这一步做到了','first-check','startup','firstCheck',d.firstCheck,{max:1000})):''}
      ${detail('startup-suggestions',`另有 ${d.suggestions?.length||0} 条后续建议 · 还未加入计划`,d.suggestions?.length?`<ul class="candidate-list">${d.suggestions.map(v=>`<li>${e(v)}</li>`).join('')}</ul><p class="small">这些候选不会随首步一起加入。</p>`:'<p class="small">先做好眼前的一小步就够了。</p>')}
      <div class="actions">${button(failed?'重试保存并开始':'就从这一步开始','confirm-plan',{primary:true})}${button('先放这里','save-intent',{link:true})}${button('返回原话','go-guide',{link:true})}</div>
      <p class="scope">只确认目标、检验方式和这一条首步。其他步骤仍是候选；材料准备好后才开始本轮。</p><div id="draft-state" class="draft-state">${draftStatus(d)}</div>${companion('不用规划整门课，先试这一小步。')}`;
  }
  function studyView() {
    const t=activeTask();if(!t)return emptyTask('还没有开始的任务');
    if(t.caseId)return cases.study(t);
    const r=unfinished(t.id),step=selectedStep(t),running=r?.status==='running';
    const unavailable=!t.material.available||ui.error?.code==='MATERIAL_UNAVAILABLE';
    return `${heading('知道自己正在做什么',running?'先做眼前的一步。卡住时，可以换一个更容易检验的办法。':'按自己的节奏继续，开始与结束都由你决定。',t.materialMode==='external'?'我的学习材料':'操作系统 · 学习示例',running?'study':'idle')}
      <div class="learning-compass"><div><h2>我想弄清什么</h2><p>${e(t.title)}</p></div><div><h2>我现在做什么</h2><p>${e(step?.text||'这一步已由我标为完成，下一步由我选择')}</p></div><div><h2>我如何检验</h2><p>${e(t.successCheck||step?.check||'合上材料，用自己的话解释一句，再核对。')}</p>${step?.check&&step.check!==t.successCheck?`<p class="small">本步：${e(step.check)}</p>`:''}${button('调整目标或检验方式','edit-task',{link:true})}</div></div>
      ${unavailable?`<div class="card sketch"><h2>材料没打开，本轮尚未恢复。</h2><p class="muted">你的任务和原来的轮次仍保留。换一份材料，或确认自己已找到。</p>${errorBox()}<div class="actions">${button('换一份材料','edit-material',{primary:true})}${button('我已自己找到','manual-ready')}${button('先不开始','go-home',{link:true})}</div></div>`:
      `${errorBox()}<div class="meta-row"><span class="pill">${running?'本轮进行中':r?.status==='paused'?'本轮已暂停':'本轮尚未开始'}</span><span class="small">${e(t.material.label)} · ${e(t.material.position)}</span></div>
      <div class="actions study-actions">${running&&step?button('我完成这一步','complete-current-step',{primary:true}):step?button(ui.error?.action==='round.start'?'重试开始本轮':r?.status==='paused'?'继续本轮':'开始本轮','start-current',{primary:true}):button('自己选择下一步','go-tasks',{primary:true})}
      ${running?button('暂停并留点','pause-round',{link:true,safe:true}):''}${r?button('结束这一轮','end-round',{link:true,safe:true}):''}${button(running?'阶段自检':'自己回顾','go-reflection',{link:true})}</div>
      ${materialFrame(t)}
      ${!step?'<p class="scope">这一步完成了，任务仍由你管理。候选建议不会自动变成下一步。</p>':''}
      ${detail('material-options','材料或位置不对？',`<div class="actions compact">${button('更换材料','edit-material',{link:true})}${button('核对位置','go-resume',{link:true})}</div>`)}
      ${companion('是否完成，由你确认。','study')}`}`;
  }
  function materialFrame(t) {
    if(t.materialMode==='external')return `<div class="material-shell"><div class="material-head">${e(t.material.label)} · 由我自己准备</div><div class="external-material"><h2>回到自己的教材、笔记或练习</h2><p>${e(t.material.position)}</p><p class="muted">StudyPet 保留目标与眼前一步。按自己的方式学习，想核对理解时再回来写一句。</p><p class="small">没有读取你的文件或其他窗口。AI 只看到你确认发送的文字。</p></div></div>`;
    const tab=ui.materialTab||t.material.id;
    return `<div class="material-shell"><div class="material-tabs" role="tablist" aria-label="学习材料"><button type="button" role="tab" data-action="material-practice" aria-selected="${tab==='practice'}"${disabled()}>进程与线程图解</button><button type="button" role="tab" data-action="material-tutorial" aria-selected="${tab==='tutorial'}"${disabled()}>资源分类自测</button></div><div class="material-head">操作系统 · 同一进程内线程资源归属 · 本地学习示例</div>${window.OSLearningMaterial.render({taskId:t.id,tab,disabled:ordinaryLocked()})}</div>`;
  }
  function ensureResume(t) {
    if(ui.resume?.taskId===t.id)return ui.resume;
    const stored=state.editorDraft?.mode==='checkpoint'&&state.editorDraft.taskId===t.id?state.editorDraft.fields:null;
    ui.resume={taskId:t.id,position:stored?.position||t.checkpoint?.position||t.material.position,nextAction:stored?.nextAction||t.checkpoint?.nextAction||selectedStep(t)?.text||'',changed:!!stored};return ui.resume;
  }
  function resumeView() {
    const t=activeTask();if(!t)return emptyTask('还没有留下的位置');
    if(t.caseId)return cases.home(t);
    const c=ensureResume(t);
    return `${heading('上次留在这里','先核对，再接着做。改位置会先回到这里预览。','接续学习','rest')}${errorBox()}
      <div class="card"><h3>原来确认的位置</h3><p class="small">${e(t.material.label)}</p><p class="lead">${e(t.checkpoint?.position||t.material.position)}</p><p>${e(t.checkpoint?.nextAction||selectedStep(t)?.text||'下一步还没选')}</p><p class="small">${e(t.checkpoint?.source||'来自当前材料位置')}</p></div>
      ${c.changed?`<div class="card sketch"><div class="meta-row"><span class="pill">新的候选 · 还未覆盖旧位置</span></div><p class="lead">${e(c.position)}</p><p>${e(c.nextAction)}</p></div>`:''}
      <div class="actions">${button('就接着这里','confirm-checkpoint',{primary:true})}${button('改一下位置','edit-checkpoint',{link:true})}${button('稍后','go-home',{link:true})}</div><p class="scope">按下“就接着这里”才确认位置；原来已暂停的本轮会接着进行。</p>${companion('书签不必完全正确，你可以先修正。','rest')}`;
  }
  function tasksView() {
    const t=activeTask(),drafts=state.intentDrafts.filter(d=>d.status!=='confirmed');
    if(t?.caseId&&!ui.allTasks)return cases.outline(t)+`<div class="actions">${button('管理全部任务','show-all-tasks',{link:true})}</div>`;
    const tasks=state.tasks.map((v,i)=>`<div class="task-item${v.id===t?.id?' active':''}"><div class="row start"><div class="grow"><h3>${e(v.title)}</h3><span class="small">${e(selectedStep(v)?.text||'还未选眼前小步')}</span></div><span class="task-status">${e({ready:'待开始',active:'已开始',parked:'暂放',completed:'我已标为完成'}[v.status])}</span></div><div class="actions compact">${v.id===t?.id?'<span class="small">当前任务</span>':button('选为当前','task-select',{link:true,attrs:`data-id="${e(v.id)}"`})}${i?button('上移','task-up',{link:true,attrs:`data-id="${e(v.id)}"`}):''}${i<state.tasks.length-1?button('下移','task-down',{link:true,attrs:`data-id="${e(v.id)}"`}):''}</div></div>`).join('');
    const draftHtml=drafts.map(d=>`<div class="task-item"><p class="step-text">${e(d.intent||d.title||'还没写完的意向')}</p><div class="actions compact">${button('继续整理','open-draft',{link:true,attrs:`data-id="${e(d.id)}"`})}${button('删除意向','delete-draft',{link:true,attrs:`data-id="${e(d.id)}"`})}</div></div>`).join('');
    return `${heading('我的任务','顺序、暂放和完成都由你决定。切换当前任务会先暂停原来的本轮。','已确认的计划')}${errorBox()}${t?.caseId?`<div class="actions">${button('返回当前材料计划','show-current-plan',{link:true})}</div>`:''}
      <div class="split"><div><div class="card"><h2>已确认任务</h2>${tasks||'<p class="muted">还没有确认的任务。先写一句想学的事。</p>'}<div class="actions">${button('新建学习意向','new-guide',{link:true})}</div></div>
      ${detail('intent-drafts',`暂存意向 · ${drafts.length} 份`,draftHtml||'<p class="small">暂时没有。这里的意向不会算作任务。</p>')}</div>
      <div>${t?taskDetail(t):`<div class="card sketch"><h2>从眼前一步开始</h2><p class="muted">一句愿望、一条首步就够了。</p>${button('帮我找个起点','new-guide',{primary:true})}</div>`}</div></div>${companion('这里没有自动排序，也不会替你判断任务完成。')}`;
  }
  function taskDetail(t) {
    const d=draftForTask(t);
    const stepHtml=t.steps.map((v,i)=>`<li class="step-item${v.completed?' done':''}${v.id===t.currentStepId?' current':''}"><span class="step-index">${v.completed?'✓':i+1}</span><div class="grow"><div class="step-text">${e(v.text)}</div>${v.id===t.currentStepId?'<span class="small">眼前一步</span>':''}<div class="actions compact">${button('改写','edit-step',{link:true,attrs:`data-id="${e(v.id)}"`})}${v.completed?button('撤回这步完成','reopen-step',{link:true,attrs:`data-id="${e(v.id)}"`}):`${v.id!==t.currentStepId?button('选为眼前一步','select-step',{link:true,attrs:`data-id="${e(v.id)}"`}):''}${button('我完成了','complete-step',{link:true,attrs:`data-id="${e(v.id)}"`})}`}${i?button('往前','step-up',{link:true,attrs:`data-id="${e(v.id)}"`}):''}${i<t.steps.length-1?button('往后','step-down',{link:true,attrs:`data-id="${e(v.id)}"`}):''}</div></div></li>`).join('');
    const candidates=d?.suggestions?.map((v,i)=>`<div class="candidate"><p>${e(v)}</p>${button('改好后加入','accept-suggestion',{link:true,attrs:`data-index="${i}" data-id="${e(d.id)}"`})}</div>`).join('');
    return `<div class="card sketch"><div class="meta-row"><span class="pill">当前任务</span></div><h2>${e(t.title)}</h2><div class="actions compact">${button('改任务名称','edit-task',{link:true})}${t.status==='completed'||t.status==='parked'?button(t.status==='completed'?'撤回任务完成':'重新取出','reopen-task',{link:true}):button('暂放任务','park-task',{link:true,safe:true})}${t.status!=='completed'?button('我确认任务完成','complete-task',{link:true,safe:true}):''}${button('删除任务','delete-task',{link:true})}</div><hr><h3>已确认的小步</h3><ol class="step-list">${stepHtml||'<li class="muted">还没有小步。</li>'}</ol><div class="actions">${button('添加一条小步','new-step',{primary:true})}</div>${candidates?detail('task-candidates',`未接受候选 · ${d.suggestions.length} 条`,`${candidates}<p class="small">每条都需单独保存，不会自动开始。</p>`):''}</div>`;
  }
  function emptyTask(title) {return `${heading(title,'先有一项你自己的学习任务，就可以回来继续。')}${button('去写学习意向','new-guide',{primary:true})}`;}
  function feedbackView() {
    const t=activeTask();if(!t)return emptyTask('先留一个自己的起点');
    if(t.caseId)return cases.feedback(t);
    const events=state.events.filter(v=>v.taskId===t.id),visible=events.filter(v=>!v.hidden);
    const refs=state.reflections.filter(r=>r.taskId===t.id),latest=refs.at(-1);
    const seed=events.some(v=>v.source==='seed'),sim=events.some(v=>v.source==='simulation');
    return `${heading('回看过程，写自己的理解',t.title,'学习反馈','review')}${errorBox()}
      ${refs.some(r=>r.id===ui.savedReflectionId&&r.taskId===t.id)?'<div class="saved"><span class="mark">✓</span><strong>回顾已保存</strong><span class="small">下一步仍只是意向。</span></div>':''}
      <div class="split wide-left"><div class="card"><h2>过程线索</h2>${seed?'<p class="evidence-note">预置示例记录，非电脑监测结果</p>':''}${sim?'<p class="evidence-note">本轮模拟记录 · 仅来自图解与自测切换</p>':''}
      ${visible.length?`<p class="small">共 ${visible.length} 条可见线索${visible.filter(v=>v.inaccurate).length?`，其中 ${visible.filter(v=>v.inaccurate).length} 条已标为不准确`:''}。这些记录只描述操作，不判断原因或掌握程度。</p><ol class="timeline">${visible.map(eventView).join('')}</ol>`:'<div class="empty"><p>这次没有过程记录，也可以直接写一句自己的理解。</p></div>'}
      ${events.some(v=>v.hidden)?detail('hidden-events',`已隐藏 ${events.filter(v=>v.hidden).length} 条线索`,events.filter(v=>v.hidden).map(v=>`<div class="task-item"><span class="small">${e(v.time)} · ${e(v.observation)}</span><div class="actions compact">${button('恢复显示','show-event',{link:true,attrs:`data-id="${e(v.id)}"`})}${button('删除这条线索','delete-event',{link:true,attrs:`data-id="${e(v.id)}"`})}</div></div>`).join('')):''}</div>
      <div><div class="card sketch"><h2>自己的总结</h2>${latest?savedReflectionView(latest):'<p class="muted">会了什么、哪里还不确定，都可以只写一句。</p>'}<div class="actions">${button(unconfirmedReflectionDraft(t.id)?'继续暂存的回顾':latest?'写一份新回顾':'写一句自己的理解','go-reflection',{primary:true})}</div></div>
      ${refs.length>1?detail('past-reflections',`更早保存的回顾 · ${refs.length-1} 份`,refs.slice(0,-1).reverse().map(r=>`<div class="card reflection-card">${savedReflectionView(r)}</div>`).join('')):''}</div></div>${companion('切回教程可以有很多原因，解释留给你。','review')}`;
  }
  function eventView(v) {
    return `<li class="timeline-item${v.inaccurate?' inaccurate':''}"><div><span class="timeline-time">${e(v.time)}</span><span class="timeline-observation">${e(v.observation)}</span></div><span class="timeline-source">${v.source==='seed'?'预置示例记录，非电脑监测结果':'本轮模拟记录'}${v.inaccurate?' · 已标为不准确':''}</span>${v.explanation?`<p class="timeline-explanation">我的解释：${e(v.explanation)}</p>`:''}
      <details class="plain-details" data-detail="event-${e(v.id)}"><summary data-event-menu="${e(v.id)}">解释或修正这条线索</summary><div class="actions compact">${button('写我的解释','edit-event',{link:true,attrs:`data-id="${e(v.id)}"`})}${button(v.inaccurate?'撤回不准确标记':'标为不准确',v.inaccurate?'accurate-event':'inaccurate-event',{link:true,attrs:`data-id="${e(v.id)}"`})}${button('隐藏这条','hide-event',{link:true,attrs:`data-id="${e(v.id)}"`})}${button('删除这条线索','delete-event',{link:true,attrs:`data-id="${e(v.id)}"`})}</div></details></li>`;
  }
  function savedReflectionView(r) {
    const linked=!!r.nextStepId&&activeTask()?.steps.some(v=>v.id===r.nextStepId);
    return `<div class="reflection-card"><h3>我保存的理解</h3><p class="reflection-text">${e(r.text||'这次没有填写')}</p>${r.uncertainty?`<h3>还不确定</h3><p class="reflection-text">${e(r.uncertainty)}</p>`:''}${r.nextIntent?`<h3>下一步意向 · ${linked?'已由我另行加入计划':'还未加入计划'}</h3><p class="reflection-text">${e(r.nextIntent)}</p>${linked?'<p class="small">已作为小步保存，未自动开始新轮。</p>':`<div class="actions compact">${button('把这条下一步加入计划','reflection-to-step',{link:true,attrs:`data-id="${e(r.id)}"`})}</div>`}`:''}<p class="small">${r.evidenceMissing?'部分来源已隐藏、标为不准确或删除；自己的文字仍保留。':`${r.evidenceIds?.length||0} 条来源线索 · 理解由我自己填写`}</p><div class="actions compact">${button('修改这份回顾','edit-reflection',{link:true,attrs:`data-id="${e(r.id)}"`})}</div></div>`;
  }
  function pendingReflections(taskId) {
    return [state.reflectionDrafts[taskId],...(state.reflectionDraftArchive||[])].filter(d=>{
      if(!d||d.taskId!==taskId||!d.text&&!d.uncertainty&&!d.nextIntent&&!d.proposal)return false;const saved=state.reflections.find(r=>r.id===d.id);
      return !saved||d.proposal||['text','uncertainty','nextIntent','phase'].some(k=>(d[k]||'')!==(saved[k]||''));
    });
  }
  function unconfirmedReflectionDraft(taskId) {
    const roundId=latestRound(taskId)?.id||null;
    return pendingReflections(taskId).find(d=>(d.roundId||null)===roundId)||null;
  }
  function earlierDraftsView(taskId) {
    const roundId=latestRound(taskId)?.id||null,old=pendingReflections(taskId).filter(d=>(d.roundId||null)!==roundId);
    return old.length?detail('earlier-drafts',`早前尚未确认的回顾 · ${old.length} 份`,old.map(d=>`<div class="card"><span class="pill">早前${d.phase==='stage'?'阶段自检':'结束复盘'} · 尚未确认</span><p class="reflection-text">${e(d.text||d.uncertainty||d.nextIntent||'一份尚未写完的草稿')}</p>${button('继续这份早前草稿','edit-reflection-draft',{link:true,attrs:`data-id="${e(d.id)}"`})}</div>`).join('')):'';
  }
  function ensureReflection() {
    const t=activeTask();if(!t)return null;
    const roundId=latestRound(t.id)?.id||null;
    if(ui.reflection?.taskId===t.id&&(ui.reflection.historyEdit||(ui.reflection.roundId||null)===roundId))return ui.reflection;
    const d=unconfirmedReflectionDraft(t.id);
    const phase=unfinished(t.id)?'stage':'end';
    ui.reflection=d?{...d,phase,proposal:d.phase===phase?d.proposal:null,rev:0,savedRev:d.phase===phase?0:-1}:{id:null,taskId:t.id,roundId,text:'',uncertainty:'',nextIntent:'',phase,proposal:null,contextGoal:t.title,contextAction:selectedStep(t)?.text||'',contextSuccessCheck:t.successCheck||'',rev:0,savedRev:-1};
    ui.proposalDismissed=false;return ui.reflection;
  }
  function reflectionView() {
    if(activeTask()?.caseId)return cases.review(activeTask());
    const d=ensureReflection();if(!d)return emptyTask('先留一个自己的起点');
    const p=d.proposal&&!ui.proposalDismissed?d.proposal:null;
    const failed=ui.error?.action==='reflection.save';
    const t=activeTask(),stage=d.phase==='stage';
    return `${heading(stage?'停一下，看看自己懂到哪里':'回看这一轮，留下自己的判断',stage?'先用自己的话解释一句；没想清楚也可以直接说。':'对照原来的目标，留下收获和还没解决的问题。','阶段自检 / 结束复盘','review')}${errorBox()}
      ${d.historyEdit?`<p class="scope">正在修改早前的一份回顾，归属于原来的学习轮次。</p><div class="actions compact">${button('回到本轮自检','current-reflection',{link:true})}</div>`:''}
      <div class="self-check"><p><strong>这次想弄清：</strong>${e(d.contextGoal||t.title)}</p><p class="small">如何检验：${e(d.contextSuccessCheck??(t.successCheck||'合上材料，用自己的话解释，再找例子核对。'))}</p>${stage?'<p class="small">当前是阶段自检，不会替你结束学习。</p>':''}</div>
      ${field('不看材料，我现在能解释什么？','reflection-text','reflection','text',d.text,{textarea:true,rows:3,placeholder:'只写一句即可。说不清楚的地方，也可以如实写下。'})}
      <div class="split">${field('哪里还不确定 · 可不填','reflection-uncertainty','reflection','uncertainty',d.uncertainty,{textarea:true,rows:2,max:2000})}${field('下一步意向 · 还未加入计划','reflection-next','reflection','nextIntent',d.nextIntent,{textarea:true,rows:2,max:1000})}</div>
      <div class="actions compact">${button('给我一个自检问题','self-question',{link:true})}</div>
      ${ui.question?`<div class="self-check"><p>${e(t.materialMode==='external'?`不看材料，你能否用一个例子说明“${t.title}”？哪里还解释不清？`:'先不看图解：普通全局变量和线程栈分别属于谁？为什么两个线程需要各自的栈？')}</p><div class="actions compact">${button(ui.selfTest?'我再自己试试':'我来自己试试','self-test')}${button('先不用这个问题','hide-question',{link:true})}</div>${ui.selfTest?'<p class="small">先自己解释，再回到材料核对。结果由你自己写，不会自动判为已掌握。</p>':''}</div>`:''}
      <div class="actions compact">${button(stage?'请 DeepSeek 帮我自检':'请 DeepSeek 帮我复盘','ai-review')}</div><p class="small">可以只请它给一个问题；整理后的文字仍要自己核对。</p>
      ${detail('reflection-help','离线整理示例 · 不调用模型',`<p class="small">仅复制你已写的内容，供课堂展示采用或拒绝的流程。</p><label class="checkline"><input id="bad-proposal" type="checkbox" ${ui.badProposal?'checked':''}>演示一条不合适的候选</label><div class="actions compact">${button('帮我整理','suggest-reflection')}</div>`)}
      ${p?`<div class="candidate"><span class="pill">整理候选 · 尚未确认</span><p class="small">${e(p.source)}</p><p class="reflection-text">${e(p.text||'尚无自己的理解，先试试下面的问题。')}</p>${p.uncertainty?`<p class="small">还不确定：${e(p.uncertainty)}</p>`:''}${p.question?`<div class="review-question"><h3>先自己试着回答</h3><p>${e(p.question)}</p>${p.adjustment?`<p class="small">可选办法：${e(p.adjustment)}</p>`:''}</div>`:''}<p class="reflection-text">下一步建议：${e(p.nextIntent||'仍由你来定')}</p><div class="actions compact">${button('可不用','reject-proposal',{link:true})}${button('我来改','revise-proposal',{link:true})}${button('采用候选','accept-proposal')}</div></div>`:''}
      <div class="actions">${button(failed?'重试保存回顾':'只保存回顾','save-reflection',{primary:true})}${button('这次跳过','skip-reflection',{link:true})}</div><p class="scope">保存回顾不会把下一步加入计划，也不会替你结束或开始一轮。</p><div id="draft-state" class="draft-state">${draftStatus(d)}</div>`;
  }
  function preferencesView() {
    const p=state.prefs;
    return `${heading('由我决定怎样辅助','AI 辅助、记录和邀请分别设置。','设置')}${errorBox()}${ai.settingsView(ordinaryLocked())}
      ${state.runtime.pendingSave?`<div class="error"><p>停止已生效，还有一项停止状态待保存。</p><div class="actions compact">${button('重试保存停止状态','retry-persistence',{safe:true})}</div></div>`:''}
      <div class="card"><h2>本地模拟记录</h2><div class="setting"><label class="checkline"><input type="checkbox" id="pref-recording" data-pref="recording" ${p.recording?'checked':''}>允许本地模拟记录</label><p class="setting-help">只记录本轮在这里切换图解与自测的操作。不会监测其他电脑活动。</p>${p.recording?`<div class="actions compact">${button(p.recordingPaused?'继续模拟记录':'暂停模拟记录','toggle-recording-pause',{safe:!p.recordingPaused,link:true})}${button('关闭模拟记录','stop-recording',{safe:true,link:true})}</div>`:''}</div><p class="small">关闭或暂停记录不会暂停学习，也不影响自己写回顾。已保存的历史线索仍可查看、修正或删除。</p></div>
      <div class="card"><h2>主动邀请</h2><div class="setting"><label class="checkline"><input type="checkbox" id="pref-invitations" data-pref="invitations" ${p.invitations?'checked':''}>允许主动邀请</label><p class="setting-help">只在你允许的学习节点轻轻问一次；稍后或拒绝后，同一节点不再追问。</p><div class="node-settings">${[['resume','接续时'],['stage','阶段自检时'],['end','结束时']].map(([key,label])=>`<label class="checkline"><input type="checkbox" id="node-${key}" data-node="${key}" ${p.nodes[key]?'checked':''}>${label}</label>`).join('')}</div></div><div class="setting"><label class="checkline"><input type="checkbox" id="pref-quiet" data-pref="quiet" ${p.quiet?'checked':''}>安静学习</label><p class="setting-help">暂时不出现主动邀请。当前轮次和记录许可都保留。</p></div></div>
      ${detail('classroom-tools','课堂演示工具 · 按需展开',`<p class="small">载入情境会替换本原型的学习内容，并恢复记录与邀请默认关闭；不会改变电脑上的其他文件。</p><div class="tools-grid">${button('载入启动情境','load-startup')}${button('载入接续情境','load-resume')}${button('载入回顾情境','load-reflection')}</div><div class="tool-row"><h3>模拟一次节点</h3><p class="small">仍遵守许可、安静学习、当前轮次和同节点只问一次的规则。</p><div class="tools-grid">${button('模拟阶段邀请','node-stage')}${button('模拟接续邀请','node-resume')}${button('模拟结束邀请','node-end')}</div></div><div class="tool-row"><h3>演示保存失败与修复</h3><div class="tool-actions"><label for="failure-kind">下一次关键保存</label><select id="failure-kind"><option value="plan">确认计划</option><option value="round">开始／保存轮次</option><option value="reflection">保存回顾</option><option value="edit">保存编辑</option><option value="any">任意关键保存</option></select>${button('设置一次保存失败','fail-next')}</div><p class="small">先设置，再回到对应页面保存。暂存文字不会消耗这次模拟失败。</p></div><div class="tool-row"><h3>演示材料打不开</h3><p class="small">让当前任务的材料暂时不可用，再核对接续位置，体验替换材料或自行找到材料。</p>${button('让当前材料暂时不可用','material-unavailable')}</div>`)}${companion('不想被打扰，就按自己的节奏安静学。','rest')}`;
  }
  function draftStatus(d) {return d.rev===d.savedRev?'文字已暂存；还没有替你确认。':'修改会暂存，确认范围仍由你决定。';}

  function editorView() {
    const x=ui.editor,t=state.tasks.find(v=>v.id===x.taskId);
    const titles={task:'改任务名称',step:x.fromReflectionId?'把自己的下一步加入计划':x.fromDraftId?'接受一条候选小步':x.stepId?'改写这条小步':'添加一条小步',checkpoint:'改一下接续位置',material:'更换学习材料',event:'写下我的解释'};
    const labels={task:'保存名称',step:'保存小步',checkpoint:'用这个位置',material:'保存材料',event:'保存解释'};
    let fields='';
    if(x.kind==='task')fields=field('任务名称','editor-title','editor','title',x.title,{max:1000})+field('如何检验 · 可不填','editor-task-check','editor','successCheck',x.successCheck,{max:1000});
    if(x.kind==='step')fields=`${x.fromReflectionId?'<p class="small">来自你保存的下一步意向。请再确认一次小步文字。</p>':''}${x.fromDraftId?'<p class="small">这是一条尚未接受的建议，保存后才会加入正式小步。</p>':''}${field('小步内容','editor-step','editor','text',x.text,{textarea:true,rows:3,max:1000})}${field('这一步如何自检 · 可不填','editor-step-check','editor','check',x.check,{max:1000})}<p class="scope">只保存这一条小步；不会自动选中、开始新轮或完成任务。</p>`;
    if(x.kind==='checkpoint')fields=`<label>原来确认的位置</label><div class="readonly">${e(t?.checkpoint?.position||t?.material.position)}\n${e(t?.checkpoint?.nextAction||selectedStep(t)?.text||'')}</div><hr>${field('新的位置候选','editor-position','editor','position',x.position,{max:1000})}${field('接着做什么','editor-next-action','editor','nextAction',x.nextAction,{textarea:true,rows:3,max:1000})}<p class="scope">这里只更新接续预览。回到预览按“就接着这里”才覆盖旧位置。</p>`;
    if(x.kind==='material')fields=`${t?.materialMode==='external'?'<p class="small">填写自己打开的资料名称和位置。这里只保留书签，不读取文件。</p>':`<div class="field"><label for="editor-material">选择本地演示材料</label><select id="editor-material" data-model="editor" data-field="materialId"><option value="practice"${x.materialId==='practice'?' selected':''}>进程与线程图解</option><option value="tutorial"${x.materialId==='tutorial'?' selected':''}>资源分类自测</option></select></div>`}${field('材料名称','editor-material-label','editor','label',x.label,{max:200})}${field('打开后的参考位置','editor-material-position','editor','position',x.position,{max:1000})}<p class="scope">只替换本任务的材料引用。修复材料后可继续原来的暂停轮次。</p>`;
    if(x.kind==='event')fields=`<label>原始线索 · 只读</label><div class="readonly">${e(x.time)} · ${e(x.observation)}</div><p class="small">${x.source==='seed'?'预置示例记录，非电脑监测结果':'本轮模拟记录'}</p>${field('我的解释','editor-explanation','editor','explanation',x.explanation,{textarea:true,rows:4})}<p class="scope">只保存自己的解释，不改变原始线索。</p>`;
    const label=x.failed?`重试${labels[x.kind]}`:labels[x.kind];
    return `<div class="scrim drawer-scrim"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="editor-heading"><div class="drawer-head"><h2 id="editor-heading">${e(titles[x.kind])}</h2>${button('×','stash-editor',{link:true,attrs:'aria-label="暂存并收起编辑"'})}</div><div class="drawer-body">${errorBox()}${fields}</div><div class="drawer-foot"><div class="actions">${button(label,'save-editor',{primary:true,attrs:'id="editor-save"'})}${button('先暂存收起','stash-editor',{link:true})}${button('取消','cancel-editor',{link:true,attrs:'id="editor-cancel"'})}</div></div></section></div>`;
  }
  function modalView() {
    const m=ui.modal;
    return `<div class="scrim"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading"><h2 id="modal-heading">${e(m.title)}</h2><p class="muted">${e(m.message)}</p>${m.items?.length?`<ul>${m.items.map(v=>`<li>${e(v)}</li>`).join('')}</ul>`:''}${m.error?`<div class="error" role="alert">${e(m.error)}</div>`:''}<div class="actions">${button(m.cancelLabel||'取消','cancel-modal',{attrs:'id="modal-cancel"'})}${m.secondaryLabel?button(m.secondaryLabel,'secondary-modal',{attrs:'id="modal-secondary"'}):''}${button(m.confirmLabel||'确认删除','confirm-modal',{primary:true,attrs:'id="modal-confirm"'})}</div></section></div>`;
  }
  function showNotice(message) {ui.notice=message;renderChrome();}
  function fail(message,action='',code='INVALID_INPUT') {ui.error={message,action,code};render();return {ok:false,error:message,code};}
  async function execute(action,payload={},options={}) {
    const critical=options.critical!==false;
    if(critical){ui.busy++;if(!options.keepError)ui.error=null;render();}
    let result;
    try {
      result=await api.dispatch(action,payload);
      if(result.state)state=result.state;
      if(!result.ok)ui.error={message:result.error||'还没保存，可以重试。',action,code:result.code};
      else if(!options.keepError)ui.error=null;
    } catch(error) {result={ok:false,error:'暂时没有收到保存回执，输入仍在这里。请重试。',code:'SAVE_FAILED'};ui.error={message:result.error,action,code:result.code};}
    finally {if(critical)ui.busy--;render();drainTransition();}
    return result;
  }
  function setContext() {
    if(!state)return;
    api.dispatch('view.context',{view:ui.editor||ui.modal?'editor':ui.view==='case'&&cases.isReview()?'reflection':ui.view}).then(result=>{if(result.state)state=result.state;}).catch(()=>{});
  }
  function drainTransition() {
    if(!ui.busy&&!ui.flowBusy&&!ui.closing&&ui.queuedNavigation){const work=ui.queuedNavigation;ui.queuedNavigation=null;queueMicrotask(()=>work());}
  }
  function setView(target,{resetScroll=true}={}) {
    ui.view=['home','guide','plan','study','resume','tasks','feedback','reflection','preferences','case'].includes(target)?target:'home';
    if(ui.view==='reflection'&&!activeTask()?.caseId)ensureReflection();
    if(ui.view==='reflection'&&activeTask()?.caseId)cases.prepareReview();
    if(ui.view==='guide'||ui.view==='plan')ensureStartup();
    if(ui.view==='study'&&activeTask())ui.materialTab=activeTask().material.id;
    render();if(resetScroll)main.scrollTop=0;setContext();
  }
  function scheduleDraft() {
    clearTimeout(ui.draftTimer);
    ui.draftTimer=setTimeout(()=>{flushDrafts().catch(()=>{});},650);
  }
  async function saveStartup() {
    const d=ui.startup;if(!d||d.status==='confirmed'||d.savedRev===d.rev&&d.id)return true;
    const rev=d.rev;
    const result=await execute('draft.startup',{...(d.id?{draftId:d.id}:{newDraft:true}),intent:d.intent,scope:d.scope,title:d.title,firstStep:d.firstStep,priorKnowledge:d.priorKnowledge||'',difficulty:d.difficulty||'',successCheck:d.successCheck||'',firstCheck:d.firstCheck||'',materialMode:d.materialMode||'os-example',status:d.status},{critical:false,keepError:true});
    if(!result.ok)return false;
    const saved=result.state.intentDrafts.find(v=>v.id===result.state.startupDraftId);
    if(saved&&ui.startup===d){d.id=saved.id;d.savedRev=rev;d.suggestions=[...(saved.suggestions||[])];}
    render();return true;
  }
  async function saveReflectionDraft() {
    const d=ui.reflection;if(!d||d.savedRev===d.rev&&d.id)return true;
    const rev=d.rev;
    const result=await execute('reflection.draft',{taskId:d.taskId,...(d.id?{id:d.id}:{newDraft:true}),text:d.text,uncertainty:d.uncertainty,nextIntent:d.nextIntent,phase:d.phase,roundId:d.roundId??null},{critical:false,keepError:true});
    if(!result.ok)return false;
    const saved=result.state.reflectionDrafts[d.taskId];
    if(saved&&ui.reflection===d){d.id=saved.id;d.savedRev=rev;d.proposal=saved.proposal;}
    render();return true;
  }
  function editorMode(x) {return x.kind==='event'?'explanation':x.kind;}
  async function saveEditorDraft() {
    const x=ui.editor;
    if(!x||!x.dirty||x.savedRev===x.rev&&x.persisted)return true;
    const fields={};
    const keys={task:['title','successCheck'],step:['text','check','stepId','fromReflectionId','fromDraftId','acceptedSuggestion'],checkpoint:['position','nextAction'],material:['materialId','label','position','resumeAfter'],event:['explanation']}[x.kind]||[];
    for(const key of keys)if(x[key]!==undefined)fields[key]=x[key];
    const rev=x.rev;
    const result=await execute('editor.draft',{mode:editorMode(x),taskId:x.taskId,targetId:x.kind==='event'?x.id:x.stepId,fields,returnView:x.returnView||ui.view},{critical:false,keepError:true});
    if(!result.ok)return false;
    if(ui.editor===x){x.savedRev=rev;x.persisted=true;}render();return true;
  }
  async function flushDrafts() {
    clearTimeout(ui.draftTimer);
    if(ui.draftPromise){const ok=await ui.draftPromise;if(!ok)return false;}
    const work=(async()=>{if(!await cases.flush())return false;if(!await saveStartup())return false;if(!await saveReflectionDraft())return false;if(!await saveEditorDraft())return false;return true;})();
    ui.draftPromise=work;
    try{return await work;}finally{if(ui.draftPromise===work)ui.draftPromise=null;}
  }
  function discardLocalDrafts() {
    clearTimeout(ui.draftTimer);cases.discard();ui.startup=null;ui.reflection=null;ui.editor=null;ui.resume=null;ui.error=null;
  }
  function openModal(config) {ui.modal=config;render();setContext();document.querySelector('#modal-cancel')?.focus({preventScroll:true});}
  function closeModal() {ui.modal=null;render();setContext();}
  function failedTransition(continueAction) {
    openModal({title:'文字还没暂存',message:'保存没有成功。继续编辑可以保留这里的输入；放弃后将回到原来已保存的版本。',items:['尚未保存的原话、候选、回顾或编辑文字会被放弃。','原来确认的任务和回顾仍保留。'],cancelLabel:'继续编辑',confirmLabel:'放弃未保存修改',confirm:async()=>{discardLocalDrafts();closeModal();await continueAction(true);}});
  }
  async function navigate(target,options={}) {
    if(!state){ui.pendingTarget=target;return;}
    if(ui.closing)return;
    ai.cancel('页面已切换，尚未返回的 AI 请求已取消。');ai.closePreview();
    cases.cancel();
    if(ui.busy||ui.flowBusy&&!options.fromAction){ui.queuedNavigation=()=>navigate(target,options);return;}
    const finish=()=>{ui.error=null;ui.modal=null;ui.editor=null;setView(target);};
    if(!options.discard&&!await flushDrafts()){failedTransition(()=>{finish();});return;}
    finish();
  }
  async function closeRequested(options={}) {
    const reason=options.reason==='quit'?'quit':'panel';
    if(ui.closing)return;
    ai.cancel();ai.closePreview();
    cases.cancel();
    if(ui.busy||ui.flowBusy){ui.queuedNavigation=()=>closeRequested(options);return;}
    // Native close does not arrive through a button action. Hold the same edit
    // lock across draft flushing AND the close acknowledgement, so text cannot
    // change after the snapshot that will survive the window being destroyed.
    ui.closing=true;render();
    try {
      if(!options.discard&&!await flushDrafts()){ui.closing=false;failedTransition(()=>closeRequested({reason,discard:true}));return;}
      const result=await api.closeReady({reason,discard:!!options.discard});
      if(result.state)state=result.state;
      if(!result.ok){ui.closing=false;openModal({title:'还有一项状态没保存',message:result.error||'关闭前保存没有成功。停止状态已生效，可以重试。',cancelLabel:'继续编辑',confirmLabel:'重试关闭',secondaryLabel:'仍然关闭',secondary:async()=>{closeModal();await closeRequested({reason,discard:true});},confirm:async()=>{closeModal();await closeRequested({reason});}});}
    }catch{ui.closing=false;failedTransition(()=>closeRequested({reason,discard:true}));}
    // A successful acknowledgement precedes native window destruction. Keep
    // the lock during that interval; each failure path above releases it.
    finally{render();}
  }
  function openEditor(config) {
    const old=state.editorDraft;
    if(old&&!config.persisted) {
      const mode=config.kind==='event'?'explanation':config.kind;
      const sameTarget=old.taskId===(config.taskId||activeTask()?.id)&&old.mode===mode&&
        (old.targetId||'')===(config.kind==='event'?config.id:config.stepId||'')&&
        (mode!=='step'||['fromReflectionId','fromDraftId','acceptedSuggestion'].every(key=>(old.fields[key]||'')===(config[key]||'')));
      if(sameTarget){resumeStoredEditor().catch(()=>fail('暂存编辑暂时没能打开，文字仍保留。'));return;}
      openModal({title:'已有一份暂存编辑',message:'共用编辑区里还有一份尚未确认的文字。继续编辑可以保留它，或明确放弃后再打开新的编辑。',cancelLabel:'保留旧编辑',secondaryLabel:'继续上次编辑',confirmLabel:'放弃旧编辑并打开',secondary:async()=>{closeModal();await resumeStoredEditor();},confirm:async()=>{const result=await execute('editor.clear');if(result.ok){closeModal();openEditor(config);}else{ui.modal.error=result.error;render();}}});return;
    }
    ui.error=null;ui.editor={taskId:activeTask()?.id,dirty:false,failed:false,rev:0,savedRev:0,persisted:false,returnView:ui.view,...config};
    render();setContext();document.querySelector('.drawer input,.drawer textarea,.drawer select')?.focus({preventScroll:true});
  }
  async function resumeStoredEditor() {
    const d=state.editorDraft;if(!d)return;
    if(d.taskId!==activeTask()?.id){const result=await execute('task.select',{taskId:d.taskId});if(!result.ok)return;}
    setView(d.returnView||'tasks');
    const config={kind:d.mode==='explanation'?'event':d.mode,taskId:d.taskId,...d.fields,dirty:true,persisted:true,returnView:d.returnView};
    if(d.mode==='step'&&d.targetId)config.stepId=d.targetId;
    if(d.mode==='explanation'){const v=state.events.find(v=>v.id===d.targetId);if(!v){fail('这条线索已经不在了，可以从反馈页重新选择。');return;}Object.assign(config,v,{explanation:d.fields.explanation});}
    openEditor(config);
  }
  async function cancelEditor() {
    if(ui.editor?.dirty){openModal({title:'放弃这次编辑？',message:'这次编辑及其暂存文字会被放弃；原来确认的内容仍保留。',cancelLabel:'继续编辑',confirmLabel:'放弃修改',confirm:async()=>{clearTimeout(ui.draftTimer);if(ui.draftPromise)await ui.draftPromise;const result=ui.editor?.persisted?await execute('editor.clear',{}, {critical:false}):{ok:true};if(result.ok){ui.editor=null;ui.error=null;closeModal();}else{ui.modal.error=result.error;render();}}});return;}
    ui.editor=null;ui.error=null;render();setContext();
  }
  async function saveEditor() {
    const x=ui.editor;if(!x)return true;
    if(!await flushDrafts()){x.failed=true;render();return false;}
    if(x.kind==='checkpoint') {
      if(!x.position.trim()||!x.nextAction.trim()){fail('写下一个位置和接着要做的事即可。');x.failed=true;return false;}
      x.dirty=true;x.rev++;if(!await saveEditorDraft()){x.failed=true;render();return false;}
      ui.resume={taskId:x.taskId,position:x.position.trim(),nextAction:x.nextAction.trim(),changed:true};
      ui.editor=null;ui.error=null;setView('resume',{resetScroll:false});return true;
    }
    let action,payload;
    if(x.kind==='task'){action='task.save';payload={taskId:x.taskId,title:x.title,successCheck:x.successCheck||''};}
    if(x.kind==='step'){action='step.save';payload={taskId:x.taskId,text:x.text,check:x.check||'',...(x.stepId?{stepId:x.stepId}:{}),...(x.fromReflectionId?{fromReflectionId:x.fromReflectionId}:{}),...(x.fromDraftId?{fromDraftId:x.fromDraftId,acceptedSuggestion:x.acceptedSuggestion}:{})};}
    if(x.kind==='material'){action='material.replace';payload={taskId:x.taskId,id:x.materialId,label:x.label,position:x.position,available:true};}
    if(x.kind==='event'){action='event.explain';payload={id:x.id,explanation:x.explanation};}
    const result=await execute(action,payload);
    if(!result.ok){x.failed=true;render();return false;}
    ui.editor=null;render();setContext();
    showNotice(x.kind==='step'?'小步已保存；没有自动开始新轮。':x.kind==='task'?'任务名称已保存。':x.kind==='event'?'自己的解释已保存。':'材料已替换。');
    if(x.kind==='material'&&x.resumeAfter)await startRound();
    return true;
  }
  async function newStartup(direct=false) {
    if(!await flushDrafts()){failedTransition(()=>newStartup(direct));return;}
    ui.startup={id:null,intent:direct?'':'想复习操作系统的进程和线程，但总分不清',scope:'resources',title:'',firstStep:'',priorKnowledge:'',difficulty:'',successCheck:'',firstCheck:'',materialMode:'external',suggestions:[],status:direct?'candidate':'intent',rev:0,savedRev:-1};
    ui.error=null;setView(direct?'plan':'guide');scheduleDraft();
  }
  async function suggestStartup(scope) {
    const d=ensureStartup();d.scope=scope;d.rev++;
    if(!await flushDrafts())return;
    const result=await execute('draft.suggest',{draftId:d.id,intent:d.intent,scope});
    if(result.ok){const saved=result.state.intentDrafts.find(v=>v.id===d.id);Object.assign(d,saved,{rev:0,savedRev:0});setView('plan');}
  }
  async function refineStartup(kind) {
    if(ai.ready())return requestAIPlan(kind);
    const d=ensureStartup();if(!await flushDrafts())return;
    if(d.materialMode==='external'){showNotice('可以直接改写首步；配置 DeepSeek 后，也能请它再拆小。');document.querySelector('#plan-step')?.focus();return;}
    const result=await execute('draft.refine',{draftId:d.id,kind});
    if(result.ok){const saved=result.state.intentDrafts.find(v=>v.id===d.id);Object.assign(d,saved,{rev:0,savedRev:0});render();}
  }
  async function confirmPlan() {
    const d=ensureStartup();if(!await flushDrafts())return;
    const result=await execute('plan.confirm',{draftId:d.id,title:d.title,firstStep:d.firstStep});
    if(!result.ok)return;
    ui.startup=null;ui.found=false;ui.resume=null;setView('study');
    await startRound();
  }
  async function startRound(manualReady=false) {
    const t=activeTask();if(!t)return;
    ui.materialTab=t.material.id;
    window.OSLearningMaterial.restore({taskId:t.id,tab:ui.materialTab,position:t.checkpoint?.position||t.material.position});
    if(ui.view!=='study')setView('study');
    // The local material is part of this renderer, so it is ready only after
    // its frame is present. An unavailable reference is checked by the engine.
    if(!manualReady&&t.material.available&&!main.querySelector('.material-shell'))return fail('材料还没有准备好，请重试。','round.start','MATERIAL_UNAVAILABLE');
    await execute('round.start',{taskId:t.id,...(manualReady?{manualReady:true}:{})});
  }
  async function saveReflection() {
    const d=ensureReflection();if(!d||!await flushDrafts())return;
    const result=await execute('reflection.save',{taskId:d.taskId,id:d.id,text:d.text,uncertainty:d.uncertainty,nextIntent:d.nextIntent,phase:d.phase,roundId:d.roundId??null});
    if(result.ok){d.savedRev=d.rev;d.proposal=null;ui.savedReflectionId=d.id;ui.reflection=null;setView('feedback');}
  }
  async function suggestReflection() {
    const d=ensureReflection();if(!d||!await flushDrafts())return;
    const result=await execute('reflection.suggest',{taskId:d.taskId,id:d.id,text:d.text,uncertainty:d.uncertainty,nextIntent:d.nextIntent,bad:ui.badProposal});
    if(result.ok){d.proposal=result.state.reflectionDrafts[d.taskId].proposal;ui.proposalDismissed=false;render();}
  }
  async function requestAIPlan(variant='start') {
    const d=ensureStartup();if(!d.intent.trim())return fail('先用一句话说说自己想学什么。');
    if(!await flushDrafts())return;
    const expected=Object.fromEntries(['intent','title','firstStep','priorKnowledge','difficulty','successCheck','materialMode'].map(k=>[k,d[k]||''])),rev=d.rev;
    const valid=()=>!ui.closing&&ui.startup===d&&d.rev===rev&&['guide','plan'].includes(ui.view)&&d.status!=='confirmed';
    ai.open({kind:'plan',context:{intent:d.intent,priorKnowledge:d.priorKnowledge||'',difficulty:d.difficulty||'',goal:d.title,action:d.firstStep,successCheck:d.successCheck||'',materialMode:d.materialMode||'os-example',variant},valid,apply:async response=>{
      if(!await flushDrafts()||!valid())return;
      const result=await execute('draft.aiCandidate',{draftId:d.id,expected,result:response.result,source:{...response.source,requestId:response.requestId}});
      if(result.ok&&valid()){Object.assign(d,result.state.intentDrafts.find(v=>v.id===d.id),{rev:0,savedRev:0});setView('plan');showNotice('DeepSeek 建议已放入候选，确认前不会成为正式任务。');}
    }});
  }
  async function requestAIReview() {
    const d=ensureReflection(),t=activeTask();if(!d||!await flushDrafts())return;
    const expected={text:d.text,uncertainty:d.uncertainty,nextIntent:d.nextIntent,phase:d.phase},rev=d.rev,stepId=t.currentStepId,goal=t.title,check=t.successCheck;
    const valid=()=>!ui.closing&&ui.reflection===d&&d.rev===rev&&ui.view==='reflection'&&activeTask()?.id===t.id&&activeTask()?.title===goal&&activeTask()?.currentStepId===stepId&&activeTask()?.successCheck===check;
    ai.open({kind:'review',taskId:t.id,reflectionId:d.id,context:{phase:d.phase,goal:d.contextGoal||t.title,action:d.contextAction??(selectedStep(t)?.text||''),successCheck:d.contextSuccessCheck??(t.successCheck||''),selfReport:d.text,uncertainty:d.uncertainty,nextIntent:d.nextIntent},evidence:state.events.filter(v=>v.taskId===t.id&&v.roundId===d.roundId&&!v.hidden&&!v.inaccurate),valid,apply:async response=>{
      if(!await flushDrafts()||!valid())return;
      const result=await execute('reflection.aiCandidate',{taskId:d.taskId,id:d.id,expected,result:response.result,source:{...response.source,requestId:response.requestId}});
      if(result.ok&&valid()){d.proposal=result.state.reflectionDrafts[d.taskId].proposal;ui.proposalDismissed=false;render();showNotice('整理候选已就绪。先自己回答问题，再决定要不要采用。');document.querySelector('.candidate')?.scrollIntoView({block:'nearest'});}
    }});
  }
  function confirmDeletion(kind,id) {
    if(kind==='task'){
      const t=state.tasks.find(v=>v.id===id),count=key=>state[key].filter(v=>v.taskId===id).length;
      openModal({title:'删除这项任务？',message:t.title,items:[`${t.steps.length} 条已确认小步及检查点`,`关联的 ${count('rounds')} 轮学习、${count('events')} 条过程线索、${count('reflections')} 份回顾`,'关联的意向与回顾草稿也会删除，无法在本原型中恢复。'],confirm:async()=>{const result=await execute('task.delete',{taskId:id});if(result.ok){ui.reflection=null;ui.resume=null;closeModal();showNotice('这项任务与关联学习内容已删除。');}else{ui.modal.error=result.error;render();}}});
    }
    if(kind==='event'){
      const event=state.events.find(v=>v.id===id);
      openModal({title:'删除这条过程线索？',message:`${event.time} · ${event.observation}`,items:['这条线索及其解释会删除。','已保存回顾中的来源引用会移除；你自己的回顾文字仍保留。'],confirm:async()=>{const result=await execute('event.delete',{id});if(result.ok){closeModal();showNotice('线索已删除，自己的回顾文字保留。');}else{ui.modal.error=result.error;render();}}});
    }
    if(kind==='draft'){
      const d=state.intentDrafts.find(v=>v.id===id);
      openModal({title:'删除这份暂存意向？',message:d.intent||d.title||'还没写完的意向',items:['仅删除这份未确认意向，不改变已确认任务。'],confirm:async()=>{const result=await execute('draft.delete',{draftId:id});if(result.ok){if(ui.startup?.id===id)ui.startup=null;closeModal();}else{ui.modal.error=result.error;render();}}});
    }
  }
  function loadScenario(scenario) {
    openModal({title:'载入课堂演示情境？',message:'将替换本原型中现有的全部学习内容，并关闭模拟记录与主动邀请。',items:['现有任务、小步、轮次、过程线索与回顾会被替换。','暂存意向和未保存的编辑也会被替换；此操作无法撤销。'],confirmLabel:'确认载入',confirm:async()=>{const result=await execute('demo.load',{scenario});if(result.ok){discardLocalDrafts();ui.savedReflectionId=null;ui.proposalDismissed=false;ui.found=false;ui.modal=null;showNotice('演示情境已载入。记录与邀请均已关闭。');setView(scenario==='reflection'?'feedback':'home');}else{ui.modal.error=result.error;render();}}});
  }
  async function handle(action,el) {
    const t=activeTask(),id=el.dataset.id;
    if((ui.busy||ui.closing)&&!el.hasAttribute('data-stop'))return;
    if(await cases.handle(action,el))return;
    if(action==='ai-go-settings'){ai.closePreview();await navigate('preferences',{fromAction:true});return;}
    if(await ai.handle(action))return;
    if(['task-select','delete-task','load-startup','load-resume','load-reflection','pause-round','end-round','confirm-plan','save-reflection','complete-current-step','complete-task'].includes(action))ai.cancel();
    if(action.startsWith('os-')&&t&&window.OSLearningMaterial.handle(action,el,t.id)){render();return;}
    const routes={'go-home':'home','go-guide':'guide','go-study':'study','go-resume':'resume','go-tasks':'tasks','go-feedback':'feedback','go-reflection':'reflection'};
    if(routes[action]){if(action==='go-reflection'&&ui.reflection?.historyEdit){if(!await flushDrafts())return;ui.reflection=null;}await navigate(routes[action],{fromAction:true});return;}
    switch(action) {
      case 'show-all-tasks':if(await flushDrafts()){ui.allTasks=true;setView('tasks');}break;
      case 'show-current-plan':ui.allTasks=false;setView('tasks');break;
      case 'notice-dismiss':ui.notice='';renderChrome();break;
      case 'new-guide':await newStartup();break;
      case 'new-direct':await newStartup(true);break;
      case 'ai-plan':await requestAIPlan();break;
      case 'ai-review':await requestAIReview();break;
      case 'direct-plan':{const d=ensureStartup();d.status='candidate';d.rev++;await navigate('plan');break;}
      case 'suggest-resources':await suggestStartup('resources');break;
      case 'suggest-concepts':await suggestStartup('concepts');break;
      case 'refine-smaller':await refineStartup('smaller');break;
      case 'refine-other':await refineStartup('other');break;
      case 'focus-first-step':document.querySelector('#plan-step')?.focus();break;
      case 'save-intent':if(await flushDrafts()){ui.startup=null;showNotice('意向已暂存，还没有创建任务或开始本轮。');setView('home');}break;
      case 'confirm-plan':await confirmPlan();break;
      case 'start-current':await startRound();break;
      case 'manual-ready':await startRound(true);break;
      case 'material-practice':case 'material-tutorial':{const material=action==='material-practice'?'practice':'tutorial';if(ui.materialTab!==material){ui.materialTab=material;render();await execute('demo.event',{material},{critical:false,keepError:true});}break;}
      case 'pause-round':{const result=await execute('round.pause',{taskId:t?.id,materialId:ui.materialTab,position:materialPosition(t)});if(result.ok){ui.resume=null;setView('home');showNotice('本轮已暂停，位置和下一步已留下。');}break;}
      case 'end-round':{const result=await execute('round.end',{taskId:t?.id,materialId:ui.materialTab,position:materialPosition(t)});if(result.ok){ui.resume=null;if(ui.reflection?.historyEdit)ui.reflection=null;const d=ensureReflection();if(d.phase!=='end'){d.phase='end';d.proposal=null;d.rev++;scheduleDraft();}setView('reflection');showNotice('这一轮已结束。可以留一句自己的理解，也可以跳过。');}break;}
      case 'complete-current-step':{const result=await execute('step.complete',{taskId:t.id});if(result.ok)showNotice('这一小步已由你标为完成；任务还没有被标为完成。');break;}
      case 'confirm-checkpoint':{const c=ensureResume(t);const result=await execute('checkpoint.confirm',{taskId:t.id,position:c.position,nextAction:c.nextAction});if(result.ok){c.changed=false;setView('study');await startRound();}break;}
      case 'edit-checkpoint':{const c=ensureResume(t);openEditor({kind:'checkpoint',position:c.position,nextAction:c.nextAction});break;}
      case 'edit-material':openEditor({kind:'material',materialId:t.material.id,label:t.material.label,position:t.material.position,resumeAfter:!t.material.available||ui.error?.code==='MATERIAL_UNAVAILABLE'});break;
      case 'edit-task':openEditor({kind:'task',title:t.title,successCheck:t.successCheck||''});break;
      case 'edit-step':{const v=t.steps.find(v=>v.id===id);openEditor({kind:'step',stepId:id,text:v.text,check:v.check||''});break;}
      case 'new-step':openEditor({kind:'step',text:''});break;
      case 'accept-suggestion':{const d=state.intentDrafts.find(v=>v.id===id),text=d.suggestions[Number(el.dataset.index)];openEditor({kind:'step',text,check:d.suggestionChecks?.[text]||'',fromDraftId:d.id,acceptedSuggestion:text});break;}
      case 'reflection-to-step':{const r=state.reflections.find(v=>v.id===id);openEditor({kind:'step',text:r.nextIntent,fromReflectionId:r.id});break;}
      case 'edit-event':{const v=state.events.find(v=>v.id===id);openEditor({kind:'event',...v});break;}
      case 'save-editor':await saveEditor();break;
      case 'stash-editor':if(await flushDrafts()){ui.editor=null;ui.error=null;render();setContext();showNotice('编辑文字已暂存，还没有改动正式内容。');}else failedTransition(()=>{ui.editor=null;render();setContext();});break;
      case 'resume-editor':await resumeStoredEditor();break;
      case 'cancel-editor':await cancelEditor();break;
      case 'task-select':{if(!await flushDrafts())break;const result=await execute('task.select',{taskId:id});if(result.ok){ui.reflection=null;ui.resume=null;showNotice('当前任务已切换，还没有自动开始。');}break;}
      case 'task-up':case 'task-down':await execute('task.move',{taskId:id,direction:action==='task-up'?'up':'down'});break;
      case 'step-up':case 'step-down':await execute('step.move',{taskId:t.id,stepId:id,direction:action==='step-up'?'up':'down'});break;
      case 'select-step':await execute('step.select',{taskId:t.id,stepId:id});break;
      case 'complete-step':await execute('step.complete',{taskId:t.id,stepId:id});break;
      case 'reopen-step':await execute('step.reopen',{taskId:t.id,stepId:id});break;
      case 'park-task':await execute('task.park',{taskId:t.id});break;
      case 'complete-task':await execute('task.complete',{taskId:t.id});break;
      case 'reopen-task':await execute('task.reopen',{taskId:t.id});break;
      case 'delete-task':confirmDeletion('task',t.id);break;
      case 'delete-event':confirmDeletion('event',id);break;
      case 'delete-draft':confirmDeletion('draft',id);break;
      case 'open-draft':{if(!await flushDrafts())break;const d=state.intentDrafts.find(v=>v.id===id);ui.startup={...d,rev:0,savedRev:0};ui.error=null;setView(d.status==='candidate'?'plan':'guide');break;}
      case 'hide-event':case 'show-event':await execute('event.mark',{id,hidden:action==='hide-event'});break;
      case 'inaccurate-event':case 'accurate-event':await execute('event.mark',{id,inaccurate:action==='inaccurate-event'});break;
      case 'self-question':ui.question=true;render();break;
      case 'hide-question':ui.question=false;render();break;
      case 'self-test':ui.selfTest=true;render();break;
      case 'suggest-reflection':await suggestReflection();break;
      case 'reject-proposal':ui.proposalDismissed=true;render();break;
      case 'revise-proposal':ui.proposalDismissed=true;render();document.querySelector('#reflection-next')?.focus();break;
      case 'accept-proposal':{const d=ensureReflection(),p=d.proposal;if(p){for(const key of ['text','uncertainty','nextIntent'])d[key]=p[key]||'';d.rev++;ui.proposalDismissed=true;render();scheduleDraft();}break;}
      case 'save-reflection':await saveReflection();break;
      case 'skip-reflection':ui.savedReflectionId=null;await navigate('feedback');break;
      case 'edit-reflection':case 'edit-reflection-draft':{if(!await flushDrafts())break;const d=action==='edit-reflection'?state.reflections.find(v=>v.id===id):pendingReflections(t.id).find(v=>v.id===id);if(!d)break;ui.reflection={...d,historyEdit:true,proposal:null,rev:0,savedRev:-1};ui.proposalDismissed=false;ui.savedReflectionId=null;setView('reflection');break;}
      case 'current-reflection':if(await flushDrafts()){ui.reflection=null;setView('reflection');}break;
      case 'stop-recording':await execute('prefs.update',{recording:false});break;
      case 'toggle-recording-pause':await execute('prefs.update',{recordingPaused:!state.prefs.recordingPaused});break;
      case 'retry-persistence':await execute('persistence.retry');break;
      case 'invite-accept':case 'invite-later':case 'invite-reject':await execute('invitation.respond',{response:action.slice(7)});break;
      case 'load-startup':case 'load-resume':case 'load-reflection':loadScenario(action.slice(5));break;
      case 'node-stage':case 'node-resume':case 'node-end':{const result=await execute('demo.node',{node:action.slice(5)});if(result.ok&&result.data?.suppressed)showNotice('未出现邀请：可能尚未许可、正在安静学习、当前轮次不在此节点、同节点已问过，或正在编辑。');else if(result.ok)showNotice('已模拟当前节点；你可以自己决定要不要回应。');break;}
      case 'fail-next':{const kind=document.querySelector('#failure-kind').value;const result=await execute('demo.failNext',{kind});if(result.ok)showNotice('已设置：下一次对应的关键保存会失败一次，之后可在原处重试。');break;}
      case 'material-unavailable':if(!t){showNotice('先载入一个含任务的情境，再演示材料失效。');break;}if((await execute('material.replace',{taskId:t.id,id:t.material.id,label:t.material.label,position:t.material.position,available:false})).ok)showNotice('当前材料已设为暂时不可用。可回到开始，核对后继续。');break;
      case 'cancel-modal':closeModal();break;
      case 'confirm-modal':if(ui.modal?.confirm)await ui.modal.confirm();break;
      case 'secondary-modal':if(ui.modal?.secondary)await ui.modal.secondary();break;
    }
  }
  const runningActions=new Set();
  document.addEventListener('click',event=>{
    const nav=event.target.closest('[data-nav]');
    if(nav){navigate(nav.dataset.nav).catch(()=>fail('页面暂时没能切换，输入仍保留。'));return;}
    const el=event.target.closest('[data-action]');
    if(!el||el.disabled)return;
    const action=el.dataset.action;if(runningActions.has(action))return;
    if((ui.flowBusy||ui.closing)&&!el.hasAttribute('data-stop'))return;
    runningActions.add(action);
    ui.flowBusy++;
    const work=handle(action,el);render();
    work.catch(error=>fail('这次操作没有完成，输入仍保留。可以重试。',action)).finally(()=>{
      runningActions.delete(action);ui.flowBusy--;render();
      if(ui.modal&&!overlay.contains(document.activeElement))document.querySelector('#modal-cancel')?.focus({preventScroll:true});
      drainTransition();
    });
  });
  document.addEventListener('input',event=>{
    const el=event.target,model=el.dataset.model,key=el.dataset.field;
    if(cases.input(el))return;
    if(ai.input(el))return;
    if(!model||!key)return;
    const d=ui[model];if(!d)return;
    if(ui.closing){el.value=d[key]??'';return;}
    d[key]=el.value;
    d.rev++;
    const staleProposal=model==='reflection'&&d.proposal;
    if(staleProposal){d.proposal=null;ui.proposalDismissed=true;}
    ai.cancel('原稿已修改，本次 AI 请求已取消。可根据新内容重新请求。');
    if(staleProposal)render();
    if(model==='editor'){d.dirty=true;scheduleDraft();return;}
    scheduleDraft();
    const status=document.querySelector('#draft-state');if(status)status.textContent=draftStatus(d);
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.dataset.caseStart||el.dataset.casePrerequisite){cases.change(el).catch(()=>fail('这次选择尚未保存，可以重试。'));return;}
    if(ai.input(el))return;
    if(el.id==='use-built-in'){const d=ensureStartup();if(ordinaryLocked()){el.checked=d.materialMode==='os-example';return;}ai.cancel();d.materialMode=el.checked?'os-example':'external';d.rev++;scheduleDraft();return;}
    if(el.id==='bad-proposal'){if(ui.closing){el.checked=ui.badProposal;return;}ui.badProposal=el.checked;return;}
    if(el.dataset.pref){
      const key=el.dataset.pref,value=el.checked;
      // STOP choices go straight to IPC even while another save is pending.
      const stop=(key==='recording'||key==='invitations')?!value:key==='quiet'?value:false;
      if(ordinaryLocked()&&!stop){el.checked=state.prefs[key];return;}
      execute('prefs.update',{[key]:value}).catch(()=>{});return;
    }
    if(el.dataset.node){const value=el.checked;if(ordinaryLocked()&&value){el.checked=state.prefs.nodes[el.dataset.node];return;}execute('prefs.update',{nodes:{[el.dataset.node]:value}}).catch(()=>{});return;}
    if(el.dataset.model==='editor'&&el.dataset.field){
      if(ui.closing){el.value=ui.editor?.[el.dataset.field]??'';return;}
      ui.editor[el.dataset.field]=el.value;ui.editor.dirty=true;ui.editor.rev++;scheduleDraft();
      if(el.dataset.field==='materialId'){
        ui.editor.label=el.value==='tutorial'?'资源分类自测':'进程与线程图解';
        ui.editor.position=el.value==='tutorial'?'第2题／线程的调用栈':'双线程示意图／共享区';render();
      }
    }
  });
  document.addEventListener('toggle',event=>{const el=event.target;if(!el.dataset?.detail)return;if(el.open)ui.details.add(el.dataset.detail);else ui.details.delete(el.dataset.detail);},true);
  document.addEventListener('keydown',event=>{
    const dialog=document.querySelector('[role="dialog"]');
    if(!dialog)return;
    if(event.key==='Escape'){event.preventDefault();if(ordinaryLocked())return;if(ui.modal)closeModal();else if(ai.hasPreview())ai.closePreview();else cancelEditor();return;}
    if(event.key==='Tab'){
      const focusable=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary')];
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}
    }
  });
  if(!api){main.innerHTML='<div class="error">学习面板暂时没有连接成功。请重新从 StudyPet 打开。</div>';return;}
  ai.init();
  api.onState(next=>{
    state=next;render();
    drainTransition();
  });
  api.onNavigate(target=>navigate(target).catch(()=>fail('页面暂时没能切换，输入仍保留。')));
  api.onCloseRequested(options=>closeRequested(options).catch(()=>fail('关闭前还没能保存，输入仍保留。')));
  api.getState().then(result=>{
    if(result.state){state=result.state;setView(ui.pendingTarget||ui.view);ui.pendingTarget=null;}
    else main.innerHTML='<div class="error">暂时没能打开学习内容，请重新打开面板。</div>';
  }).catch(()=>{main.innerHTML='<div class="error">暂时没能打开学习内容，请重新打开面板。</div>';});
})();
