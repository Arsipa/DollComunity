// Подробная карточка: галерея, полный текст, сравнение «Моя версия / Оригинал ВКонтакте», история, редактор.
import { S, eff, photos, text, date, localChanges, vkChanged, sourceName, likersOf, replacePost, reload, emit } from './state.js';
import { icon, esc, $, $$, html, num, pl, fmtDate, fmtMs, photoSrc, placeholder, modal, toast, toastError, wordDiff, confirmDialog } from './util.js';
import { openLikers } from './people.js';
import { deletePost } from './library.js';

const FIELD = { text: 'Текст', date: 'Дата', photos: 'Фотографии' };

export function openPost(id, tab = null) {
  const p = S.byId.get(id);
  if (!p) return;
  let idx = 0;
  let current = tab || (vkChanged(p).length ? 'compare' : 'post');
  const m = modal({ cls: 'wide', raw: true, body: '<div class="detail" style="min-height:0"></div>', onClose: () => emit('post-closed') });
  m.el.style.height = 'min(860px, calc(100vh - 60px))';

  const render = () => {
    const post = S.byId.get(id);
    if (!post) return m.close();
    const ph = photos(post);
    idx = Math.min(idx, Math.max(0, ph.length - 1));
    const changes = localChanges(post);
    const vkc = vkChanged(post);
    const root = m.el.querySelector('.detail');
    root.innerHTML = `
      <div class="gallery">
        <div class="gallery-main">
          ${ph[idx] ? `<img src="${esc(photoSrc(ph[idx], false))}" alt="" data-ph="Фото недоступно" />` : placeholder()}
          ${ph.length > 1 ? `<button class="g-nav prev" data-g="-1">${icon('chevL')}</button><button class="g-nav next" data-g="1">${icon('chevR')}</button>` : ''}
        </div>
        ${ph.length > 1 ? `<div class="g-thumbs">${ph.map((x, i) => `<img src="${esc(photoSrc(x))}" class="${i === idx ? 'on' : ''}" data-i="${i}" alt="" />`).join('')}</div>` : ''}
      </div>
      <div class="detail-side">
        <div class="row between">
          <div class="tabs">
            <button class="tab ${current === 'post' ? 'on' : ''}" data-tab="post">Публикация</button>
            <button class="tab ${current === 'compare' ? 'on' : ''}" data-tab="compare">Сравнение ${changes.length ? `<span class="badge pink">${changes.length}</span>` : ''}</button>
            <button class="tab ${current === 'history' ? 'on' : ''}" data-tab="history">История</button>
          </div>
          <button class="btn ghost icon-only sm" data-close title="Закрыть">${icon('close')}</button>
        </div>
        <div id="d-tab"></div>
      </div>`;
    const tabEl = root.querySelector('#d-tab');
    if (current === 'post') tabEl.innerHTML = postTab(post, changes, vkc);
    if (current === 'compare') tabEl.innerHTML = compareTab(post, changes, vkc);
    if (current === 'history') tabEl.innerHTML = historyTab(post);

    root.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => ((current = b.dataset.tab), render())));
    root.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => ((idx = (idx + Number(b.dataset.g) + ph.length) % ph.length), render())));
    root.querySelectorAll('.g-thumbs [data-i]').forEach((b) => (b.onclick = () => ((idx = Number(b.dataset.i)), render())));
    root.querySelector('[data-likes]')?.addEventListener('click', () => openLikers(id));
    root.querySelector('[data-orig]')?.addEventListener('click', () => window.api.openUrl(post.url));
    root.querySelector('[data-edit]')?.addEventListener('click', () => openEditor(id, render));
    root.querySelector('[data-del]')?.addEventListener('click', () => deletePost(id, () => m.close()));
    root.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => ((current = b.dataset.goto), render())));
    root.querySelectorAll('[data-accept]').forEach(
      (b) =>
        (b.onclick = async () => {
          const f = b.dataset.accept;
          const ok = await confirmDialog({ title: 'Принять версию ВКонтакте?', text: `${FIELD[f]}: ваша версия будет заменена оригиналом из ВКонтакте. Ваш вариант останется в истории изменений.`, ok: 'Принять оригинал' });
          if (!ok) return;
          try {
            replacePost(await window.api.acceptOriginal(id, f));
            emit('post-changed');
            render();
            toast('Принята версия ВКонтакте');
          } catch (e) {
            toastError(e);
          }
        }),
    );
    root.querySelectorAll('[data-keep]').forEach(
      (b) =>
        (b.onclick = async () => {
          replacePost(await window.api.keepMine(id, b.dataset.keep));
          emit('post-changed');
          render();
          toast('Ваша версия сохранена');
        }),
    );
    root.querySelectorAll('[data-merge]').forEach((b) => (b.onclick = () => openEditor(id, render, { merge: true })));
  };

  const onKey = (e) => {
    if (!document.body.contains(m.el)) return document.removeEventListener('keydown', onKey);
    const ph = photos(S.byId.get(id) || { original: {} });
    if (ph.length < 2 || document.querySelector('.overlay:last-of-type .modal') !== m.el) return;
    if (e.key === 'ArrowRight') ((idx = (idx + 1) % ph.length), render());
    if (e.key === 'ArrowLeft') ((idx = (idx - 1 + ph.length) % ph.length), render());
  };
  document.addEventListener('keydown', onKey);
  render();
}

