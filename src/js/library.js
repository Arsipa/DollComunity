// Библиотека публикаций: карточки, поиск, фильтры, подсказка с лайками.
import { S, eff, photos, text, date, localChanges, vkChanged, sourceName, likersOf, reload } from './state.js';
import { icon, esc, $, $$, html, num, pl, fmtDate, photoSrc, placeholder, avatar, userName, debounce, incremental, toast, toastError, confirmDialog, ago } from './util.js';
import { openPost, openEditor } from './post.js';
import { openLikers, openUser } from './people.js';
import { startSync, go } from './app.js';

const F = {
  q: '',
  qMode: 'text', // text | liker
  source: '',
  from: '',
  to: '',
  sort: 'date_desc',
  changed: false,
  fresh: false,
  withPhoto: false,
  missing: false,
};
let stopIncremental = null;
const root = () => $('#view-library');

export function renderLibrary() {
  const el = root();
  F.sort = S.settings?.view?.sort || F.sort;
  const hasSources = (S.settings?.sources || []).length > 0;
  const lastSync = S.history.last_sync;
  el.innerHTML = `
    <div class="view-head">
      <div>
        <h1 class="view-title">Библиотека</h1>
        <div class="view-sub">${S.posts.length ? `${pl(S.posts.length, 'публикация', 'публикации', 'публикаций')} · обновлено ${ago(lastSync)}` : 'Здесь появятся публикации из ваших источников'}</div>
      </div>
      <div class="spacer"></div>
      <button class="btn primary lg sync-btn" id="lib-sync" ${S.syncing ? 'disabled' : ''}>${icon('refresh', S.syncing ? 'spin' : '')}<span>${S.syncing ? 'Обновляю…' : 'Обновить данные'}</span></button>
    </div>
    <div id="lib-banners"></div>
    ${S.posts.length ? toolbar() : ''}
    <div class="grid" id="lib-grid"></div>
    <div id="lib-empty"></div>`;
  $('#lib-sync').onclick = () => startSync();
  renderBanners();
  if (!S.posts.length) {
    $('#lib-empty').innerHTML = emptyState(hasSources);
    $('#lib-empty [data-go]')?.addEventListener('click', (e) => go(e.currentTarget.dataset.go));
    $('#lib-empty [data-sync]')?.addEventListener('click', () => startSync());
    return;
  }
  bindToolbar();
  renderGrid();
}

function renderBanners() {
  const b = $('#lib-banners');
  const parts = [];
  if (S.blocked.length) {
    parts.push(`<div class="notice red banner">${icon('alert')}<div>Файл данных повреждён (${esc(S.blocked.join(', '))}) и не был восстановлен автоматически. Изменения в нём временно не сохраняются, чтобы ничего не потерять. Откройте <b>Настройки → Резервные копии</b> и восстановите последнюю копию.</div></div>`);
  }
  const fixed = S.problems.filter((p) => p.fixed);
  if (fixed.length) parts.push(`<div class="notice amber banner">${icon('shield')}<div>При запуске найден повреждённый файл — данные автоматически восстановлены из ${fixed[0].fixed === 'prev' ? 'предыдущей сохранённой версии' : 'резервной копии'}. Повреждённый файл отложен в папку trash.</div></div>`);
  const conflicts = S.posts.filter((p) => vkChanged(p).length).length;
  if (conflicts) parts.push(`<div class="notice lav banner">${icon('compare')}<div>Во ВКонтакте изменился оригинал у отредактированных вами публикаций: ${num(conflicts)}. Ваши версии сохранены — можно сравнить и выбрать. <a href="#" id="show-conflicts">Показать</a></div></div>`);
  b.innerHTML = parts.join('');
  $('#show-conflicts')?.addEventListener('click', (e) => {
    e.preventDefault();
    F.changed = true;
    renderLibrary();
  });
}

function emptyState(hasSources) {
  if (!S.account.connected)
    return `<div class="empty"><div class="art">${icon('bow')}</div><h3>Добро пожаловать!</h3><p>Здесь будет ваша коллекция кукольных публикаций из ВКонтакте: фото нарядов, тексты и все, кто поставил «Мне нравится».</p><p class="muted small">Для начала подключите ВКонтакте — это займёт минуту.</p><button class="btn primary lg" data-go="settings">${icon('key')} Подключить ВКонтакте</button></div>`;
  if (!hasSources)
    return `<div class="empty"><div class="art">${icon('sources')}</div><h3>Добавьте источник</h3><p>Укажите ссылку на сообщество или страницу ВКонтакте, публикации которых хотите собирать.</p><button class="btn primary lg" data-go="sources">${icon('plus')} Добавить источник</button></div>`;
  return `<div class="empty"><div class="art">${icon('sparkle')}</div><h3>Почти готово!</h3><p>Нажмите «Обновить данные», и приложение загрузит публикации, фотографии и лайки. Это может занять несколько минут.</p><button class="btn primary lg" data-sync>${icon('refresh')} Обновить данные</button></div>`;
}

