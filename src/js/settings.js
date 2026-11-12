// Настройки: ВКонтакте, хранение, журнал, о программе.
import { S, reload } from './state.js';
import { startTour } from './tour.js';
import { icon, esc, $, $$, bytes, pl, toast, toastError, confirmDialog, modal } from './util.js';
import { emptyTrash } from './trash.js';
import { go } from './app.js';

// ---- параметры обновления (раньше были на вкладке «Источники») ----
function syncPanel(s) {
  return `<div class="panel" id="p-sync">
    <div class="panel-title">${icon('refresh')} Обновление данных</div>
    <p class="panel-sub">Кнопка «Обновить данные» проверяет только посты, которые вы добавили, — больше ничего не скачивается.</p>
    <label class="check"><input type="checkbox" id="opt-allphotos" ${s.sync.all_photos ? 'checked' : ''} /><span>Сохранять все фотографии поста<br><span class="hint">Иначе — только первую</span></span></label>
    <label class="check"><input type="checkbox" id="opt-avatars" ${s.sync.save_avatars ? 'checked' : ''} /><span>Сохранять аватары тех, кто лайкнул<br><span class="hint">Чтобы они были видны без интернета</span></span></label>
    <label class="check"><input type="checkbox" id="opt-likes" ${s.sync.refresh_all_likes ? 'checked' : ''} /><span>Полная проверка лайков при каждом обновлении<br><span class="hint">Медленнее. Обычно список перепроверяется, только если изменилось число лайков.</span></span></label>
  </div>`;
}

// ---- списки лайков: вход на vk.com (и сервисный ключ для старых приложений VK) ----
function likesPanel(acc) {
  const has = !!acc.serviceKey;
  return `<div class="panel" id="p-likes">
    <div class="panel-title">${icon('heart')} Списки лайков</div>
    <p class="panel-sub">ВКонтакте не даёт приложениям VK ID узнать, кто поставил лайк. Поэтому программа читает список «Оценили» прямо со страницы поста на vk.com — так же, как его видите вы.</p>
    <div id="web-status" class="row" style="margin-bottom:10px"><span class="hint">Проверяю вход на vk.com…</span></div>
    <span class="hint">Без входа видны только открытые посты и только первые ~350 лайкнувших. Пароль вы вводите на странице ВКонтакте — программа его не видит.</span>
    <details class="more"><summary>Сервисный ключ (для старых приложений VK)</summary>
      ${
        has
          ? `<div class="notice mint" style="margin:8px 0 12px">${icon('check')}<div>Сервисный ключ указан. Программа сначала попробует его, а если ВКонтакте откажет — возьмёт списки со страницы vk.com.</div></div>
             <div class="row"><button class="btn ghost danger" id="svc-clear">Удалить ключ</button></div>`
          : `<p class="hint">Нужен, только если ваше приложение создано на vk.com/dev (не через VK ID). У приложений VK ID сервисный ключ лайки не получает.</p>
             <div class="field"><label>Сервисный ключ доступа</label>
               <div class="row"><input class="input" id="svc-key" type="password" placeholder="Вставьте ключ" autocomplete="off" spellcheck="false" style="flex:1" /><button class="btn primary" id="svc-save">Сохранить</button></div>
             </div>`
      }
    </details>
  </div>`;
}

function renderWebStatus(st) {
  const box = $('#web-status');
  if (!box) return;
  box.innerHTML = st.loggedIn
    ? `<div class="notice mint" style="flex:1">${icon('check')}<div>Вы вошли на vk.com — списки лайков загружаются полностью.</div></div>
       <button class="btn ghost" id="web-logout">Выйти</button>`
    : `<span style="flex:1">${st.offline ? 'Не удалось проверить вход — нет связи с ВКонтакте.' : 'Вход на vk.com не выполнен.'}</span>
       <button class="btn primary" id="web-login">Войти на vk.com</button>`;
  $('#web-login')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await window.api.vkWebLogin();
      renderWebStatus(r);
      if (r.loggedIn) toast('Готово. Нажмите «Обновить данные», чтобы загрузить списки лайков.');
    } catch (err) {
      toastError(err);
      renderWebStatus({ loggedIn: false });
    }
  });
  $('#web-logout')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Выйти с vk.com?', text: 'Списки лайков будут загружаться без входа: только открытые посты и до ~350 человек. Уже собранные лайки останутся.', ok: 'Выйти' });
    if (!ok) return;
    renderWebStatus(await window.api.vkWebLogout().catch(() => ({ loggedIn: false })));
  });
}

