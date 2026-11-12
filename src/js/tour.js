// Обучение (по образцу MyMusicLibrary): экран затемняется, нужное место подсвечивается, рядом — подсказка.
// Часть шагов просит нажать на подсвеченное, часть — просто прочитать и нажать «Дальше».
import { S } from './state.js';
import { icon, esc, toast } from './util.js';
import { go } from './app.js';
import { hidePopover } from './library.js';

let active = false;
let steps = [];
let idx = 0;
let els = null;
let raf = 0;
let target = null;
let waiting = false;

const q = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length) || null;
const viewActive = (id) => document.getElementById(`view-${id}`)?.classList.contains('active');
const closeLayers = () => document.querySelectorAll('.drawer-wrap, .overlay').forEach((e) => e.remove());

function buildSteps() {
  const hasPosts = S.posts.length > 0;
  return [
    {
      center: true,
      title: 'Добро пожаловать в Doll Community!',
      text: 'Здесь собираются ваши посты из ВКонтакте: фото нарядов, тексты и все, кто поставил «Мне нравится». За пару минут покажу, где что находится. Подсвеченные кнопки можно будет понажимать.',
      next: 'Поехали',
      enter: () => go('library'),
    },
    {
      target: () => document.getElementById('nav'),
      title: 'Разделы программы',
      text: '«Мои посты» — посты, которые вы добавили. «Статистика» — кто чаще всех ставит лайки. «Пользователи» — все, кто лайкал. «Корзина» — удалённые карточки. «Настройки» — подключение к ВКонтакте и папка с данными.',
    },
    {
      target: () => document.getElementById('lib-add'),
      title: 'Добавить пост',
      text: 'Откройте свой пост во ВКонтакте, скопируйте ссылку (в ней есть «wall», например https://vk.com/wall-123_456) и вставьте сюда. Можно сразу дать посту название — его видно только вам.',
      hint: 'Сейчас нажимать не нужно — жмите «Дальше».',
    },
    {
      target: () => document.getElementById('lib-sync'),
      title: 'Обновить данные',
      text: 'Программа проверит во ВКонтакте только ваши добавленные посты: обновит текст, лайки и скачает фотографии на компьютер. Можно продолжать пользоваться программой, пока идёт обновление.',
      hint: 'Сейчас нажимать не нужно — жмите «Дальше».',
    },
    hasPosts && {
      target: () => q('.toolbar'),
      title: 'Поиск и порядок',
      text: 'Ищите по названию и тексту поста или по имени того, кто поставил лайк (переключатель «в тексте / по лайкнувшим»). Рядом — порядок: новые, старые, самые залайканные.',
    },
    hasPosts && {
      target: () => q('#lib-grid .card'),
      title: 'Карточка поста',
      text: 'Название, фото, дата и текст. Нажмите на фото или «Читать полностью» — откроется карточка целиком: все фотографии и полный текст.',
      pad: 6,
    },
    hasPosts && {
      target: () => q('#lib-grid .card .likes-pill'),
      title: 'Кто поставил лайк',
      text: 'Наведите мышку на сердечко — появятся имена тех, кому понравилась публикация. А если нажать — откроется полный список.',
      click: true,
      hint: 'Нажмите на подсвеченное сердечко.',
      done: () => !!q('.drawer'),
    },
    hasPosts && {
      target: () => q('.drawer'),
      title: 'Список понравившихся',
      text: 'Здесь можно найти человека по имени и поменять порядок. Нажмите на человека — откроется его карточка со всеми публикациями, которые ему понравились. Значок со стрелкой открывает профиль ВКонтакте в браузере.',
      pad: 0,
    },
    hasPosts && {
      target: () => q('.drawer [data-close]'),
      title: 'Закрываем панель',
      text: 'Любая панель и окно закрываются крестиком в углу.',
      click: true,
      hint: 'Нажмите на крестик.',
      pad: 4,
      done: () => !q('.drawer'),
    },
    hasPosts && {
      target: () => q('#lib-grid .card [data-orig]'),
      title: 'Открыть оригинал',
      text: 'Открывает эту публикацию во ВКонтакте в вашем браузере.',
      pad: 4,
    },
    hasPosts && {
      target: () => q('#lib-grid .card [data-edit]'),
      title: 'Редактировать',
      text: 'Название, текст, дату и фото можно менять только у себя — во ВКонтакте ничего не изменится. Ваши правки главнее: обновление данных их никогда не затрёт.',
      pad: 4,
    },
    hasPosts && {
      target: () => q('#lib-grid .card [data-del]'),
      title: 'Удалить',
      text: 'Карточка уходит в «Корзину» и больше не появится при обновлении. Передумали — верните её из корзины.',
      pad: 4,
    },
    {
      target: () => q('#nav [data-view=stats]'),
      title: 'Статистика',
      text: hasPosts ? 'Посмотрим, кто самые активные участницы.' : 'Здесь появится рейтинг: кто чаще всех ставит лайки публикациям из вашей библиотеки — за всё время, неделю, месяц или год.',
      click: true,
      hint: 'Нажмите на «Статистика».',
      done: () => viewActive('stats'),
    },
    hasPosts && {
      target: () => q('#s-period'),
      title: 'Период',
      text: 'Выберите, за какое время считать: всё время, неделя, месяц или год. Справа — как считать период.',
      pad: 6,
    },
    hasPosts && {
      target: () => q('#s-rows tr'),
      title: 'Рейтинг участников',
      text: 'Ниже — самые активные: кто поставил больше всего лайков публикациям из вашей библиотеки. Нажмите на строку, чтобы увидеть, что именно понравилось человеку, или на стрелку — чтобы открыть профиль ВКонтакте.',
      pad: 4,
    },
    {
      target: () => q('#nav [data-view=settings]'),
      title: 'Настройки',
      text: 'Последний раздел.',
      click: true,
      hint: 'Нажмите на «Настройки».',
      done: () => viewActive('settings'),
    },
    {
      target: () => q('#p-vk'),
      title: 'Подключение ВКонтакте',
      text: 'Чтобы программа могла загружать публикации, подключите аккаунт. Вход идёт на официальной странице ВКонтакте — пароль программа не видит и не хранит.',
      pad: 6,
    },
    {
      target: () => q('#restart-tour'),
      title: 'Обучение всегда под рукой',
      text: 'Если что-то забудется — пройдите обучение снова здесь.',
      pad: 4,
    },
    {
      center: true,
      title: 'Готово!',
      text: S.account.connected
        ? S.posts.length
          ? 'Всё настроено. Добавляйте новые посты кнопкой «Добавить пост», а «Обновить данные» освежит лайки уже добавленных. Всё сохраняется само — перед закрытием ничего нажимать не нужно.'
          : 'Осталось добавить свой пост: в «Моих постах» нажмите «Добавить пост» и вставьте ссылку на него. Всё сохраняется само.'
        : 'С чего начать: 1) подключите ВКонтакте здесь, в настройках; 2) в «Моих постах» нажмите «Добавить пост» и вставьте ссылку; 3) «Обновить данные» освежит лайки. Всё сохраняется само — перед закрытием ничего нажимать не нужно.',
      next: 'Начать',
    },
  ].filter(Boolean);
}

