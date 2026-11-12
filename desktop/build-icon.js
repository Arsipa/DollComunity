'use strict';
// Рисует значок приложения (build/icon.png, src/assets/icon.png). Запуск: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2a9bf"/><stop offset="1" stop-color="#a995e0"/></linearGradient></defs>
<rect x="16" y="16" width="480" height="480" rx="120" fill="url(#g)"/>
<rect x="40" y="40" width="432" height="432" rx="100" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="6" stroke-dasharray="18 14"/>
<g fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" transform="translate(256 236) scale(15) translate(-12 -12)">
<path d="M12 11.5c-2.2-3.4-6.6-6-8.2-4.4-1.6 1.6-.6 7.2 2.3 7.8 2.4.5 4.6-1.7 5.9-3.4z" stroke-width="1.5"/>
<path d="M12 11.5c2.2-3.4 6.6-6 8.2-4.4 1.6 1.6.6 7.2-2.3 7.8-2.4.5-4.6-1.7-5.9-3.4z" stroke-width="1.5"/>
<circle cx="12" cy="11.8" r="1.8" fill="#fff" stroke-width="1.2"/>
<path d="M10.8 13.3L8 20M13.2 13.3L16 20" stroke-width="1.5"/>
</g></svg>`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${SVG}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const png = img.resize({ width: 512, height: 512 }).toPNG();
  for (const out of [path.join(__dirname, '..', 'build', 'icon.png'), path.join(__dirname, '..', 'src', 'assets', 'icon.png')]) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);
  }
  console.log('icon ok');
  app.quit();
});
