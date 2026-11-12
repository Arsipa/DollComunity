// «Мои посты»: карточки постов, добавленных по ссылке; поиск, сортировка, подсказка с лайками.
import { S, eff, photos, text, date, localChanges, ownerName, likersOf, reload } from './state.js';
import { icon, esc, $, $$, html, num, pl, fmtDate, photoSrc, placeholder, avatar, userName, debounce, incremental, toast, toastError, confirmDialog, ago, modal } from './util.js';
import { openPost, openEditor } from './post.js';
import { openLikers, openUser } from './people.js';
import { startSync, go } from './app.js';

const F = {
  q: '',
  qMode: 'text', // text | liker
  month: null, // 'ГГГГ-ММ', '' — все месяцы, null — ещё не выбран (выберем по умолчанию)
  sort: 'date_desc',
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
      <button class="btn primary lg sync-btn" id="lib-sync" ${S.syncing ? 'disabled' : ''}>${icon('refresh', S.syncing ? 'spin' : '')}<span>${S.syncing ? 'Обновляю…' : 'Обновить данные'}</span></button>
    </div>
    <div id="lib-banners"></div>
    ${S.posts.length ? toolbar() : ''}
    <div class="grid" id="lib-grid"></div>
    <div id="lib-empty"></div>`;
  $('#lib-sync').onclick = () => startSync();
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
  for (const p of S.posts) {
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

const qPlaceholder = () => (F.qMode === 'text' ? 'Поиск по названию и тексту…' : 'Имя того, кто поставил лайк…');

function toolbar() {
  const months = monthList();
  // по умолчанию — текущий месяц, а если в нём нет постов — ближайший прошлый, где они есть
  if (F.month === null) {
    const now = monthKey(Date.now() / 1000);
    F.month = (months.find((m) => m.key <= now) || months[0] || { key: '' }).key;
  }
  if (F.month && !months.some((m) => m.key === F.month)) F.month = '';
  return `
  <div class="toolbar">
    <div class="search with-mode">${icon('search')}<input class="input" id="f-q" placeholder="${qPlaceholder()}" value="${esc(F.q)}" />
      <div class="q-mode" title="Где искать">
        <button type="button" data-qmode="text" class="${F.qMode === 'text' ? 'on' : ''}" title="Искать в названии и тексте поста">${icon('doc')}<span>Текст</span></button>
        <button type="button" data-qmode="liker" class="${F.qMode === 'liker' ? 'on' : ''}" title="Искать по имени того, кто поставил лайк">${icon('heart')}<span>Лайки</span></button>
      </div>
    </div>
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

function card(p) {
  const ph = photos(p);
  const t = text(p);
  const changed = localChanges(p).length > 0;
  const el = html(`<article class="card" data-id="${esc(p.id)}">
    <div class="card-photo" data-open>
      ${
        ph.length > 1
          ? `<div class="slides">${ph.map((x) => `<img src="${esc(photoSrc(x))}" alt="" loading="lazy" decoding="async" data-ph="Фото недоступно" />`).join('')}</div>
             <button class="s-nav prev" data-s="-1" title="Предыдущее фото">${icon('chevL')}</button><button class="s-nav next" data-s="1" title="Следующее фото">${icon('chevR')}</button>
             <div class="s-dots">${ph.map((_, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>`
          : ph[0]
            ? `<img src="${esc(photoSrc(ph[0]))}" alt="" loading="lazy" decoding="async" data-ph="Фото недоступно" />`
            : placeholder()
      }
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
      ${ph.length > 1 ? `<span class="photo-count">${icon('image')}<b data-n>1</b>/${ph.length}</span>` : ''}
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
  // слайдер фото: стрелки листают, клик по фото открывает пост на текущем фото
  let slide = 0;
  const slideBy = (d) => {
    slide = (slide + d + ph.length) % ph.length;
    el.querySelector('.slides').style.transform = `translateX(-${slide * 100}%)`;
    el.querySelectorAll('.s-dots span').forEach((x, i) => x.classList.toggle('on', i === slide));
    const n = el.querySelector('[data-n]');
    if (n) n.textContent = String(slide + 1);
  };
  el.querySelectorAll('[data-s]').forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        slideBy(Number(b.dataset.s));
      }),
  );
  // вся карточка открывает пост (кнопки внутри обрабатывают клик сами)
  el.onclick = (e) => {
    if (e.target.closest('button, a')) return;
    openPost(p.id, slide);
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
