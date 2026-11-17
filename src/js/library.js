// «Мои посты»: карточки постов, добавленных по ссылке; поиск, сортировка, подсказка с лайками.
import { S, eff, photos, text, date, localChanges, ownerName, likersOf, reload, myOwnerId, personPages, groupPages } from './state.js';
import { icon, esc, $, $$, html, num, pl, fmtDate, photoSrc, placeholder, avatar, userName, debounce, incremental, toast, toastError, confirmDialog, ago, modal } from './util.js';
import { openPost, openEditor } from './post.js';
import { openLikers, openUser } from './people.js';
import { startSync, go } from './app.js';

const F = {
  q: '',
  qMode: 'text', // text | liker
  month: null, // 'ГГГГ-ММ', '' — все месяцы, null — ещё не выбран (выберем по умолчанию)
  sort: 'date_desc',
  owner: 'all', // all | mine | groups
  group: '', // id сообщества (строкой) или '' — все сообщества
};
let stopIncremental = null;
const root = () => $('#view-library');

export function renderLibrary() {
  const el = root();
  F.sort = S.settings?.view?.sort || F.sort;
  const lastSync = S.history.last_sync;
  el.innerHTML = `
    <div class="view-head">
      <div>
        <h1 class="view-title">Мои посты</h1>
        <div class="view-sub">${S.posts.length ? `${pl(S.posts.length, 'пост', 'поста', 'постов')} · обновлено ${ago(lastSync)}` : 'Добавляйте свои посты ВКонтакте по ссылке'}</div>
      </div>
      <div class="spacer"></div>
      <button class="btn lg" id="lib-add">${icon('plus')}<span>Добавить пост</span></button>
      <div class="split-btn" id="sync-split">
        <button class="btn primary lg sync-btn" id="lib-sync" ${S.syncing ? 'disabled' : ''} title="${esc(syncMode().hint)}">${icon('refresh', S.syncing ? 'spin' : '')}<span>${S.syncing ? 'Обновляю…' : syncMode().label}</span></button>
        <button class="btn primary lg split-chev" id="lib-sync-menu" ${S.syncing ? 'disabled' : ''} title="Выбрать, что обновлять" aria-haspopup="menu">${icon('chevD')}</button>
      </div>
    </div>
    <div id="lib-banners"></div>
    ${S.posts.length ? toolbar() : ''}
    <div class="grid" id="lib-grid"></div>
    <div id="lib-empty"></div>`;
  $('#lib-sync').onclick = () => runSync();
  $('#lib-sync-menu').onclick = (e) => toggleSyncMenu(e.currentTarget);
  $('#lib-add').onclick = () => openAddPost();
  renderBanners();
  if (!S.posts.length) {
    $('#lib-empty').innerHTML = emptyState();
    $('#lib-empty [data-go]')?.addEventListener('click', (e) => go(e.currentTarget.dataset.go));
    $('#lib-empty [data-add]')?.addEventListener('click', () => openAddPost());
    return;
  }
  bindToolbar();
  renderGrid();
}

// ---------- кнопка «Обновить» с выбором: все посты или только добавленные за неделю ----------
// Выбор запоминается в настройках (view.sync_mode), поэтому после перезапуска не сбрасывается.
const SYNC_MODES = {
  all: { label: 'Обновить данные', menu: 'Обновить все посты', hint: 'Проверить во ВКонтакте все добавленные посты', icon: 'refresh' },
  week: { label: 'Обновить за неделю', menu: 'Только за неделю', hint: 'Проверить только посты, которые вы добавили в программу за последние 7 дней', icon: 'history' },
};
const syncModeKey = () => (S.settings?.view?.sync_mode === 'week' ? 'week' : 'all');
const syncMode = () => SYNC_MODES[syncModeKey()];

function runSync() {
  if (syncModeKey() !== 'week') return startSync();
  const since = Date.now() - 7 * 86400e3;
  const ids = S.posts.filter((p) => (p.added_at || 0) >= since).map((p) => p.id);
  if (!ids.length) return toast('За последние 7 дней вы не добавляли постов — обновлять нечего. Выберите «Обновить все посты» в списке у кнопки.');
  toast(`Обновляю ${pl(ids.length, 'пост', 'поста', 'постов')}, добавленных за неделю…`);
  startSync({ postIds: ids });
}

