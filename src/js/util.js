// Общие помощники интерфейса: иконки, форматирование, окна, уведомления.

const P = {
  library: '<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/>',
  stats: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.2c2.7.2 4.6 2.2 5 5.3"/>',
  sources: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.4C1.6 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.2 4.2 2.4h2c.6-1.2 2.1-2.4 4.2-2.4 3.5 0 5.2 3.5 4.1 6.6-1.8 4.8-9.3 9.4-9.3 9.4z"/>',
  heartFill: '<path d="M12 20.5s-7.5-4.6-9.3-9.4C1.6 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.2 3.5 4.1 6.6-1.8 4.8-9.3 9.4-9.3 9.4z"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path d="M21 3v5h-5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
  bow: '<path d="M12 11.5c-2.2-3.4-6.6-6-8.2-4.4-1.6 1.6-.6 7.2 2.3 7.8 2.4.5 4.6-1.7 5.9-3.4z"/><path d="M12 11.5c2.2-3.4 6.6-6 8.2-4.4 1.6 1.6.6 7.2-2.3 7.8-2.4.5-4.6-1.7-5.9-3.4z"/><circle cx="12" cy="11.8" r="1.8"/><path d="M10.8 13.3L8 20M13.2 13.3L16 20"/>',
  dress: '<path d="M9 3l1.5 3h3L15 3"/><path d="M10.5 6l-1 4.5L5 20h14l-4.5-9.5-1-4.5"/><path d="M9.5 10.5h5"/>',
  spool: '<rect x="6" y="3" width="12" height="3" rx="1"/><rect x="6" y="18" width="12" height="3" rx="1"/><path d="M8 6v12M16 6v12"/><path d="M8 9l8 2M8 13l8 2"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  compare: '<rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/>',
  wifiOff: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8M14 10.1a10 10 0 0 1 5 2.8"/><circle cx="12" cy="20" r=".8"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  sortNew: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5"/><path d="M13 6h8M13 11h6M13 16h4"/>',
  sortOld: '<path d="M7 20V4M3.5 7.5L7 4l3.5 3.5"/><path d="M13 6h4M13 11h6M13 16h8"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const num = (n) => Number(n || 0).toLocaleString('ru-RU');
export const pl = (n, one, few, many) => `${num(n)} ${plural(n, one, few, many)}`;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function fmtDate(sec, withTime = false) {
  if (!sec) return '—';
  const d = new Date(sec * 1000);
  const now = new Date();
  let s = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (d.getFullYear() !== now.getFullYear()) s += ` ${d.getFullYear()}`;
  if (withTime) s += `, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return s;
}
export const fmtMs = (ms, withTime = true) => (ms ? fmtDate(ms / 1000, withTime) : '—');
export function ago(ms) {
  if (!ms) return 'никогда';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${pl(m, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${pl(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${pl(d, 'день', 'дня', 'дней')} назад`;
  return fmtMs(ms, false);
}
export function bytes(n) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

// ---------- изображения ----------
export function photoSrc(ph, thumb = true) {
  if (!ph) return '';
  if (ph.file) return thumb && ph.thumb ? `vkd://thumb/${encodeURIComponent(ph.thumb)}` : `vkd://photo/${encodeURIComponent(ph.file)}`;
  return ph.url || '';
}

export function placeholder(label = 'Нет фотографии') {
  return `<div class="placeholder"><div>${icon('dress')}<div>${esc(label)}</div></div></div>`;
}

const AVA_COLORS = [['#fbe7ed', '#c9607f'], ['#efeafb', '#7c66c4'], ['#e7f1fa', '#4f86b8'], ['#e5f4ec', '#3d8a63'], ['#fdf1dc', '#b07a1f']];
export function initials(u) {
  return ((u?.first_name || '?')[0] + (u?.last_name || '')[0] || '').toUpperCase();
}
export function avatar(u, cls = '') {
  const [bg, fg] = AVA_COLORS[Math.abs(Number(u?.id) || 0) % AVA_COLORS.length];
  const fallback = `<div class="ava ${cls}" style="background:${bg};color:${fg}">${esc(initials(u))}</div>`;
  const src = u?.avatar_file ? `vkd://avatar/${encodeURIComponent(u.avatar_file)}` : u?.photo_100 && !/camera_|deactivated_/.test(u.photo_100) ? u.photo_100 : '';
  if (!src) return fallback;
  return `<img class="ava ${cls}" src="${esc(src)}" alt="" loading="lazy" data-fallback="${esc(fallback)}" />`;
}
// если аватар не загрузился (нет интернета) — показываем инициалы
document.addEventListener(
  'error',
  (e) => {
    const t = e.target;
    if (t.tagName === 'IMG' && t.dataset.fallback) t.replaceWith(html(t.dataset.fallback));
    else if (t.tagName === 'IMG' && t.dataset.ph) {
      const ph = html(placeholder(t.dataset.ph));
      t.replaceWith(ph);
    }
  },
  true,
);
document.addEventListener(
  'load',
  (e) => {
    if (e.target.tagName === 'IMG') e.target.classList.add('loaded');
  },
  true,
);

export function userName(u) {
  if (!u) return 'Неизвестный участник';
  return `${u.first_name || ''} ${u.last_name || ''}`.trim() || `id${u.id}`;
}

// ---------- уведомления ----------
export function toast(text, { error = false, action, onAction, timeout = 4200 } = {}) {
  const el = html(`<div class="toast ${error ? 'err' : ''}"><span>${esc(text)}</span>${action ? `<button>${esc(action)}</button>` : ''}</div>`);
  if (action) el.querySelector('button').onclick = () => {
    onAction && onAction();
    el.remove();
  };
  $('#toasts').append(el);
  setTimeout(() => el.remove(), timeout);
}
export const toastError = (e) => toast(e?.message || String(e), { error: true, timeout: 6500 });

// ---------- окна ----------
// ---------- слои: окна (.overlay) и боковые панели (.drawer-wrap) ----------
// Новое окно или панель всегда поверх уже открытых (в каком бы порядке их ни открывали),
// а Esc закрывает только самое верхнее.
const LAYERS = '.overlay, .drawer-wrap';
const openLayers = () => [...document.querySelectorAll(LAYERS)];
const isTopLayer = (el) => {
  const all = openLayers();
  return all[all.length - 1] === el;
};
function pushLayer(el) {
  el.style.zIndex = String(50 + openLayers().length); // 50, 51, 52… — выше всех уже открытых
  document.body.append(el);
}

export function modal({ title, body, foot = '', cls = '', onClose, raw = false }) {
  const ov = html(`<div class="overlay"><div class="modal ${cls}">${
    raw
      ? body
      : `<div class="modal-head"><h2>${title}</h2><button class="btn ghost icon-only sm" data-close title="Закрыть">${icon('close')}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`
  }</div></div>`);
  const close = () => {
    ov.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && isTopLayer(ov)) close();
  };
  ov.addEventListener('mousedown', (e) => {
    if (e.target === ov) close();
  });
  ov.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  pushLayer(ov);
  return { el: ov.firstElementChild, close };
}