function build() {
  const root = document.createElement('div');
  root.className = 'tour';
  const blockers = ['t', 'r', 'b', 'l', 'c'].map(() => {
    const d = document.createElement('div');
    d.className = 'tour-block';
    d.addEventListener('click', nudge);
    return d;
  });
  const hole = document.createElement('div');
  hole.className = 'tour-hole';
  const bubble = document.createElement('div');
  bubble.className = 'tour-bubble';
  bubble.setAttribute('role', 'dialog');
  root.append(...blockers, hole, bubble);
  document.body.append(root);
  return { root, blockers, hole, bubble };
}

function nudge() {
  els.bubble.classList.remove('nudge');
  void els.bubble.offsetWidth;
  els.bubble.classList.add('nudge');
}

export function startTour() {
  if (active) return;
  closeLayers();
  hidePopover();
  active = true;
  steps = buildSteps();
  idx = 0;
  els = build();
  document.body.classList.add('touring');
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onClick, true);
  show();
  loop();
}
export const tourActive = () => active;

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape' || ((e.key === 'Enter' || e.code === 'Space') && !els.bubble.contains(e.target))) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onClick(e) {
  if (!active || waiting) return;
  const s = steps[idx];
  if (!s || !s.click || !target) return;
  if (target.contains(e.target)) {
    // клик проходит к настоящей кнопке, а обучение ждёт результата
    waiting = true;
    els.bubble.classList.add('hidden');
    waitFor(s.done || (() => true), 3000).then(() => {
      waiting = false;
      next(idx + 1);
    });
  }
}

function waitFor(cond, timeout) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => (cond() || Date.now() - t0 > timeout ? setTimeout(resolve, 300) : setTimeout(tick, 80));
    tick();
  });
}

function next(i) {
  idx = i;
  if (idx >= steps.length) return finish();
  show();
}

async function show() {
  const s = steps[idx];
  target = null;
  hidePopover();
  if (s.enter) s.enter();
  if (!s.center) {
    // ждём, пока нужный элемент появится на экране (панель открывается с анимацией)
    let el = s.target();
    const t0 = Date.now();
    while ((!el || !el.getClientRects().length) && Date.now() - t0 < 2500) {
      await new Promise((r) => setTimeout(r, 80));
      el = s.target();
    }
    if (!el || !el.getClientRects().length) return next(idx + 1); // такого элемента сейчас нет — пропускаем шаг
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    target = el;
  }
  renderBubble(s);
  position();
}