let syncMenu = null;
function closeSyncMenu() {
  if (!syncMenu) return;
  syncMenu.el.remove();
  document.removeEventListener('mousedown', syncMenu.onDown, true);
  document.removeEventListener('keydown', syncMenu.onKey, true);
  window.removeEventListener('resize', closeSyncMenu);
  $('#sync-split')?.classList.remove('open');
  syncMenu = null;
}
function toggleSyncMenu(anchor) {
  if (syncMenu) return closeSyncMenu();
  const cur = syncModeKey();
  const el = html(`<div class="dd-list sync-menu" role="menu">
    ${Object.entries(SYNC_MODES)
      .map(
        ([k, m]) => `<div class="dd-opt sync-opt ${k === cur ? 'on' : ''}" role="menuitemradio" aria-checked="${k === cur}" data-mode="${k}">
          <svg class="dd-tick" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>${icon(m.icon, 'dd-ico')}
          <span><b>${m.menu}</b><small>${m.hint}</small></span></div>`,
      )
      .join('')}
  </div>`);
  document.body.append(el);
  const r = $('#sync-split').getBoundingClientRect();
  el.style.top = `${r.bottom + 6}px`;
  el.style.left = `${Math.max(8, r.right - el.offsetWidth)}px`;
  $('#sync-split').classList.add('open');
  el.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-mode]');
    if (!o) return;
    closeSyncMenu();
    const mode = o.dataset.mode;
    if (mode === syncModeKey()) return;
    try {
      S.settings = await window.api.updateSettings({ view: { sync_mode: mode } });
    } catch (err) {
      return toastError(err);
    }
    const b = $('#lib-sync');
    if (b && !S.syncing) {
      b.title = syncMode().hint;
      b.lastElementChild.textContent = syncMode().label;
    }
    toast(`Кнопка теперь: «${syncMode().label}». Выбор запомнится.`);
  });
  syncMenu = {
    el,
    onDown: (e) => {
      if (!el.contains(e.target) && !anchor.contains(e.target)) closeSyncMenu();
    },
    onKey: (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSyncMenu();
      }
    },
  };
  document.addEventListener('mousedown', syncMenu.onDown, true);
  document.addEventListener('keydown', syncMenu.onKey, true);
  window.addEventListener('resize', closeSyncMenu);
}

function renderBanners() {
  const b = $('#lib-banners');
  const parts = [];
  if (S.blocked.length) {
    parts.push(`<div class="notice red banner">${icon('alert')}<div>Файл данных повреждён (${esc(S.blocked.join(', '))}) и не был восстановлен автоматически. Изменения в нём временно не сохраняются, чтобы ничего не потерять. Повреждённый файл не тронут — откройте <b>Настройки → Открыть папку</b> и сообщите о проблеме.</div></div>`);
  }
  const fixed = S.problems.filter((p) => p.fixed);
  if (fixed.length) parts.push(`<div class="notice amber banner">${icon('shield')}<div>При запуске найден повреждённый файл — данные автоматически восстановлены из предыдущей сохранённой версии. Повреждённый файл отложен в папку trash.</div></div>`);
  b.innerHTML = parts.join('');
}

function emptyState() {
  if (!S.account.connected)
    return `<div class="empty"><div class="art">${icon('bow')}</div><h3>Добро пожаловать!</h3><p>Здесь будут ваши посты из ВКонтакте: фото, тексты и все, кто поставил «Мне нравится».</p><p class="muted small">Для начала подключите ВКонтакте — это займёт минуту.</p><button class="btn primary lg" data-go="settings">${icon('key')} Подключить ВКонтакте</button></div>`;
  return `<div class="empty"><div class="art">${icon('sparkle')}</div><h3>Добавьте первый пост</h3><p>Откройте свой пост во ВКонтакте, скопируйте ссылку на него и вставьте сюда. Программа загрузит фото, текст и лайки только этого поста.</p><button class="btn primary lg" data-add>${icon('plus')} Добавить пост</button></div>`;
}