function postTab(p, changes, vkc) {
  const t = text(p);
  const ids = likersOf(p);
  return `
    ${vkc.length ? `<div class="notice lav">${icon('compare')}<div>Публикация изменилась во ВКонтакте после вашей правки. Ваша версия сохранена. <a href="#" data-goto="compare">Сравнить версии</a></div></div>` : changes.length ? `<div class="notice amber" style="background:var(--pink-soft);color:#8a3653">${icon('edit')}<div>Есть локальные изменения: ${changes.map((f) => FIELD[f].toLowerCase()).join(', ')}. <a href="#" data-goto="compare">Сравнить с оригиналом</a></div></div>` : ''}
    ${p.vk_missing ? `<div class="notice amber">${icon('alert')}<div>Публикация не найдена во ВКонтакте с ${fmtMs(p.vk_missing, false)} — возможно, её удалили или скрыли. В вашей библиотеке она сохранена.</div></div>` : ''}
    <div class="card-meta">${icon('calendar')} ${fmtDate(date(p), true)} · ${esc(sourceName(p))}</div>
    <p class="detail-text">${t ? esc(t) : '<span class="muted">Без текста</span>'}</p>
    <div class="row">
      <button class="likes-pill" data-likes>${icon('heartFill', 'fill')} ${num(p.likes_count)}</button>
      <span class="muted small">${ids.length ? `собрано ${pl(ids.length, 'имя', 'имени', 'имён')} — нажмите, чтобы посмотреть всех` : 'список появится после обновления данных'}</span>
    </div>
    <div class="row small muted">${p.reposts ? `${icon('refresh')} ${pl(p.reposts, 'репост', 'репоста', 'репостов')}` : ''} ${p.views ? `· ${pl(p.views, 'просмотр', 'просмотра', 'просмотров')}` : ''} ${p.comments ? `· ${pl(p.comments, 'комментарий', 'комментария', 'комментариев')}` : ''}</div>
    <hr class="stitch" style="margin:4px 0" />
    <div class="detail-actions">
      <button class="btn primary" data-orig>${icon('external')} Открыть оригинал</button>
      <button class="btn" data-edit>${icon('edit')} Редактировать</button>
      <button class="btn ghost danger" data-del>${icon('trash')} Удалить</button>
    </div>
    <div class="muted small">Добавлено ${fmtMs(p.added_at)} · проверено ${fmtMs(p.last_checked)}</div>`;
}

