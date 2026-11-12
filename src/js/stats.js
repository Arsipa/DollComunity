// Статистика: рейтинг самых активных участников и общие показатели.
import { S, photos, text, date } from './state.js';
import { icon, esc, $, $$, html, num, pl, fmtDate, fmtMs, photoSrc, avatar, userName, debounce, incremental } from './util.js';
import { openUser } from './people.js';
import { openPost } from './post.js';

const SF = { period: 'all', basis: 'posts', from: '', to: '', q: '', sort: 'likes', source: '' };

function periodRange() {
  const now = Date.now();
  if (SF.period === '7') return [now - 7 * 86400e3, now];
  if (SF.period === '30') return [now - 30 * 86400e3, now];
  if (SF.period === '365') return [now - 365 * 86400e3, now];
  if (SF.period === 'custom') return [SF.from ? new Date(SF.from + 'T00:00:00').getTime() : 0, SF.to ? new Date(SF.to + 'T23:59:59').getTime() : now];
  return null;
}

function compute() {
  const range = periodRange();
  let posts = S.posts;
  if (SF.source) posts = posts.filter((p) => p.source_id === SF.source);
  if (range && SF.basis === 'posts') posts = posts.filter((p) => date(p) * 1000 >= range[0] && date(p) * 1000 <= range[1]);
  const per = new Map();
  let collected = 0;
  for (const p of posts) {
    for (const [uid, seen] of Object.entries(p.likers || {})) {
      if (range && SF.basis === 'seen' && (seen < range[0] || seen > range[1])) continue;
      let r = per.get(uid);
      if (!r) per.set(uid, (r = { uid, likes: 0, sources: new Set(), last: 0 }));
      r.likes++;
      r.sources.add(p.source_id);
      if (seen > r.last) r.last = seen;
      collected++;
    }
  }
  const rows = [...per.values()];
  const totalLikes = posts.reduce((s, p) => s + (p.likes_count || 0), 0);
  return { posts, rows, collected, totalLikes };
}

export function renderStats() {
  const el = $('#view-stats');
  if (!S.posts.length) {
    el.innerHTML = `<div class="view-head"><div><h1 class="view-title">Статистика</h1></div></div><div class="empty"><div class="art">${icon('stats')}</div><h3>Статистики пока нет</h3><p>Она появится, когда в библиотеке будут публикации с лайками.</p></div>`;
    return;
  }
  el.innerHTML = `
    <div class="view-head">
      <div><h1 class="view-title">Статистика</h1><div class="view-sub">Кто чаще всего ставит «Мне нравится» публикациям из вашей библиотеки</div></div>
    </div>
    <div class="row" style="margin-bottom:12px;gap:12px">
      <div class="seg" id="s-period">
        <button data-p="all">Всё время</button><button data-p="7">Неделя</button><button data-p="30">Месяц</button><button data-p="365">Год</button><button data-p="custom">Свой период</button>
      </div>
      <span id="s-custom" class="${SF.period === 'custom' ? '' : 'hidden'} row">
        <input type="date" class="input" id="s-from" value="${SF.from}" style="width:160px" /> — <input type="date" class="input" id="s-to" value="${SF.to}" style="width:160px" />
      </span>
      <select class="select" id="s-basis" title="Как считать период">
        <option value="posts">по дате публикации</option>
        <option value="seen">по дате, когда лайк замечен</option>
      </select>
      <select class="select" id="s-source"><option value="">Все источники</option>${S.settings.sources.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select>
    </div>
    <div id="s-note"></div>
    <div class="kpis" id="s-kpis"></div>
    <div class="stats-grid">
      <div class="panel" style="padding:18px 14px">
        <div class="row between" style="padding:0 8px 10px">
          <div class="panel-title">${icon('crown')} Рейтинг участников</div>
          <div class="search" style="width:260px">${icon('search')}<input class="input" id="s-q" placeholder="Найти участника…" value="${esc(SF.q)}" /></div>
        </div>
        <table class="rank-table">
          <thead><tr>
            <th style="width:54px">Место</th><th data-sort="name">Участник</th>
            <th class="num" data-sort="likes">Лайки</th><th class="num" data-sort="share" title="Какой доле публикаций поставлен лайк">Публикаций</th><th class="num" data-sort="sources">Источников</th><th style="width:40px"></th>
          </tr></thead>
          <tbody id="s-rows"></tbody>
        </table>
      </div>
      <div class="col">
        <div class="panel"><div class="panel-title">${icon('heart')} Самые популярные публикации</div><p class="panel-sub">за выбранный период</p><div id="s-top"></div></div>
        <div class="panel"><div class="panel-title">${icon('stats')} Динамика</div><p class="panel-sub">по снимкам, сохранённым при каждом обновлении</p><div id="s-chart"></div></div>
      </div>
    </div>`;
  $$('#s-period button').forEach((b) => {
    b.classList.toggle('on', b.dataset.p === SF.period);
    b.onclick = () => {
      SF.period = b.dataset.p;
      renderStats();
    };
  });
  $('#s-basis').value = SF.basis;
  $('#s-source').value = SF.source;
  $('#s-basis').onchange = (e) => ((SF.basis = e.target.value), draw());
  $('#s-source').onchange = (e) => ((SF.source = e.target.value), draw());
  $('#s-from').onchange = (e) => ((SF.from = e.target.value), draw());
  $('#s-to').onchange = (e) => ((SF.to = e.target.value), draw());
  $('#s-q').addEventListener('input', debounce((e) => ((SF.q = e.target.value), drawRows(last)), 150));
  $$('.rank-table th[data-sort]').forEach(
    (th) =>
      (th.onclick = () => {
        SF.sort = th.dataset.sort;
        drawRows(last);
      }),
  );
  drawChart();
  draw();
}