// ---------- добавление поста ----------
export function openAddPost() {
  const m = modal({
    title: 'Добавить пост',
    body: `${S.account.connected ? '' : `<div class="notice amber" style="margin-bottom:12px">${icon('key')}<div>Сначала подключите ВКонтакте. <a href="#" id="ap-settings">Перейти в настройки</a></div></div>`}
      <div class="field"><label>Ссылка на пост</label>
        <input class="input" id="ap-url" placeholder="Например: https://vk.com/wall-123456_789" autocomplete="off" spellcheck="false" />
        <span class="hint">Откройте пост во ВКонтакте и скопируйте адрес из строки браузера — в нём есть «wall». Подойдёт и ссылка вида …?w=wall-123_456.</span>
      </div>
      <div class="field"><label>Название поста <span class="muted">(необязательно)</span></label>
        <input class="input" id="ap-title" placeholder="Например: Платье для Паолы, весна" maxlength="200" autocomplete="off" />
        <span class="hint">Видно только вам — помогает быстро найти пост среди карточек.</span>
      </div>
      <div id="ap-res"></div>`,
    foot: `<button class="btn ghost" data-close>Отмена</button><button class="btn primary" id="ap-ok">${icon('plus')} Добавить</button>`,
  });
  const url = m.el.querySelector('#ap-url');
  const ttl = m.el.querySelector('#ap-title');
  const ok = m.el.querySelector('#ap-ok');
  const res = m.el.querySelector('#ap-res');
  m.el.querySelector('#ap-settings')?.addEventListener('click', (e) => (e.preventDefault(), m.close(), go('settings')));
  setTimeout(() => url.focus(), 30);
  const submit = async () => {
    const v = url.value.trim();
    if (!v) {
      res.innerHTML = `<div class="notice lav">${icon('info')}<div>Вставьте ссылку на пост: щёлкните правой кнопкой мыши по полю → «Вставить» или нажмите Ctrl+V.</div></div>`;
      url.focus();
      return;
    }
    ok.disabled = true;
    ok.innerHTML = `${icon('refresh', 'spin')} Загружаю…`;
    try {
      const p = await window.api.addPost(v, ttl.value);
      m.close();
      await reload();
      toast(`Пост добавлен${p.title ? `: ${p.title}` : ''}. Загружаю фото и лайки…`);
      startSync({ postIds: [p.id] });
    } catch (e) {
      res.innerHTML = `<div class="notice red">${icon('alert')}<div>${esc(e.message)}</div></div>`;
      ok.disabled = false;
      ok.innerHTML = `${icon('plus')} Добавить`;
    }
  };
  ok.onclick = submit;
  // не «onkeydown = (e) => e.key === 'Enter' && submit()» — false из on*-обработчика отменяет ввод
  for (const inp of [url, ttl]) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
}

const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const monthKey = (sec) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
/** Месяцы, в которых есть посты: [{ key, label, n }] от новых к старым */
function monthList() {
  const m = new Map();
  // считаем только посты, подходящие под «Чьи посты», — цифры у месяцев совпадают с тем, что будет показано
  for (const p of byOwner(S.posts)) {
    const k = monthKey(date(p));
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, n]) => {
      const [y, mm] = key.split('-');
      return { key, n, label: `${MONTHS_NOM[Number(mm) - 1]} ${y}` };
    });
}

/** Фильтр «Чьи посты»: все / мои / из сообществ (все или одно) */
function byOwner(list) {
  if (F.owner === 'mine') {
    const me = myOwnerId();
    return list.filter((p) => Number(p.owner_id) === me);
  }
  if (F.owner === 'groups') return list.filter((p) => Number(p.owner_id) < 0 && (!F.group || String(p.owner_id) === F.group));
  return list;
}

function ownerFilter() {
  const me = myOwnerId();
  const meName = personPages().find((x) => x.id === me)?.name;
  const groups = groupPages();
  if (F.group && !groups.some((g) => String(g.id) === F.group)) F.group = '';
  return `<select class="select" id="f-owner" title="Чьи посты показывать">
      <option value="all" data-icon="library" ${F.owner === 'all' ? 'selected' : ''}>Все посты</option>
      <option value="mine" data-icon="heart" ${F.owner === 'mine' ? 'selected' : ''}>Мои${meName ? ` — ${esc(meName)}` : ''}</option>
      <option value="groups" data-icon="users" ${F.owner === 'groups' ? 'selected' : ''}>Из сообществ</option>
    </select>
    ${
      F.owner === 'groups'
        ? `<select class="select" id="f-group" title="Какое сообщество">
      <option value="">Все сообщества</option>
      ${groups.map((g) => `<option value="${g.id}" ${F.group === String(g.id) ? 'selected' : ''}>${esc(g.name)} · ${num(g.n)}</option>`).join('')}
    </select>`
        : ''
    }`;
}

const qPlaceholder = () => (F.qMode === 'text' ? 'Поиск по названию и тексту…' : 'Имя того, кто поставил лайк…');