function photosStrip(list) {
  if (!list || !list.length) return '<span class="muted small">Нет фото</span>';
  return `<div class="version-photos">${list.map((x) => `<img src="${esc(photoSrc(x))}" alt="" data-ph="" />`).join('')}</div>`;
}

function compareTab(p, changes, vkc) {
  if (!changes.length)
    return `<div class="notice mint">${icon('check')}<div>Локальных изменений нет — карточка совпадает с оригиналом ВКонтакте. Если вы отредактируете карточку, здесь появится сравнение «Моя версия / Оригинал ВКонтакте».</div></div>`;
  return changes
    .map((f) => {
      const mine = p.local[f];
      const orig = p.original[f];
      let a;
      let b;
      if (f === 'text') {
        const d = wordDiff(orig, mine);
        a = `<div class="txt">${d.b || '<span class="muted">пусто</span>'}</div>`;
        b = `<div class="txt">${d.a || '<span class="muted">пусто</span>'}</div>`;
      } else if (f === 'date') {
        a = `<div class="txt">${fmtDate(mine, true)}</div>`;
        b = `<div class="txt">${fmtDate(orig, true)}</div>`;
      } else {
        a = photosStrip(mine);
        b = photosStrip(orig);
      }
      return `<div style="margin-bottom:18px">
        <div class="row between" style="margin-bottom:8px"><b>${FIELD[f]}</b>${vkc.includes(f) ? `<span class="badge lav">${icon('compare')} изменено в VK ${fmtMs(p.vk_changed[f], false)}</span>` : ''}</div>
        <div class="compare">
          <div class="version mine"><h4>${icon('edit')} Моя версия</h4>${a}</div>
          <div class="version"><h4>${icon('external')} Оригинал ВКонтакте</h4>${b}</div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn sm ${vkc.includes(f) ? 'primary' : ''}" data-keep="${f}">${icon('check')} Оставить мою</button>
          <button class="btn sm" data-accept="${f}">${icon('restore')} Принять оригинал VK</button>
          ${f === 'text' ? `<button class="btn sm lav" data-merge="${f}">${icon('edit')} Объединить вручную</button>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function historyTab(p) {
  const KIND = { import: 'Публикация добавлена в библиотеку', vk: 'Изменилось во ВКонтакте', edit: 'Изменено вами', accept: 'Принят оригинал ВКонтакте', restore: 'Восстановлено из корзины', missing: 'Не найдено во ВКонтакте' };
  const items = [...(p.history || [])].reverse();
  if (!items.length) return '<div class="list-empty">История пуста</div>';
  return `<ul class="history">${items
    .map(
      (h) => `<li><div class="when">${fmtMs(h.at)}</div><div class="what"><b>${KIND[h.kind] || h.kind}</b>${h.field ? ` · ${FIELD[h.field] || h.field}` : ''}
      ${h.field === 'text' && (h.from !== undefined || h.to !== undefined) ? `<div class="diffline">было: «${esc(String(h.from ?? '').slice(0, 160))}${String(h.from ?? '').length > 160 ? '…' : ''}»<br>стало: «${esc(String(h.to ?? '').slice(0, 160))}${String(h.to ?? '').length > 160 ? '…' : ''}»</div>` : ''}
      ${h.field === 'date' ? `<div class="diffline">${fmtDate(h.from, true)} → ${fmtDate(h.to, true)}</div>` : ''}
      ${h.field === 'photos' ? `<div class="diffline">${esc(h.from)} → ${esc(h.to)}</div>` : ''}
      </div></li>`,
    )
    .join('')}</ul>`;
}

// ---------- редактор ----------
const toLocalInput = (sec) => {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function openEditor(id, after, { merge = false } = {}) {
  const p = S.byId.get(id);
  if (!p) return;
  let ph = [...photos(p)];
  const startText = merge && p.overrides.text ? `${p.local.text}\n\n——— Оригинал ВКонтакте ———\n${p.original.text}` : text(p);
  const m = modal({
    title: merge ? 'Объединить тексты' : 'Редактировать карточку',
    cls: 'mid',
    body: `
      <div class="notice lav" style="margin-bottom:14px">${icon('info')}<div>Изменения сохраняются только в вашей библиотеке. Публикация во ВКонтакте не изменится, а оригинал будет доступен для сравнения.</div></div>
      <div class="field"><label>Текст</label><textarea class="input" id="e-text" rows="${merge ? 14 : 9}">${esc(startText)}</textarea>${merge ? '<span class="hint">Оставьте нужные части обоих текстов и удалите лишнее.</span>' : ''}</div>
      <div class="field"><label>Дата публикации</label><input type="datetime-local" class="input" id="e-date" value="${toLocalInput(date(p))}" style="max-width:260px" /><span class="hint">Меняется только отображение в библиотеке.</span></div>
      <div class="field"><label>Фотографии</label><div class="edit-photos" id="e-photos"></div><span class="hint">Первая фотография показывается на карточке.</span></div>
      ${p.overrides.photos ? '<button class="btn sm ghost" id="e-photo-reset">' + icon('restore') + ' Вернуть фото из ВКонтакте</button>' : ''}`,
    foot: `<button class="btn ghost" data-close>Отмена</button><button class="btn primary" id="e-save">${icon('check')} Сохранить</button>`,
  });
  const drawPhotos = () => {
    const box = m.el.querySelector('#e-photos');
    box.innerHTML =
      ph
        .map(
          (x, i) => `<div class="edit-photo"><img src="${esc(photoSrc(x))}" alt="" data-ph="" />
          ${i > 0 ? `<button class="mv" data-first="${i}" title="Сделать главной">${icon('arrowUp')}</button>` : '<span class="badge pink first">главная</span>'}
          <button class="x" data-rm="${i}" title="Убрать">${icon('close')}</button></div>`,
        )
        .join('') + `<button class="add-photo" id="e-add">${icon('plus')}<span>Добавить фото</span></button>`;
    box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => (ph.splice(Number(b.dataset.rm), 1), drawPhotos())));
    box.querySelectorAll('[data-first]').forEach((b) => (b.onclick = () => (ph.unshift(ph.splice(Number(b.dataset.first), 1)[0]), drawPhotos())));
    box.querySelector('#e-add').onclick = async () => {
      try {
        const np = await window.api.pickPhoto();
        if (np) {
          ph.push(np);
          drawPhotos();
        }
      } catch (e) {
        toastError(e);
      }
    };
  };
  drawPhotos();
  m.el.querySelector('#e-photo-reset')?.addEventListener('click', async () => {
    try {
      replacePost(await window.api.acceptOriginal(id, 'photos'));
      ph = [...photos(S.byId.get(id))];
      drawPhotos();
      m.el.querySelector('#e-photo-reset').remove();
      emit('post-changed');
    } catch (e) {
      toastError(e);
    }
  });
  m.el.querySelector('#e-save').onclick = async () => {
    const patch = {};
    const t = m.el.querySelector('#e-text').value;
    if (t !== text(p) || (merge && p.overrides.text)) patch.text = t;
    const dv = m.el.querySelector('#e-date').value;
    if (dv) {
      const sec = Math.round(new Date(dv).getTime() / 1000);
      if (toLocalInput(sec) !== toLocalInput(date(p))) patch.date = sec;
    }
    const keys = (a) => a.map((x) => x.key).join('|');
    if (keys(ph) !== keys(photos(p))) patch.photos = ph;
    if (!Object.keys(patch).length) return m.close();
    try {
      replacePost(await window.api.editPost(id, patch));
      m.close();
      emit('post-changed');
      after && after();
      toast('Изменения сохранены');
    } catch (e) {
      toastError(e);
    }
  };
  setTimeout(() => m.el.querySelector('#e-text').focus(), 40);
}