let last = null;
function draw() {
  const c = (last = compute());
  const unique = c.rows.length;
  const note = $('#s-note');
  note.innerHTML =
    SF.period !== 'all' && SF.basis === 'seen'
      ? `<div class="notice lav banner">${icon('info')}<div>ВКонтакте не сообщает, когда поставлен лайк. Здесь учитывается момент, когда приложение <b>впервые увидело</b> лайк при обновлении. Лайки, найденные при первой загрузке, относятся ко дню этой загрузки.</div></div>`
      : SF.period !== 'all'
        ? `<div class="notice lav banner">${icon('info')}<div>Учитываются лайки к публикациям, вышедшим за выбранный период${S.history.snapshots.length < 2 ? '' : ''}.</div></div>`
        : '';
  const avg = c.posts.length ? c.totalLikes / c.posts.length : 0;
  const kpi = (v, l, color) => `<div class="kpi" style="--c:${color}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('#s-kpis').innerHTML =
    kpi(num(c.posts.length), plural(c.posts.length, 'публикация', 'публикации', 'публикаций'), 'var(--pink-soft)') +
    kpi(num(c.totalLikes), 'лайков всего (по данным VK)', 'var(--lav-soft)') +
    kpi(num(c.collected), 'лайков с именами собрано', 'var(--blue-soft)') +
    kpi(num(unique), plural(unique, 'активный участник', 'активных участника', 'активных участников'), 'var(--mint-soft)') +
    kpi(avg.toLocaleString('ru-RU', { maximumFractionDigits: 1 }), 'лайков в среднем на публикацию', 'var(--amber-soft)');
  drawRows(c);
  drawTop(c.posts);
}
function plural(n, a, b, c) {
  const x = n % 100;
  const y = n % 10;
  if (x > 10 && x < 20) return c;
  if (y === 1) return a;
  if (y > 1 && y < 5) return b;
  return c;
}

function drawRows(c) {
  if (!c) return;
  const tbody = $('#s-rows');
  const scroller = $('#view-stats');
  tbody.innerHTML = '';
  // места считаются по количеству лайков (одинаковое число — одно место)
  const ranked = [...c.rows].sort((a, b) => b.likes - a.likes);
  let place = 0;
  let prev = -1;
  ranked.forEach((r, i) => {
    if (r.likes !== prev) place = i + 1;
    prev = r.likes;
    r.place = place;
  });
  let rows = ranked;
  const q = SF.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => userName(S.users[r.uid]).toLowerCase().includes(q));
  const sorters = {
    likes: (a, b) => b.likes - a.likes,
    share: (a, b) => b.likes - a.likes,
    sources: (a, b) => b.sources.size - a.sources.size || b.likes - a.likes,
    name: (a, b) => userName(S.users[a.uid]).localeCompare(userName(S.users[b.uid]), 'ru'),
  };
  rows = [...rows].sort(sorters[SF.sort]);
  $$('.rank-table th[data-sort]').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === SF.sort));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="list-empty">${c.rows.length ? 'Никого не нашли' : 'За этот период лайков нет. Попробуйте другой период или обновите данные.'}</div></td></tr>`;
    return;
  }
  const max = ranked[0].likes || 1;
  const total = c.posts.length || 1;
  // tbody не может содержать служебный div — используем строку-«якорь»
  const anchor = document.createElement('tr');
  tbody.append(anchor);
  let shown = 0;
  const more = () => {
    const frag = document.createDocumentFragment();
    for (const r of rows.slice(shown, shown + 80)) {
      const u = S.users[r.uid] || { id: r.uid, first_name: 'Участник', last_name: r.uid };
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><div class="place ${r.place <= 3 ? 'p' + r.place : ''}">${r.place}</div></td>
        <td><div class="rank-name">${avatar(u)}<div style="min-width:0;flex:1"><div class="n">${esc(userName(u))}</div><div class="bar"><div style="width:${Math.max(3, (r.likes / max) * 100)}%"></div></div></div></div></td>
        <td class="num"><span class="big-num">${num(r.likes)}</span></td>
        <td class="num">${num(r.likes)} <span class="muted small">(${Math.round((r.likes / total) * 100)}%)</span></td>
        <td class="num">${num(r.sources.size)}</td>
        <td><button class="link-btn" data-vk title="Профиль ВКонтакте">${icon('external')}</button></td>`;
      tr.onclick = () => openUser(r.uid);
      tr.querySelector('[data-vk]').onclick = (e) => {
        e.stopPropagation();
        window.api.openUrl(u.url || `https://vk.com/id${r.uid}`);
      };
      frag.append(tr);
    }
    shown += 80;
    anchor.before(frag);
  };
  more();
  const io = new IntersectionObserver((e) => {
    if (e[0].isIntersecting && shown < rows.length) more();
    if (shown >= rows.length) io.disconnect();
  }, { root: scroller, rootMargin: '600px' });
  io.observe(anchor);
}