function toolbar() {
  const owner = ownerFilter(); // раньше месяцев: от выбора «Чьи посты» зависят месяцы и цифры в них
  const months = monthList();
  // выбранного месяца нет среди постов этого владельца — выбираем месяц заново по общему правилу
  if (F.month && !months.some((m) => m.key === F.month)) F.month = null;
  // по умолчанию — текущий месяц, а если в нём нет постов — ближайший прошлый, где они есть
  if (F.month === null) {
    const now = monthKey(Date.now() / 1000);
    F.month = (months.find((m) => m.key <= now) || months[0] || { key: '' }).key;
  }
  return `
  <div class="toolbar">
    <div class="search with-mode">${icon('search')}<input class="input" id="f-q" placeholder="${qPlaceholder()}" value="${esc(F.q)}" />
      <div class="q-mode" title="Где искать">
        <button type="button" data-qmode="text" class="${F.qMode === 'text' ? 'on' : ''}" title="Искать в названии и тексте поста">${icon('doc')}<span>Текст</span></button>
        <button type="button" data-qmode="liker" class="${F.qMode === 'liker' ? 'on' : ''}" title="Искать по имени того, кто поставил лайк">${icon('heart')}<span>Лайки</span></button>
      </div>
    </div>
    ${owner}
    <select class="select" id="f-month" title="Месяц публикации">
      <option value="">Все месяцы</option>
      ${months.map((m) => `<option value="${m.key}" ${F.month === m.key ? 'selected' : ''}>${m.label} · ${num(m.n)}</option>`).join('')}
    </select>
    <div class="spacer"></div>
    <select class="select" id="f-sort" title="Порядок карточек">
      <option value="date_desc" data-icon="sortNew">Сначала новые</option>
      <option value="date_asc" data-icon="sortOld">Сначала старые</option>
      <option value="likes_desc" data-icon="heartFill">Больше лайков</option>
      <option value="likes_asc" data-icon="heart">Меньше лайков</option>
      <option value="added_desc" data-icon="plus">Недавно добавленные</option>
    </select>
  </div>
`;
}

function bindToolbar() {
  $('#f-sort').value = F.sort;
  $('#f-q').addEventListener('input', debounce((e) => ((F.q = e.target.value), renderGrid()), 180));
  $$('[data-qmode]').forEach(
    (b) =>
      (b.onclick = () => {
        F.qMode = b.dataset.qmode;
        $$('[data-qmode]').forEach((x) => x.classList.toggle('on', x === b));
        $('#f-q').placeholder = qPlaceholder();
        $('#f-q').focus();
        renderGrid();
      }),
  );
  $('#f-month').onchange = (e) => ((F.month = e.target.value), renderGrid());
  $('#f-owner').onchange = (e) => {
    F.owner = e.target.value;
    if (F.owner === 'mine' && !myOwnerId()) toast('Не знаю, какая страница ваша. Выберите её в «Настройках» → «Моя страница».', { error: true });
    // второй список (сообщество) появляется только при «Из сообществ» — перерисовываем панель
    renderLibrary();
  };
  // сообщество меняет список месяцев и цифры в нём — перерисовываем панель
  $('#f-group')?.addEventListener('change', (e) => ((F.group = e.target.value), renderLibrary()));
  $('#f-sort').onchange = (e) => {
    F.sort = e.target.value;
    window.api.updateSettings({ view: { sort: F.sort } }).catch(() => {});
    renderGrid();
  };
}

function filtered() {
  let list = S.posts;
  const q = F.q.trim().toLowerCase();
  if (q) {
    if (F.qMode === 'text') list = list.filter((p) => (p.title || '').toLowerCase().includes(q) || text(p).toLowerCase().includes(q));
    else {
      const uids = new Set(Object.values(S.users).filter((u) => userName(u).toLowerCase().includes(q)).map((u) => String(u.id)));
      list = list.filter((p) => likersOf(p).some((id) => uids.has(id)));
    }
  }
  if (F.month) list = list.filter((p) => monthKey(date(p)) === F.month);
  list = byOwner(list);
  const sorters = {
    date_desc: (a, b) => date(b) - date(a),
    date_asc: (a, b) => date(a) - date(b),
    likes_desc: (a, b) => b.likes_count - a.likes_count || date(b) - date(a),
    likes_asc: (a, b) => a.likes_count - b.likes_count || date(b) - date(a),
    added_desc: (a, b) => b.added_at - a.added_at,
  };
  return [...list].sort(sorters[F.sort] || sorters.date_desc);
}

