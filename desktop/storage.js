'use strict';
/**
 * Файловое хранилище библиотеки (никаких баз данных — только обычные файлы).
 *
 *   <root>/data/posts.json          — публикации (оригинал VK и локальные правки хранятся раздельно)
 *   <root>/data/users.json          — профили пользователей, поставивших лайки
 *   <root>/data/settings.json       — настройки и источники
 *   <root>/data/sync_history.json   — история обновлений и снимки статистики
 *   <root>/data/deleted_posts.json  — локальная корзина
 *   <root>/storage/photos/          — фотографии публикаций (+ thumbs/ — уменьшенные копии)
 *   <root>/storage/avatars/         — аватары
 *   <root>/backups/                 — резервные копии
 *   <root>/trash/                   — файлы, убранные из библиотеки (заменённые фото, повреждённые JSON)
 *   <root>/logs/                    — журнал
 *
 * Правила: запись атомарная (tmp → fsync → проверка → замена), предыдущая версия хранится в *.prev,
 * повреждённый файл никогда не перезаписывается пустыми данными — он блокируется до восстановления.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SCHEMA_VERSION = 1;
const DOCS = ['posts.json', 'users.json', 'settings.json', 'sync_history.json', 'deleted_posts.json'];

class StoreError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function safeJoin(dir, name) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name.startsWith('.')) {
    throw new StoreError('bad_name');
  }
  return path.join(dir, name);
}

function defaultDoc(name) {
  switch (name) {
    case 'posts.json':
      return { version: SCHEMA_VERSION, posts: [] };
    case 'users.json':
      return { version: SCHEMA_VERSION, users: {} };
    case 'settings.json':
      return {
        version: SCHEMA_VERSION,
        vk: { app_id: '', redirect_uri: 'https://localhost/vk-callback', account: null },
        sources: [],
        sync: { max_posts: 200, since_days: 0, refresh_all_likes: false, save_avatars: true, all_photos: true },
        view: { sort: 'date_desc' },
        backups: { auto: true, keep: 10 },
        onboarding_done: false,
      };
    case 'sync_history.json':
      return { version: SCHEMA_VERSION, runs: [], snapshots: [] };
    case 'deleted_posts.json':
      return { version: SCHEMA_VERSION, deleted: [] };
    default:
      throw new StoreError('bad_name');
  }
}

function validateDoc(name, d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
  switch (name) {
    case 'posts.json':
      return Array.isArray(d.posts);
    case 'users.json':
      return !!d.users && typeof d.users === 'object' && !Array.isArray(d.users);
    case 'settings.json':
      return true;
    case 'sync_history.json':
      return Array.isArray(d.runs);
    case 'deleted_posts.json':
      return Array.isArray(d.deleted);
    default:
      return false;
  }
}

/** Миграции формата: каждая функция переводит документ с версии N на N+1. */
const MIGRATIONS = {
  // 'posts.json': { 1: (d) => { ...; d.version = 2; return d; } },
};

function migrate(name, data) {
  let d = data;
  let changed = false;
  if (typeof d.version !== 'number') {
    d.version = 1;
    changed = true;
  }
  const steps = MIGRATIONS[name] || {};
  while (d.version < SCHEMA_VERSION && steps[d.version]) {
    d = steps[d.version](d);
    changed = true;
  }
  // недостающие поля настроек — из значений по умолчанию (новые версии программы добавляют настройки)
  if (name === 'settings.json') {
    const def = defaultDoc(name);
    for (const k of Object.keys(def)) {
      if (d[k] === undefined) {
        d[k] = def[k];
        changed = true;
      } else if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k]) && d[k] && typeof d[k] === 'object') {
        for (const kk of Object.keys(def[k])) {
          if (d[k][kk] === undefined) {
            d[k][kk] = def[k][kk];
            changed = true;
          }
        }
      }
    }
  }
  if (name === 'sync_history.json' && !Array.isArray(d.snapshots)) {
    d.snapshots = [];
    changed = true;
  }
  return { data: d, changed };
}

function renameWithRetry(from, to) {
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      last = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break;
      sleepSync(40 * (i + 1)); // антивирус мог ненадолго занять файл
    }
  }
  throw last;
}

/** Атомарная запись: временный файл → fsync → проверка чтением → .prev → замена. */
function atomicWriteJson(file, data, validate) {
  const content = JSON.stringify(data);
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // проверяем, что на диск записалось именно то, что нужно
  const check = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  if (validate && !validate(check)) {
    fs.rmSync(tmp, { force: true });
    throw new StoreError('verify_failed');
  }
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + '.prev');
    } catch (_) {}
  }
  renameWithRetry(tmp, file);
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.replace(/^﻿/, ''));
}

async function dirSize(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else {
      try {
        total += (await fsp.stat(p)).size;
      } catch (_) {}
    }
  }
  return total;
}

