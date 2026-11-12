'use strict';
/**
 * Модель публикации. Оригинал VK (original) и правки пользователя (local + overrides) хранятся раздельно.
 * Отображаемое значение поля = overrides[поле] ? local[поле] : original[поле].
 * Лайки и список лайкнувших — всегда из VK (это статистика, её не редактируют).
 */
const EDITABLE = ['text', 'date', 'photos'];
const HISTORY_LIMIT = 60;

function postId(ownerId, id) {
  return `wall${ownerId}_${id}`;
}

function postUrl(ownerId, id) {
  return `https://vk.com/wall${ownerId}_${id}`;
}

function same(field, a, b) {
  if (field === 'photos') {
    const ka = (a || []).map((p) => p.key).join('|');
    const kb = (b || []).map((p) => p.key).join('|');
    return ka === kb;
  }
  return (a ?? '') === (b ?? '');
}

function pushHistory(post, entry) {
  post.history = post.history || [];
  post.history.push({ at: Date.now(), ...entry });
  if (post.history.length > HISTORY_LIMIT) post.history.splice(0, post.history.length - HISTORY_LIMIT);
}

function brief(field, v) {
  if (field === 'photos') return (v || []).length + ' фото';
  if (field === 'date') return v;
  return typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
}

/** Есть ли у публикации действующие локальные правки, отличающиеся от оригинала */
function localChanges(post) {
  const fields = [];
  for (const f of EDITABLE) {
    if (post.overrides && post.overrides[f] && !same(f, post.local[f], post.original[f])) fields.push(f);
  }
  return fields;
}

function newPost({ ownerId, id, sourceId, text, date, photos, likes, reposts, views, comments, now }) {
  return {
    id: postId(ownerId, id),
    owner_id: ownerId,
    post_id: id,
    source_id: sourceId,
    url: postUrl(ownerId, id),
    original: { text: text || '', date, photos: photos || [] },
    local: {},
    overrides: { text: false, date: false, photos: false },
    vk_changed: {},
    likes_count: likes || 0,
    reposts: reposts || 0,
    views: views || 0,
    comments: comments || 0,
    likers: {},
    likers_complete: false,
    likers_at: 0,
    history: [{ at: now, kind: 'import' }],
    added_at: now,
    updated_at: now,
    last_checked: now,
    is_new: true,
    vk_missing: 0,
  };
}

/**
 * Применяет свежие данные VK к публикации. Ручные правки не трогаются.
 * Возвращает { changed, conflictFields }.
 */
function applyVk(post, fresh, now) {
  let changed = false;
  const conflictFields = [];
  for (const f of EDITABLE) {
    if (fresh[f] === undefined) continue;
    let next = fresh[f];
    if (f === 'photos') {
      // переиспользуем уже скачанные файлы
      const byKey = new Map((post.original.photos || []).map((p) => [p.key, p]));
      next = next.map((p) => {
        const old = byKey.get(p.key);
        return old ? { ...p, file: old.file, thumb: old.thumb } : p;
      });
    }
    if (!same(f, post.original[f], next)) {
      pushHistory(post, { kind: 'vk', field: f, from: brief(f, post.original[f]), to: brief(f, next) });
      if (post.overrides[f]) {
        post.vk_changed = post.vk_changed || {};
        post.vk_changed[f] = now; // оригинал изменился, а у пользователя своя версия — покажем это
        conflictFields.push(f);
      }
      post.original[f] = next;
      changed = true;
    } else if (f === 'photos') {
      post.original.photos = next; // обновлённые ссылки на CDN при тех же фото
    }
  }
  for (const k of ['likes_count', 'reposts', 'views', 'comments']) {
    if (fresh[k] !== undefined && post[k] !== fresh[k]) {
      post[k] = fresh[k];
      changed = true;
    }
  }
  if (post.vk_missing) {
    post.vk_missing = 0;
    changed = true;
  }
  post.last_checked = now;
  if (changed) post.updated_at = now;
  return { changed, conflictFields };
}

/** Обновление списка лайкнувших: сохраняем момент, когда приложение впервые увидело лайк */
function applyLikers(post, ids, now) {
  const prev = post.likers || {};
  const next = {};
  let added = 0;
  let removed = 0;
  for (const id of ids) {
    if (prev[id]) next[id] = prev[id];
    else {
      next[id] = now;
      added++;
    }
  }
  for (const id of Object.keys(prev)) if (!(id in next)) removed++;
  post.likers = next;
  post.likers_complete = true;
  post.likers_at = now;
  return { added, removed };
}

/** Ручное редактирование. patch: { text?, date?, photos? } */
function editPost(post, patch, now) {
  for (const f of EDITABLE) {
    if (!(f in patch)) continue;
    const before = post.overrides[f] ? post.local[f] : post.original[f];
    if (same(f, before, patch[f])) continue;
    post.local[f] = patch[f];
    post.overrides[f] = true;
    if (post.vk_changed) delete post.vk_changed[f];
    pushHistory(post, { kind: 'edit', field: f, from: brief(f, before), to: brief(f, patch[f]) });
  }
  post.updated_at = now;
}

/** Принять оригинал VK для поля (отменить ручную правку) */
function acceptOriginal(post, field, now) {
  if (!EDITABLE.includes(field) || !post.overrides[field]) return;
  pushHistory(post, { kind: 'accept', field, from: brief(field, post.local[field]), to: brief(field, post.original[field]) });
  post.overrides[field] = false;
  delete post.local[field];
  if (post.vk_changed) delete post.vk_changed[field];
  post.updated_at = now;
}

/** Оставить свою версию: убрать отметку «оригинал изменился» */
function keepMine(post, field) {
  if (post.vk_changed) delete post.vk_changed[field];
}

function effective(post, field) {
  return post.overrides && post.overrides[field] ? post.local[field] : post.original[field];
}

/** Пересчёт лайков пользователей в users.json */
function recountUsers(posts, users) {
  const counts = {};
  const last = {};
  for (const p of posts) {
    for (const [uid, ts] of Object.entries(p.likers || {})) {
      counts[uid] = (counts[uid] || 0) + 1;
      if (!last[uid] || ts > last[uid]) last[uid] = ts;
    }
  }
  for (const [uid, u] of Object.entries(users)) {
    u.likes = counts[uid] || 0;
    u.last_like_seen = last[uid] || 0;
  }
  return counts;
}

module.exports = {
  EDITABLE,
  postId,
  postUrl,
  newPost,
  applyVk,
  applyLikers,
  editPost,
  acceptOriginal,
  keepMine,
  effective,
  localChanges,
  recountUsers,
  same,
};
