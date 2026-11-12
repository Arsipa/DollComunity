'use strict';
/**
 * Проверка интерфейса в настоящем окне программы: во всех полях ввода на всех экранах
 * нажатие клавиши не должно отменяться (иначе в поле нельзя печатать).
 * Запуск: npm run test:ui
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vkd-ui-'));
spawnSync(process.execPath, [path.join(__dirname, 'make-demo.js'), root, '30'], { stdio: 'ignore' });

// внутри шагов нельзя использовать «;» — это разделитель шагов
const CHECK =
  "console.error('error KEYTEST '+document.querySelector('.view.active').id+(document.querySelector('.overlay,.drawer')?'+окно':'')+': '+" +
  "[...document.querySelectorAll('input:not([type=checkbox]):not([type=date]):not([type=datetime-local]),textarea')].filter(el=>el.getClientRects().length)" +
  ".map(el=>(ev=>(el.dispatchEvent(ev),(el.id||el.placeholder||el.tagName).slice(0,24)+(ev.defaultPrevented?' — ЗАБЛОКИРОВАНО':' ok')))" +
  "(new KeyboardEvent('keydown',{key:'а',bubbles:true,cancelable:true}))).join(' | '))";
const go = (v) => `document.querySelector('[data-view=${v}]').click()`;
const steps = [
  `lib::${CHECK}`,
  `src::${go('sources')}`,
  `src2::${CHECK}`,
  `set::${go('settings')}`,
  `set2::${CHECK}`,
  `users::${go('users')}`,
  `users2::${CHECK}`,
  `stats::${go('stats')}`,
  `stats2::${CHECK}`,
  `edit::${go('library')},setTimeout(()=>document.querySelector('.card [data-edit]').click(),300)`,
  `edit2::${CHECK}`,
  `likers::document.querySelector('.overlay').remove(),document.querySelector('.card [data-likes]').click()`,
  `likers2::${CHECK}`,
];

const electron = require('electron'); // путь к electron.exe
const r = spawnSync(electron, [path.join(__dirname, '..')], {
  env: { ...process.env, VKD_TEST_ROOT: root, VKD_SHOTS: path.join(root, 'shots'), VKD_SCRIPT: steps.join(';') },
  encoding: 'utf8',
  timeout: 120000,
});
const out = `${r.stdout}\n${r.stderr}`;
const lines = out.split('\n').filter((l) => l.includes('KEYTEST')).map((l) => l.slice(l.indexOf('KEYTEST') + 8));
fs.rmSync(root, { recursive: true, force: true });
lines.forEach((l) => console.log(l));
const blocked = lines.filter((l) => l.includes('ЗАБЛОКИРОВАНО'));
if (lines.length < 7) {
  console.log(`\n✘ проверено экранов: ${lines.length} из 7 — интерфейс не загрузился или сценарий сломался`);
  process.exit(1);
}
if (blocked.length) {
  console.log('\n✘ есть поля, в которых нельзя печатать');
  process.exit(1);
}
console.log('\n✔ во всех полях можно печатать');
