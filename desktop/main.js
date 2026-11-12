'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu, screen, safeStorage, nativeImage, session } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { Store, stamp } = require('./storage');
const { SyncEngine } = require('./sync');
const { VkClient, parseSourceInput } = require('./vk');
const M = require('./model');
const vkid = require('./vkid');

const APP_NAME = 'VK Doll Community';
const SRC_DIR = path.join(__dirname, '..', 'src');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'vkd', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Служебные файлы Chromium и зашифрованный ключ VK — в %LOCALAPPDATA% (привязаны к компьютеру),
// библиотека — в %APPDATA%\VK Doll Community (её можно просто скопировать на другой компьютер).
const DEV_TEST = !app.isPackaged && process.env.VKD_TEST_ROOT;
const LOCAL_BASE = DEV_TEST ? path.join(process.env.VKD_TEST_ROOT, 'system') : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), APP_NAME);
app.setPath('userData', LOCAL_BASE);
app.setName(APP_NAME);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
const TOKEN_FILE = () => path.join(app.getPath('userData'), 'secure', 'vk-token.bin');
const defaultRoot = () => (DEV_TEST ? path.join(process.env.VKD_TEST_ROOT, 'library') : path.join(app.getPath('appData'), APP_NAME));

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
  } catch (_) {
    return {};
  }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  const tmp = CONFIG_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_FILE());
}

let config = readConfig();
let store;
let win;
let problems = [];
let memSession = null; // если шифрование Windows недоступно — ключ живёт только до закрытия программы

// ---------- журнал ----------
function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  if (!app.isPackaged) process.stdout.write(line);
  try {
    if (!store) return;
    const file = path.join(store.logsDir, 'app.log');
    fs.mkdirSync(store.logsDir, { recursive: true });
    try {
      if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, path.join(store.logsDir, 'app.1.log'));
    } catch (_) {}
    fs.appendFileSync(file, line);
  } catch (_) {}
}
process.on('uncaughtException', (e) => log('error', 'uncaught: ' + (e && e.stack)));
process.on('unhandledRejection', (e) => log('error', 'unhandled: ' + (e && e.stack)));

// ---------- ключ доступа VK (DPAPI через safeStorage) ----------
// Хранится «сессия»: { kind: 'vkid', access_token, refresh_token, expires_at, device_id, client_id, ... }
// или { kind: 'plain', access_token } — для вставленного вручную ключа (в т.ч. сервисного).
function saveSession(sess) {
  if (!sess) {
    memSession = null;
    fs.rmSync(TOKEN_FILE(), { force: true });
    return { secure: true };
  }
  memSession = sess;
  if (safeStorage.isEncryptionAvailable()) {
    fs.mkdirSync(path.dirname(TOKEN_FILE()), { recursive: true });
    const tmp = TOKEN_FILE() + '.tmp';
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(sess)));
    fs.renameSync(tmp, TOKEN_FILE());
    return { secure: true };
  }
  log('warn', 'Шифрование Windows недоступно: ключ VK не сохранён на диск');
  return { secure: false };
}
function loadSession() {
  if (memSession) return memSession;
  try {
    const raw = safeStorage.decryptString(fs.readFileSync(TOKEN_FILE()));
    try {
      memSession = JSON.parse(raw);
    } catch (_) {
      memSession = { kind: 'plain', access_token: raw }; // формат первой версии — просто строка
    }
    return memSession;
  } catch (_) {
    return null;
  }
}
const hasToken = () => !!loadSession();

let refreshing = null;
/** Продление ключа VK ID (одно на всех, даже если запросов много одновременно) */
function refreshSession() {
  const s = loadSession();
  if (!s || s.kind !== 'vkid') return Promise.resolve(false);
  if (!refreshing) {
    refreshing = vkid
      .refresh(s)
      .then((ns) => {
        saveSession(ns);
        log('info', 'Ключ VK ID продлён');
        return true;
      })
      .catch((e) => {
        log('warn', `Не удалось продлить ключ VK ID: ${e.message} ${e.details || ''}`);
        throw e;
      })
      .finally(() => (refreshing = null));
  }
  return refreshing;
}
async function getAccessToken() {
  const s = loadSession();
  if (!s) return null;
  if (s.kind === 'vkid' && (s.expires_at || 0) - 120000 < Date.now()) await refreshSession();
  return loadSession()?.access_token || null;
}
const vkClient = () => new VkClient({ getToken: getAccessToken, refreshToken: refreshSession, log });