function renderBubble(s) {
  const b = els.bubble;
  const total = steps.length;
  const canBack = idx > 0 && !s.center && !s.click && !steps[idx - 1].click && !steps[idx - 1].center;
  b.className = `tour-bubble${s.center ? ' center' : ''}`;
  b.innerHTML = `
    <div class="tour-top"><span class="tour-step">${idx + 1} / ${total}</span><div class="tour-dots">${steps.map((_, i) => `<i class="${i === idx ? 'on' : i < idx ? 'done' : ''}"></i>`).join('')}</div></div>
    <h3 class="tour-title">${esc(s.title)}</h3>
    <p class="tour-text">${esc(s.text)}</p>
    ${s.hint ? `<p class="tour-hint ${s.click ? 'click' : ''}">${icon(s.click ? 'sparkle' : 'info')}<span>${esc(s.hint)}</span></p>` : ''}
    <div class="tour-btns">
      ${idx < total - 1 ? '<button class="tour-skip" data-skip>Пропустить обучение</button>' : ''}
      <span style="flex:1"></span>
      ${canBack ? '<button class="btn ghost sm" data-back>Назад</button>' : ''}
      ${s.click ? '' : `<button class="btn primary sm" data-next>${esc(s.next || 'Дальше')} ${icon('chevR')}</button>`}
    </div>`;
  b.querySelector('[data-skip]')?.addEventListener('click', () => finish(true));
  b.querySelector('[data-back]')?.addEventListener('click', () => next(idx - 1));
  const nb = b.querySelector('[data-next]');
  if (nb) {
    nb.addEventListener('click', () => next(idx + 1));
    setTimeout(() => nb.focus(), 50);
  }
  els.root.classList.toggle('mode-click', !!s.click);
  els.root.classList.toggle('mode-center', !!s.center);
}

function setRect(el, x, y, w, h) {
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, h)}px` });
}

function position() {
  if (!active) return;
  const s = steps[idx];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const b = els.bubble;
  const [bt, br, bb, bl, bc] = els.blockers;
  if (s.center || !target || !target.isConnected) {
    Object.assign(els.hole.style, { left: `${W / 2}px`, top: `${H / 2}px`, width: '0px', height: '0px' });
    setRect(bt, 0, 0, W, H);
    [br, bb, bl, bc].forEach((x) => setRect(x, 0, 0, 0, 0));
    b.style.left = `${Math.max(16, (W - b.offsetWidth) / 2)}px`;
    b.style.top = `${Math.max(16, (H - b.offsetHeight) / 2)}px`;
    return;
  }
  const pad = s.pad ?? 8;
  const r = target.getBoundingClientRect();
  const x = Math.max(4, r.left - pad);
  const y = Math.max(4, r.top - pad);
  const w = Math.min(W - 4, r.right + pad) - x;
  const h = Math.min(H - 4, r.bottom + pad) - y;
  Object.assign(els.hole.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  // всё вокруг подсветки не нажимается; сама подсветка — только в шагах «нажмите»
  setRect(bt, 0, 0, W, y);
  setRect(bb, 0, y + h, W, H - y - h);
  setRect(bl, 0, y, x, h);
  setRect(br, x + w, y, W - x - w, h);
  setRect(bc, x, y, s.click ? 0 : w, s.click ? 0 : h);
  // подсказка — снизу, сверху, справа или слева, где помещается
  const bw = b.offsetWidth;
  const bh = b.offsetHeight;
  const gap = 16;
  let left;
  let top;
  if (y + h + gap + bh < H - 8) [top, left] = [y + h + gap, x + w / 2 - bw / 2];
  else if (y - gap - bh > 8) [top, left] = [y - gap - bh, x + w / 2 - bw / 2];
  else if (x + w + gap + bw < W - 8) [left, top] = [x + w + gap, y + h / 2 - bh / 2];
  else [left, top] = [x - gap - bw, y + h / 2 - bh / 2];
  b.style.left = `${Math.round(Math.min(Math.max(12, left), W - bw - 12))}px`;
  b.style.top = `${Math.round(Math.min(Math.max(12, top), H - bh - 12))}px`;
}

function loop() {
  if (!active) return;
  position();
  raf = requestAnimationFrame(loop);
}

function finish(skipped) {
  if (!active) return;
  active = false;
  cancelAnimationFrame(raf);
  window.removeEventListener('keydown', onKey, true);
  document.removeEventListener('click', onClick, true);
  const root = els.root;
  root.classList.add('leaving');
  setTimeout(() => root.remove(), 250);
  document.body.classList.remove('touring');
  closeLayers();
  if (!S.settings.onboarding_done) {
    window.api
      .updateSettings({ onboarding_done: true })
      .then((s) => (S.settings = s))
      .catch(() => {});
  }
  if (skipped) toast('Обучение можно пройти снова: «Настройки» → «Пройти обучение»', { timeout: 6000 });
  else go(S.account.connected ? 'library' : 'settings');
}
