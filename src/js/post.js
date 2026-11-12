// Подробная карточка: галерея, полный текст, редактор.
import { S, photos, text, date, localChanges, ownerName, likersOf, replacePost, emit } from './state.js';
import { icon, esc, num, pl, fmtDate, fmtMs, photoSrc, placeholder, modal, toast, toastError, avatar, userName } from './util.js';
import { openLikers, openUser } from './people.js';
import { deletePost, sourceChip, ownerUrl } from './library.js';

const FIELD = { text: 'Текст', date: 'Дата', photos: 'Фотографии' };

export function openPost(id, startIdx = 0) {
  const p = S.byId.get(id);
  if (!p) return;
  let idx = Number(startIdx) || 0;
  const m = modal({ cls: 'wide', raw: true, body: '<div class="detail" style="min-height:0"></div>', onClose: () => emit('post-closed') });
  m.el.style.height = 'min(860px, calc(100vh - 60px))';

  const render = () => {
    const post = S.byId.get(id);
    if (!post) return m.close();
    const ph = photos(post);
    idx = Math.min(idx, Math.max(0, ph.length - 1));
    const changes = localChanges(post);
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
        <div class="detail-top">
          <button class="btn primary sm" data-orig title="Открыть пост во ВКонтакте">${icon('external')} Открыть оригинал</button>
          <button class="btn sm icon-only" data-edit title="Редактировать карточку">${icon('edit')}</button>
          <button class="btn ghost sm icon-only danger" data-del title="Удалить (убрать в корзину)">${icon('trash')}</button>
          <div class="spacer"></div>
          <button class="btn ghost icon-only sm" data-close title="Закрыть">${icon('close')}</button>
        </div>
        <div id="d-tab">${postTab(post, changes)}</div>
      </div>`;
    root.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => ((idx = (idx + Number(b.dataset.g) + ph.length) % ph.length), render())));
    root.querySelectorAll('.g-thumbs [data-i]').forEach((b) => (b.onclick = () => ((idx = Number(b.dataset.i)), render())));
    root.querySelectorAll('[data-likes]').forEach((b) => b.addEventListener('click', () => openLikers(id)));
    root.querySelector('[data-src]')?.addEventListener('click', () => window.api.openUrl(ownerUrl(post)));
    root.querySelectorAll('[data-uid]').forEach((b) => b.addEventListener('click', () => openUser(b.dataset.uid)));
    root.querySelector('[data-orig]')?.addEventListener('click', () => window.api.openUrl(post.url));
    root.querySelector('[data-edit]')?.addEventListener('click', () => openEditor(id, render));
    root.querySelector('[data-del]')?.addEventListener('click', () => deletePost(id, () => m.close()));
  };

  const onKey = (e) => {
    if (!document.body.contains(m.el)) return document.removeEventListener('keydown', onKey);
    const ph = photos(S.byId.get(id) || { original: {} });
    const layers = document.querySelectorAll('.overlay, .drawer-wrap');
    if (ph.length < 2 || layers[layers.length - 1] !== m.el.parentElement) return; // стрелки — только если пост сверху
    if (e.key === 'ArrowRight') ((idx = (idx + 1) % ph.length), render());
    if (e.key === 'ArrowLeft') ((idx = (idx - 1 + ph.length) % ph.length), render());
  };
  document.addEventListener('keydown', onKey);
  render();
}

const LIKERS_INLINE = 40;

function postTab(p, changes) {
  const t = text(p);
  const ids = likersOf(p);
  const stats = [
    p.views ? `${icon('image')} ${pl(p.views, 'просмотр', 'просмотра', 'просмотров')}` : '',
    p.reposts ? `${icon('refresh')} ${pl(p.reposts, 'репост', 'репоста', 'репостов')}` : '',
    p.comments ? `${icon('doc')} ${pl(p.comments, 'комментарий', 'комментария', 'комментариев')}` : '',
  ].filter(Boolean);
  const people = ids
    .map((id) => S.users[id] || { id, first_name: 'Участник', last_name: String(id) })
    .sort((a, b) => (b.likes || 0) - (a.likes || 0) || userName(a).localeCompare(userName(b), 'ru'));
  return `
    ${changes.length ? `<div class="notice amber" style="background:var(--pink-soft);color:#8a3653">${icon('edit')}<div>Изменено вами: ${changes.map((f) => FIELD[f].toLowerCase()).join(', ')}. Ваша версия главнее данных ВКонтакте.</div></div>` : ''}
    ${p.vk_missing ? `<div class="notice amber">${icon('alert')}<div>Пост не найден во ВКонтакте с ${fmtMs(p.vk_missing, false)} — возможно, его удалили или скрыли. У вас он сохранён.</div></div>` : ''}
    <section class="d-head">
      ${p.title ? `<h2 class="d-title">${esc(p.title)}</h2>` : ''}
      <div class="d-meta">${sourceChip(p)}<span class="card-date">${icon('calendar')}${fmtDate(date(p), true)}</span></div>
    </section>
    <p class="detail-text">${t ? esc(t) : '<span class="muted">Без текста</span>'}</p>
    <div class="d-stats">
      <button class="likes-pill" data-likes title="Кто поставил «Мне нравится»">${icon('heartFill', 'fill')} ${num(p.likes_count)}</button>
      ${stats.map((x) => `<span class="d-stat">${x}</span>`).join('')}
    </div>
    ${
      people.length
        ? `<section class="d-likers">
        <div class="d-sub">${icon('heart')} Понравилось ${pl(people.length, 'человеку', 'людям', 'людям')}${people.length < p.likes_count ? ` <span class="muted">из ${num(p.likes_count)}</span>` : ''}</div>
        <div class="d-people">${people
          .slice(0, LIKERS_INLINE)
          .map((u) => `<button class="person" data-uid="${esc(String(u.id))}" title="Открыть карточку участника">${avatar(u)}<span class="name">${esc(userName(u))}${u.likes > 1 ? `<small>${pl(u.likes, 'лайк', 'лайка', 'лайков')} у вас</small>` : ''}</span></button>`)
          .join('')}</div>
        ${people.length > LIKERS_INLINE ? `<button class="btn ghost sm" data-likes>Показать всех (${num(people.length)})</button>` : ''}
      </section>`
        : p.likes_count
          ? `<div class="muted small">Список тех, кто поставил лайк, появится после обновления данных.</div>`
          : ''
    }
    <div class="muted small d-foot">Добавлено ${fmtMs(p.added_at)} · проверено ${fmtMs(p.last_checked)}</div>`;
}

// ---------- редактор ----------
const toLocalInput = (sec) => {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function openEditor(id, after) {
  const p = S.byId.get(id);
  if (!p) return;
  let ph = [...photos(p)];
  const startText = text(p);
  const m = modal({
    title: 'Редактировать карточку',
    cls: 'mid',
    body: `
      <div class="notice lav" style="margin-bottom:14px">${icon('info')}<div>Изменения сохраняются только у вас. Пост во ВКонтакте не изменится.</div></div>
      ${`<div class="field"><label>Название поста</label><input class="input" id="e-title" maxlength="200" placeholder="Например: Платье для Паолы, весна" value="${esc(p.title || '')}" /><span class="hint">Видно только вам.</span></div>`}
      <div class="field"><label>Текст</label><textarea class="input" id="e-text" rows="9">${esc(startText)}</textarea></div>
      <div class="field"><label>Дата публикации</label><input type="datetime-local" class="input" id="e-date" value="${toLocalInput(date(p))}" style="max-width:260px" /><span class="hint">Меняется только отображение у вас.</span></div>
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
    if (t !== text(p)) patch.text = t;
    const dv = m.el.querySelector('#e-date').value;
    if (dv) {
      const sec = Math.round(new Date(dv).getTime() / 1000);
      if (toLocalInput(sec) !== toLocalInput(date(p))) patch.date = sec;
    }
    const keys = (a) => a.map((x) => x.key).join('|');
    if (keys(ph) !== keys(photos(p))) patch.photos = ph;
    const titleEl = m.el.querySelector('#e-title');
    const newTitle = titleEl ? titleEl.value.replace(/\s+/g, ' ').trim() : p.title || '';
    const titleChanged = newTitle !== (p.title || '');
    if (!Object.keys(patch).length && !titleChanged) return m.close();
    try {
      if (titleChanged) replacePost(await window.api.setPostTitle(id, newTitle));
      if (Object.keys(patch).length) replacePost(await window.api.editPost(id, patch));
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
