'use strict';
/**
 * Демо-библиотека для проверки интерфейса без ВКонтакте.
 *   node test/make-demo.js <папка> [кол-во публикаций]
 * Затем: set VKD_TEST_ROOT=<папка> && npx electron .
 */
const fs = require('fs');
const path = require('path');
const { Store } = require('../desktop/storage');
const M = require('../desktop/model');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '.demo'));
const N = Number(process.argv[3] || 120);
fs.rmSync(path.join(root, 'library'), { recursive: true, force: true });
const store = new Store(path.join(root, 'library'), () => {});
store.loadAll();

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const PALETTES = [['#f8d7e1', '#e48aa6'], ['#e9e2fb', '#9c86dc'], ['#dceefa', '#7fb0dd'], ['#fdeccf', '#e6b264'], ['#dff3e8', '#79bf98'], ['#fbe1d6', '#e39a7b']];
function svgPhoto(i) {
  const [a, b] = PALETTES[i % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900" viewBox="0 0 800 900">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="800" height="900" fill="url(#g)"/>
  <circle cx="${150 + (i * 97) % 500}" cy="${120 + (i * 53) % 200}" r="${60 + (i % 5) * 18}" fill="#fff" opacity=".25"/>
  <g transform="translate(400 470) scale(${1.6 + (i % 3) * 0.25})" fill="#fff" opacity=".92">
    <circle cx="0" cy="-150" r="34"/>
    <path d="M-30 -110 L30 -110 L40 -40 L120 150 L-120 150 L-40 -40 Z"/>
    <path d="M-40 -40 L40 -40" stroke="${b}" stroke-width="10"/>
  </g>
</svg>`;
}

const FIRST = ['Анна', 'Мария', 'Елена', 'Ольга', 'Наталья', 'Ирина', 'Светлана', 'Татьяна', 'Юлия', 'Екатерина', 'Дарья', 'Ксения', 'Алёна', 'Вероника', 'Полина', 'Виктория', 'Марина', 'Людмила', 'Галина', 'Софья'];
const LAST = ['Иванова', 'Петрова', 'Смирнова', 'Кузнецова', 'Попова', 'Соколова', 'Лебедева', 'Козлова', 'Новикова', 'Морозова', 'Волкова', 'Алексеева', 'Павлова', 'Семёнова', 'Голубева', 'Виноградова'];
const CITIES = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Самара', 'Тула', ''];
const TEXTS = [
  'Новое платье для Барби 💗 Шила весь вечер, ткань — хлопок с мелким цветочком. Выкройку выложу позже!',
  'Наконец-то закончила зимний комплект для Паола Рейна: пальто, шапочка и шарфик. Как вам?',
  'Делюсь мастер-классом: как сшить простую юбку-солнце для куклы за 30 минут.\n\n1. Вырезаем круг\n2. Обрабатываем край\n3. Пришиваем пояс на резинке',
  'Мои девочки собрались на чаепитие ☕ Мебель делали вместе с дочкой из картона и остатков ткани.',
  'Вязаный кардиган для Blythe. Пряжа — мохер, спицы 1.5 мм. Глаза устали, но результат радует!',
  'Розыгрыш! Среди тех, кто поставит лайк до воскресенья, разыграем комплект одежды ручной работы 🎀',
  'Перешила старое платье в наряд для куклы — вторая жизнь вещей.',
  'Кукольная обувь из фоамирана: туфельки, сапожки и балетки. Пошаговые фото в карусели.',
  'Сегодня у нас осенняя фотосессия в парке 🍂',
  'Подскажите, где купить мелкую фурнитуру — пуговицы 4 мм и кнопки?',
  '',
];

// участники
const users = store.get('users.json').users;
const uids = [];
for (let i = 0; i < 420; i++) {
  const id = 100000 + i * 37;
  uids.push(id);
  users[id] = { id, type: 'user', first_name: pick(FIRST), last_name: pick(LAST), city: pick(CITIES), photo_100: '', url: `https://vk.com/id${id}`, is_closed: rnd() < 0.2, updated_at: Date.now(), first_seen: Date.now() - Math.floor(rnd() * 60) * 86400e3 };
}

// источники
const settings = store.get('settings.json');
settings.sources = [
  { id: 'sA', owner_id: -1001, type: 'group', name: 'Кукольная мастерская', screen_name: 'club1001', url: 'https://vk.com/club1001', added_at: Date.now(), enabled: true, last_synced: Date.now() - 3600e3 },
  { id: 'sB', owner_id: -1002, type: 'group', name: 'Одежда для Барби своими руками', screen_name: 'club1002', url: 'https://vk.com/club1002', added_at: Date.now(), enabled: true, last_synced: Date.now() - 3600e3 },
  { id: 'sC', owner_id: 5005, type: 'user', name: 'Светлана Шьёт', screen_name: 'id5005', url: 'https://vk.com/id5005', added_at: Date.now(), enabled: true, last_synced: Date.now() - 3600e3 },
];
settings.vk.account = { id: 1, name: 'Демо-аккаунт', photo: '', kind: 'user' };
settings.onboarding_done = process.env.DEMO_ONBOARD ? false : true;

// публикации
const posts = store.get('posts.json').posts;
const now = Date.now();
const weights = uids.map((_, i) => 1 / (1 + i * 0.05)); // одни активнее других
for (let i = 0; i < N; i++) {
  const src = settings.sources[i % 3];
  const nPhotos = rnd() < 0.12 ? 0 : 1 + Math.floor(rnd() * 3);
  const photos = [];
  for (let k = 0; k < nPhotos; k++) {
    const key = `${src.owner_id}_${9000 + i * 10 + k}`;
    const file = `demo_${i}_${k}.svg`;
    fs.writeFileSync(store.photoPath(file), svgPhoto(i * 3 + k));
    photos.push({ key, url: '', width: 800, height: 900, file, thumb: null });
  }
  const p = M.newPost({ ownerId: src.owner_id, id: 500 + i, sourceId: src.id, text: TEXTS[i % TEXTS.length], date: Math.floor(now / 1000) - i * 86400 * 0.7 - Math.floor(rnd() * 40000), photos, likes: 0, now: now - (N - i) * 1000 });
  p.is_new = i < 5;
  const likers = [];
  uids.forEach((u, j) => {
    if (rnd() < weights[j] * 0.25) likers.push(u);
  });
  M.applyLikers(p, likers, now - Math.floor(rnd() * 30) * 86400e3);
  p.likes_count = likers.length + (rnd() < 0.2 ? 2 : 0);
  p.views = p.likes_count * 12;
  posts.push(p);
}
// локальные правки и конфликт
M.editPost(posts[1], { text: 'Моё новое платье для Барби — сшито к дню рождения дочки 💗' }, now);
M.editPost(posts[3], { text: 'Чаепитие у кукол (моя подпись)' }, now);
M.applyVk(posts[3], { text: 'Мои девочки собрались на чаепитие ☕ Обновлено: добавили фото торта!' }, now);
posts[7].vk_missing = now - 86400e3;
M.recountUsers(posts, users);

const hist = store.get('sync_history.json');
for (let k = 6; k >= 0; k--) hist.snapshots.push({ at: now - k * 3 * 86400e3, posts: N - k * 5, likes: 0, collected_likes: 3000 - k * 280, unique_users: 380 - k * 14, top: [] });
hist.runs.unshift({ started: now - 3700e3, finished: now - 3600e3, checked: N, created: 12, updated: 30, conflicts: 2, errors: [] });
hist.last_sync = now - 3600e3;

store.flush();
for (const n of ['posts.json', 'users.json', 'settings.json', 'sync_history.json']) store.writeNow(n);
console.log(`Демо-библиотека: ${root} (${N} публикаций, ${uids.length} участников)`);
