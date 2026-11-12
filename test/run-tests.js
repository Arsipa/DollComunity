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
const { parseSourceInput } = require('../desktop/vk');
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
  const method = url.replace('https://api.vk.com/method/', '');
  const p = Object.fromEntries(new URLSearchParams(String(opts.body)));
  fake.calls.push(method);
  const ok = (response) => ({ ok: true, json: async () => ({ response }) });
  if (fake.failOnce[method]) {
    delete fake.failOnce[method];
    return { ok: true, json: async () => ({ error: { error_code: 6, error_msg: 'Too many requests' } }) };
  }
  switch (method) {
    case 'users.get': {
      const ids = (p.user_ids || '').split(',').filter(Boolean).map(Number);
      return ok(ids.map((id) => fake.users[id] || { id, first_name: 'User', last_name: String(id) }));
    }
    case 'wall.get': {
      const off = Number(p.offset);
      const cnt = Number(p.count);
      return ok({ count: fake.wall.length, items: fake.wall.slice(off, off + cnt) });
    }
    case 'wall.getById': {
      const keys = p.posts.split(',');
      return ok({ items: fake.wall.filter((w) => keys.includes(`${w.owner_id}_${w.id}`)) });
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

function makeEngine(store) {
  return new SyncEngine({ store, getToken: async () => 'token', log: () => {}, makeThumb: async (src, dest) => fs.copyFileSync(src, dest) });
}

(async () => {
  await test('разбор ссылок на источники', () => {
    assert.deepStrictEqual(parseSourceInput('https://vk.com/club123'), { kind: 'group', id: 123 });
    assert.deepStrictEqual(parseSourceInput('vk.com/public55?w=wall-55_1'), { kind: 'group', id: 55 });
    assert.deepStrictEqual(parseSourceInput('https://m.vk.com/id7'), { kind: 'user', id: 7 });
    assert.deepStrictEqual(parseSourceInput('https://vk.com/dolls_world'), { kind: 'screen', name: 'dolls_world' });
    assert.deepStrictEqual(parseSourceInput('https://vk.com/wall-42_10'), { kind: 'group', id: 42 });
    assert.strictEqual(parseSourceInput('   '), null);
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

  await test('резервная копия и восстановление', async () => {
    const s = makeStore('backup');
    s.get('posts.json').posts.push({ id: 'keep-me' });
    s.writeNow('posts.json');
    const name = await s.createBackup({ reason: 't', kind: 'manual' });
    s.get('posts.json').posts.length = 0;
    s.writeNow('posts.json');
    await s.restoreBackup(name, 10);
    assert.strictEqual(s.get('posts.json').posts[0].id, 'keep-me');
    assert.ok(s.listBackupsSync().some((b) => b.kind === 'safety'), 'перед восстановлением создана страховочная копия');
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

  await test('синхронизация: импорт, лайки >1000 (постранично), фото, профили, повтор после ошибки', async () => {
    const s = makeStore('sync');
    s.get('settings.json').sources.push({ id: 'src1', owner_id: -100, type: 'group', name: 'Куклы', enabled: true });
    fake.wall = [vkItem(1, 'Платье', 3, 11), vkItem(2, 'Шляпка', 2500, 12), vkItem(3, 'Без фото', 0)];
    fake.likes = { 1: [10, 20, 30], 2: Array.from({ length: 2500 }, (_, i) => i + 1) };
    fake.failOnce['wall.get'] = true;
    const e = makeEngine(s);
    const done = new Promise((r) => e.once('done', r));
    await e.run();
    const rep = await done;
    assert.strictEqual(rep.fatal, null, JSON.stringify(rep.fatal));
    const posts = s.get('posts.json').posts;
    assert.strictEqual(posts.length, 3);
    assert.strictEqual(rep.created, 3);
    const p2 = posts.find((p) => p.post_id === 2);
    assert.strictEqual(Object.keys(p2.likers).length, 2500, 'все 2500 лайков, а не первые 100/1000');
    assert.ok(p2.original.photos[0].url.endsWith('_x.jpg'), 'выбрано фото максимального качества');
    assert.ok(fs.existsSync(s.photoPath(p2.original.photos[0].file)));
    const users = s.get('users.json').users;
    assert.strictEqual(users[10].likes, 2, 'пользователь 10 лайкнул 2 публикации');
    assert.strictEqual(Object.keys(users).length, 2500);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'posts.json'), 'utf8'));
    assert.strictEqual(saved.posts.length, 3, 'данные записаны на диск');
    assert.strictEqual(s.get('sync_history.json').runs.length, 1);
  });

  await test('повторная синхронизация: ручные правки и удалённые карточки сохраняются', async () => {
    const s = makeStore('sync');
    const posts = s.get('posts.json').posts;
    const p1 = posts.find((p) => p.post_id === 1);
    M.editPost(p1, { text: 'Моё платье' }, Date.now());
    // удаляем публикацию 3 локально
    const del = s.get('deleted_posts.json');
    const i = posts.findIndex((p) => p.post_id === 3);
    del.deleted.push({ id: posts[i].id, deleted_at: Date.now(), post: posts.splice(i, 1)[0] });
    s.flush();
    fake.wall = [vkItem(4, 'Новинка', 1, 14), vkItem(1, 'Платье (обновлено)', 4, 11), vkItem(2, 'Шляпка', 2500, 12), vkItem(3, 'Без фото', 0)];
    fake.likes[1] = [10, 20, 30, 40];
    fake.likes[4] = [40];
    const e = makeEngine(s);
    await e.run();
    const after = s.get('posts.json').posts;
    assert.strictEqual(after.length, 3, 'удалённая публикация не вернулась');
    assert.ok(!after.find((p) => p.post_id === 3));
    const q1 = after.find((p) => p.post_id === 1);
    assert.strictEqual(M.effective(q1, 'text'), 'Моё платье');
    assert.strictEqual(q1.original.text, 'Платье (обновлено)');
    assert.ok(q1.vk_changed.text);
    assert.strictEqual(Object.keys(q1.likers).length, 4);
    assert.ok(after.find((p) => p.post_id === 4).is_new);
    assert.ok(!q1.is_new);
    const run = s.get('sync_history.json').runs[0];
    assert.strictEqual(run.created, 1);
    assert.strictEqual(run.conflicts, 1);
  });

  await test('публикация исчезла из VK — остаётся в библиотеке', async () => {
    const s = makeStore('sync');
    s.get('settings.json').sync.max_posts = 1; // со стены берём только самую свежую
    fake.wall = [vkItem(4, 'Новинка', 1, 14)];
    const e = makeEngine(s);
    await e.run();
    const after = s.get('posts.json').posts;
    assert.strictEqual(after.length, 3);
    assert.ok(after.find((p) => p.post_id === 1).vk_missing > 0);
  });

  for (const [status, name, err] of results) console.log(`${status === 'ok' ? '✔' : '✘'} ${name}${err ? '\n   ' + (err.stack || err) : ''}`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  const failed = results.filter((r) => r[0] !== 'ok').length;
  console.log(`\n${results.length - failed}/${results.length} тестов пройдено`);
  process.exit(failed ? 1 : 0);
})();