export function renderGrid() {
  const grid = $('#lib-grid');
  if (!grid) return;
  if (stopIncremental) stopIncremental();
  grid.innerHTML = '';
  const list = filtered();
  if (!list.length) {
    grid.innerHTML = `<div class="list-empty" style="grid-column:1/-1">${icon('search')}<br>${F.month ? 'В этом месяце ничего не найдено.' : 'Ничего не найдено. Попробуйте изменить условия поиска.'}</div>`;
    return;
  }
  stopIncremental = incremental(grid, list, card, { batch: 48, root: root() });
}

const SRC_TONES = ['lav', 'blue', 'mint', 'amber', 'pink'];
export const ownerUrl = (p) => (p.owner_id < 0 ? `https://vk.com/club${-p.owner_id}` : `https://vk.com/id${p.owner_id}`);
/** Плашка источника: у каждого сообщества/страницы свой цвет, чтобы посты разных источников различались с первого взгляда */
export function sourceChip(p) {
  const name = ownerName(p);
  const tone = SRC_TONES[Math.abs(Number(p.owner_id) || 0) % SRC_TONES.length];
  return `<button class="src-chip ${tone}" data-src title="${esc(name)} — открыть во ВКонтакте"><span class="src-ava">${esc((name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase())}</span><span class="src-name">${esc(name)}</span>${icon(p.owner_id < 0 ? 'users' : 'external')}</button>`;
}

/** Сетка фото в карточке: 2 фото — рядом, 3 и больше — 2×2 (у трёх последняя клетка пустая), с 5-го — «+N» на последней */
function photoGrid(ph) {
  const shown = ph.slice(0, 4);
  const more = ph.length - shown.length;
  const cells = shown.map(
    (x, i) =>
      `<div class="pg-cell" data-pi="${i}"><img src="${esc(photoSrc(x))}" alt="" loading="lazy" decoding="async" data-ph="" />${
        more > 0 && i === shown.length - 1 ? `<span class="pg-more" title="Ещё ${pl(more, 'фотография', 'фотографии', 'фотографий')}">+${more}</span>` : ''
      }</div>`,
  );
  if (shown.length === 3) cells.push('<div class="pg-cell pg-empty"></div>');
  return `<div class="photo-grid n${shown.length === 2 ? 2 : 4}">${cells.join('')}</div>`;
}

function card(p) {
  const ph = photos(p);
  const t = text(p);
  const changed = localChanges(p).length > 0;
  const el = html(`<article class="card" data-id="${esc(p.id)}">
    <div class="card-photo" data-open>
      ${ph.length > 1 ? photoGrid(ph) : ph[0] ? `<img src="${esc(photoSrc(ph[0]))}" alt="" loading="lazy" decoding="async" data-ph="Фото недоступно" />` : placeholder()}
      <div class="card-badges">
        ${p.is_new ? `<span class="badge mint">${icon('sparkle')} Новое</span>` : ''}
        ${changed ? `<span class="badge pink" title="Есть ваши изменения">${icon('edit')} Изменено</span>` : ''}
        ${p.vk_missing ? `<span class="badge amber" title="Пост не найден во ВКонтакте (удалён или скрыт). У вас он сохранён.">${icon('alert')} Нет в VK</span>` : ''}
      </div>
      <div class="card-acts">
        <button class="c-act" data-orig title="Открыть во ВКонтакте">${icon('external')}</button>
        <button class="c-act" data-edit title="Редактировать">${icon('edit')}</button>
        <button class="c-act danger" data-del title="Убрать в корзину">${icon('trash')}</button>
      </div>
    </div>
    <div class="card-body">
      ${sourceChip(p)}
      ${p.title ? `<h3 class="card-title" title="${esc(p.title)}">${esc(p.title)}</h3>` : ''}
      ${t ? `<p class="card-text">${esc(t.length > 400 ? t.slice(0, 400) + '…' : t)}</p>` : ''}
    </div>
    <div class="card-foot">
      <button class="likes-pill" data-likes title="Кто поставил «Мне нравится»">${icon('heartFill', 'fill')} ${num(p.likes_count)}</button>
      <div class="spacer"></div>
      <span class="card-date" title="${esc(fmtDate(date(p), true))}">${icon('calendar')}${esc(fmtDate(date(p)))}</span>
    </div>
  </article>`);
  // вся карточка открывает пост (кнопки внутри обрабатывают клик сами); клик по фото в сетке — сразу на этом фото
  el.onclick = (e) => {
    if (e.target.closest('button, a')) return;
    const cell = e.target.closest('[data-pi]');
    openPost(p.id, cell ? Number(cell.dataset.pi) : 0);
  };
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  el.querySelector('[data-orig]').onclick = stop(() => window.api.openUrl(p.url));
  el.querySelector('[data-edit]').onclick = stop(() => openEditor(p.id));
  el.querySelector('[data-del]').onclick = stop(() => deletePost(p.id));
  el.querySelector('[data-src]').onclick = stop(() => window.api.openUrl(ownerUrl(p)));
  const lk = el.querySelector('[data-likes]');
  lk.onclick = (e) => {
    e.stopPropagation();
    hidePopover();
    openLikers(p.id);
  };
  lk.onmouseenter = () => showPopover(lk, p);
  lk.onmouseleave = () => schedHide();
  return el;
}