// ---------- протокол vkd:// ----------
const notFound = () => new Response('Not found', { status: 404 });
async function serveFile(file, cache) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return notFound();
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      headers: { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': String(st.size), 'Cache-Control': cache ? 'max-age=31536000' : 'no-store' },
    });
  } catch (_) {
    return notFound();
  }
}
function registerProtocol() {
  protocol.handle('vkd', async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    try {
      if (url.host === 'app') {
        const full = path.resolve(SRC_DIR, rel || 'index.html');
        if (!full.startsWith(path.resolve(SRC_DIR) + path.sep)) return notFound();
        return serveFile(full, false);
      }
      if (url.host === 'photo') return serveFile(store.photoPath(rel), true);
      if (url.host === 'thumb') return serveFile(store.thumbPath(rel), true);
      if (url.host === 'avatar') return serveFile(store.avatarPath(rel), false);
    } catch (_) {}
    return notFound();
  });
}

// ---------- уменьшенные копии фото для быстрой ленты ----------
async function makeThumb(src, dest) {
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) throw new Error('not an image');
  const { width } = img.getSize();
  const out = width > 520 ? img.resize({ width: 520, quality: 'good' }) : img;
  await fsp.writeFile(dest, out.toJPEG(84));
}

// ---------- окно ----------
function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = config.windowBounds;
  const width = Math.min(1440, Math.round(area.width * 0.9));
  const height = Math.min(940, Math.round(area.height * 0.92));
  win = new BrowserWindow({
    width: saved?.width || width,
    height: saved?.height || height,
    x: saved?.x,
    y: saved?.y,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#fbf6f3',
    title: APP_NAME,
    icon: path.join(SRC_DIR, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  if (saved?.maximized || (!saved && (area.width < 1500 || area.height < 900))) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL('vkd://app/index.html');
  // ссылки — только во внешнем браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('vkd://app/')) {
      e.preventDefault();
      openExternal(url);
    }
  });
  const remember = () => {
    if (!win || win.isMinimized()) return;
    config.windowBounds = { ...(win.isMaximized() ? config.windowBounds || {} : win.getBounds()), maximized: win.isMaximized() };
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', () => {
    remember();
    try {
      writeConfig(config);
    } catch (_) {}
  });
  attachEditMenu(win.webContents);
  if (process.env.VKD_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  if (DEV_TEST && process.env.VKD_SHOTS) runScreenshots(process.env.VKD_SHOTS);
}

