// Источники: сообщества и страницы ВКонтакте, из которых собираются публикации.
import { S, reload } from './state.js';
import { icon, esc, $, $$, num, pl, ago, toast, toastError, confirmDialog } from './util.js';
import { startSync, go } from './app.js';

let preview = null;

export function renderSources() {
  const el = $('#view-sources');
  const s = S.settings;
  const counts = {};
  for (const p of S.posts) counts[p.source_id] = (counts[p.source_id] || 0) + 1;
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Источники</h1><div class="view-sub">Сообщества и страницы ВКонтакте, публикации которых собирает приложение</div></div></div>
    <div class="settings-grid">
      <div class="col">
        <div class="panel">
          <div class="panel-title">${icon('plus')} Добавить источник</div>
          <p class="panel-sub">Откройте нужное сообщество или страницу во ВКонтакте, скопируйте адрес из строки браузера и вставьте сюда.</p>
          ${S.account.connected ? '' : `<div class="notice amber" style="margin-bottom:12px">${icon('key')}<div>Сначала подключите ВКонтакте. <a href="#" id="to-settings">Перейти в настройки</a></div></div>`}
          <div class="add-source">
            <input class="input" id="src-input" placeholder="Например: https://vk.com/doll_fashion" ${S.account.connected ? '' : 'disabled'} />
            <button class="btn primary" id="src-find" ${S.account.connected ? '' : 'disabled'}>${icon('search')} Найти</button>
          </div>
          <div id="src-preview"></div>
        </div>
        <div class="panel">
          <div class="panel-title">${icon('settings')} Параметры загрузки</div>
          <p class="panel-sub">Сколько публикаций собирать из каждого источника</p>
          <div class="field"><label>Сколько последних публикаций загружать</label>
            <select class="select" id="opt-max">
              ${[50, 100, 200, 500, 1000, 3000, 0].map((n) => `<option value="${n}" ${Number(s.sync.max_posts) === n ? 'selected' : ''}>${n ? `до ${num(n)}` : 'все публикации'}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>За какой период</label>
            <select class="select" id="opt-since">
              ${[[0, 'за всё время'], [7, 'за последнюю неделю'], [30, 'за последний месяц'], [90, 'за 3 месяца'], [180, 'за полгода'], [365, 'за год']].map(([v, l]) => `<option value="${v}" ${Number(s.sync.since_days) === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <span class="hint">Уже загруженные публикации никуда не денутся — они проверяются при каждом обновлении.</span>
          </div>
          <label class="check"><input type="checkbox" id="opt-allphotos" ${s.sync.all_photos ? 'checked' : ''} /><span>Сохранять все фотографии публикации<br><span class="hint">Иначе — только первую</span></span></label>
          <label class="check"><input type="checkbox" id="opt-avatars" ${s.sync.save_avatars ? 'checked' : ''} /><span>Сохранять аватары участников на компьютер<br><span class="hint">Чтобы они были видны без интернета</span></span></label>
          <label class="check"><input type="checkbox" id="opt-likes" ${s.sync.refresh_all_likes ? 'checked' : ''} /><span>Полная проверка лайков при каждом обновлении<br><span class="hint">Медленнее. Обычно список перепроверяется, только если изменилось число лайков.</span></span></label>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">${icon('sources')} Подключённые источники</div>
        <p class="panel-sub">${s.sources.length ? pl(s.sources.length, 'источник', 'источника', 'источников') : 'Пока ни одного'}</p>
        <div id="src-list">${
          s.sources.length
            ? s.sources
                .map(
                  (x) => `<div class="source-row" data-id="${esc(x.id)}">
          ${x.photo ? `<img class="ava md" src="${esc(x.photo)}" alt="" data-fallback='<div class="ava md">${esc((x.name || '?')[0])}</div>' />` : `<div class="ava md">${esc((x.name || '?')[0])}</div>`}
          <div class="info">
            <div class="name">${esc(x.name)}</div>
            <div class="muted small">${x.type === 'group' ? 'Сообщество' : 'Страница'} · ${pl(counts[x.id] || 0, 'публикация', 'публикации', 'публикаций')} в библиотеке · обновлено ${ago(x.last_synced)}</div>
            ${x.last_error ? `<div class="small" style="color:var(--red-deep)">${icon('alert')} ${esc(x.last_error)}</div>` : ''}
          </div>
          <label class="switch" title="Загружать при обновлении"><input type="checkbox" data-toggle ${x.enabled !== false ? 'checked' : ''} /><span></span></label>
          <button class="btn ghost icon-only sm" data-sync title="Обновить только этот источник">${icon('refresh')}</button>
          <button class="btn ghost icon-only sm" data-open title="Открыть во ВКонтакте">${icon('external')}</button>
          <button class="btn ghost icon-only sm danger" data-rm title="Убрать источник">${icon('trash')}</button>
        </div>`,
                )
                .join('')
            : `<div class="list-empty">Добавьте первое сообщество или страницу слева</div>`
        }</div>
      </div>
    </div>`;
  $('#to-settings')?.addEventListener('click', (e) => (e.preventDefault(), go('settings')));
  const find = async () => {
    const v = $('#src-input').value.trim();
    if (!v) return;
    const btn = $('#src-find');
    btn.disabled = true;
    btn.innerHTML = `${icon('refresh', 'spin')} Ищу…`;
    try {
      preview = await window.api.resolveSource(v);
      drawPreview();
    } catch (e) {
      $('#src-preview').innerHTML = `<div class="notice red" style="margin-top:12px">${icon('alert')}<div>${esc(e.message)}</div></div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('search')} Найти`;
    }
  };
  $('#src-find').onclick = find;
  $('#src-input').onkeydown = (e) => e.key === 'Enter' && find();
  const upd = (patch) => window.api.updateSettings({ sync: patch }).then((st) => (S.settings = st)).catch(toastError);
  $('#opt-max').onchange = (e) => upd({ max_posts: Number(e.target.value) });
  $('#opt-since').onchange = (e) => upd({ since_days: Number(e.target.value) });
  $('#opt-allphotos').onchange = (e) => upd({ all_photos: e.target.checked });
  $('#opt-avatars').onchange = (e) => upd({ save_avatars: e.target.checked });
  $('#opt-likes').onchange = (e) => upd({ refresh_all_likes: e.target.checked });
  $$('#src-list .source-row').forEach((row) => {
    const id = row.dataset.id;
    const src = s.sources.find((x) => x.id === id);
    row.querySelector('[data-toggle]').onchange = async (e) => {
      await window.api.updateSource(id, { enabled: e.target.checked });
      src.enabled = e.target.checked;
    };
    row.querySelector('[data-sync]').onclick = () => startSync({ sourceIds: [id] });
    row.querySelector('[data-open]').onclick = () => window.api.openUrl(src.url);
    row.querySelector('[data-rm]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Убрать источник?', text: `«${esc(src.name)}» больше не будет проверяться на новые публикации. Уже собранные публикации <b>останутся</b> в библиотеке.`, ok: 'Убрать', danger: true });
      if (!ok) return;
      await window.api.removeSource(id);
      await reload();
      toast('Источник убран');
    };
  });
  if (preview) drawPreview();
}

function drawPreview() {
  const box = $('#src-preview');
  if (!box || !preview) return;
  const exists = S.settings.sources.some((x) => x.owner_id === preview.owner_id);
  box.innerHTML = `<div class="preview-src">
    ${preview.photo ? `<img class="ava md" src="${esc(preview.photo)}" alt="" />` : `<div class="ava md">${esc(preview.name[0])}</div>`}
    <div style="flex:1;min-width:0"><div style="font-weight:850">${esc(preview.name)}</div>
      <div class="muted small">${preview.type === 'group' ? 'Сообщество' : 'Страница'}${preview.members ? ` · ${pl(preview.members, 'участник', 'участника', 'участников')}` : ''}</div>
      ${preview.closed ? `<div class="small" style="color:var(--amber-deep)">${icon('alert')} Закрыто — публикации могут быть недоступны</div>` : ''}
    </div>
    <button class="btn primary" id="src-add" ${exists ? 'disabled' : ''}>${exists ? 'Уже добавлен' : icon('plus') + ' Добавить'}</button>
  </div>`;
  $('#src-add').onclick = async () => {
    try {
      await window.api.addSource(preview);
      preview = null;
      await reload();
      toast('Источник добавлен', { action: 'Загрузить публикации', onAction: () => startSync(), timeout: 8000 });
    } catch (e) {
      toastError(e);
    }
  };
}
