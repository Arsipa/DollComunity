// Точка входа интерфейса: навигация, обновление данных, приветствие.
import { S, setData, reload, onState } from './state.js';
import { icon, esc, $, $$, html, num, pl, ago, modal, toast, toastError } from './util.js';
import { renderLibrary, renderGrid, hidePopover } from './library.js';
import { renderStats } from './stats.js';
import { renderUsers } from './people.js';
import { renderSources } from './sources.js';
import { renderSettings } from './settings.js';
import { renderTrash } from './trash.js';
import { startTour } from './tour.js';

const VIEWS = [
  { id: 'library', label: 'Библиотека', icon: 'library', render: renderLibrary, count: () => S.posts.length },
  { id: 'stats', label: 'Статистика', icon: 'stats', render: renderStats },
  { id: 'users', label: 'Пользователи', icon: 'users', render: renderUsers, count: () => Object.keys(S.users).length },
  { id: 'sources', label: 'Источники', icon: 'sources', render: renderSources, count: () => S.settings.sources.length },
  { id: 'trash', label: 'Корзина', icon: 'trash', render: renderTrash, count: () => S.deleted.filter((d) => d.post).length },
  { id: 'settings', label: 'Настройки', icon: 'settings', render: renderSettings },
];
let current = 'library';

export function go(id) {
  current = id;
  hidePopover();
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${id}`));
  renderNav();
  VIEWS.find((v) => v.id === id).render();
}

function renderNav() {
  $('#nav').innerHTML = VIEWS.map((v) => {
    const c = v.count ? v.count() : 0;
    return `<button class="nav-item ${v.id === current ? 'active' : ''}" data-view="${v.id}" title="${v.label}">${icon(v.icon)}<span>${v.label}</span>${c ? `<span class="count">${c > 9999 ? Math.round(c / 1000) + 'k' : num(c)}</span>` : ''}</button>`;
  }).join('');
  $$('#nav [data-view]').forEach((b) => (b.onclick = () => go(b.dataset.view)));
  const acc = S.account;
  $('#side-status').innerHTML = `${acc.connected ? `<span class="dot ok"></span><b>${esc(acc.info?.name || 'ВКонтакте подключён')}</b>` : '<span class="dot off"></span><b>ВКонтакте не подключён</b>'}<br>${S.history.last_sync ? `Обновлено ${ago(S.history.last_sync)}` : 'Данные ещё не обновлялись'}`;
}

function rerender() {
  renderNav();
  VIEWS.find((v) => v.id === current).render();
}

// ---------- обновление данных ----------
let progress = null;
export async function startSync(opts) {
  if (!S.account.connected) {
    toast('Сначала подключите ВКонтакте в настройках', { error: true, action: 'Открыть настройки', onAction: () => go('settings') });
    return;
  }
  if (!S.settings.sources.length) {
    toast('Добавьте хотя бы один источник', { error: true, action: 'Добавить', onAction: () => go('sources') });
    return;
  }
  try {
    const r = await window.api.syncStart(opts);
    S.syncing = true;
    if (current === 'library') {
      const b = $('#lib-sync');
      if (b) {
        b.disabled = true;
        b.innerHTML = `${icon('refresh', 'spin')}<span>Обновляю…</span>`;
      }
    }
    drawDock({ phaseLabel: r.already ? 'Обновление уже идёт' : 'Подготовка…', done: 0, total: 0, checked: 0, created: 0, conflicts: 0, errors: 0 });
  } catch (e) {
    toastError(e);
  }
}

function drawDock(p) {
  progress = p;
  const dock = $('#sync-dock');
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  dock.innerHTML = `<div class="sync-dock">
    <div class="row between"><h4>${icon('refresh', 'spin')} Обновляю данные</h4><button class="btn ghost sm" id="sync-stop" title="Уже полученные данные сохранятся">${icon('stop')} Остановить</button></div>
    <div class="phase">${esc(p.phaseLabel || '')}${pct !== null ? ` · ${pct}%` : ''}${p.total ? ` <span class="muted">(${num(p.done)} из ${num(p.total)})</span>` : ''}</div>
    <div class="progress ${pct === null ? 'indet' : ''}"><div style="width:${pct ?? 0}%"></div></div>
    <div class="sync-nums">
      <div><b>${num(p.checked)}</b><span>проверено</span></div>
      <div><b>${num(p.created)}</b><span>новых</span></div>
      <div><b>${num(p.likesChanged || 0)}</b><span>лайки изм.</span></div>
      <div><b style="${p.errors ? 'color:var(--red-deep)' : ''}">${num(p.errors)}</b><span>ошибок</span></div>
    </div>
    <div class="muted small" style="margin-top:8px">Можно продолжать пользоваться программой.</div>
  </div>`;
  $('#sync-stop').onclick = () => {
    window.api.syncCancel();
    $('#sync-stop').disabled = true;
  };
}

function showReport(r) {
  $('#sync-dock').innerHTML = '';
  S.syncing = false;
  const errors = r.errors || [];
  if (r.fatal && r.fatal.code !== 'aborted') {
    const offline = r.fatal.code === 'network';
    modal({
      title: offline ? 'Нет связи с ВКонтакте' : 'Обновление не завершено',
      body: `<div class="notice ${offline ? 'amber' : 'red'}">${icon(offline ? 'wifiOff' : 'alert')}<div>${esc(r.fatal.message)}</div></div>
      <p class="muted small" style="margin-bottom:0">Ранее загруженные данные в безопасности.${r.checked ? ` Успели проверить ${pl(r.checked, 'публикацию', 'публикации', 'публикаций')} — эти данные сохранены.` : ''}</p>`,
      foot: r.fatal.code === 'auth' ? `<button class="btn primary" data-close id="go-set">Открыть настройки</button>` : '<button class="btn primary" data-close>Понятно</button>',
    }).el.querySelector('#go-set')?.addEventListener('click', () => go('settings'));
    return;
  }
  const m = modal({
    title: r.cancelled ? 'Обновление остановлено' : 'Обновление завершено!',
    body: `${r.cancelled ? `<p class="muted" style="margin-top:0">Всё, что успели получить, сохранено.</p>` : ''}
      <div class="report">
        <div><b>${num(r.checked)}</b><span>Проверено публикаций</span></div>
        <div><b style="color:var(--mint-deep)">${num(r.created)}</b><span>Новых публикаций</span></div>
        <div><b>${num(r.updated)}</b><span>Обновлено</span></div>
        <div><b style="color:var(--lav-deep)">${num(r.conflicts)}</b><span>С локальными изменениями</span></div>
        ${r.missing ? `<div><b style="color:var(--amber-deep)">${num(r.missing)}</b><span>Пропали из ВКонтакте (сохранены у вас)</span></div>` : ''}
        <div><b style="${errors.length ? 'color:var(--red-deep)' : ''}">${num(errors.length)}</b><span>Ошибок</span></div>
      </div>
      ${errors.length ? `<details class="more"><summary>Подробнее об ошибках</summary><ul class="steps">${errors.slice(0, 15).map((e) => `<li><b>${esc(e.where)}:</b> ${esc(e.message)}</li>`).join('')}</ul></details>` : ''}`,
    foot: `<button class="btn primary" data-close>${icon('check')} Отлично</button>`,
  });
}

// ---------- запуск ----------
async function boot() {
  $('#brand-logo').innerHTML = icon('bow');
  try {
    setData(await window.api.init());
  } catch (e) {
    document.body.innerHTML = `<div class="empty"><h3>Не удалось открыть библиотеку</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  go('library');
  if (S.syncing) drawDock({ phaseLabel: 'Обновление идёт…', done: 0, total: 0, checked: 0, created: 0, errors: 0 });
  if (!S.settings.onboarding_done) setTimeout(startTour, 400);
  $('#help-btn').onclick = () => startTour();

  window.api.onSyncProgress((p) => {
    S.syncing = true;
    drawDock(p);
  });
  window.api.onSyncDone((r) => showReport(r));
  let partialT = null;
  window.api.onDataChanged(async (info) => {
    if (info && info.partial) {
      // во время обновления тихо подтягиваем данные, не сбивая прокрутку библиотеки
      clearTimeout(partialT);
      partialT = setTimeout(async () => {
        setData(await window.api.init());
        renderNav();
        if (current === 'library' && !$('#lib-grid')?.children.length) renderLibrary();
      }, 300);
      return;
    }
    const scroll = $(`#view-${current}`).scrollTop;
    setData(await window.api.init());
    rerender();
    if (current === 'library') $('#view-library').scrollTop = scroll;
  });
  onState((what) => {
    if (what === 'data') rerender();
    if (what === 'post-changed' && current === 'library') {
      const scroll = $('#view-library').scrollTop;
      renderGrid();
      $('#view-library').scrollTop = scroll;
    }
  });
}

boot();
