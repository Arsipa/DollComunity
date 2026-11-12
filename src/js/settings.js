// Настройки: ВКонтакте, хранение, резервные копии, журнал, о программе.
import { S, reload } from './state.js';
import { startTour } from './tour.js';
import { icon, esc, $, $$, html, num, pl, fmtMs, bytes, toast, toastError, confirmDialog, modal } from './util.js';

export function renderSettings() {
  const el = $('#view-settings');
  const s = S.settings;
  const acc = S.account;
  el.innerHTML = `
    <div class="view-head"><div><h1 class="view-title">Настройки</h1><div class="view-sub">Подключение, хранение данных и резервные копии</div></div></div>
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
                <li>В разделе «Доступы» по возможности включите «Стена» и «Сообщества» — без них программа тоже войдёт, но закрытые сообщества будут недоступны.</li>
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
        <div class="panel">
          <div class="panel-title">${icon('folder')} Хранение данных</div>
          <p class="panel-sub">Вся библиотека — обычная папка на вашем компьютере. Чтобы перенести её на другой компьютер, просто скопируйте эту папку.</p>
          <dl class="kv"><dt>Папка</dt><dd>${esc(S.paths.root)}</dd><dt>Занято</dt><dd id="usage">считаю…</dd></dl>
          <div class="row" style="margin-top:14px"><button class="btn" id="open-folder">${icon('folder')} Открыть папку</button><button class="btn ghost" id="change-folder">Изменить расположение</button><button class="btn ghost" id="integrity">${icon('shield')} Проверить файлы</button></div>
          <div id="integrity-res"></div>
        </div>
      </div>
      <div class="col">
        <div class="panel" id="p-backups">
          <div class="panel-title">${icon('shield')} Резервные копии</div>
          <p class="panel-sub">Копии создаются автоматически раз в день и перед каждым обновлением данных.</p>
          <label class="check"><input type="checkbox" id="bk-auto" ${s.backups.auto ? 'checked' : ''} /><span>Автоматические резервные копии</span></label>
          <div class="row" style="margin:4px 0 12px"><span class="label">Хранить последних:</span>
            <select class="select" id="bk-keep">${[5, 10, 20, 40].map((n) => `<option value="${n}" ${s.backups.keep === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </div>
          <div class="row"><button class="btn primary" id="bk-create">${icon('plus')} Создать копию сейчас</button></div>
          <div id="bk-list" style="margin-top:10px"></div>
        </div>
        <div class="panel">
          <div class="panel-title">${icon('info')} О программе</div>
          <dl class="kv"><dt>Версия</dt><dd>${esc(S.version)}</dd><dt>Обновления</dt><dd>Чтобы обновить программу, запустите установщик новой версии — библиотека сохранится.</dd><dt>Приватность</dt><dd>Данные хранятся только на этом компьютере. Программа обращается только к ВКонтакте.</dd></dl>
          <div class="row" style="margin-top:14px"><button class="btn" id="show-log">${icon('doc')} Журнал событий</button><button class="btn ghost" id="restart-tour">${icon('sparkle')} Пройти обучение</button></div>
        </div>
      </div>
    </div>`;

  $$('[data-url]', el).forEach((a) => (a.onclick = (e) => (e.preventDefault(), window.api.openUrl(a.dataset.url))));
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
    if (el2) el2.textContent = `${bytes(u.total)} (фото ${bytes(u.photos)}, аватары ${bytes(u.avatars)}, данные ${bytes(u.data)}, копии ${bytes(u.backups)})`;
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
      ? `<div class="notice red" style="margin-top:12px">${icon('alert')}<div>Повреждены: ${bad.map((x) => esc(x.name)).join(', ')}. Восстановите данные из резервной копии.</div></div>`
      : `<div class="notice mint" style="margin-top:12px">${icon('check')}<div>Все файлы в порядке: ${r.map((x) => `${esc(x.name)} (${bytes(x.size)})`).join(', ')}</div></div>`;
  };

  // ---- копии ----
  $('#bk-auto').onchange = (e) => window.api.updateSettings({ backups: { auto: e.target.checked } }).then((st) => (S.settings = st));
  $('#bk-keep').onchange = (e) => window.api.updateSettings({ backups: { keep: Number(e.target.value) } }).then((st) => (S.settings = st));
  $('#bk-create').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await window.api.createBackup();
      toast('Резервная копия создана');
      drawBackups();
    } catch (err) {
      toastError(err);
    } finally {
      e.currentTarget.disabled = false;
    }
  };
  drawBackups();

  $('#show-log').onclick = async () => {
    const txt = await window.api.readLogs();
    const m = modal({ title: 'Журнал событий', cls: 'mid', body: `<div class="logbox">${esc(txt || 'Журнал пуст')}</div>`, foot: `<button class="btn ghost" id="log-open">${icon('folder')} Открыть папку журнала</button><button class="btn primary" data-close>Закрыть</button>` });
    m.el.querySelector('#log-open').onclick = () => window.api.openLogs();
    const lb = m.el.querySelector('.logbox');
    lb.scrollTop = lb.scrollHeight;
  };
  $('#restart-tour').onclick = () => startTour();
}

const KIND = { manual: 'Вручную (с фото)', auto: 'Автоматически', safety: 'Страховочная' };
async function drawBackups() {
  const box = $('#bk-list');
  if (!box) return;
  const list = await window.api.listBackups();
  if (!list.length) return (box.innerHTML = '<div class="list-empty">Копий пока нет</div>');
  box.innerHTML = list
    .map(
      (b) => `<div class="backup-row" data-name="${esc(b.name)}">
      <div class="info"><div style="font-weight:800">${fmtMs(b.created ? Date.parse(b.created) : 0)}</div>
      <div class="muted small">${esc(b.reason)} · ${KIND[b.kind] || b.kind}${b.posts !== null ? ` · ${pl(b.posts, 'публикация', 'публикации', 'публикаций')}` : ''}</div></div>
      <button class="btn sm" data-restore>${icon('restore')} Восстановить</button>
      <button class="btn ghost icon-only sm" data-reveal title="Открыть папку">${icon('folder')}</button>
      <button class="btn ghost icon-only sm danger" data-del title="Удалить копию">${icon('trash')}</button>
    </div>`,
    )
    .join('');
  $$('.backup-row', box).forEach((row) => {
    const name = row.dataset.name;
    row.querySelector('[data-restore]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Восстановить данные из копии?', text: 'Библиотека вернётся к состоянию на момент копии. Перед этим текущее состояние будет сохранено отдельной страховочной копией, так что ничего не потеряется.', ok: 'Восстановить' });
      if (!ok) return;
      try {
        await window.api.restoreBackup(name);
        await reload();
        toast('Данные восстановлены');
      } catch (e) {
        toastError(e);
      }
    };
    row.querySelector('[data-reveal]').onclick = () => window.api.revealBackup(name);
    row.querySelector('[data-del]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Удалить резервную копию?', text: 'Эту копию нельзя будет вернуть.', ok: 'Удалить', danger: true });
      if (!ok) return;
      await window.api.deleteBackup(name);
      drawBackups();
    };
  });
}
