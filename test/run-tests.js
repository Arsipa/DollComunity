'use strict';
/**
 * Автотесты хранилища, модели и синхронизации (VK подменяется фальшивым сервером).
 * Запуск: npm test
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../desktop/storage');
const { SyncEngine } = require('../desktop/sync');
const { parsePostInput } = require('../desktop/vk');
const M = require('../desktop/model');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vkd-test-'));
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}

// ---------- фальшивый VK ----------
const fake = {
  wall: [], // items
  likes: {}, // "owner_id" -> [ids]
  users: {},
  calls: [],
  failOnce: {},
  failAlways: {},
  web: null, // страница «Оценили» на m.vk.ru: { item_id: ['id10', 'masha', ...] }; null — отдаём fake.likes
  screenNames: {}, // короткое имя -> id для users.get
};
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400, 1)]);
function vkItem(id, text, likes, photoKey) {
  return {
    id,
    owner_id: -100,
    date: 1760000000 + id,
    text,
    likes: { count: likes },
    attachments: photoKey ? [{ type: 'photo', photo: { id: photoKey, owner_id: -100, sizes: [{ url: `https://cdn/${photoKey}_s.jpg`, width: 100, height: 100 }, { url: `https://cdn/${photoKey}_x.jpg`, width: 1000, height: 800 }] } }] : [],
  };
}
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (opts.method === 'HEAD') return { ok: true };
  if (url.startsWith('https://cdn/')) return { ok: true, arrayBuffer: async () => JPEG };
  if (url.startsWith('https://m.vk.ru/like')) {
    const q = new URL(url).searchParams;
    fake.calls.push('web:like');
    const item = q.get('object').split('_')[1];
    if (fake.webHidden && fake.webHidden.includes(item)) {
      return { ok: true, json: async () => ({ location: 'id823631978', hard: 0, type: 1 }) }; // так VK отвечает гостю на скрытые лайки
    }
    const all = fake.web ? fake.web[item] || [] : (fake.likes[item] || []).map((id) => 'id' + id);
    let off = Number(q.get('offset'));
    if (fake.webCap && off >= fake.webCap) off = 0; // как у VK без входа: дальше ~350 человек отдаётся одна и та же страница
    const head = fake.webCap ? '<div class="UnauthorizedHeader"></div>' : '';
    const html = head + all
      .slice(off, off + 50)
      .map((h) => `<a class="inline_item like_user_item" href="/${h}">
  <div class="ii_body"><span class="ii_owner">X</span></div></a>`)
      .join('');
    return { ok: true, json: async () => ({ title: 'Оценили | ВКонтакте', html: `<div class="upanel"><div class="items bl_cont">${html}</div></div>` }) };
  }
  const method = url.replace('https://api.vk.com/method/', '');
  const p = Object.fromEntries(new URLSearchParams(String(opts.body)));
  fake.calls.push(method);
  const ok = (response) => ({ ok: true, json: async () => ({ response }) });
  if (method === 'likes.getList' && fake.likesOnlyFor && p.access_token !== fake.likesOnlyFor) {
    return { ok: true, json: async () => ({ error: { error_code: 1051, error_msg: 'Method is not available for this profile type' } }) };
  }
  if (fake.failAlways[method]) return { ok: true, json: async () => ({ error: fake.failAlways[method] }) };
  if (fake.failOnce[method]) {
    delete fake.failOnce[method];
    return { ok: true, json: async () => ({ error: { error_code: 6, error_msg: 'Too many requests' } }) };
  }
  switch (method) {
    case 'users.get': {
      const keys = (p.user_ids || '').split(',').filter(Boolean);
      if (keys.some((k) => !/^\d+$/.test(k) && !fake.screenNames[k]) && keys.length > 1) {
        return { ok: true, json: async () => ({ error: { error_code: 113, error_msg: 'Invalid user id' } }) };
      }
      const ids = keys.map((k) => (/^\d+$/.test(k) ? Number(k) : fake.screenNames[k])).filter(Boolean);
      const name = (id) => Object.keys(fake.screenNames).find((n) => fake.screenNames[n] === id) || 'id' + id;
      return ok(ids.map((id) => ({ screen_name: name(id), ...(fake.users[id] || { id, first_name: 'User', last_name: String(id) }) })));
    }
    case 'wall.get': {
      const off = Number(p.offset);
      const cnt = Number(p.count);
      return ok({ count: fake.wall.length, items: fake.wall.slice(off, off + cnt) });
    }
    case 'wall.getById': {
      const keys = p.posts.split(',');
      return ok({ items: fake.wall.filter((w) => keys.includes(`${w.owner_id}_${w.id}`)), groups: [{ id: 100, name: 'Куклы' }], profiles: [] });
    }
    case 'likes.getList': {
      const all = fake.likes[p.item_id] || [];
      const off = Number(p.offset);
      return ok({ count: all.length, items: all.slice(off, off + Number(p.count)) });
    }
    case 'groups.getById':
      return ok({ groups: [] });
    default:
      return { ok: true, json: async () => ({ error: { error_code: 3, error_msg: 'unknown' } }) };
  }
};

function makeStore(name) {
  const s = new Store(path.join(tmpRoot, name), () => {});
  s.loadAll();
  return s;
}

const { WebLikes, parseLikersPage } = require('../desktop/weblikes');
const fastWeb = () => new WebLikes({ minInterval: 0 });
function makeEngine(store, extra = {}) {
  return new SyncEngine({ store, getToken: async () => 'token', webLikes: fastWeb, log: () => {}, makeThumb: async (src, dest) => fs.copyFileSync(src, dest), ...extra });
}

const NO_LIKES_API = { error_code: 1051, error_msg: 'Method is not available for this profile type' };

(async () => {
  await test('разбор ссылок на посты', () => {
    assert.deepStrictEqual(parsePostInput('https://vk.com/wall-42_10'), { owner_id: -42, post_id: 10 });
    assert.deepStrictEqual(parsePostInput('https://vk.ru/paolareina?w=wall-44396859_1664852'), { owner_id: -44396859, post_id: 1664852 });
    assert.deepStrictEqual(parsePostInput('vk.com/feed?w=wall7_3&z=photo'), { owner_id: 7, post_id: 3 });
    assert.deepStrictEqual(parsePostInput('-5_6'), { owner_id: -5, post_id: 6 });
    assert.strictEqual(parsePostInput('https://vk.com/club123'), null);
    assert.strictEqual(parsePostInput('   '), null);
  });

  await test('атомарная запись и восстановление повреждённого файла из .prev', () => {
    const s = makeStore('atomic');
    s.get('posts.json').posts.push({ id: 'x' });
    s.writeNow('posts.json');
    s.get('posts.json').posts.push({ id: 'y' });
    s.writeNow('posts.json'); // .prev теперь содержит [x]
    fs.writeFileSync(path.join(s.dataDir, 'posts.json'), '{"posts": [ broken');
    const s2 = new Store(s.root, () => {});
    const probs = s2.loadAll();
    assert.strictEqual(probs[0].fixed, 'prev');
    assert.deepStrictEqual(s2.get('posts.json').posts.map((p) => p.id), ['x']);
    assert.ok(fs.readdirSync(s.trashDir).some((f) => f.includes('damaged_posts.json')), 'повреждённый файл отложен в trash');
  });

  await test('повреждённый файл без копий не перезаписывается пустыми данными', () => {
    const s = makeStore('nooverwrite');
    const file = path.join(s.dataDir, 'users.json');
    fs.writeFileSync(file, 'garbage');
    fs.rmSync(file + '.prev', { force: true });
    const s2 = new Store(s.root, () => {});
    s2.loadAll();
    assert.ok(s2.blocked.has('users.json'));
    s2.writeNow('users.json');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'garbage');
  });

  await test('модель: правка, приоритет ручных изменений, принять оригинал', () => {
    const p = M.newPost({ ownerId: -1, id: 5, text: 'Новое платье для кукол', date: 100, photos: [{ key: 'a' }], now: 1 });
    M.editPost(p, { text: 'Моё новое платье для Барби' }, 2);
    let r = M.applyVk(p, { text: 'Новое платье для кукол', photos: [{ key: 'b' }], likes_count: 9 }, 3);
    assert.strictEqual(M.effective(p, 'text'), 'Моё новое платье для Барби');
    assert.deepStrictEqual(M.effective(p, 'photos').map((x) => x.key), ['b'], 'фото не правили — обновилось из VK');
    assert.deepStrictEqual(r.conflictFields, []);
    r = M.applyVk(p, { text: 'Платье v2' }, 4);
    assert.deepStrictEqual(r.conflictFields, ['text']);
    assert.strictEqual(M.effective(p, 'text'), 'Моё новое платье для Барби');
    assert.strictEqual(p.original.text, 'Платье v2');
    assert.deepStrictEqual(M.localChanges(p), ['text']);
    M.acceptOriginal(p, 'text', 5);
    assert.strictEqual(M.effective(p, 'text'), 'Платье v2');
    assert.deepStrictEqual(M.localChanges(p), []);
    assert.ok(p.history.length >= 4);
  });

  // ---------- «Мои посты»: добавление по ссылке и обновление только добавленных ----------
  const { addPost, setTitle } = require('../desktop/posts');
  const { VkClient } = require('../desktop/vk');
  const testVk = () => new VkClient({ getToken: async () => 't', minInterval: 0 });
  const runSync = async (s, opts) => {
    const e = makeEngine(s);
    const done = new Promise((r) => e.once('done', r));
    await e.run(opts);
    return done;
  };

  await test('добавление поста по ссылке: название, владелец, повтор и корзина', async () => {
    const s = makeStore('add');
    fake.wall = [vkItem(1, 'Платье', 3, 11), vkItem(2, 'Шляпка', 2500, 12), vkItem(3, 'Без фото', 0)];
    const p = await addPost({ vk: testVk(), store: s, input: 'https://vk.ru/paolareina?w=wall-100_1', title: '  Платье   для Паолы ' });
    assert.strictEqual(p.id, 'wall-100_1');
    assert.strictEqual(p.title, 'Платье для Паолы', 'лишние пробелы убраны');
    assert.strictEqual(p.owner_name, 'Куклы', 'название сообщества из ответа VK');
    assert.strictEqual(M.effective(p, 'text'), 'Платье');
    assert.strictEqual(s.get('posts.json').posts.length, 1);
    await assert.rejects(addPost({ vk: testVk(), store: s, input: 'vk.com/wall-100_1' }), /уже есть/);
    await assert.rejects(addPost({ vk: testVk(), store: s, input: 'https://vk.com/paolareina' }), /ссылку на пост/);
    await assert.rejects(addPost({ vk: testVk(), store: s, input: 'wall-100_999' }), /не найден/);
    await addPost({ vk: testVk(), store: s, input: 'wall-100_2' });
    await addPost({ vk: testVk(), store: s, input: '-100_3', title: '' });
    assert.strictEqual(s.get('posts.json').posts.length, 3);
    setTitle(s.get('posts.json').posts[2], 'Новое имя');
    assert.strictEqual(s.get('posts.json').posts[2].title, 'Новое имя');
    // пост из корзины заново не добавляется — его возвращают из корзины
    const del = s.get('deleted_posts.json');
    const list = s.get('posts.json').posts;
    del.deleted.push({ id: 'wall-100_3', deleted_at: 1, post: list.splice(2, 1)[0] });
    s.writeNow('posts.json');
    s.writeNow('deleted_posts.json');
    await assert.rejects(addPost({ vk: testVk(), store: s, input: 'wall-100_3' }), /корзине/);
  });

  await test('обновление: только добавленные посты (без стен сообществ), лайки >1000, фото, профили, повтор после ошибки', async () => {
    const s = makeStore('add'); // 2 поста из предыдущего теста
    fake.likes = { 1: [10, 20, 30], 2: Array.from({ length: 2500 }, (_, i) => i + 1) };
    fake.failOnce['wall.getById'] = true;
    const before = fake.calls.length;
    const rep = await runSync(s);
    assert.strictEqual(rep.fatal, null, JSON.stringify(rep.fatal));
    const calls = fake.calls.slice(before);
    assert.ok(!calls.includes('wall.get'), 'стены сообществ не листаются');
    const posts = s.get('posts.json').posts;
    assert.strictEqual(posts.length, 2, 'новые посты сами не появляются');
    assert.strictEqual(rep.created, 0);
    const p2 = posts.find((p) => p.post_id === 2);
    assert.strictEqual(Object.keys(p2.likers).length, 2500, 'все 2500 лайков, а не первые 100/1000');
    assert.ok(p2.original.photos[0].url.endsWith('_x.jpg'), 'выбрано фото максимального качества');
    assert.ok(fs.existsSync(s.photoPath(p2.original.photos[0].file)));
    const users = s.get('users.json').users;
    assert.strictEqual(users[10].likes, 2, 'пользователь 10 лайкнул 2 поста');
    assert.strictEqual(Object.keys(users).length, 2500);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'posts.json'), 'utf8'));
    assert.strictEqual(saved.posts.length, 2, 'данные записаны на диск');
  });

  await test('обновление одного поста (после «Добавить пост») не трогает остальные', async () => {
    const s = makeStore('add');
    fake.wall = [vkItem(1, 'Платье', 4, 11), vkItem(2, 'Шляпка', 3, 12)]; // у обоих изменилось число лайков
    fake.likes[1] = [10, 20, 30, 40];
    fake.likes[2] = [1, 2, 3];
    await runSync(s, { postIds: ['wall-100_1'] });
    const posts = s.get('posts.json').posts;
    assert.strictEqual(Object.keys(posts.find((p) => p.post_id === 1).likers).length, 4);
    assert.strictEqual(Object.keys(posts.find((p) => p.post_id === 2).likers).length, 2500, 'второй пост не обновлялся');
  });

  await test('ручные правки сохраняются; пост исчез из VK — остаётся у вас', async () => {
    const s = makeStore('add');
    const posts = s.get('posts.json').posts;
    M.editPost(posts.find((p) => p.post_id === 1), { text: 'Моё платье' }, Date.now());
    s.flush();
    fake.wall = [vkItem(1, 'Платье (обновлено)', 4, 11)]; // пост 2 удалили во ВКонтакте
    const rep = await runSync(s);
    const after = s.get('posts.json').posts;
    const q1 = after.find((p) => p.post_id === 1);
    assert.strictEqual(M.effective(q1, 'text'), 'Моё платье');
    assert.strictEqual(q1.original.text, 'Платье (обновлено)');
    assert.ok(q1.vk_changed.text);
    assert.strictEqual(rep.conflicts, 1);
    assert.strictEqual(after.length, 2);
    assert.ok(after.find((p) => p.post_id === 2).vk_missing > 0);
  });

  await test('«Очистить все посты» → корзина; «Удалить всё в корзине» — навсегда, вместе с ненужными фото', async () => {
    const { trashAll, clearTrash } = require('../desktop/posts');
    const s = makeStore('clean');
    fake.wall = [vkItem(1, 'A', 1, 11), vkItem(2, 'B', 1, 12)];
    fake.likes = { 1: [10], 2: [10] };
    for (const n of [1, 2]) await addPost({ vk: testVk(), store: s, input: `wall-100_${n}` });
    await runSync(s); // скачивает фото
    const files = s.get('posts.json').posts.map((p) => p.original.photos[0].file);
    assert.ok(files.every((f) => fs.existsSync(s.photoPath(f))), 'фото скачаны');
    assert.strictEqual(trashAll(s), 2);
    assert.strictEqual(s.get('posts.json').posts.length, 0);
    assert.strictEqual(s.get('deleted_posts.json').deleted.length, 2);
    assert.strictEqual(s.get('users.json').users[10].likes, 0, 'счётчики лайков пересчитаны');
    assert.ok(files.every((f) => fs.existsSync(s.photoPath(f))), 'из корзины можно вернуть — фото на месте');
    assert.strictEqual(await clearTrash(s), 2);
    assert.strictEqual(s.get('deleted_posts.json').deleted.length, 0);
    assert.ok(files.every((f) => !fs.existsSync(s.photoPath(f)) && !fs.existsSync(s.thumbPath(f))), 'фото удалены с диска');
    const saved = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'deleted_posts.json'), 'utf8'));
    assert.strictEqual(saved.deleted.length, 0, 'записано на диск');
    // удалённый навсегда пост можно добавить заново
    await addPost({ vk: testVk(), store: s, input: 'wall-100_1' });
    assert.strictEqual(s.get('posts.json').posts.length, 1);
  });

  await test('wall.getById запрещён (код 1051, ключ VK ID) — пост находится через wall.get за несколько запросов', async () => {
    const { PostFetcher } = require('../desktop/wallfind');
    const s = makeStore('byid1051');
    // стена из 5000 постов, от новых к старым; первый — закреплённый старый пост
    const wall = Array.from({ length: 5000 }, (_, i) => vkItem(9000 - i, 'Пост ' + (9000 - i), 1));
    wall.unshift(Object.assign(vkItem(17, 'Закреплённый', 1), { is_pinned: 1 }));
    fake.wall = wall;
    fake.likes = {};
    fake.failAlways['wall.getById'] = { error_code: 1051, error_msg: 'Method is not available for this profile type' };
    try {
      let before = fake.calls.length;
      const p = await addPost({ vk: testVk(), store: s, input: 'https://vk.ru/wall-100_6197', title: 'Глубоко на стене' });
      const used = fake.calls.slice(before).filter((m) => m === 'wall.get').length;
      assert.strictEqual(M.effective(p, 'text'), 'Пост 6197');
      assert.ok(used <= 8, `двоичный поиск, а не перебор всей стены (запросов wall.get: ${used})`);
      assert.ok(Number.isFinite(p.wall_offset), 'место на стене запомнено');
      const pinned = await addPost({ vk: testVk(), store: s, input: 'wall-100_17' });
      assert.strictEqual(M.effective(pinned, 'text'), 'Закреплённый');
      await assert.rejects(addPost({ vk: testVk(), store: s, input: 'wall-100_99999' }), /не найден/);
      // обновление: по запомненному месту хватает пары запросов; удалённый пост помечается «Нет в VK»
      fake.wall = wall.filter((x) => x.id !== 17);
      fake.wall.unshift(vkItem(9001, 'Новый пост сверху', 1)); // стена сдвинулась
      before = fake.calls.length;
      const rep = await runSync(s);
      assert.strictEqual(rep.fatal, null, JSON.stringify(rep.fatal));
      // найденный пост — 1 запрос по подсказке; удалённый — поиск (~log2(5000/100)) + соседние страницы
      const n = fake.calls.slice(before).filter((m) => m === 'wall.get').length;
      assert.ok(n <= 14, `не листаем всю стену (запросов wall.get: ${n})`);
      const posts = s.get('posts.json').posts;
      assert.ok(posts.find((x) => x.post_id === 17).vk_missing > 0, 'удалённый пост помечен');
      assert.ok(!posts.find((x) => x.post_id === 6197).vk_missing, 'найденный пост на месте');
    } finally {
      delete fake.failAlways['wall.getById'];
      PostFetcher.reset();
    }
  });

  // ---------- лайки ----------
  await test('лайки: ключ VK ID отклонён (1051) — берём списки сервисным ключом', async () => {
    const s = makeStore('svc');
    fake.wall = [vkItem(1, 'A', 2, 11), vkItem(2, 'B', 1, 12)];
    fake.likes = { 1: [10, 20], 2: [30] };
    for (const n of [1, 2]) await addPost({ vk: testVk(), store: s, input: `wall-100_${n}` });
    fake.likesOnlyFor = 'svc-key';
    try {
      const e = new SyncEngine({ store: s, getToken: async () => 'token', getServiceToken: async () => 'svc-key', webLikes: false, log: () => {}, makeThumb: async (a, b) => fs.copyFileSync(a, b) });
      const done = new Promise((r) => e.once('done', r));
      await e.run();
      const rep = await done;
      assert.deepStrictEqual(rep.errors, []);
      const posts = s.get('posts.json').posts;
      assert.strictEqual(Object.keys(posts.find((p) => p.post_id === 1).likers).length, 2);
      assert.strictEqual(s.get('users.json').users[30].likes, 1);
    } finally {
      delete fake.likesOnlyFor;
    }
  });

  await test('лайки: likes.getList закрыт (код 1051) — списки берутся со страницы vk.com', async () => {
    const s = makeStore('likes1051');
    fake.wall = [vkItem(1, 'A', 3, 11), vkItem(2, 'B', 2, 12), vkItem(3, 'C', 0)];
    fake.likes = { 1: [10, 20, 30], 2: [40, 50] };
    for (const n of [1, 2, 3]) await addPost({ vk: testVk(), store: s, input: `wall-100_${n}` });
    fake.failAlways['likes.getList'] = NO_LIKES_API;
    const before = fake.calls.length;
    try {
      const rep = await runSync(s);
      assert.strictEqual(rep.fatal, null);
      assert.deepStrictEqual(rep.errors, []);
      assert.strictEqual(fake.calls.slice(before).filter((m) => m === 'likes.getList').length, 1, 'после 1051 API лайков больше не спрашиваем');
      const posts = s.get('posts.json').posts;
      assert.deepStrictEqual(Object.keys(posts.find((p) => p.post_id === 1).likers).map(Number).sort((a, b) => a - b), [10, 20, 30]);
      assert.strictEqual(s.get('users.json').users[50].likes, 1);
    } finally {
      delete fake.failAlways['likes.getList'];
    }
  });

  await test('лайки с vk.com: короткие имена → id, много страниц, неизвестные имена пропускаются', async () => {
    const s = makeStore('weblikes');
    const many = Array.from({ length: 120 }, (_, i) => 'id' + (1000 + i));
    fake.wall = [vkItem(1, 'A', 123, 11)];
    fake.web = { 1: [...many, 'masha', 'deleted_name', 'club5'] };
    fake.screenNames = { masha: 77 };
    await addPost({ vk: testVk(), store: s, input: 'wall-100_1' });
    fake.failAlways['likes.getList'] = NO_LIKES_API;
    try {
      const rep = await runSync(s);
      assert.deepStrictEqual(rep.errors, []);
      const likers = Object.keys(s.get('posts.json').posts[0].likers).map(Number);
      assert.strictEqual(likers.length, 121);
      assert.ok(likers.includes(77) && likers.includes(1119));
    } finally {
      delete fake.failAlways['likes.getList'];
      fake.web = null;
      fake.screenNames = {};
    }
  });

  await test('лайки с vk.com: пост закрыт — ошибка только по этому посту', async () => {
    const s = makeStore('webclosed');
    fake.wall = [vkItem(1, 'A', 2, 11), vkItem(2, 'B', 1)];
    fake.web = { 1: [], 2: ['id9'] };
    for (const n of [1, 2]) await addPost({ vk: testVk(), store: s, input: `wall-100_${n}` });
    fake.failAlways['likes.getList'] = NO_LIKES_API;
    try {
      const rep = await runSync(s);
      assert.strictEqual(rep.errors.length, 1, JSON.stringify(rep.errors));
      assert.strictEqual(rep.errors[0].code, 'access');
      assert.ok(s.get('posts.json').posts.find((p) => p.post_id === 2).likers[9]);
    } finally {
      delete fake.failAlways['likes.getList'];
      fake.web = null;
    }
  });

  await test('лайки с vk.com без входа: видны только первые 350 — известные лайки не теряются, ошибка с подсказкой', async () => {
    const s = makeStore('webcap');
    const all = Array.from({ length: 500 }, (_, i) => 'id' + (2000 + i));
    fake.wall = [vkItem(1, 'A', 500, 11)];
    fake.web = { 1: all };
    await addPost({ vk: testVk(), store: s, input: 'wall-100_1' });
    const post = s.get('posts.json').posts[0];
    post.likers = { 2499: 111 }; // этот лайк уже был известен раньше
    fake.failAlways['likes.getList'] = NO_LIKES_API;
    fake.webCap = 350;
    try {
      const rep = await runSync(s);
      assert.strictEqual(rep.errors.length, 1, JSON.stringify(rep.errors));
      assert.strictEqual(rep.errors[0].code, 'partial');
      assert.ok(/Войдите на vk\.com/.test(rep.errors[0].message));
      const p = s.get('posts.json').posts[0];
      assert.strictEqual(Object.keys(p.likers).length, 351);
      assert.strictEqual(p.likers[2499], 111, 'старый лайк сохранён с прежней датой');
      assert.strictEqual(p.likers_complete, false);
    } finally {
      delete fake.failAlways['likes.getList'];
      fake.web = null;
      delete fake.webCap;
    }
  });

  await test('лайки с vk.com: VK отправляет на профиль (лайки скрыты) — понятная ошибка с подсказкой войти', async () => {
    const s = makeStore('webhidden');
    fake.wall = [vkItem(1, 'A', 4, 11), vkItem(2, 'B', 1)];
    fake.web = { 2: ['id9'] };
    fake.webHidden = ['1'];
    for (const n of [1, 2]) await addPost({ vk: testVk(), store: s, input: `wall-100_${n}` });
    fake.failAlways['likes.getList'] = NO_LIKES_API;
    try {
      const rep = await runSync(s);
      assert.strictEqual(rep.errors.length, 1, JSON.stringify(rep.errors));
      assert.strictEqual(rep.errors[0].code, 'access');
      assert.ok(/Войдите на vk\.com/.test(rep.errors[0].message));
      assert.ok(s.get('posts.json').posts.find((p) => p.post_id === 2).likers[9], 'остальные посты обработаны');
    } finally {
      delete fake.failAlways['likes.getList'];
      fake.web = null;
      delete fake.webHidden;
    }
  });

  await test('лайки недоступны совсем (1051, без vk.com) — одна ошибка, обновление не прерывается', async () => {
    const s = makeStore('likes1051noweb');
    fake.wall = [vkItem(1, 'A', 3, 11), vkItem(2, 'B', 5, 12)];
    for (const n of [1, 2]) await addPost({ vk: testVk(), store: s, input: `wall-100_${n}` });
    fake.failAlways['likes.getList'] = NO_LIKES_API;
    const before = fake.calls.length;
    try {
      const e = makeEngine(s, { webLikes: false });
      const done = new Promise((r) => e.once('done', r));
      await e.run();
      const rep = await done;
      assert.strictEqual(rep.fatal, null);
      assert.strictEqual(rep.errors.length, 1, JSON.stringify(rep.errors));
      assert.strictEqual(rep.errors[0].code, 'unsupported');
      assert.strictEqual(fake.calls.slice(before).filter((m) => m === 'likes.getList').length, 1);
    } finally {
      delete fake.failAlways['likes.getList'];
    }
  });

  await test('разбор страницы «Оценили»: id из адреса и из класса, имена, сообщества пропускаются', () => {
    const html =
      '<a class="inline_item like_user_item al_unew25969669" href="/id25969669"></a>' +
      '<a class="inline_item like_user_item al_unew464530132" href="/aleksandrinka05"></a>' +
      '<a class="inline_item like_user_item" href="/klishina87"></a>' +
      '<a class="inline_item like_user_item" href="/id396887797"></a>' +
      '<a class="inline_item like_user_item" href="/club123"></a>' +
      '<a class="inline_item" href="/id1"></a>';
    assert.deepStrictEqual(parseLikersPage(html), [{ id: 25969669 }, { id: 464530132 }, { name: 'klishina87' }, { id: 396887797 }]);
  });

  // ---------- VK ID ----------
  const vkid = require('../desktop/vkid');
  const crypto = require('crypto');

  await test('VK ID: PKCE и адрес входа', () => {
    const { verifier, challenge } = vkid.pkce();
    assert.ok(/^[A-Za-z0-9_-]{43,128}$/.test(verifier));
    assert.strictEqual(challenge, vkid.b64url(crypto.createHash('sha256').update(verifier).digest()));
    const u = new URL(vkid.buildAuthUrl({ clientId: 54893549, redirectUri: 'https://localhost/vk-callback', scope: 'wall groups', state: 'st', challenge }));
    assert.strictEqual(u.origin + u.pathname, 'https://id.vk.com/authorize');
    assert.strictEqual(u.searchParams.get('response_type'), 'code');
    assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://localhost/vk-callback');
    assert.strictEqual(u.searchParams.get('scope'), 'wall groups');
  });

  await test('VK ID: разбор ответа VK (код, ошибка, чужой state)', () => {
    const r = vkid.parseCallback('https://localhost/vk-callback?code=abc&state=st&device_id=dev1&type=code_v2', 'st');
    assert.deepStrictEqual(r, { code: 'abc', deviceId: 'dev1', state: 'st' });
    const p = vkid.parseCallback('https://localhost/vk-callback?payload=' + encodeURIComponent(JSON.stringify({ code: 'c2', state: 'st', device_id: 'd2' })), 'st');
    assert.strictEqual(p.code, 'c2');
    assert.throws(() => vkid.parseCallback('https://localhost/vk-callback?error=access_denied', 'st'), (e) => e.code === 'cancelled');
    assert.throws(() => vkid.parseCallback('https://localhost/vk-callback?code=a&state=evil', 'st'), (e) => e.code === 'state');
  });

  await test('VK ID: обмен кода и продление ключа', async () => {
    const sent = [];
    const fakeFetch = async (url, opts) => {
      const p = Object.fromEntries(new URLSearchParams(opts.body));
      sent.push({ url, p });
      if (p.grant_type === 'authorization_code') return { status: 200, json: async () => ({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600, user_id: 7 }) };
      if (p.grant_type === 'refresh_token' && p.refresh_token === 'R1') return { status: 200, json: async () => ({ access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }) };
      return { status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'bad' }) };
    };
    const s1 = await vkid.exchangeCode({ clientId: '54893549', redirectUri: 'https://localhost/vk-callback', code: 'abc', deviceId: 'dev1', verifier: 'v'.repeat(50), state: 'st' }, fakeFetch);
    assert.strictEqual(sent[0].url, 'https://id.vk.com/oauth2/auth');
    assert.deepStrictEqual(
      Object.keys(sent[0].p).sort(),
      ['client_id', 'code', 'code_verifier', 'device_id', 'grant_type', 'redirect_uri', 'state'],
      'в обмене нет лишних code_challenge — из-за них VK отвечает ошибкой',
    );
    assert.strictEqual(s1.access_token, 'A1');
    assert.strictEqual(s1.device_id, 'dev1');
    assert.ok(s1.expires_at > Date.now() + 3500e3);
    const s2 = await vkid.refresh(s1, fakeFetch);
    assert.strictEqual(s2.access_token, 'A2');
    assert.strictEqual(s2.refresh_token, 'R2', 'новый ключ продления сохраняется');
    assert.strictEqual(sent[1].p.device_id, 'dev1');
    await assert.rejects(vkid.refresh(s2, fakeFetch), (e) => e.code === 'auth');
  });

  await test('VK API: при устаревшем ключе — продление и повтор запроса', async () => {
    let token = 'old';
    let refreshes = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const p = Object.fromEntries(new URLSearchParams(String(opts.body)));
      if (p.access_token === 'old') return { ok: true, json: async () => ({ error: { error_code: 5, error_msg: 'expired' } }) };
      return { ok: true, json: async () => ({ response: [{ id: 1 }] }) };
    };
    try {
      const vk = new VkClient({ getToken: async () => token, refreshToken: async () => ((token = 'new'), ++refreshes, true), log: () => {}, minInterval: 0 });
      const r = await vk.call('users.get', { user_ids: 1 });
      assert.deepStrictEqual(r, [{ id: 1 }]);
      assert.strictEqual(refreshes, 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  for (const [status, name, err] of results) console.log(`${status === 'ok' ? '✔' : '✘'} ${name}${err ? '\n   ' + (err.stack || err) : ''}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  const failed = results.filter((r) => r[0] !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} тестов пройдено`);
  process.exit(failed ? 1 : 0);
})();
