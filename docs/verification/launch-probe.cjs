// Diagnostic launcher only. It does not alter the product entry point.
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

if (!process.env.STUDYPET_PROBE_DATA) throw new Error('STUDYPET_PROBE_DATA is required');
const dataDir = path.resolve(process.env.STUDYPET_PROBE_DATA);
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'chromium'), { recursive: true });
app.setAppPath(path.resolve(__dirname, '../..'));
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'chromium'));
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.setSkipTaskbar(true);
});

require('../../main.js');
global.__studyPetProbe = {
  store: require('../../store.js'),
  api: require('../../api-service.js'),
};
