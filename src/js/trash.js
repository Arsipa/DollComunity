// Корзина: карточки, убранные из «Моих постов». Их можно вернуть или удалить навсегда.
import { S, reload, eff } from './state.js';
import { icon, esc, $, $$, fmtMs, fmtDate, photoSrc, pl, toast, toastError, confirmDialog } from './util.js';

/** «Удалить всё в корзине» — общая для корзины и настроек. true, если удалено. */
export async function emptyTrash() {
  const n = S.deleted.length;
  if (!n) {
    toast('Корзина уже пуста');
    return false;
  }
  const ok = await confirmDialog({
    title: 'Удалить всё в корзине?',
    text: `${pl(n, 'карточка будет удалена', 'карточки будут удалены', 'карточек будут удалены')} навсегда вместе с вашими правками, историей, списками лайков и сохранёнными фото. Отменить это нельзя. Во ВКонтакте посты останутся — их можно будет добавить заново по ссылке.`,
    ok: 'Удалить навсегда',
    danger: true,
  });
  if (!ok) return false;
  try {
    const removed = await window.api.clearTrash();
    await reload();
    toast(`Корзина очищена: ${pl(removed, 'карточка', 'карточки', 'карточек')}`);
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export function renderTrash() {
  const el = $('#view-trash');
  const list = S.deleted;
  const live = list.filter((d) => d.post);
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Корзина</h1><div class="view-sub">Карточки, убранные из «Моих постов». Во ВКонтакте посты не удалялись.</div></div>
    <div class="spacer"></div>
    ${live.length ? `<button class="btn" id="tr-all">${icon('restore')} Вернуть все</button>` : ''}
    ${list.length ? `<button class="btn ghost danger" id="tr-clear">${icon('trash')} Удалить все</button>` : ''}</div>
    ${
      list.length
        ? `<div class="panel">${list
            .map((d) => {
              const p = d.post;
              const ph = p ? (eff(p, 'photos') || [])[0] : null;
              const t = p ? p.title || eff(p, 'text') || 'Без текста' : d.title || 'Содержимое удалено навсегда';
              return `<div class="source-row" data-id="${esc(d.id)}">
                ${ph ? `<img class="ava md" style="border-radius:12px" src="${esc(photoSrc(ph))}" alt="" data-ph="" />` : `<div class="ava md" style="border-radius:12px">${icon('dress')}</div>`}
                <div class="info"><div style="font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.slice(0, 140))}</div>
                <div class="muted small">${p ? `от ${fmtDate(eff(p, 'date') || p.original.date)} · ` : ''}удалено ${fmtMs(d.deleted_at)}</div></div>
                ${p ? `<button class="btn sm" data-restore>${icon('restore')} Вернуть</button><button class="btn ghost sm danger" data-forget>Удалить навсегда</button>` : `<button class="btn ghost sm" data-allow title="Запись старой версии программы">Убрать из списка</button>`}
              </div>`;
            })
            .join('')}</div>`
        : `<div class="empty"><div class="art">${icon('trash')}</div><h3>Корзина пуста</h3><p>Если убрать карточку из «Моих постов», она попадёт сюда и её можно будет вернуть.</p></div>`
    }`;
  $('#tr-all')?.addEventListener('click', async () => {
    await window.api.restorePosts(live.map((d) => d.id));
    await reload();
    toast(`Возвращено: ${pl(live.length, 'карточка', 'карточки', 'карточек')}`);
  });
  $('#tr-clear')?.addEventListener('click', () => emptyTrash());
  $$('[data-id]', el).forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-restore]')?.addEventListener('click', async () => {
      try {
        await window.api.restorePosts([id]);
        await reload();
        toast('Карточка возвращена в «Мои посты»');
      } catch (e) {
        toastError(e);
      }
    });
    row.querySelector('[data-forget]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Удалить навсегда?', text: 'Карточка будет удалена вместе с вашими правками, историей и списком лайков. Во ВКонтакте пост останется — его можно будет добавить заново по ссылке.', ok: 'Удалить навсегда', danger: true });
      if (!ok) return;
      await window.api.forgetPosts([id]);
      await reload();
    });
    row.querySelector('[data-allow]')?.addEventListener('click', async () => {
      await window.api.allowReturn([id]);
      await reload();
    });
  });
}
