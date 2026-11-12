// Люди: панель «кто лайкнул», карточка пользователя, раздел «Пользователи».
import { S, photos, text, date, likersOf } from './state.js';
import { icon, esc, $, html, num, pl, fmtDate, fmtMs, photoSrc, avatar, userName, drawer, debounce, incremental } from './util.js';
import { openPost } from './post.js';

const userOf = (id) => S.users[id] || { id: Number(id), first_name: 'Участник', last_name: String(id), url: `https://vk.com/id${id}` };

function personRow(u, extra = '') {
  return html(`<div class="person" data-uid="${u.id}" style="cursor:pointer">
    ${avatar(u, 'md')}
    <div class="name">${esc(userName(u))}<small>${u.city ? esc(u.city) + ' · ' : ''}${pl(u.likes || 0, 'лайк', 'лайка', 'лайков')} в моих постах${u.is_closed ? ' · закрытый профиль' : ''}${u.deactivated ? ' · страница удалена' : ''}</small></div>
    ${extra}
    <button class="link-btn" data-vk title="Открыть профиль ВКонтакте">${icon('external')}</button>
  </div>`);
}

function bindPerson(el, u) {
  el.querySelector('[data-vk]').onclick = (e) => {
    e.stopPropagation();
    window.api.openUrl(u.url || `https://vk.com/id${u.id}`);
  };
  el.onclick = () => openUser(u.id);
  return el;
}

/** Панель со всеми, кто поставил лайк публикации */
export function openLikers(postId) {
  const p = S.byId.get(postId);
  if (!p) return;
  const ids = likersOf(p);
  const d = drawer({
    title: `Понравилось: ${num(p.likes_count)}`,
    tools: `<div class="search">${icon('search')}<input class="input" placeholder="Поиск по имени…" id="lk-q" /></div>
      <select class="select" id="lk-sort"><option value="active">Самые активные</option><option value="name">По имени</option><option value="seen">Недавние</option></select>`,
  });
  const draw = () => {
    const q = $('#lk-q', d.el).value.trim().toLowerCase();
    const sort = $('#lk-sort', d.el).value;
    let list = ids.map((id) => ({ u: userOf(id), seen: p.likers[id] }));
    if (q) list = list.filter((x) => userName(x.u).toLowerCase().includes(q));
    if (sort === 'name') list.sort((a, b) => userName(a.u).localeCompare(userName(b.u), 'ru'));
    else if (sort === 'seen') list.sort((a, b) => b.seen - a.seen);
    else list.sort((a, b) => (b.u.likes || 0) - (a.u.likes || 0));
    d.body.innerHTML = '';
    if (!ids.length) {
      d.body.innerHTML = `<div class="list-empty">${p.likes_count ? 'Список ещё не загружен. Нажмите «Обновить данные» в «Моих постах».' : 'Пока никто не поставил лайк.'}</div>`;
      return;
    }
    if (ids.length < p.likes_count) d.body.append(html(`<div class="notice amber" style="margin:6px 4px 10px">${icon('info')}<div>Собрано ${num(ids.length)} из ${num(p.likes_count)}. Часть лайков ВКонтакте может не показывать (например, от закрытых или удалённых страниц).</div></div>`));
    if (!list.length) {
      d.body.append(html('<div class="list-empty">Никого не нашли</div>'));
      return;
    }
    incremental(d.body, list, (x) => bindPerson(personRow(x.u), x.u), { batch: 80, root: d.body });
  };
  $('#lk-q', d.el).addEventListener('input', debounce(draw, 150));
  $('#lk-sort', d.el).onchange = draw;
  draw();
  setTimeout(() => $('#lk-q', d.el).focus(), 50);
}

/** Карточка пользователя */
export function openUser(uid) {
  uid = String(uid);
  const u = userOf(uid);
  const liked = (S.likedBy.get(uid) || []).map((id) => S.byId.get(id)).filter(Boolean).sort((a, b) => date(b) - date(a));
  const d = drawer({ title: 'Участник' });
  d.body.innerHTML = `
    <div class="profile-head">
      ${avatar(u, 'lg')}
      <h2>${esc(userName(u))}</h2>
      <div class="muted small">${[u.city, u.is_closed ? 'закрытый профиль' : '', u.deactivated ? 'страница удалена' : '', u.type === 'group' ? 'сообщество' : ''].filter(Boolean).map(esc).join(' · ')}</div>
      <button class="btn sm lav" style="margin-top:10px" data-vk>${icon('external')} Профиль ВКонтакте</button>
    </div>
    <div class="profile-stats">
      <div><b>${num(liked.length)}</b><span>лайков</span></div>
      <div><b>${S.posts.length ? Math.round((liked.length / S.posts.length) * 100) : 0}%</b><span>публикаций</span></div>
      <div><b>${num(S.posts.length)}</b><span>моих постов</span></div>
    </div>
    <div class="muted small" style="margin:-4px 0 12px;text-align:center">Впервые замечен(а) ${fmtMs(u.first_seen, false)} · последний лайк замечен ${fmtMs(u.last_like_seen, false)}</div>
    <div class="label" style="margin:6px 4px 10px">Понравившиеся публикации</div>
    <div class="mini-posts" id="u-posts"></div>`;
  d.el.querySelector('[data-vk]').onclick = () => window.api.openUrl(u.url || `https://vk.com/id${u.id}`);
  const box = d.el.querySelector('#u-posts');
  if (!liked.length) box.outerHTML = '<div class="list-empty">Среди ваших постов нет тех, что понравились этому участнику.</div>';
  else
    incremental(
      box,
      liked,
      (p) => {
        const ph = photos(p)[0];
        const el = html(`<div class="mini-post" title="${esc(fmtDate(date(p)))}">${ph ? `<img src="${esc(photoSrc(ph))}" alt="" loading="lazy" data-ph="" />` : `<div class="t">${esc(text(p).slice(0, 120) || 'Без текста')}</div>`}</div>`);
        el.onclick = () => openPost(p.id);
        return el;
      },
      { batch: 45, root: d.body },
    );
}
