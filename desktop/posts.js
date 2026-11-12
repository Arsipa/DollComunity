'use strict';
/**
 * «Мои посты»: добавление поста по ссылке и смена его названия.
 * Посты добавляются только вручную — программа не ищет публикации на стенах сообществ.
 */
const fs = require('fs');
const { parsePostInput, VkError } = require('./vk');
const { freshFromItem } = require('./sync');
const { PostFetcher } = require('./wallfind');
const M = require('./model');

const TITLE_MAX = 200;
const cleanTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);

/**
 * Загружает пост из VK и кладёт его в posts.json. Лайки и фото подтянет обновление (sync.run({ postIds })).
 * @returns созданный пост
 */
async function addPost({ vk, store, input, title, now = Date.now(), log = () => {} }) {
  const ref = parsePostInput(input);
  if (!ref) throw new Error('Не получилось разобрать ссылку на пост. Откройте пост во ВКонтакте и скопируйте адрес — в нём должно быть «wall», например https://vk.com/wall-123_456');
  const id = M.postId(ref.owner_id, ref.post_id);
  const postsDoc = store.get('posts.json');
  if (postsDoc.posts.some((p) => p.id === id)) throw new Error('Этот пост уже есть в «Моих постах».');

  const del = store.get('deleted_posts.json');
  const trashed = del.deleted.find((d) => d.id === id);
  if (trashed && trashed.post) throw new Error('Этот пост лежит в корзине — верните его оттуда.');

  const fetcher = new PostFetcher(vk, log);
  let got;
  try {
    got = await fetcher.fetch([ref]);
  } catch (e) {
    if (e.code === 'not_found' || e.code === 'access') throw new Error('Пост не найден или закрыт. Проверьте ссылку и что пост виден с вашего аккаунта.');
    throw e;
  }
  const hit = got.found.get(id);
  if (!hit) throw new VkError('not_found', 'Пост не найден или закрыт. Проверьте ссылку и что пост виден с вашего аккаунта.');
  const item = hit.item;

  const f = freshFromItem(item);
  const p = M.newPost({ ownerId: item.owner_id, id: item.id, title: cleanTitle(title), text: f.text, date: f.date, photos: f.photos, likes: f.likes_count, reposts: f.reposts, views: f.views, comments: f.comments, now });
  p.owner_name = got.names[item.owner_id] || '';
  if (Number.isFinite(hit.offset)) p.wall_offset = hit.offset;
  postsDoc.posts.push(p);
  // пост «удалён навсегда» раньше, а теперь добавлен заново вручную — убираем отметку, чтобы обновление его не пропускало
  if (trashed) del.deleted = del.deleted.filter((d) => d.id !== id);
  store.writeNow('posts.json');
  if (trashed) store.writeNow('deleted_posts.json');
  return p;
}

function setTitle(post, title, now = Date.now()) {
  const t = cleanTitle(title);
  if (t === (post.title || '')) return post;
  post.title = t;
  post.updated_at = now;
  return post;
}

// ---------- массовые действия: «Очистить все посты» и «Удалить всё в корзине» ----------

/** Все посты → в корзину (обратимо). Возвращает число перенесённых. */
function trashAll(store, now = Date.now()) {
  const postsDoc = store.get('posts.json');
  const del = store.get('deleted_posts.json');
  const moved = postsDoc.posts.splice(0, postsDoc.posts.length);
  for (const p of moved) del.deleted.unshift({ id: p.id, deleted_at: now, post: p });
  M.recountUsers(postsDoc.posts, store.get('users.json').users);
  store.writeNow('deleted_posts.json');
  store.writeNow('posts.json');
  store.writeNow('users.json');
  return moved.length;
}

const photoFiles = (p) => {
  const out = new Set();
  for (const ph of [...((p && p.original && p.original.photos) || []), ...((p && p.local && p.local.photos) || [])]) {
    if (ph && ph.file) out.add(ph.file);
    if (ph && ph.thumb) out.add(ph.thumb);
  }
  return out;
};

/**
 * Удалить файлы фото убранных постов, если они больше нигде не используются
 * (ни в «Моих постах», ни в оставшейся корзине).
 */
async function removeUnusedPhotos(store, removedPosts) {
  const used = new Set();
  for (const p of store.get('posts.json').posts) for (const f of photoFiles(p)) used.add(f);
  for (const d of store.get('deleted_posts.json').deleted) for (const f of photoFiles(d.post)) used.add(f);
  let n = 0;
  for (const p of removedPosts) {
    for (const f of photoFiles(p)) {
      if (used.has(f) || !/^[\w.-]+$/.test(f)) continue; // только простые имена файлов из папки фото
      for (const full of [store.photoPath(f), store.thumbPath(f)]) {
        try {
          await fs.promises.unlink(full);
          n++;
        } catch (_) {}
      }
    }
  }
  return n;
}

/** Корзина → пусто, навсегда (вместе с неиспользуемыми фото). Возвращает число удалённых карточек. */
async function clearTrash(store) {
  const del = store.get('deleted_posts.json');
  const removed = del.deleted.splice(0, del.deleted.length);
  store.writeNow('deleted_posts.json');
  await removeUnusedPhotos(store, removed.map((d) => d.post).filter(Boolean));
  return removed.length;
}

module.exports = { addPost, setTitle, cleanTitle, trashAll, clearTrash, removeUnusedPhotos };
