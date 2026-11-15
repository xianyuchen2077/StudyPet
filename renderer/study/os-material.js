/* Offline exercise choices are temporary window state, never persisted mastery. */
(function () {
  'use strict';
  const tasks = new Map();
  const choices = { shared: '同进程线程共享', own: '每个线程各自维护', unsure: '我还不确定' };
  const diagramPositions = {
    initial: '双线程示意图／先找全局变量区',
    shared: '双线程示意图／共享区',
    stack: '双线程示意图／各自的栈'
  };
  const questions = [
    { title: '普通全局变量 counter 属于共享还是各自独立？', answer: 'shared', position: '第1题／普通全局变量',
      why: 'counter 位于进程的数据区，同一进程内的线程访问的是同一个变量。并发修改时可能需要同步。' },
    { title: '线程的调用栈属于共享还是各自维护？', answer: 'own', position: '第2题／线程的调用栈',
      why: '调用栈记录每个线程的函数调用、局部自动变量等执行状态，所以由各线程维护。每线程有自己的栈，并不等于地址空间隔离。' }
  ];
  function state(taskId) {
    if (!tasks.has(taskId)) tasks.set(taskId, { focus: 'initial', sharedSeen: false, detail: false, question: 0, answers: [null, null], explained: [false, false], disabled: false });
    return tasks.get(taskId);
  }
  function escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function button(action, label, s, attributes = '') {
    return `<button type="button" data-action="${escape(action)}"${s.disabled ? ' disabled' : ''}${attributes}>${escape(label)}</button>`;
  }
  const reference = '<p class="os-reference">知识点参考：Linux man-pages pthreads(7) · POSIX / Linux 常见模型</p>';

  function diagram(s) {
    const explanation = s.focus === 'shared'
      ? '<strong>一起使用同一份资源</strong><p>counter 位于进程的数据区；两个线程访问的是同一个普通全局变量。代码、堆内存和打开的文件描述符表也由同进程线程共享。</p>'
      : s.focus === 'stack'
        ? '<strong>各自保留执行现场</strong><p>每个线程各自记录函数调用、局部自动变量和执行位置，所以需要自己的栈与寄存器上下文。</p>'
        : '<p>先找找 counter 在哪里，再看看两个线程各自带着什么。</p>';
    const thread = name => `<div class="os-thread${s.focus === 'stack' ? ' os-emphasis' : ''}"><h4>${escape(name)}</h4><p class="os-stack">自己的栈</p><p class="os-registers">执行位置 / 寄存器上下文</p></div>`;
    return `<section class="os-material os-diagram" aria-label="进程与线程图解">
      <h3>一个进程，两个线程</h3>
      <div class="os-process" aria-label="同一进程的资源边界">
        <span class="os-process-label">同一进程</span>
        <div class="os-shared${s.focus === 'shared' ? ' os-emphasis' : ''}">
          <h4>共享区 · 两个线程都使用</h4>
          <div class="os-resources"><div>代码 / 数据<br><strong>普通全局变量 <code>counter</code></strong></div><div>堆内存</div><div>打开的<br>文件描述符表</div></div>
        </div>
        <div class="os-threads">${thread('线程 A')}${thread('线程 B')}</div>
      </div>
      <p class="os-takeaway">共用的是进程资源；各自维护的是执行现场。</p>
      <div class="os-actions">${button('os-show-shared', '先看共享区', s, ` class="os-first" aria-pressed="${s.focus === 'shared'}"`)}${s.sharedSeen ? button('os-show-stack', '看看各自的栈', s, ` aria-pressed="${s.focus === 'stack'}"`) : ''}</div>
      <div class="os-explanation" role="status">${explanation}</div>
      <div class="os-detail">${button('os-toggle-detail', '地址空间的小提醒', s, ` aria-expanded="${s.detail}"`)}${s.detail ? '<p>每线程有自己的调用栈，但仍在同一进程地址空间中；不表示其他线程拿到地址后绝对不能访问。</p>' : ''}</div>
      ${reference}
    </section>`;
  }

  function tutorial(s) {
    const index = s.question;
    const question = questions[index];
    const answer = s.answers[index];
    const shown = s.explained[index];
    const feedback = answer === question.answer ? '这次分类符合这个知识点。' : answer === 'unsure' ? '先看看解释，再按自己的理解改选。' : '可以再想一想，也可以看过解释后改选。';
    return `<section class="os-material os-quiz" aria-label="资源分类自测">
      <p class="os-question-count">第 ${index + 1} / 2 题 · 一次只想一个问题</p>
      <h3>${escape(question.title)}</h3>
      <div class="os-choices" role="group" aria-label="选择资源归属">${Object.keys(choices).map(key => button('os-answer', choices[key], s, ` data-answer="${escape(key)}" aria-pressed="${answer === key}"`)).join('')}</div>
      <p class="os-choice-status" role="status">${answer ? `你的选择：${escape(choices[answer])} · 可以直接改选` : '还没有选择，按你的理解试试。'}</p>
      <div class="os-actions">${button('os-explain', '查看解释', { disabled: s.disabled || !answer }, ` aria-expanded="${shown}"`)}</div>
      ${shown ? `<div class="os-explanation" role="status"><p class="os-feedback">${escape(feedback)}</p><strong>正确答案：${escape(choices[question.answer])}</strong><p>${escape(question.why)}</p></div>` : ''}
      <div class="os-question-nav">${button('os-prev', '上一题', { disabled: s.disabled || index === 0 })}<span>第 ${index + 1} / 2 题</span>${button('os-next', '下一题', { disabled: s.disabled || index === 1 })}</div>
      <p class="os-reflect">不看图解，尝试解释为什么线程需要各自的栈。</p>
      <p class="os-temporary">练习选择仅在当前窗口暂留，学习任务是否完成由你确认。</p>
      ${reference}
    </section>`;
  }

  function render({ taskId, tab = 'practice', disabled = false }) {
    const s = state(taskId);
    s.disabled = Boolean(disabled);
    return tab === 'tutorial' ? tutorial(s) : diagram(s);
  }
  function handle(action, element, taskId) {
    if (!['os-show-shared', 'os-show-stack', 'os-toggle-detail', 'os-answer', 'os-explain', 'os-prev', 'os-next'].includes(action)) return false;
    const s = state(taskId);
    if (s.disabled || element?.disabled) return true;
    if (action === 'os-show-shared') { s.focus = s.focus === 'shared' ? 'initial' : 'shared'; s.sharedSeen = true; }
    if (action === 'os-show-stack' && s.sharedSeen) s.focus = s.focus === 'stack' ? 'shared' : 'stack';
    if (action === 'os-toggle-detail') s.detail = !s.detail;
    if (action === 'os-answer') {
      const answer = element?.dataset?.answer;
      if (!Object.prototype.hasOwnProperty.call(choices, answer)) return false;
      if (s.answers[s.question] !== answer) { s.answers[s.question] = answer; s.explained[s.question] = false; }
    }
    if (action === 'os-explain' && s.answers[s.question]) s.explained[s.question] = true;
    if (action === 'os-prev') s.question = Math.max(0, s.question - 1);
    if (action === 'os-next') s.question = Math.min(questions.length - 1, s.question + 1);
    return true;
  }
  function position({ taskId, tab = 'practice' }) {
    const s = state(taskId);
    return tab === 'tutorial' ? questions[s.question].position : diagramPositions[s.focus];
  }
  function restore({ taskId, tab = 'practice', position: saved }) {
    const s = state(taskId);
    if (tab === 'tutorial') {
      const index = questions.findIndex(question => question.position === saved);
      if (index >= 0) s.question = index;
    } else {
      const focus = Object.keys(diagramPositions).find(key => diagramPositions[key] === saved);
      if (focus) { s.focus = focus; s.sharedSeen = focus !== 'initial'; }
    }
  }
  window.OSLearningMaterial = { render, handle, position, restore };
})();