/** Только для разработчика: снимки экранов по сценарию (в собранной программе недоступно) */
function runScreenshots(dir) {
  const steps = (process.env.VKD_SCRIPT || 'library').split(';');
  fs.mkdirSync(dir, { recursive: true });
  win.webContents.on('console-message', (e) => {
    const msg = e.message || '';
    if (/error|uncaught/i.test(msg)) log('error', 'renderer: ' + msg);
  });
  win.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await wait(1500);
    for (const [i, step] of steps.entries()) {
      const cut = step.indexOf('::');
      const [name, js] = cut < 0 ? [step, ''] : [step.slice(0, cut), step.slice(cut + 2)];
      if (name.startsWith('@paste') || name.startsWith('@ctxpaste')) {
        const { clipboard } = require('electron');
        let saved = '';
        try {
          saved = clipboard.readText();
          clipboard.writeText(js);
          if (name.startsWith('@paste')) {
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
          } else win.webContents.paste(); // то же, что «Вставить» в меню правой кнопки
        } catch (e) {
          log('error', `paste step: ${e.stack}`);
        }
        await wait(300);
        try {
          if (saved) clipboard.writeText(saved);
          else clipboard.clear();
        } catch (_) {}
      } else if (js) {
        try {
          await win.webContents.executeJavaScript(js);
        } catch (e) {
          log('error', `shot ${name}: ${e.message}`);
        }
      }
      await wait(900);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${String(i).padStart(2, '0')}_${name.trim()}.png`), img.toPNG());
    }
    app.quit();
  });
}

/**
 * Меню по правой кнопке мыши для полей ввода и выделенного текста («Вставить» и т.п.)
 * и привычные сочетания Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z.
 * Главное меню окна скрыто, поэтому сочетания обрабатываются здесь явно.
 */
function attachEditMenu(wc) {
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.isEditable) {
      items.push(
        { label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut },
        { label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { label: 'Выделить всё', role: 'selectAll' },
      );
    } else if (p.selectionText && p.selectionText.trim()) {
      items.push({ label: 'Копировать', role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) });
  });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    // физическая клавиша, чтобы сочетания работали и в русской раскладке
    const map = { KeyV: 'paste', KeyC: 'copy', KeyX: 'cut', KeyA: 'selectAll', KeyZ: input.shift ? 'redo' : 'undo', KeyY: 'redo' };
    const action = map[input.code];
    if (!action) return;
    e.preventDefault();
    wc[action]();
  });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString());
  } catch (_) {}
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- библиотека ----------
function openLibrary() {
  const root = config.libraryRoot && fs.existsSync(config.libraryRoot) ? config.libraryRoot : defaultRoot();
  store = new Store(root, log);
  problems = store.loadAll();
  log('info', `Библиотека открыта: ${root}`);
}

const posts = () => store.get('posts.json').posts;
const findPost = (id) => posts().find((p) => p.id === id);

function snapshotForUi() {
  const hist = store.get('sync_history.json');
  return {
    settings: store.get('settings.json'),
    posts: posts(),
    users: store.get('users.json').users,
    deleted: store.get('deleted_posts.json').deleted,
    history: { runs: hist.runs.slice(0, 30), snapshots: hist.snapshots, last_sync: hist.last_sync || 0 },
    account: { connected: hasToken(), info: store.get('settings.json').vk.account },
    paths: { root: store.root },
    problems,
    blocked: [...store.blocked.keys()],
    syncing: engine ? engine.running : false,
    version: app.getVersion(),
  };
}

let engine;
function getEngine() {
  if (!engine) {
    engine = new SyncEngine({ store, getToken: getAccessToken, refreshToken: refreshSession, log, makeThumb });
    let lastPush = 0;
    engine.on('progress', (p) => {
      send('sync:progress', p);
      if (Date.now() - lastPush > 5000 && ['likes', 'photos', 'recheck', 'wall'].includes(p.phase)) {
        lastPush = Date.now();
        send('data:changed', { partial: true });
      }
    });
    engine.on('done', (r) => {
      send('sync:done', r);
      send('data:changed', {});
    });
  }
  return engine;
}

// ---------- вход через VK ID (официальное окно VK, пароль программа не видит) ----------
function vkIdLoginWindow({ clientId, redirectUri, scope }) {
  const { verifier, challenge } = vkid.pkce();
  const state = vkid.b64url(require('crypto').randomBytes(24));
  const part = 'vkauth';
  const ses = session.fromPartition(part);
  const redirectBase = redirectUri.split(/[?#]/)[0];
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({ width: 560, height: 720, parent: win, modal: true, title: 'Вход ВКонтакте', autoHideMenuBar: true, webPreferences: { partition: part, sandbox: true } });
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      ses.webRequest.onBeforeRequest(null);
      setImmediate(() => !w.isDestroyed() && w.destroy());
      if (err) reject(err);
      else resolve(val);
    };
    // VK возвращает пользователя на https://localhost/... — перехватываем этот адрес, сервер не нужен
    ses.webRequest.onBeforeRequest({ urls: [redirectBase + '*'] }, (details, cb) => {
      cb({ cancel: true });
      try {
        finish(null, vkid.parseCallback(details.url, state));
      } catch (e) {
        finish(e);
      }
    });
    attachEditMenu(w.webContents);
    w.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { parent: w, autoHideMenuBar: true, webPreferences: { partition: part, sandbox: true } } }));
    w.webContents.on('did-navigate', (_e, u) => log('info', `VK ID: ${u.split('?')[0]}`));
    w.on('closed', () => finish(new vkid.VkIdError('Окно входа закрыто.', 'cancelled')));
    log('info', `VK ID: открываю вход (client_id=${clientId}, redirect=${redirectUri}, scope=${scope || '—'})`);
    w.loadURL(vkid.buildAuthUrl({ clientId, redirectUri, scope, state, challenge }));
  }).then((r) => vkid.exchangeCode({ clientId, redirectUri, code: r.code, deviceId: r.deviceId, verifier, state: r.state || state }));
}

async function fetchAccount() {
  const vk = vkClient();
  try {
    const me = await vk.call('users.get', { fields: 'photo_100,screen_name' });
    if (Array.isArray(me) && me[0] && me[0].id) return { id: me[0].id, name: `${me[0].first_name} ${me[0].last_name}`, photo: me[0].photo_100, kind: 'user' };
  } catch (e) {
    if (e.code === 'auth') throw e;
  }
  // сервисный ключ приложения: проверяем, что он рабочий
  await vk.call('users.get', { user_ids: 1 });
  return { id: 0, name: 'Сервисный ключ приложения', photo: '', kind: 'service' };
}

// ---------- IPC ----------
function h(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      log('error', `${channel}: ${e && e.stack}`);
      return { ok: false, error: { code: e.code || 'error', message: e.message || String(e) } };
    }
  });
}

function registerIpc() {
  h('app:init', () => snapshotForUi());
  h('app:open-url', (url) => openExternal(url));
  h('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, root: store.root, system: app.getPath('userData') }));

  // ---- публикации ----
  h('post:edit', (id, patch) => {
    const p = findPost(id);
    if (!p) throw new Error('Публикация не найдена');
    const clean = {};
    if (typeof patch.text === 'string') clean.text = patch.text.slice(0, 100000);
    if (Number.isFinite(patch.date)) clean.date = Math.round(patch.date);
    if (Array.isArray(patch.photos)) clean.photos = patch.photos;
    M.editPost(p, clean, Date.now());
    store.save('posts.json');
    return p;
  });
  h('post:accept-original', (id, field) => {
    const p = findPost(id);
    M.acceptOriginal(p, field, Date.now());
    store.save('posts.json');
    return p;
  });
  h('post:keep-mine', (id, field) => {
    const p = findPost(id);
    M.keepMine(p, field);
    store.save('posts.json');
    return p;
  });
  h('post:pick-photo', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Выберите фотографию', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const img = nativeImage.createFromPath(src);
    if (img.isEmpty()) throw new Error('Не получилось открыть это изображение. Попробуйте JPG или PNG.');
    const key = `local_${Date.now().toString(36)}`;
    const file = `${key}.jpg`;
    await fsp.writeFile(store.photoPath(file), img.toJPEG(92));
    await makeThumb(store.photoPath(file), store.thumbPath(file));
    const { width, height } = img.getSize();
    return { key, file, thumb: file, width, height, local: true };
  });
  h('posts:delete', (ids) => {
    const del = store.get('deleted_posts.json');
    const list = posts();
    const now = Date.now();
    for (const id of ids) {
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) continue;
      const [p] = list.splice(i, 1);
      del.deleted.unshift({ id: p.id, deleted_at: now, post: p });
    }
    M.recountUsers(list, store.get('users.json').users);
    store.writeNow('deleted_posts.json');
    store.writeNow('posts.json');
    store.save('users.json');
    return true;
  });
  h('trash:restore', (ids) => {
    const del = store.get('deleted_posts.json');
    const list = posts();
    for (const id of ids) {
      const i = del.deleted.findIndex((d) => d.id === id);
      if (i < 0) continue;
      const [d] = del.deleted.splice(i, 1);
      if (!list.find((p) => p.id === d.id)) {
        d.post.history = d.post.history || [];
        d.post.history.push({ at: Date.now(), kind: 'restore' });
        list.push(d.post);
      }
    }
    M.recountUsers(list, store.get('users.json').users);
    store.writeNow('posts.json');
    store.writeNow('deleted_posts.json');
    store.save('users.json');
    return true;
  });
  h('trash:forget', async (ids) => {
    // «Удалить навсегда»: запись остаётся в списке удалённых (чтобы синхронизация её не вернула), но без содержимого
    const del = store.get('deleted_posts.json');
    for (const d of del.deleted) {
      if (ids.includes(d.id) && d.post) {
        d.title = (M.effective(d.post, 'text') || '').slice(0, 120);
        d.post = null;
        d.forgotten = true;
      }
    }
    store.writeNow('deleted_posts.json');
    return true;
  });
  h('trash:allow-return', (ids) => {
    // убрать из списка удалённых совсем — публикация сможет вернуться при следующем обновлении
    const del = store.get('deleted_posts.json');
    del.deleted = del.deleted.filter((d) => !ids.includes(d.id) || d.post);
    store.writeNow('deleted_posts.json');
    return true;
  });

  // ---- источники ----
  h('source:resolve', async (input) => {
    const parsed = parseSourceInput(input);
    if (!parsed) throw new Error('Не получилось разобрать ссылку. Скопируйте адрес страницы из браузера, например https://vk.com/club123');
    if (!hasToken()) throw new Error('Сначала подключите ВКонтакте в настройках.');
    const vk = vkClient();
    let kind = parsed.kind;
    let id = parsed.id;
    if (kind === 'screen') {
      const r = await vk.call('utils.resolveScreenName', { screen_name: parsed.name });
      if (!r || Array.isArray(r) || !r.object_id) throw new Error('Такая страница ВКонтакте не найдена.');
      kind = r.type === 'user' ? 'user' : 'group';
      id = r.object_id;
    }
    if (kind === 'user') {
      const [u] = await vk.call('users.get', { user_ids: id, fields: 'photo_100,screen_name,is_closed' });
      if (!u) throw new Error('Страница не найдена');
      return { owner_id: u.id, type: 'user', name: `${u.first_name} ${u.last_name}`, photo: u.photo_100, screen_name: u.screen_name || `id${u.id}`, closed: !!u.is_closed && !u.can_access_closed };
    }
    const res = await vk.call('groups.getById', { group_id: id, fields: 'members_count' });
    const g = Array.isArray(res) ? res[0] : (res.groups || [])[0];
    if (!g) throw new Error('Сообщество не найдено');
    return { owner_id: -g.id, type: 'group', name: g.name, photo: g.photo_100, screen_name: g.screen_name || `club${g.id}`, closed: !!g.is_closed, members: g.members_count };
  });
  h('source:add', (src) => {
    const s = store.get('settings.json');
    if (s.sources.find((x) => x.owner_id === src.owner_id)) throw new Error('Этот источник уже добавлен');
    const item = { id: 's' + Date.now().toString(36), owner_id: Number(src.owner_id), type: src.type, name: String(src.name || ''), photo: src.photo || '', screen_name: src.screen_name || '', url: `https://vk.com/${src.screen_name}`, added_at: Date.now(), enabled: true };
    s.sources.push(item);
    store.writeNow('settings.json');
    return item;
  });
  h('source:update', (id, patch) => {
    const s = store.get('settings.json');
    const src = s.sources.find((x) => x.id === id);
    if (src && typeof patch.enabled === 'boolean') src.enabled = patch.enabled;
    store.writeNow('settings.json');
    return src;
  });
  h('source:remove', (id) => {
    const s = store.get('settings.json');
    s.sources = s.sources.filter((x) => x.id !== id);
    store.writeNow('settings.json');
    return true; // публикации источника остаются в библиотеке
  });

  // ---- настройки ----
  h('settings:update', (patch) => {
    const s = store.get('settings.json');
    for (const k of ['sync', 'view', 'vk']) {
      if (patch[k] && typeof patch[k] === 'object') Object.assign(s[k], patch[k]);
    }
    if (typeof patch.onboarding_done === 'boolean') s.onboarding_done = patch.onboarding_done;
    store.save('settings.json', 100);
    return s;
  });

  // ---- VK ----
  h('vk:login', async (appId, redirectUri) => {
    const clientId = String(appId || '').trim();
    if (!/^\d{4,12}$/.test(clientId)) throw new Error('Укажите номер (ID) приложения VK — только цифры.');
    const redirect = String(redirectUri || '').trim() || vkid.DEFAULT_REDIRECT;
    if (!/^https:\/\/\S+$/i.test(redirect)) throw new Error('Адрес перенаправления должен начинаться с https://');
    let sess;
    try {
      sess = await vkIdLoginWindow({ clientId, redirectUri: redirect, scope: vkid.DEFAULT_SCOPE });
    } catch (e) {
      if (e.code !== 'invalid_scope') {
        log('warn', `VK ID: ${e.message} ${e.details || ''}`);
        throw e;
      }
      log('warn', `VK ID: права «${vkid.DEFAULT_SCOPE}» не разрешены, вход без них`);
      sess = await vkIdLoginWindow({ clientId, redirectUri: redirect, scope: '' });
    }
    const old = memSession;
    memSession = sess;
    let account;
    try {
      account = await fetchAccount();
    } catch (e) {
      memSession = old;
      throw e;
    }
    const sec = saveSession(sess);
    const s = store.get('settings.json');
    s.vk.app_id = clientId;
    s.vk.redirect_uri = redirect;
    s.vk.account = account;
    store.writeNow('settings.json');
    log('info', `VK ID: вход выполнен (${account.name})`);
    return { account, secure: sec.secure };
  });
  h('vk:set-token', async (token) => {
    let t = String(token || '').trim();
    const m = /access_token=([^&\s]+)/.exec(t);
    if (m) t = m[1];
    if (t.length < 20) throw new Error('Похоже, это не ключ доступа. Он длинный и состоит из букв и цифр.');
    const old = memSession;
    memSession = { kind: 'plain', access_token: t };
    try {
      const account = await fetchAccount();
      const sec = saveSession(memSession);
      const s = store.get('settings.json');
      s.vk.account = account;
      store.writeNow('settings.json');
      return { account, secure: sec.secure };
    } catch (e) {
      memSession = old;
      throw e;
    }
  });
  h('vk:logout', async () => {
    const sess = loadSession();
    if (sess && sess.kind === 'vkid') await vkid.logout(sess);
    saveSession(null);
    await session.fromPartition('vkauth').clearStorageData();
    const s = store.get('settings.json');
    s.vk.account = null;
    store.writeNow('settings.json');
    return true;
  });
  h('vk:check', async () => {
    if (!(await VkClient.online())) return { online: false, connected: hasToken() };
    if (!hasToken()) return { online: true, connected: false };
    const account = await fetchAccount();
    return { online: true, connected: true, account };
  });

  // ---- синхронизация ----
  h('sync:start', (opts) => {
    const e = getEngine();
    if (e.running) return { already: true };
    e.run(opts || {}).catch((err) => log('error', 'sync: ' + err.stack));
    return { started: true };
  });
  h('sync:cancel', () => {
    if (engine) engine.cancel();
    return true;
  });

  // ---- хранилище ----
  h('lib:open-folder', () => shell.openPath(store.root));
  h('lib:usage', () => store.usage());
  h('lib:integrity', () => store.integrity());
  h('lib:change-location', async () => {
    if (engine && engine.running) throw new Error('Дождитесь окончания обновления данных');
    const r = await dialog.showOpenDialog(win, { title: 'Новая папка для библиотеки', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    let dest = r.filePaths[0];
    if (path.resolve(dest) === store.root) return null;
    const hasLib = fs.existsSync(path.join(dest, 'data', 'posts.json'));
    if (!hasLib) {
      const entries = await fsp.readdir(dest).catch(() => []);
      if (entries.length) dest = path.join(dest, APP_NAME);
      store.flush();
      await fsp.cp(store.root, dest, { recursive: true, errorOnExist: false, force: false });
    }
    config.libraryRoot = dest;
    writeConfig(config);
    openLibrary();
    engine = null;
    send('data:changed', {});
    return { root: store.root, usedExisting: hasLib };
  });
  h('logs:read', async () => {
    try {
      const txt = await fsp.readFile(path.join(store.logsDir, 'app.log'), 'utf8');
      return txt.split('\n').slice(-300).join('\n');
    } catch (_) {
      return '';
    }
  });
  h('logs:open', () => shell.openPath(store.logsDir));
}

app.whenReady().then(() => {
  openLibrary();
  registerProtocol();
  registerIpc();
  createWindow();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('before-quit', () => {
  if (engine && engine.running) engine.cancel();
  if (store) store.flush();
});
app.on('window-all-closed', () => app.quit());