// ---------- подсказка «кто лайкнул» ----------
let pop = null;
let hideT = null;
function schedHide() {
  clearTimeout(hideT);
  hideT = setTimeout(hidePopover, 180);
}
export function hidePopover() {
  clearTimeout(hideT);
  pop?.remove();
  pop = null;
}
function showPopover(anchor, p) {
  hidePopover();
  const ids = likersOf(p);
  const sorted = ids
    .map((id) => S.users[id] || { id, first_name: 'Участник', last_name: '' })
    .sort((a, b) => (b.likes || 0) - (a.likes || 0) || userName(a).localeCompare(userName(b), 'ru'));
  const missing = p.likes_count - ids.length;
  pop = html(`<div class="popover">
    <div class="popover-title">${p.likes_count ? `Понравилось ${pl(p.likes_count, 'человеку', 'людям', 'людям')}` : 'Пока никто не поставил лайк'}</div>
    ${sorted.length ? `<div class="popover-list">${sorted.map((u) => `<div class="person" data-uid="${u.id}" style="cursor:pointer">${avatar(u)}<div class="name">${esc(userName(u))}</div><button class="link-btn" data-vk="${esc(u.url || '')}" title="Открыть профиль ВКонтакте">${icon('external')}</button></div>`).join('')}</div>` : ''}
    ${!ids.length && p.likes_count ? '<div class="popover-foot">Список ещё не загружен — нажмите «Обновить данные»</div>' : missing > 0 && ids.length ? `<div class="popover-foot" style="color:var(--muted)">Собрано ${num(ids.length)} из ${num(p.likes_count)}</div>` : ''}
  </div>`);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const ph = pop.offsetHeight;
  let top = r.top - ph - 8;
  if (top < 8) top = r.bottom + 8;
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.min(window.innerWidth - 290, Math.max(8, r.left - 10))}px`;
  pop.onmouseenter = () => clearTimeout(hideT);
  pop.onmouseleave = schedHide;
  pop.addEventListener('click', (e) => {
    const vk = e.target.closest('[data-vk]');
    if (vk) {
      e.stopPropagation();
      if (vk.dataset.vk) window.api.openUrl(vk.dataset.vk);
      return;
    }
    const person = e.target.closest('[data-uid]');
    hidePopover();
    if (person) openUser(person.dataset.uid);
    else openLikers(p.id);
  });
}

export async function deletePost(id, after) {
  const p = S.byId.get(id);
  if (!p) return;
  const ok = await confirmDialog({
    title: 'Удалить карточку?',
    text: 'Карточка переместится в корзину. Пост во ВКонтакте <b>не будет</b> удалён. Вернуть карточку можно из корзины.',
    ok: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  try {
    await window.api.deletePosts([id]);
    await reload();
    after && after();
    toast('Карточка перемещена в корзину', {
      action: 'Вернуть',
      onAction: async () => {
        await window.api.restorePosts([id]);
        await reload();
        toast('Карточка восстановлена');
      },
    });
  } catch (e) {
    toastError(e);
  }
}

// прокрутка страницы закрывает подсказку, а прокрутка списка внутри неё — нет
window.addEventListener(
  'scroll',
  (e) => {
    if (pop && e.target instanceof Node && pop.contains(e.target)) return;
    hidePopover();
  },
  true,
);
