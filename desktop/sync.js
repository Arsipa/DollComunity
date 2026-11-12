'use strict';
/**
 * Синхронизация с VK.
 *  1. Интернет → 2. Авторизация → 3. Резервная копия → 4. Новые публикации источников →
 *  5. Проверка остальных публикаций библиотеки → 6. Лайки → 7. Профили → 8. Фото → 9. Аватары → 10. Отчёт.
 * Данные сохраняются по ходу работы (контрольные точки), поэтому прерывание ничего не ломает.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');
const { VkClient, VkError, extractPhotos, postText } = require('./vk');
const M = require('./model');

const USER_FIELDS = 'photo_100,photo_200,screen_name,city,sex,is_closed,deactivated,bdate';
const PROFILE_TTL = 7 * 24 * 3600 * 1000;

function freshFromItem(item) {
  return {
    text: postText(item),
    date: item.date,
    photos: extractPhotos(item),
    likes_count: item.likes ? item.likes.count : 0,
    reposts: item.reposts ? item.reposts.count : 0,
    views: item.views ? item.views.count : 0,
    comments: item.comments ? item.comments.count : 0,
  };
}

async function download(url, dest, timeout = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('пустой файл');
    const tmp = dest + '.part';
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, dest);
    return buf;
  } finally {
    clearTimeout(t);
  }
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

class SyncEngine extends EventEmitter {
  constructor({ store, getToken, refreshToken, log, makeThumb }) {
    super();
    this.store = store;
    this.getToken = getToken;
    this.refreshToken = refreshToken;
    this.log = log;
    this.makeThumb = makeThumb; // (srcPath, destPath) => Promise
    this.running = false;
    this.vk = null;
  }

  cancel() {
    if (this.vk) this.vk.aborted = true;
    this.cancelled = true;
  }

  emitProgress() {
    const s = this.state;
    this.emit('progress', { ...s, errors: s.errors.length });
  }

  phase(key, label, total = 0) {
    Object.assign(this.state, { phase: key, phaseLabel: label, done: 0, total });
    this.emitProgress();
  }

  tick(n = 1) {
    this.state.done += n;
    const now = Date.now();
    if (now - (this.lastEmit || 0) > 150) {
      this.lastEmit = now;
      this.emitProgress();
    }
  }

  checkpoint(force) {
    const now = Date.now();
    if (force || now - (this.lastSave || 0) > 4000) {
      this.lastSave = now;
      this.store.writeNow('posts.json');
      this.store.writeNow('users.json');
    }
  }

  async run({ sourceIds = null } = {}) {
    if (this.running) throw new VkError('busy', 'Обновление уже идёт');
    this.running = true;
    this.cancelled = false;
    const startedAt = Date.now();
    this.state = { phase: 'start', phaseLabel: 'Подготовка', done: 0, total: 0, checked: 0, created: 0, updated: 0, conflicts: 0, likesChanged: 0, missing: 0, errors: [] };
    const store = this.store;
    const settings = store.get('settings.json');
    const postsDoc = store.get('posts.json');
    const usersDoc = store.get('users.json');
    const deletedIds = new Set(store.get('deleted_posts.json').deleted.map((d) => d.id));
    const byId = new Map(postsDoc.posts.map((p) => [p.id, p]));
    const touched = new Set();
    const conflictPosts = new Set();
    const updatedPosts = new Set();
    let fatal = null;

    const vk = (this.vk = new VkClient({ getToken: this.getToken, refreshToken: this.refreshToken, log: this.log }));
    const softError = (where, e) => {
      this.state.errors.push({ where, message: e.message, code: e.code || 'error' });
      this.log('warn', `${where}: ${e.message}`);
    };

    try {
      this.phase('check', 'Проверяю интернет и подключение');
      if (!(await VkClient.online())) throw new VkError('network', 'Нет подключения к интернету. Ранее загруженные публикации доступны как обычно.');
      await vk.call('users.get', { user_ids: 1 }); // проверка ключа доступа

      if (settings.backups.auto) {
        this.phase('backup', 'Создаю резервную копию');
        await store.createBackup({ reason: 'Перед обновлением', keep: settings.backups.keep });
      }

      for (const p of postsDoc.posts) p.is_new = false;

      // ---------- 4. публикации источников ----------
      const sources = settings.sources.filter((s) => s.enabled !== false && (!sourceIds || sourceIds.includes(s.id)));
      const max = Number(settings.sync.max_posts) || 0;
      const since = Number(settings.sync.since_days) > 0 ? Date.now() / 1000 - settings.sync.since_days * 86400 : 0;
      for (const src of sources) {
        if (this.cancelled) break;
        this.phase('wall', `Загружаю публикации: ${src.name}`, max || 0);
        let offset = 0;
        let got = 0;
        let total = Infinity;
        try {
          while (offset < total && (!max || got < max)) {
            const count = Math.min(100, max ? max - got : 100);
            const res = await vk.call('wall.get', { owner_id: src.owner_id, offset, count, filter: 'all' });
            total = res.count;
            if (!max) this.state.total = total;
            const items = res.items || [];
            if (!items.length) break;
            let tooOld = false;
            for (const item of items) {
              offset++;
              if (since && item.date < since) {
                if (!item.is_pinned) tooOld = true;
                continue;
              }
              got++;
              this.ingest(item, src, byId, postsDoc, deletedIds, touched, updatedPosts, conflictPosts);
              this.tick();
            }
            src.last_synced = Date.now();
            src.total_on_wall = total;
            this.checkpoint();
            if (tooOld) break;
          }
        } catch (e) {
          if (e.code === 'auth' || e.code === 'aborted') throw e;
          softError(`Источник «${src.name}»`, e);
          src.last_error = e.message;
        }
        if (!this.state.errors.find((x) => x.where.includes(src.name))) src.last_error = '';
      }

      // ---------- 5. остальные публикации библиотеки ----------
      const rest = postsDoc.posts.filter((p) => !touched.has(p.id));
      if (rest.length && !this.cancelled) {
        this.phase('recheck', 'Проверяю остальные публикации', rest.length);
        for (let i = 0; i < rest.length && !this.cancelled; i += 100) {
          const chunk = rest.slice(i, i + 100);
          try {
            const res = await vk.call('wall.getById', { posts: chunk.map((p) => `${p.owner_id}_${p.post_id}`).join(',') });
            const items = Array.isArray(res) ? res : res.items || [];
            const found = new Set();
            for (const item of items) {
              const id = M.postId(item.owner_id, item.id);
              found.add(id);
              const src = settings.sources.find((s) => s.owner_id === item.owner_id) || { id: null };
              this.ingest(item, src, byId, postsDoc, deletedIds, touched, updatedPosts, conflictPosts);
            }
            for (const p of chunk) {
              if (!found.has(p.id) && !p.vk_missing) {
                p.vk_missing = Date.now(); // в VK не найдена — но из библиотеки НЕ удаляем
                this.state.missing++;
                p.last_checked = Date.now();
                p.history = p.history || [];
                p.history.push({ at: Date.now(), kind: 'missing' });
              }
            }
          } catch (e) {
            if (e.code === 'auth' || e.code === 'aborted') throw e;
            softError('Проверка публикаций', e);
          }
          this.tick(chunk.length);
          this.checkpoint();
        }
      }

      // ---------- 6. лайки ----------
      const needLikes = postsDoc.posts.filter(
        (p) => touched.has(p.id) && !p.vk_missing && (settings.sync.refresh_all_likes || !p.likers_complete || Object.keys(p.likers).length !== p.likes_count),
      );
      this.phase('likes', 'Собираю, кто поставил лайки', needLikes.length);
      const now = Date.now();
      for (const p of needLikes) {
        if (this.cancelled) break;
        try {
          const ids = [];
          let offset = 0;
          let total = Infinity;
          while (offset < total) {
            const res = await vk.call('likes.getList', { type: 'post', owner_id: p.owner_id, item_id: p.post_id, filter: 'likes', count: 1000, offset, skip_own: 0 });
            total = res.count;
            const items = res.items || [];
            ids.push(...items);
            offset += 1000;
            if (!items.length) break;
          }
          const r = M.applyLikers(p, ids, now);
          if (r.added || r.removed) {
            this.state.likesChanged++;
            updatedPosts.add(p.id);
          }
        } catch (e) {
          if (e.code === 'auth' || e.code === 'aborted') throw e;
          softError(`Лайки публикации ${p.id}`, e);
        }
        this.tick();
        this.checkpoint();
      }

      // ---------- 7. профили ----------
      await this.syncProfiles(vk, postsDoc, usersDoc, softError);
      M.recountUsers(postsDoc.posts, usersDoc.users);
      this.checkpoint(true);

      // ---------- 8. фото ----------
      await this.downloadPhotos(postsDoc.posts.filter((p) => touched.has(p.id)), settings, softError);
      this.checkpoint(true);

      // ---------- 9. аватары ----------
      if (settings.sync.save_avatars && !this.cancelled) await this.downloadAvatars(usersDoc, softError);
    } catch (e) {
      fatal = e;
      if (e.code !== 'aborted') this.log('error', `Обновление прервано: ${e.message}`);
    } finally {
      M.recountUsers(postsDoc.posts, usersDoc.users);
      this.state.updated = updatedPosts.size;
      this.state.conflicts = postsDoc.posts.filter((p) => M.localChanges(p).length).length;
      this.state.vkChangedConflicts = conflictPosts.size;
      const report = {
        started: startedAt,
        finished: Date.now(),
        checked: this.state.checked,
        created: this.state.created,
        updated: this.state.updated,
        conflicts: this.state.conflicts,
        missing: this.state.missing,
        errors: this.state.errors.slice(0, 50),
        fatal: fatal ? { code: fatal.code, message: fatal.message } : null,
        cancelled: this.cancelled,
      };
      const hist = store.get('sync_history.json');
      hist.runs.unshift(report);
      hist.runs.length = Math.min(hist.runs.length, 200);
      hist.last_sync = report.finished;
      if (!fatal || fatal.code === 'aborted') hist.snapshots.push(this.snapshot(postsDoc.posts, usersDoc.users));
      if (hist.snapshots.length > 400) hist.snapshots.splice(0, hist.snapshots.length - 400);
      try {
        store.writeNow('posts.json');
        store.writeNow('users.json');
        store.writeNow('settings.json');
        store.writeNow('sync_history.json');
      } catch (_) {}
      this.running = false;
      this.vk = null;
      this.emit('done', report);
    }
  }

  ingest(item, src, byId, postsDoc, deletedIds, touched, updatedPosts, conflictPosts) {
    const id = M.postId(item.owner_id, item.id);
    if (deletedIds.has(id)) return; // удалена пользователем — не возвращаем
    const fresh = freshFromItem(item);
    const now = Date.now();
    let p = byId.get(id);
    this.state.checked++;
    if (!p) {
      p = M.newPost({ ownerId: item.owner_id, id: item.id, sourceId: src.id, text: fresh.text, date: fresh.date, photos: fresh.photos, likes: fresh.likes_count, reposts: fresh.reposts, views: fresh.views, comments: fresh.comments, now });
      postsDoc.posts.push(p);
      byId.set(id, p);
      this.state.created++;
    } else {
      const r = M.applyVk(p, fresh, now);
      if (r.changed) updatedPosts.add(id);
      if (r.conflictFields.length) conflictPosts.add(id);
      if (!p.source_id && src.id) p.source_id = src.id;
    }
    touched.add(id);
  }

  async syncProfiles(vk, postsDoc, usersDoc, softError) {
    const users = usersDoc.users;
    const all = new Set();
    for (const p of postsDoc.posts) for (const uid of Object.keys(p.likers || {})) all.add(uid);
    const now = Date.now();
    const need = [...all].filter((uid) => !users[uid] || now - (users[uid].updated_at || 0) > PROFILE_TTL);
    const userIds = need.filter((u) => Number(u) > 0);
    const groupIds = need.filter((u) => Number(u) < 0).map((u) => -Number(u));
    this.phase('profiles', 'Обновляю профили участников', need.length);
    for (let i = 0; i < userIds.length && !this.cancelled; i += 500) {
      const chunk = userIds.slice(i, i + 500);
      try {
        const res = await vk.call('users.get', { user_ids: chunk.join(','), fields: USER_FIELDS });
        for (const u of res || []) {
          const prev = users[u.id] || {};
          users[u.id] = {
            ...prev,
            id: u.id,
            type: 'user',
            first_name: u.first_name || '',
            last_name: u.last_name || '',
            screen_name: u.screen_name || '',
            photo_100: u.photo_100 || '',
            photo_200: u.photo_200 || '',
            city: u.city ? u.city.title : '',
            sex: u.sex || 0,
            bdate: u.bdate || '',
            is_closed: !!u.is_closed,
            deactivated: u.deactivated || '',
            url: `https://vk.com/${u.screen_name || 'id' + u.id}`,
            updated_at: now,
            first_seen: prev.first_seen || now,
          };
        }
      } catch (e) {
        if (e.code === 'auth' || e.code === 'aborted') throw e;
        softError('Профили участников', e);
      }
      this.tick(chunk.length);
    }
    for (let i = 0; i < groupIds.length && !this.cancelled; i += 400) {
      const chunk = groupIds.slice(i, i + 400);
      try {
        const res = await vk.call('groups.getById', { group_ids: chunk.join(',') });
        const list = Array.isArray(res) ? res : res.groups || [];
        for (const g of list) {
          const key = String(-g.id);
          users[key] = {
            ...(users[key] || {}),
            id: -g.id,
            type: 'group',
            first_name: g.name || '',
            last_name: '',
            screen_name: g.screen_name || '',
            photo_100: g.photo_100 || '',
            photo_200: g.photo_200 || '',
            url: `https://vk.com/${g.screen_name || 'club' + g.id}`,
            updated_at: now,
            first_seen: (users[key] && users[key].first_seen) || now,
          };
        }
      } catch (e) {
        if (e.code === 'auth' || e.code === 'aborted') throw e;
        softError('Сообщества, поставившие лайки', e);
      }
      this.tick(chunk.length);
    }
    // на случай, если VK не вернул профиль (удалён) — заглушка, чтобы не терять лайк
    for (const uid of need) {
      if (!users[uid]) users[uid] = { id: Number(uid), type: Number(uid) > 0 ? 'user' : 'group', first_name: 'Пользователь', last_name: String(uid), url: `https://vk.com/id${uid}`, updated_at: now, unavailable: true, first_seen: now };
    }
  }

  async downloadPhotos(posts, settings, softError) {
    const jobs = [];
    for (const p of posts) {
      const photos = p.original.photos || [];
      const list = settings.sync.all_photos ? photos : photos.slice(0, 1);
      for (const ph of list) {
        const file = `${ph.key.replace(/[^\w-]/g, '_')}.jpg`;
        const full = this.store.photoPath(file);
        if (ph.file && fs.existsSync(full)) {
          if (!ph.thumb || !fs.existsSync(this.store.thumbPath(ph.thumb))) jobs.push({ ph, file, full, thumbOnly: true });
          continue;
        }
        jobs.push({ ph, file, full });
      }
    }
    this.phase('photos', 'Сохраняю фотографии на компьютер', jobs.length);
    let n = 0;
    await pool(jobs, 4, async (job) => {
      if (this.cancelled) return;
      try {
        if (!job.thumbOnly && !fs.existsSync(job.full)) await download(job.ph.url, job.full);
        job.ph.file = job.file;
        try {
          await this.makeThumb(job.full, this.store.thumbPath(job.file));
          job.ph.thumb = job.file;
        } catch (_) {}
      } catch (e) {
        softError('Фотография', { message: `Не удалось скачать фото (${e.message})` });
      }
      this.tick();
      if (++n % 40 === 0) this.checkpoint();
    });
  }

  async downloadAvatars(usersDoc, softError) {
    const jobs = [];
    for (const u of Object.values(usersDoc.users)) {
      if (!u.photo_100 || /camera_|deactivated_|community_/.test(u.photo_100)) continue;
      const file = `${u.id}.jpg`;
      if (u.avatar_file && u.avatar_src === u.photo_100 && fs.existsSync(this.store.avatarPath(file))) continue;
      jobs.push({ u, file });
    }
    this.phase('avatars', 'Сохраняю аватары', jobs.length);
    let failures = 0;
    await pool(jobs, 6, async ({ u, file }) => {
      if (this.cancelled) return;
      try {
        await download(u.photo_100, this.store.avatarPath(file), 15000);
        u.avatar_file = file;
        u.avatar_src = u.photo_100;
      } catch (_) {
        failures++;
      }
      this.tick();
    });
    if (failures) softError('Аватары', { message: `Не удалось сохранить аватаров: ${failures}` });
  }

  snapshot(posts, users) {
    let total = 0;
    const counts = {};
    for (const p of posts) {
      for (const uid of Object.keys(p.likers || {})) {
        counts[uid] = (counts[uid] || 0) + 1;
        total++;
      }
    }
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100);
    return {
      at: Date.now(),
      posts: posts.length,
      likes: posts.reduce((s, p) => s + (p.likes_count || 0), 0),
      collected_likes: total,
      unique_users: Object.keys(counts).length,
      top,
    };
  }
}

module.exports = { SyncEngine, download };