export function confirmDialog({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title,
      body: `<p style="margin:0;color:var(--ink-2)">${text}</p>`,
      foot: `<button class="btn ghost" data-close>${esc(cancel)}</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onClose: () => resolve(result),
    });
    m.el.querySelector('[data-ok]').onclick = () => {
      result = true;
      m.close();
    };
    setTimeout(() => m.el.querySelector('[data-ok]').focus(), 30);
  });
}

export function drawer({ title, tools = '', body = '', headExtra = '' }) {
  // панель открыта поверх другой (например, карточка человека из списка лайков) — даём вернуться назад
  const back = openLayers().length ? `<button class="btn ghost sm drawer-back" data-close title="Вернуться назад">${icon('chevL')} Назад</button>` : '';
  const wrap = html(`<div class="drawer-wrap ${back ? 'stacked' : ''}"><div class="drawer">
    <div class="drawer-head">${back}${headExtra}<h3>${title}</h3><button class="btn ghost icon-only sm" data-close title="Закрыть">${icon('close')}</button></div>
    ${tools ? `<div class="drawer-tools">${tools}</div>` : ''}
    <div class="drawer-body">${body}</div></div></div>`);
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && isTopLayer(wrap)) close();
  };
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) close();
  });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  pushLayer(wrap);
  return { el: wrap.querySelector('.drawer'), body: wrap.querySelector('.drawer-body'), close };
}

/** Постепенный вывод длинных списков: рисуем порциями при прокрутке */
export function incremental(container, items, renderItem, { batch = 60, root = null } = {}) {
  let shown = 0;
  const sentinel = html('<div class="load-more"></div>');
  const more = () => {
    const frag = document.createDocumentFragment();
    const end = Math.min(items.length, shown + batch);
    for (; shown < end; shown++) {
      const el = renderItem(items[shown], shown);
      if (el) frag.append(el);
    }
    sentinel.before(frag);
    if (shown >= items.length) io.disconnect();
  };
  const io = new IntersectionObserver((ents) => ents.some((e) => e.isIntersecting) && more(), { root, rootMargin: '900px' });
  container.append(sentinel);
  more();
  if (shown < items.length) io.observe(sentinel);
  return () => io.disconnect();
}

/** Пословное сравнение двух текстов (для «Моя версия / Оригинал») */
export function wordDiff(a, b) {
  const A = String(a || '').split(/(\s+)/);
  const B = String(b || '').split(/(\s+)/);
  if (A.length * B.length > 4e6) return { a: esc(a), b: esc(b) };
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0;
  let j = 0;
  let outA = '';
  let outB = '';
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      outA += esc(A[i]);
      outB += esc(B[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) outA += `<del>${esc(A[i++])}</del>`;
    else outB += `<ins>${esc(B[j++])}</ins>`;
  }
  while (i < n) outA += `<del>${esc(A[i++])}</del>`;
  while (j < m) outB += `<ins>${esc(B[j++])}</ins>`;
  return { a: outA, b: outB };
}

// ---------- красивые выпадающие списки ----------
// Нативный <select class="select"> остаётся в разметке (скрытым): экраны работают с ним как раньше —
// читают .value и слушают change. Поверх рисуется кнопка и всплывающий список в стиле приложения.
const CHEVRON = '<svg class="dd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const TICK = '<svg class="dd-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
let openDd = null;

function closeDropdown() {
  if (!openDd) return;
  const d = openDd;
  openDd = null;
  d.list.remove();
  d.wrap.classList.remove('open');
  document.removeEventListener('mousedown', d.onDown, true);
  document.removeEventListener('keydown', d.onKey, true);
  window.removeEventListener('resize', closeDropdown);
  window.removeEventListener('scroll', d.onScroll, true);
}

export function enhanceSelect(sel) {
  if (sel.dataset.enhanced) return;
  sel.dataset.enhanced = '1';
  const wrap = document.createElement('div');
  wrap.className = 'dd';
  if (sel.style.cssText) wrap.style.cssText = sel.style.cssText;
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(sel);
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  if (sel.title) btn.title = sel.title;
  if (sel.id) btn.dataset.for = sel.id;
  wrap.append(btn);
  const sync = () => {
    const o = sel.options[sel.selectedIndex];
    btn.innerHTML = `${o && o.dataset.icon ? icon(o.dataset.icon, o.dataset.icon.endsWith('Fill') ? 'dd-ico fill' : 'dd-ico') : ''}<span class="dd-val">${esc(o ? o.text : '')}</span>${CHEVRON}`;
    btn.disabled = sel.disabled;
  };
  // sel.value = '…' из кода экрана тоже должно обновлять кнопку
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() {
      return valueDesc.get.call(this);
    },
    set(v) {
      valueDesc.set.call(this, v);
      sync();
    },
  });
  sel.addEventListener('change', sync);
  sync();

  const choose = (i) => {
    closeDropdown();
    btn.focus();
    if (i === sel.selectedIndex) return;
    sel.selectedIndex = i;
    sync();
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const open = () => {
    if (openDd && openDd.wrap === wrap) return closeDropdown();
    closeDropdown();
    const list = document.createElement('div');
    list.className = 'dd-list';
    list.setAttribute('role', 'listbox');
    list.innerHTML = [...sel.options].map((o, i) => `<div class="dd-opt ${i === sel.selectedIndex ? 'on' : ''}" role="option" data-i="${i}">${TICK}${o.dataset.icon ? icon(o.dataset.icon, o.dataset.icon.endsWith('Fill') ? 'dd-ico fill' : 'dd-ico') : ''}<span>${esc(o.text)}</span></div>`).join('');
    document.body.append(list);
    const r = btn.getBoundingClientRect();
    list.style.minWidth = `${r.width}px`;
    const h = list.offsetHeight;
    const below = window.innerHeight - r.bottom - 12;
    list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 12))}px`;
    list.style.top = below < h && r.top > h ? `${r.top - h - 6}px` : `${r.bottom + 6}px`;
    wrap.classList.add('open');
    let active = sel.selectedIndex;
    const mark = () => list.querySelectorAll('.dd-opt').forEach((el, i) => el.classList.toggle('active', i === active));
    mark();
    list.addEventListener('mousemove', (e) => {
      const o = e.target.closest('.dd-opt');
      if (o && Number(o.dataset.i) !== active) {
        active = Number(o.dataset.i);
        mark();
      }
    });
    list.addEventListener('click', (e) => {
      const o = e.target.closest('.dd-opt');
      if (o) choose(Number(o.dataset.i));
    });
    openDd = {
      wrap,
      list,
      onDown: (e) => {
        if (!list.contains(e.target) && !wrap.contains(e.target)) closeDropdown();
      },
      onScroll: (e) => {
        if (!list.contains(e.target)) closeDropdown();
      },
      onKey: (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeDropdown();
          btn.focus();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + sel.options.length) % sel.options.length;
          mark();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose(active);
        } else if (e.key === 'Tab') closeDropdown();
      },
    };
    document.addEventListener('mousedown', openDd.onDown, true);
    document.addEventListener('keydown', openDd.onKey, true);
    window.addEventListener('resize', closeDropdown);
    window.addEventListener('scroll', openDd.onScroll, true);
  };
  btn.addEventListener('click', open);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });
}

/** Подключить красивые списки ко всем select.select — и к тем, что появятся позже */
export function autoEnhanceSelects() {
  const run = () => document.querySelectorAll('select.select:not([data-enhanced])').forEach(enhanceSelect);
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}
