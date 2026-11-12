// Статистика: рейтинг самых активных участников и общие показатели.
import { S, photos, text, date } from './state.js';
import { icon, esc, $, $$, html, num, pl, fmtDate, fmtMs, photoSrc, avatar, userName, debounce, incremental } from './util.js';
import { openUser } from './people.js';
import { openPost } from './post.js';

const SF = { period: 'all', basis: 'posts', q: '', sort: 'likes', dir: 'desc' };
// направление по умолчанию при первом нажатии на заголовок
const DEFAULT_DIR = { place: 'asc', name: 'asc', likes: 'desc', share: 'desc', last: 'desc' };

function periodRange() {
  const now = Date.now();
  if (SF.period === '7') return [now - 7 * 86400e3, now];
  if (SF.period === '30') return [now - 30 * 86400e3, now];
  if (SF.period === '365') return [now - 365 * 86400e3, now];
  return null;
}

function compute() {
  const range = periodRange();
  let posts = S.posts;
  if (range && SF.basis === 'posts') posts = posts.filter((p) => date(p) * 1000 >= range[0] && date(p) * 1000 <= range[1]);
  const per = new Map();
  let collected = 0;
  for (const p of posts) {
    for (const [uid, seen] of Object.entries(p.likers || {})) {
      if (range && SF.basis === 'seen' && (seen < range[0] || seen > range[1])) continue;
      let r = per.get(uid);
      if (!r) per.set(uid, (r = { uid, likes: 0, last: 0 }));
      r.likes++;
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
      <div><h1 class="view-title">Статистика</h1><div class="view-sub">Кто чаще всего ставит «Мне нравится» вашим постам</div></div>
    </div>
    <div class="row" style="margin-bottom:12px;gap:12px">
      <div class="seg" id="s-period">
        <button data-p="all">Всё время</button><button data-p="7">Неделя</button><button data-p="30">Месяц</button><button data-p="365">Год</button>
      </div>
      <select class="select" id="s-basis" title="Как считать период">
        <option value="posts">по дате публикации</option>
        <option value="seen">по дате, когда лайк замечен</option>
      </select>
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
            <th style="width:64px" data-sort="place" title="Сортировать по месту">Место</th><th data-sort="name" title="Сортировать по имени">Участник</th>
            <th class="num" data-sort="likes" title="Сортировать по числу лайков">Лайки</th><th class="num" data-sort="share" title="Какой доле публикаций поставлен лайк">Публикаций</th>
            <th class="num" data-sort="last" title="Когда лайк этого участника замечен в последний раз">Последний</th><th style="width:40px"></th>
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
  $('#s-basis').onchange = (e) => ((SF.basis = e.target.value), draw());
  $('#s-q').addEventListener('input', debounce((e) => ((SF.q = e.target.value), drawRows(last)), 150));
  $$('.rank-table th[data-sort]').forEach(
    (th) =>
      (th.onclick = () => {
        const k = th.dataset.sort;
        if (SF.sort === k) SF.dir = SF.dir === 'asc' ? 'desc' : 'asc';
        else ((SF.sort = k), (SF.dir = DEFAULT_DIR[k] || 'desc'));
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
  // все сравнения — «по возрастанию»; для убывания переворачиваем
  const nameOf = (r) => userName(S.users[r.uid] || { first_name: 'Участник', last_name: r.uid });
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), 'ru');
  const sorters = {
    place: (a, b) => a.place - b.place || byName(a, b),
    likes: (a, b) => a.likes - b.likes || byName(b, a),
    share: (a, b) => a.likes - b.likes || byName(b, a),
    last: (a, b) => a.last - b.last || byName(b, a),
    name: byName,
  };
  const cmp = sorters[SF.sort] || sorters.likes;
  const sign = SF.dir === 'asc' ? 1 : -1;
  rows = [...rows].sort((a, b) => sign * cmp(a, b));
  $$('.rank-table th[data-sort]').forEach((th) => {
    const on = th.dataset.sort === SF.sort;
    th.classList.toggle('sorted', on);
    th.dataset.dir = on ? SF.dir : '';
  });
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
        <td class="num muted small" title="${r.last ? esc(fmtMs(r.last)) : ''}">${r.last ? esc(fmtMs(r.last, false)) : '—'}</td>
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
  const pad = 8;
  const series = [
    { key: 'likes', color: '#c9607f', label: 'Лайки' },
    { key: 'unique_users', color: '#7c66c4', label: 'Участники' },
  ];
  const t0 = snaps[0].at;
  const t1 = snaps[snaps.length - 1].at || t0 + 1;
  const xOf = (x) => pad + ((x.at - t0) / (t1 - t0 || 1)) * (W - 2 * pad);
  for (const s of series) s.max = Math.max(1, ...snaps.map((x) => x[s.key] || 0));
  const yOf = (x, s) => H - pad - ((x[s.key] || 0) / s.max) * (H - 2 * pad);
  const lines = series
    .map((s) => `<polyline points="${snaps.map((x) => `${xOf(x)},${yOf(x, s)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />`)
    .join('');
  const lastSnap = snaps[snaps.length - 1];
  box.innerHTML = `<div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lines}<line class="chart-cursor" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke" /></svg>
      ${series.map((s, i) => `<span class="chart-pt" data-pt="${i}" style="background:${s.color}"></span>`).join('')}
      <div class="chart-tip" hidden></div>
    </div>
    <div class="row small" style="margin-top:6px">${series.map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.label}: <b>${num(lastSnap[s.key])}</b></span>`).join(' ')}</div>
    <div class="muted small">${fmtMs(t0, false)} — ${fmtMs(t1, false)} · ${pl(snaps.length, 'снимок', 'снимка', 'снимков')} · наведите на график, чтобы увидеть данные</div>`;

  const wrap = box.querySelector('.chart-wrap');
  const svg = wrap.querySelector('svg');
  const cur = svg.querySelector('.chart-cursor');
  const tip = wrap.querySelector('.chart-tip');
  const pts = [...wrap.querySelectorAll('.chart-pt')];
  const delta = (v, prev) => {
    if (prev == null) return '';
    const d = v - prev;
    return d ? ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${num(Math.abs(d))}</span>` : '';
  };
  const hide = () => {
    tip.hidden = true;
    cur.style.display = 'none';
    pts.forEach((p) => (p.style.display = 'none'));
  };
  hide();
  wrap.addEventListener('mouseleave', hide);
  wrap.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    // ближайший снимок по горизонтали
    let i = 0;
    for (let k = 1; k < snaps.length; k++) if (Math.abs(xOf(snaps[k]) - vx) < Math.abs(xOf(snaps[i]) - vx)) i = k;
    const x = snaps[i];
    const prev = snaps[i - 1];
    const px = (xOf(x) / W) * r.width;
    cur.setAttribute('x1', xOf(x));
    cur.setAttribute('x2', xOf(x));
    cur.style.display = '';
    series.forEach((s, k) => {
      pts[k].style.display = '';
      pts[k].style.left = `${px}px`;
      pts[k].style.top = `${(yOf(x, s) / H) * r.height}px`;
    });
    tip.innerHTML = `<div class="chart-tip-date">${esc(fmtMs(x.at))}</div>
      ${series.map((s) => `<div><span class="dot" style="background:${s.color}"></span>${s.label}: <b>${num(x[s.key] || 0)}</b>${delta(x[s.key] || 0, prev && (prev[s.key] || 0))}</div>`).join('')}
      <div class="muted">Публикаций: <b>${num(x.posts || 0)}</b>${x.collected_likes != null ? ` · собрано лайков: <b>${num(x.collected_likes)}</b>` : ''}</div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(r.width - tw, px - tw / 2))}px`;
  });
}