function bindLikesPanel() {
  window.api.vkWebStatus().then(renderWebStatus, () => renderWebStatus({ loggedIn: false, offline: true }));
  $('#svc-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await window.api.setServiceKey($('#svc-key').value);
      await reload();
      toast('Сервисный ключ сохранён.');
      if (!r.secure) toast('Шифрование Windows недоступно — ключ понадобится снова после перезапуска', { error: true, timeout: 9000 });
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
    }
  });
  $('#svc-key')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#svc-save').click();
  });
  $('#svc-clear')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Удалить сервисный ключ?', text: 'Списки лайков будут загружаться со страницы vk.com. Уже собранные лайки останутся.', ok: 'Удалить', danger: true });
    if (!ok) return;
    await window.api.clearServiceKey();
    await reload();
  });
}

function bindSyncPanel() {
  const upd = (patch) => window.api.updateSettings({ sync: patch }).then((st) => (S.settings = st)).catch(toastError);
  $('#opt-allphotos').onchange = (e) => upd({ all_photos: e.target.checked });
  $('#opt-avatars').onchange = (e) => upd({ save_avatars: e.target.checked });
  $('#opt-likes').onchange = (e) => upd({ refresh_all_likes: e.target.checked });
}

export function renderSettings() {
  const el = $('#view-settings');
  const s = S.settings;
  const acc = S.account;
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Настройки</h1><div class="view-sub">Подключение ВКонтакте и хранение данных</div></div></div>
    <div class="settings-grid">
      <div class="col">
        <div class="panel" id="p-vk">
          <div class="panel-title">${icon('key')} Подключение ВКонтакте</div>
          <p class="panel-sub">Вход выполняется на официальной странице ВКонтакте. Пароль приложению не передаётся и не сохраняется.</p>
          ${
            acc.connected
              ? `<div class="account">
              ${acc.info?.photo ? `<img class="ava md" src="${esc(acc.info.photo)}" alt="" data-fallback='<div class="ava md">VK</div>' />` : '<div class="ava md">VK</div>'}
              <div style="flex:1"><div style="font-weight:850">${esc(acc.info?.name || 'Аккаунт подключён')}</div><div class="small"><span class="dot ok"></span>Подключено · ключ защищён шифрованием Windows</div></div>
            </div>
            <div class="row"><button class="btn" id="vk-check">${icon('refresh')} Проверить подключение</button><button class="btn ghost danger" id="vk-logout">Отключить</button></div>
            <div id="vk-check-res"></div>`
              : `<div class="account"><div class="ava md">VK</div><div><div style="font-weight:850">Не подключено</div><div class="small muted"><span class="dot off"></span>Без подключения можно смотреть уже собранную библиотеку</div></div></div>
            <div class="field"><label>ID приложения ВКонтакте</label>
              <div class="row"><input class="input" id="vk-appid" placeholder="Например: 51234567" value="${esc(s.vk.app_id || '')}" style="flex:1" /><button class="btn primary" id="vk-login">${icon('key')} Войти через ВКонтакте</button></div>
            </div>
            <div class="field"><label>Доверенный Redirect URL</label>
              <input class="input" id="vk-redirect" value="${esc(s.vk.redirect_uri || 'https://localhost/vk-callback')}" />
              <span class="hint">Должен в точности совпадать с адресом в настройках приложения VK. Сайт по этому адресу не нужен — программа перехватывает его сама.</span>
            </div>
            <details class="more"><summary>Как создать приложение VK (один раз)</summary>
              <ol class="steps">
                <li>Откройте <a href="#" data-url="https://id.vk.com/about/business/go">VK ID для бизнеса</a> и создайте приложение. Платформа — <b>Web</b>, название — любое.</li>
                <li>Базовый домен: <b>localhost</b></li>
                <li>Доверенный Redirect URL: <b>https://localhost/vk-callback</b> (если указали другой — впишите его в поле выше).</li>
                <li>В разделе «Доступы» по возможности включите «Стена» и «Сообщества» — без них программа тоже войдёт, но посты в закрытых сообществах будут недоступны.</li>
                <li>Скопируйте <b>ID приложения</b> (только цифры) в поле выше и нажмите «Войти через ВКонтакте».</li>
              </ol>
              <span class="hint">ID приложения не является секретом. Ключ входа хранится зашифрованным и продлевается автоматически.</span>
            </details>
            <details class="more"><summary>Другой способ: вставить ключ доступа</summary>
              <p class="hint" style="margin:4px 0 8px">Если у вас уже есть ключ доступа (или сервисный ключ приложения из настроек приложения VK), вставьте его сюда. Можно вставить и всю ссылку со страницы после входа.</p>
              <div class="row"><input class="input" id="vk-token" placeholder="Ключ доступа" style="flex:1" type="password" /><button class="btn" id="vk-token-save">Подключить</button></div>
            </details>`
          }
        </div>
        ${likesPanel(acc)}
        ${syncPanel(s)}
      </div>
      <div class="col">
        <div class="panel">
          <div class="panel-title">${icon('folder')} Хранение данных</div>
          <p class="panel-sub">Вся библиотека — обычная папка на вашем компьютере. Чтобы перенести её на другой компьютер, просто скопируйте эту папку.</p>
          <dl class="kv"><dt>Папка</dt><dd>${esc(S.paths.root)}</dd><dt>Занято</dt><dd id="usage">считаю…</dd></dl>
          <div class="row" style="margin-top:14px"><button class="btn" id="open-folder">${icon('folder')} Открыть папку</button><button class="btn ghost" id="change-folder">Изменить расположение</button><button class="btn ghost" id="integrity">${icon('shield')} Проверить файлы</button></div>
          <div id="integrity-res"></div>
        </div>
        <div class="panel" id="p-clean">
          <div class="panel-title">${icon('trash')} Очистка</div>
          <p class="panel-sub">Во ВКонтакте ничего не удаляется — только карточки в программе.</p>
          <div class="row">
            <button class="btn ghost danger" id="clean-posts" ${S.posts.length ? '' : 'disabled'}>${icon('trash')} Очистить все посты${S.posts.length ? ` (${S.posts.length})` : ''}</button>
            <button class="btn ghost danger" id="clean-trash" ${S.deleted.length ? '' : 'disabled'}>${icon('trash')} Удалить всё в корзине${S.deleted.length ? ` (${S.deleted.length})` : ''}</button>
          </div>
          <span class="hint">«Очистить все посты» переносит карточки в корзину — оттуда их можно вернуть. «Удалить всё в корзине» удаляет навсегда.</span>
        </div>
        <div class="panel">
          <div class="panel-title">${icon('info')} О программе</div>
          <dl class="kv"><dt>Версия</dt><dd>${esc(S.version)}</dd><dt>Обновления</dt><dd>Чтобы обновить программу, запустите установщик новой версии — библиотека сохранится.</dd><dt>Приватность</dt><dd>Данные хранятся только на этом компьютере. Программа обращается только к ВКонтакте.</dd></dl>
          <div class="row" style="margin-top:14px"><button class="btn" id="show-log">${icon('doc')} Журнал событий</button><button class="btn ghost" id="restart-tour">${icon('sparkle')} Пройти обучение</button></div>
        </div>
      </div>
    </div>`;

  $$('[data-url]', el).forEach((a) => (a.onclick = (e) => (e.preventDefault(), window.api.openUrl(a.dataset.url))));
  bindSyncPanel();
  bindLikesPanel();
  // ---- очистка ----
  $('#clean-posts').onclick = async () => {
    const n = S.posts.length;
    const ok = await confirmDialog({
      title: 'Очистить все посты?',
      text: `${pl(n, 'карточка переместится', 'карточки переместятся', 'карточек переместятся')} в корзину. Их можно будет вернуть оттуда. Во ВКонтакте посты не удалятся.`,
      ok: 'Очистить',
      danger: true,
    });
    if (!ok) return;
    try {
      const moved = await window.api.trashAllPosts();
      await reload();
      toast(`В корзину перемещено: ${pl(moved, 'карточка', 'карточки', 'карточек')}`, { action: 'Открыть корзину', onAction: () => go('trash') });
    } catch (e) {
      toastError(e);
    }
  };
  $('#clean-trash').onclick = () => emptyTrash();
  // ---- VK ----
  $('#vk-login')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await window.api.vkLogin($('#vk-appid').value.trim(), $('#vk-redirect').value.trim());
      await reload();
      toast(`Подключено: ${r.account.name}`);
      if (!r.secure) toast('Шифрование Windows недоступно — ключ не сохранён и понадобится снова после перезапуска', { error: true, timeout: 9000 });
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
    }
  });
  $('#vk-token-save')?.addEventListener('click', async () => {
    try {
      const r = await window.api.vkSetToken($('#vk-token').value);
      await reload();
      toast(`Подключено: ${r.account.name}`);
    } catch (err) {
      toastError(err);
    }
  });
  $('#vk-logout')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Отключить ВКонтакте?', text: 'Ключ доступа будет удалён с компьютера. Собранная библиотека останется. Чтобы снова обновлять данные, нужно будет подключиться заново.', ok: 'Отключить', danger: true });
    if (!ok) return;
    await window.api.vkLogout();
    await reload();
    toast('ВКонтакте отключён');
  });
  $('#vk-check')?.addEventListener('click', async (e) => {
    const box = $('#vk-check-res');
    e.currentTarget.disabled = true;
    try {
      const r = await window.api.vkCheck();
      box.innerHTML = !r.online
        ? `<div class="notice amber" style="margin-top:12px">${icon('wifiOff')}<div>Нет подключения к интернету. Библиотека работает как обычно, а обновить данные можно будет позже.</div></div>`
        : `<div class="notice mint" style="margin-top:12px">${icon('check')}<div>Всё работает: ${esc(r.account?.name || '')}</div></div>`;
    } catch (err) {
      box.innerHTML = `<div class="notice red" style="margin-top:12px">${icon('alert')}<div>${esc(err.message)}</div></div>`;
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  // ---- хранение ----
  window.api.usage().then((u) => {
    const el2 = $('#usage');
    if (el2) el2.textContent = `${bytes(u.total)} (фото ${bytes(u.photos)}, аватары ${bytes(u.avatars)}, данные ${bytes(u.data)})`;
  });
  $('#open-folder').onclick = () => window.api.openFolder();
  $('#change-folder').onclick = async () => {
    const ok = await confirmDialog({ title: 'Изменить расположение библиотеки?', text: 'Выберите новую папку. Библиотека будет скопирована туда, а старая папка останется на месте как запасная копия — удалить её можно позже вручную. Если в выбранной папке уже есть библиотека, программа откроет её.', ok: 'Выбрать папку' });
    if (!ok) return;
    try {
      const r = await window.api.changeLocation();
      if (!r) return;
      await reload();
      toast(r.usedExisting ? 'Открыта библиотека из выбранной папки' : 'Библиотека перенесена');
    } catch (e) {
      toastError(e);
    }
  };
  $('#integrity').onclick = async () => {
    const r = await window.api.integrity();
    const bad = r.filter((x) => !x.ok);
    $('#integrity-res').innerHTML = bad.length
      ? `<div class="notice red" style="margin-top:12px">${icon('alert')}<div>Повреждены: ${bad.map((x) => esc(x.name)).join(', ')}. Откройте папку с данными: рядом с повреждённым файлом лежит его предыдущая версия (.prev).</div></div>`
      : `<div class="notice mint" style="margin-top:12px">${icon('check')}<div>Все файлы в порядке: ${r.map((x) => `${esc(x.name)} (${bytes(x.size)})`).join(', ')}</div></div>`;
  };

  $('#show-log').onclick = async () => {
    const txt = await window.api.readLogs();
    const m = modal({ title: 'Журнал событий', cls: 'mid', body: `<div class="logbox">${esc(txt || 'Журнал пуст')}</div>`, foot: `<button class="btn ghost" id="log-open">${icon('folder')} Открыть папку журнала</button><button class="btn primary" data-close>Закрыть</button>` });
    m.el.querySelector('#log-open').onclick = () => window.api.openLogs();
    const lb = m.el.querySelector('.logbox');
    lb.scrollTop = lb.scrollHeight;
  };
  $('#restart-tour').onclick = () => startTour();
}