class Store {
  constructor(root, log) {
    this.log = log || (() => {});
    this.setRoot(root);
    this.docs = {};
    this.blocked = new Map(); // name -> причина; запись запрещена, пока пользователь не восстановит файл
    this.timers = {};
    this.dirty = new Set();
  }

  setRoot(root) {
    this.root = path.resolve(root);
    this.dataDir = path.join(this.root, 'data');
    this.photosDir = path.join(this.root, 'storage', 'photos');
    this.thumbsDir = path.join(this.photosDir, 'thumbs');
    this.avatarsDir = path.join(this.root, 'storage', 'avatars');
    this.backupsDir = path.join(this.root, 'backups');
    this.trashDir = path.join(this.root, 'trash');
    this.logsDir = path.join(this.root, 'logs');
  }

  ensureDirs() {
    for (const d of [this.dataDir, this.photosDir, this.thumbsDir, this.avatarsDir, this.backupsDir, this.trashDir, this.logsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  /** Загрузка всех документов с проверкой целостности. Возвращает список проблем (если были). */
  loadAll() {
    this.ensureDirs();
    for (const f of fs.readdirSync(this.dataDir)) {
      if (f.endsWith('.tmp')) fs.rmSync(path.join(this.dataDir, f), { force: true }); // остаток прерванной записи
    }
    const problems = [];
    this.blocked.clear();
    for (const name of DOCS) {
      const file = path.join(this.dataDir, name);
      let data = null;
      if (!fs.existsSync(file)) {
        data = defaultDoc(name);
        this.docs[name] = data;
        this.writeNow(name);
        continue;
      }
      try {
        data = readJson(file);
        if (!validateDoc(name, data)) throw new Error('invalid structure');
      } catch (e) {
        this.log('error', `Файл ${name} повреждён: ${e.message}`);
        data = null;
        // 1) предыдущая версия
        try {
          const prev = readJson(file + '.prev');
          if (validateDoc(name, prev)) {
            this.quarantine(file);
            data = prev;
            problems.push({ name, fixed: 'prev' });
            this.log('warn', `${name}: восстановлен из предыдущей версии`);
          }
        } catch (_) {}
        // 2) последняя резервная копия
        if (!data) {
          const fromBackup = this.findDocInBackups(name);
          if (fromBackup) {
            this.quarantine(file);
            data = fromBackup.data;
            problems.push({ name, fixed: 'backup', backup: fromBackup.backup });
            this.log('warn', `${name}: восстановлен из копии ${fromBackup.backup}`);
          }
        }
        // 3) не получилось — НЕ перезаписываем, блокируем запись
        if (!data) {
          data = defaultDoc(name);
          this.blocked.set(name, e.message);
          problems.push({ name, fixed: null });
        }
      }
      const m = migrate(name, data);
      this.docs[name] = m.data;
      if (m.changed || (problems.find((p) => p.name === name && p.fixed))) {
        if (!this.blocked.has(name)) this.writeNow(name);
      }
    }
    return problems;
  }

  quarantine(file) {
    try {
      fs.mkdirSync(this.trashDir, { recursive: true });
      fs.copyFileSync(file, path.join(this.trashDir, `${stamp()}_damaged_${path.basename(file)}`));
    } catch (_) {}
  }

  findDocInBackups(name) {
    for (const b of this.listBackupsSync()) {
      try {
        const d = readJson(path.join(this.backupsDir, b.name, 'data', name));
        if (validateDoc(name, d)) return { data: d, backup: b.name };
      } catch (_) {}
    }
    return null;
  }

  get(name) {
    return this.docs[name];
  }

  /** Отложенная запись (несколько изменений подряд объединяются в одну запись). */
  save(name, delay = 400) {
    this.dirty.add(name);
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => this.writeNow(name), delay);
  }

  writeNow(name) {
    clearTimeout(this.timers[name]);
    if (!DOCS.includes(name)) throw new StoreError('bad_name');
    if (this.blocked.has(name)) {
      this.log('warn', `Запись ${name} пропущена: файл заблокирован до восстановления`);
      return false;
    }
    try {
      atomicWriteJson(path.join(this.dataDir, name), this.docs[name], (d) => validateDoc(name, d));
      this.dirty.delete(name);
      return true;
    } catch (e) {
      this.log('error', `Не удалось записать ${name}: ${e.message}`);
      throw e;
    }
  }

  flush() {
    for (const name of [...this.dirty]) {
      try {
        this.writeNow(name);
      } catch (_) {}
    }
  }

  // ---------- резервные копии ----------

  listBackupsSync() {
    let entries = [];
    try {
      entries = fs.readdirSync(this.backupsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch (_) {
      return [];
    }
    const list = [];
    for (const e of entries) {
      let manifest = {};
      try {
        manifest = readJson(path.join(this.backupsDir, e.name, 'manifest.json'));
      } catch (_) {}
      list.push({
        name: e.name,
        created: manifest.created || null,
        reason: manifest.reason || 'auto',
        kind: manifest.kind || 'auto',
        posts: manifest.posts ?? null,
        users: manifest.users ?? null,
        withPhotos: !!manifest.withPhotos,
      });
    }
    list.sort((a, b) => (b.created || b.name).localeCompare(a.created || a.name));
    return list;
  }

  /**
   * Резервная копия. Автоматические копии содержат только данные (JSON) — фотографии хранятся
   * под неизменяемыми именами и не удаляются. Ручная копия включает фото (через жёсткие ссылки — мгновенно).
   */
  async createBackup({ reason = 'auto', kind = 'auto', withPhotos = false, keep = 10 } = {}) {
    this.flush();
    const name = `${stamp()}_${kind}`;
    const dir = path.join(this.backupsDir, name);
    await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
    for (const doc of DOCS) {
      const src = path.join(this.dataDir, doc);
      if (fs.existsSync(src) && !this.blocked.has(doc)) await fsp.copyFile(src, path.join(dir, 'data', doc));
    }
    if (withPhotos) {
      for (const sub of ['photos', 'avatars']) {
        const from = path.join(this.root, 'storage', sub);
        const to = path.join(dir, 'storage', sub);
        await fsp.mkdir(to, { recursive: true });
        for (const f of await fsp.readdir(from).catch(() => [])) {
          const src = path.join(from, f);
          const st = await fsp.stat(src).catch(() => null);
          if (!st || !st.isFile()) continue;
          try {
            await fsp.link(src, path.join(to, f));
          } catch (_) {
            await fsp.copyFile(src, path.join(to, f));
          }
        }
      }
    }
    const manifest = {
      created: new Date().toISOString(),
      reason,
      kind,
      withPhotos,
      posts: (this.docs['posts.json']?.posts || []).length,
      users: Object.keys(this.docs['users.json']?.users || {}).length,
      schema: SCHEMA_VERSION,
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await this.pruneBackups(keep);
    this.log('info', `Создана резервная копия ${name} (${reason})`);
    return name;
  }

  async pruneBackups(keep) {
    // ручные копии не удаляются автоматически
    const auto = this.listBackupsSync().filter((b) => b.kind !== 'manual');
    for (const b of auto.slice(Math.max(1, keep))) {
      await fsp.rm(path.join(this.backupsDir, b.name), { recursive: true, force: true });
    }
  }

  async deleteBackup(name) {
    await fsp.rm(safeJoin(this.backupsDir, name), { recursive: true, force: true });
  }

  /** Восстановление: сначала копия текущего состояния, затем замена документов. */
  async restoreBackup(name, keep) {
    const dir = safeJoin(this.backupsDir, name);
    const docs = {};
    for (const doc of DOCS) {
      const f = path.join(dir, 'data', doc);
      if (!fs.existsSync(f)) continue;
      const d = readJson(f);
      if (!validateDoc(doc, d)) throw new StoreError('backup_damaged', doc);
      docs[doc] = d;
    }
    if (!docs['posts.json']) throw new StoreError('backup_damaged', 'posts.json');
    this.blocked.clear();
    await this.createBackup({ reason: 'Перед восстановлением', kind: 'safety', keep: keep + 2 });
    for (const [doc, d] of Object.entries(docs)) {
      this.docs[doc] = migrate(doc, d).data;
      this.writeNow(doc);
    }
    for (const sub of ['photos', 'avatars']) {
      const from = path.join(dir, 'storage', sub);
      const to = path.join(this.root, 'storage', sub);
      for (const f of await fsp.readdir(from).catch(() => [])) {
        if (!fs.existsSync(path.join(to, f))) await fsp.copyFile(path.join(from, f), path.join(to, f)).catch(() => {});
      }
    }
    this.log('info', `Данные восстановлены из копии ${name}`);
  }

  integrity() {
    const report = [];
    for (const name of DOCS) {
      const file = path.join(this.dataDir, name);
      let ok = false;
      let size = 0;
      try {
        size = fs.statSync(file).size;
        ok = validateDoc(name, readJson(file));
      } catch (_) {}
      report.push({ name, ok, size, blocked: this.blocked.has(name) });
    }
    return report;
  }

  async usage() {
    return {
      data: await dirSize(this.dataDir),
      photos: await dirSize(this.photosDir),
      avatars: await dirSize(this.avatarsDir),
      backups: await dirSize(this.backupsDir),
      total: await dirSize(this.root),
    };
  }

  photoPath(name) {
    return safeJoin(this.photosDir, name);
  }
  thumbPath(name) {
    return safeJoin(this.thumbsDir, name);
  }
  avatarPath(name) {
    return safeJoin(this.avatarsDir, name);
  }
}

module.exports = { Store, StoreError, DOCS, SCHEMA_VERSION, defaultDoc, validateDoc, atomicWriteJson, stamp, safeJoin, readJson };
