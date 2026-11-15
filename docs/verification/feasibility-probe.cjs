/*
 * Feasibility checks against the unmodified upstream application.
 * No real API key, desktop screenshot, or personal application data is used.
 * Requires the project's dependencies and Playwright (set NODE_PATH if needed).
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.cache/verification');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const dataDir = path.join(output, 'runs', runId, 'user-data');
fs.mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), scope: 'Unmodified upstream substrate; proposed study features are not implemented', checks: [], runtime: null };
const requests = [];
let app;
let mockServer;

async function check(id, run) {
  const started = Date.now();
  try {
    const detail = await run();
    report.checks.push({ id, status: 'PASS', elapsedMs: Date.now() - started, detail });
    console.log(id + ': PASS');
    return detail;
  } catch (error) {
    report.checks.push({ id, status: 'FAIL', elapsedMs: Date.now() - started, error: error.message });
    console.log(id + ': FAIL: ' + error.message);
    return null;
  }
}

async function launch() {
  const env = { ...process.env, STUDYPET_PROBE_DATA: dataDir, NO_PROXY: '127.0.0.1,localhost', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, 'launch-probe.cjs')],
    cwd: root,
    env,
    timeout: 30000,
  });
  app.process().stdout?.on('data', chunk => fs.appendFileSync(path.join(output, 'app.stdout.log'), chunk));
  app.process().stderr?.on('data', chunk => fs.appendFileSync(path.join(output, 'app.stderr.log'), chunk));
  return app.firstWindow({ timeout: 20000 });
}

async function main() {
  mockServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      requests.push({ model: body.model, hasImage: JSON.stringify(body.messages).includes('image_url'), stream: body.stream === true });
      const failure = JSON.stringify(body.messages).includes('probe-force-503');
      res.writeHead(failure ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(failure ? { error: { message: 'probe-server-unavailable' } } : { choices: [{ message: { role: 'assistant', content: 'probe-ok' } }] }));
    });
  });
  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = mockServer.address().port;
  const pet = await launch();
  await pet.waitForLoadState('domcontentloaded');

  await check('V01-startup', async () => {
    const result = await app.evaluate(({ app, BrowserWindow }) => ({
      electron: process.versions.electron,
      embeddedNode: process.versions.node,
      userData: app.getPath('userData'),
      windowCount: BrowserWindow.getAllWindows().length,
    }));
    assert.equal(result.electron, '28.3.3');
    assert.equal(path.resolve(result.userData), path.resolve(dataDir));
    assert.ok(result.windowCount >= 1);
    report.runtime = result;
    return result;
  });

  await check('V02-pet-render-and-preload', async () => {
    const result = await pet.evaluate(async () => {
      const image = document.querySelector('#custom-pet-image');
      if (!image.complete) await new Promise(resolve => { image.onload = resolve; image.onerror = resolve; });
      return { bridge: typeof window.electronAPI?.storeGet, imageWidth: image.naturalWidth, title: document.title };
    });
    assert.equal(result.bridge, 'function');
    assert.ok(result.imageWidth > 0);
    await pet.screenshot({ path: path.join(output, 'baseline-pet.png') });
    return result;
  });

  const [chat] = await Promise.all([
    app.waitForEvent('window', { timeout: 15000 }),
    pet.evaluate(() => window.electronAPI.openChat()),
  ]);
  await chat.waitForLoadState('domcontentloaded');
  const [settings] = await Promise.all([
    app.waitForEvent('window', { timeout: 15000 }),
    pet.evaluate(() => window.electronAPI.openSettings()),
  ]);
  await settings.waitForLoadState('domcontentloaded');

  await check('V03-chat-settings-windows', async () => {
    const result = { chat: await chat.title(), settings: await settings.title(), count: app.windows().length };
    assert.equal(result.count, 3);
    assert.ok(chat.url().endsWith('/renderer/chat.html'));
    assert.ok(settings.url().endsWith('/renderer/settings.html'));
    assert.ok(await chat.locator('textarea').count() > 0);
    assert.ok(await settings.locator('input').count() > 0);
    await chat.screenshot({ path: path.join(output, 'baseline-chat.png') });
    return result;
  });

  await check('V04-ipc-store-roundtrip', async () => {
    const payload = { goal: 'Probe only', nextStep: 'Resume one example', revision: 1 };
    const actual = await pet.evaluate(async value => {
      await window.electronAPI.storeSet('_feasibility_probe', value);
      return window.electronAPI.storeGet('_feasibility_probe');
    }, payload);
    assert.deepEqual(actual, payload);
    return { readMatchesWrite: true };
  });

  await check('V05-no-key-handled', async () => {
    const result = await chat.evaluate(() => window.electronAPI.sendMessage([{ role: 'user', content: 'probe-no-key' }]));
    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.equal(requests.length, 0);
    return { success: result.success, errorPresent: true, networkRequests: requests.length };
  });

  await check('V06-mock-openai-compatible-ipc', async () => {
    const cfg = await chat.evaluate(async portNumber => {
      const c = await window.electronAPI.addApiConfig({ name: 'Local verification mock', provider: 'custom', apiUrl: `http://127.0.0.1:${portNumber}/v1/chat/completions`, apiKey: 'probe-not-a-real-key', selectedModel: 'probe-model' });
      await window.electronAPI.setActiveConfig(c.id);
      return { id: c.id };
    }, port);
    const result = await chat.evaluate(() => window.electronAPI.sendMessage([{ role: 'user', content: 'probe-basic-chat' }]));
    assert.equal(result.success, true);
    assert.equal(result.content, 'probe-ok');
    assert.ok(cfg.id);
    return { result: result.content, requestCount: requests.length, realProviderTested: false };
  });

  await check('V07-mock-provider-failure', async () => {
    const result = await chat.evaluate(() => window.electronAPI.sendMessage([{ role: 'user', content: 'probe-force-503' }]));
    assert.equal(result.success, false);
    assert.ok(result.error);
    return { failureReturnedToRenderer: true };
  });

  await check('V08-synthetic-image-transport', async () => {
    // A generated 1x1 PNG, not a desktop screenshot.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlmsAAAAASUVORK5CYII=';
    const result = await app.evaluate(async (_electron, image) => {
      const p = global.__studyPetProbe;
      return p.api.callOpenAICompatibleWithVision([{ role: 'user', content: 'probe-synthetic-image' }], image, p.store.getActiveConfig());
    }, png);
    assert.equal(result.success, true);
    assert.equal(requests.at(-1).hasImage, true);
    return { imageInRequest: true, realScreenCaptured: false, realVisionQualityTested: false };
  });

  await check('V09-safestorage-availability', async () => {
    const result = await app.evaluate(({ safeStorage }) => {
      const available = safeStorage.isEncryptionAvailable();
      if (!available) return { available, roundtrip: false };
      const token = 'probe-secret-only';
      return { available, roundtrip: safeStorage.decryptString(safeStorage.encryptString(token)) === token };
    });
    assert.equal(result.available, true);
    assert.equal(result.roundtrip, true);
    return result;
  });

  await check('V11-history-edit-integrity', async () => {
    const result = await chat.evaluate(async () => {
      await loadConfigs();
      conversationHistory = [{ question: 'A', answer: 'a' }, { question: 'B', answer: 'b' }];
      apiMessages = [{ role: 'user', content: 'A' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'B' }, { role: 'assistant', content: 'b' }];
      messagesContainer.replaceChildren();
      addMessage('user', 'A', null, null, 0);
      addMessage('assistant', 'a');
      addMessage('user', 'B', null, null, 1);
      addMessage('assistant', 'b');
      openEditModal('A', 0);
      editInput.value = 'A edited';
      await handleEditConfirm();
      return { questions: conversationHistory.map(x => x.question), visibleUsers: [...messagesContainer.querySelectorAll('.message.user .message-content')].map(x => x.textContent) };
    });
    report.editProbe = result;
    assert.deepEqual(result.questions, ['A edited'], 'Editing first turn must discard both old turns');
    assert.deepEqual(result.visibleUsers, ['A edited'], 'Visible messages must match stored conversation');
    return result;
  });

  await app.close();
  const petAgain = await launch();
  await petAgain.waitForLoadState('domcontentloaded');
  await check('V10-persistence-after-restart', async () => {
    const result = await petAgain.evaluate(async () => {
      const saved = await window.electronAPI.storeGet('_feasibility_probe');
      await window.electronAPI.storeDelete('_feasibility_probe');
      return saved;
    });
    assert.equal(result.goal, 'Probe only');
    assert.equal(result.revision, 1);
    return { preservedAfterProcessRestart: true };
  });
  report.mockRequests = requests;
}

main().catch(error => {
  report.fatal = { message: error.message, stack: error.stack };
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (app) { try { await app.close(); } catch {} }
  if (mockServer) await new Promise(resolve => mockServer.close(resolve));
  report.completedAt = new Date().toISOString();
  report.summary = { pass: report.checks.filter(c => c.status === 'PASS').length, fail: report.checks.filter(c => c.status === 'FAIL').length, fatal: Boolean(report.fatal) };
  fs.writeFileSync(path.join(output, 'feasibility-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary));
  if (report.summary.fail) process.exitCode = 1;
});