function drawTop(posts) {
  const top = [...posts].sort((a, b) => b.likes_count - a.likes_count).slice(0, 8);
  const box = $('#s-top');
  box.innerHTML = '';
  if (!top.length) return (box.innerHTML = '<div class="list-empty">Нет публикаций</div>');
  for (const p of top) {
    const ph = photos(p)[0];
    const el = html(`<div class="top-post">${ph ? `<img src="${esc(photoSrc(ph))}" alt="" data-ph="" />` : '<div class="ph"></div>'}<div class="t">${esc(text(p).slice(0, 140) || 'Без текста')}<div class="muted small">${fmtDate(date(p))}</div></div><span class="badge pink">${icon('heartFill', 'fill')} ${num(p.likes_count)}</span></div>`);
    el.onclick = () => openPost(p.id);
    box.append(el);
  }
}

function drawChart() {
  const box = $('#s-chart');
  const snaps = S.history.snapshots || [];
  if (snaps.length < 2) {
    box.innerHTML = `<div class="muted small" style="padding:8px 0">График появится после нескольких обновлений данных. Приложение сохраняет снимок статистики при каждом обновлении — так видно, как растёт активность. ${snaps.length ? `Сейчас снимков: ${snaps.length}.` : ''}</div>`;
    return;
  }
  const W = 320;
  const H = 140;
  const pad = 6;
  const series = [
    { key: 'collected_likes', color: '#c9607f', label: 'Лайки с именами' },
    { key: 'unique_users', color: '#7c66c4', label: 'Участники' },
  ];
  const t0 = snaps[0].at;
  const t1 = snaps[snaps.length - 1].at || t0 + 1;
  const lines = series
    .map((s) => {
      const max = Math.max(1, ...snaps.map((x) => x[s.key] || 0));
      const pts = snaps.map((x) => `${pad + ((x.at - t0) / (t1 - t0 || 1)) * (W - 2 * pad)},${H - pad - ((x[s.key] || 0) / max) * (H - 2 * pad)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />`;
    })
    .join('');
  const lastSnap = snaps[snaps.length - 1];
  box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lines}</svg>
    <div class="row small" style="margin-top:6px">${series.map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.label}: <b>${num(lastSnap[s.key])}</b></span>`).join(' ')}</div>
    <div class="muted small">${fmtMs(t0, false)} — ${fmtMs(t1, false)} · ${pl(snaps.length, 'снимок', 'снимка', 'снимков')}</div>`;
}