function toolbar() {
  const sources = S.settings.sources;
  const ownerIds = [...new Set(S.posts.map((p) => p.source_id || '')).values()];
  return `
  <div class="toolbar">
    <div class="search">${icon('search')}<input class="input" id="f-q" placeholder="${F.qMode === 'text' ? 'Поиск по тексту публикаций…' : 'Имя того, кто поставил лайк…'}" value="${esc(F.q)}" /></div>
    <select class="select" id="f-qmode" title="Где искать">
      <option value="text" ${F.qMode === 'text' ? 'selected' : ''}>в тексте</option>
      <option value="liker" ${F.qMode === 'liker' ? 'selected' : ''}>по лайкнувшим</option>
    </select>
    <select class="select" id="f-source">
      <option value="">Все источники</option>
      ${sources.map((s) => `<option value="${esc(s.id)}" ${F.source === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      ${ownerIds.some((id) => id && !S.sourcesById.has(id)) || ownerIds.includes('') ? `<option value="__none" ${F.source === '__none' ? 'selected' : ''}>Без источника</option>` : ''}
    </select>
    <select class="select" id="f-sort">
      <option value="date_desc">Сначала новые</option>
      <option value="date_asc">Сначала старые</option>
      <option value="likes_desc">Больше лайков</option>
      <option value="likes_asc">Меньше лайков</option>
      <option value="added_desc">Недавно добавленные</option>
    </select>
  </div>
  <div class="chips">
    <button class="chip ${F.fresh ? 'on' : ''}" data-chip="fresh">${icon('sparkle')} Новые</button>
    <button class="chip ${F.changed ? 'on' : ''}" data-chip="changed">${icon('edit')} С моими изменениями</button>
    <button class="chip ${F.withPhoto ? 'on' : ''}" data-chip="withPhoto">${icon('image')} Только с фото</button>
    <button class="chip ${F.missing ? 'on' : ''}" data-chip="missing">${icon('alert')} Нет в VK</button>
    <span class="chip" style="cursor:default;padding-right:6px">${icon('calendar')} с <input type="date" id="f-from" value="${F.from}" style="border:0;background:none;outline:none;font-weight:700;color:var(--ink-2)"/> по <input type="date" id="f-to" value="${F.to}" style="border:0;background:none;outline:none;font-weight:700;color:var(--ink-2)"/></span>
    <button class="btn ghost sm" id="f-reset">Сбросить</button>
    <span class="result-line" id="f-count"></span>
  </div>`;
}

function bindToolbar() {
  $('#f-sort').value = F.sort;
  $('#f-q').addEventListener('input', debounce((e) => ((F.q = e.target.value), renderGrid()), 180));
  $('#f-qmode').onchange = (e) => {
    F.qMode = e.target.value;
    $('#f-q').placeholder = F.qMode === 'text' ? 'Поиск по тексту публикаций…' : 'Имя того, кто поставил лайк…';
    renderGrid();
  };
  $('#f-source').onchange = (e) => ((F.source = e.target.value), renderGrid());
  $('#f-sort').onchange = (e) => {
    F.sort = e.target.value;
    window.api.updateSettings({ view: { sort: F.sort } }).catch(() => {});
    renderGrid();
  };
  $('#f-from').onchange = (e) => ((F.from = e.target.value), renderGrid());
  $('#f-to').onchange = (e) => ((F.to = e.target.value), renderGrid());
  $$('[data-chip]').forEach(
    (b) =>
      (b.onclick = () => {
        F[b.dataset.chip] = !F[b.dataset.chip];
        b.classList.toggle('on', F[b.dataset.chip]);
        renderGrid();
      }),
  );
  $('#f-reset').onclick = () => {
    Object.assign(F, { q: '', qMode: 'text', source: '', from: '', to: '', changed: false, fresh: false, withPhoto: false, missing: false });
    renderLibrary();
  };
}

function filtered() {
  let list = S.posts;
  const q = F.q.trim().toLowerCase();
  if (q) {
    if (F.qMode === 'text') list = list.filter((p) => text(p).toLowerCase().includes(q));
    else {
      const uids = new Set(Object.values(S.users).filter((u) => userName(u).toLowerCase().includes(q)).map((u) => String(u.id)));
      list = list.filter((p) => likersOf(p).some((id) => uids.has(id)));
    }
  }
  if (F.source === '__none') list = list.filter((p) => !p.source_id || !S.sourcesById.has(p.source_id));
  else if (F.source) list = list.filter((p) => p.source_id === F.source);
  if (F.from) {
    const t = new Date(F.from + 'T00:00:00').getTime() / 1000;
    list = list.filter((p) => date(p) >= t);
  }
  if (F.to) {
    const t = new Date(F.to + 'T23:59:59').getTime() / 1000;
    list = list.filter((p) => date(p) <= t);
  }
  if (F.changed) list = list.filter((p) => localChanges(p).length || vkChanged(p).length);
  if (F.fresh) list = list.filter((p) => p.is_new);
  if (F.withPhoto) list = list.filter((p) => photos(p).length);
  if (F.missing) list = list.filter((p) => p.vk_missing);
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
  const cnt = $('#f-count');
  if (cnt) cnt.textContent = list.length === S.posts.length ? `Всего: ${num(list.length)}` : `Найдено: ${num(list.length)} из ${num(S.posts.length)}`;
  if (!list.length) {
    grid.innerHTML = `<div class="list-empty" style="grid-column:1/-1">${icon('search')}<br>Ничего не найдено. Попробуйте изменить условия поиска.</div>`;
    return;
  }
  stopIncremental = incremental(grid, list, card, { batch: 48, root: root() });
}

function card(p) {
  const ph = photos(p);
  const t = text(p);
  const changed = localChanges(p).length > 0;
  const vkc = vkChanged(p).length > 0;
  const el = html(`<article class="card" data-id="${esc(p.id)}">
    <div class="card-photo" data-open>
      ${ph[0] ? `<img src="${esc(photoSrc(ph[0]))}" alt="" loading="lazy" decoding="async" data-ph="Фото недоступно" />` : placeholder()}
      <div class="card-badges">
        ${p.is_new ? `<span class="badge mint">${icon('sparkle')} Новое</span>` : ''}
        ${vkc ? `<span class="badge lav" title="Публикация изменилась в ВКонтакте, а у вас своя версия">${icon('compare')} Изменено в VK</span>` : changed ? `<span class="badge pink" title="Есть локальные изменения">${icon('edit')} Изменено вручную</span>` : ''}
        ${p.vk_missing ? `<span class="badge amber" title="Публикация не найдена в ВКонтакте (удалена или скрыта). В библиотеке она сохранена.">${icon('alert')} Нет в VK</span>` : ''}
      </div>
      ${ph.length > 1 ? `<span class="photo-count">${icon('image')} ${ph.length}</span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-meta">${icon('calendar')}<span class="nowrap">${fmtDate(date(p))}</span><span>·</span><span class="src" title="${esc(sourceName(p))}">${esc(sourceName(p))}</span></div>
      <p class="card-text ${t ? '' : 'empty'}">${t ? esc(t.length > 600 ? t.slice(0, 600) + '…' : t) : 'Без текста'}</p>
      ${t.length > 160 || t.split('\n').length > 4 ? '<button class="more-link" data-open>Читать полностью</button>' : ''}
    </div>
    <div class="card-foot">
      <button class="likes-pill" data-likes title="Кто поставил «Мне нравится»">${icon('heartFill', 'fill')} ${num(p.likes_count)}</button>
      <div class="spacer"></div>
      <button class="btn ghost icon-only sm act" data-orig title="Открыть оригинал ВКонтакте">${icon('external')}</button>
      <button class="btn ghost icon-only sm act" data-edit title="Редактировать">${icon('edit')}</button>
      <button class="btn ghost icon-only sm act" data-del title="Удалить из библиотеки">${icon('trash')}</button>
    </div>
  </article>`);
  el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openPost(p.id)));
  el.querySelector('[data-orig]').onclick = () => window.api.openUrl(p.url);
  el.querySelector('[data-edit]').onclick = () => openEditor(p.id);
  el.querySelector('[data-del]').onclick = () => deletePost(p.id);
  const lk = el.querySelector('[data-likes]');
  lk.onclick = () => {
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
    .sort((a, b) => (b.likes || 0) - (a.likes || 0))
    .slice(0, 6);
  const missing = p.likes_count - ids.length;
  pop = html(`<div class="popover">
    <div class="popover-title">${p.likes_count ? `Понравилось ${pl(p.likes_count, 'человеку', 'людям', 'людям')}` : 'Пока никто не поставил лайк'}</div>
    ${sorted.map((u) => `<div class="person" data-uid="${u.id}" style="cursor:pointer">${avatar(u)}<div class="name">${esc(userName(u))}</div><button class="link-btn" data-vk="${esc(u.url || '')}" title="Открыть профиль ВКонтакте">${icon('external')}</button></div>`).join('')}
    ${ids.length > 6 ? `<div class="popover-foot">и ещё ${pl(ids.length - 6, 'человек', 'человека', 'человек')} — нажмите, чтобы увидеть всех</div>` : ''}
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
    text: 'Карточка переместится в корзину библиотеки. Публикация во ВКонтакте <b>не будет</b> удалена, и при обновлении данных эта карточка не появится снова. Вернуть её можно из корзины.',
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

window.addEventListener('scroll', hidePopover, true);
