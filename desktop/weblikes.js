'use strict';
/**
 * Списки лайков со страницы ВКонтакте «Оценили» (m.vk.ru/like?act=members&object=wall…).
 *
 * Зачем: у приложений, созданных через VK ID, ВКонтакте закрывает likes.getList для всех ключей
 * (и пользовательского, и сервисного) — ответ «Method is not available for this profile type», код 1051.
 * Страница «Оценили» открыта без входа для постов, которые видны всем.
 *
 * Как: страница отдаёт по 50 человек; запрос POST с _ajax=1 возвращает JSON, в поле html — список.
 * У каждого человека есть ссылка на профиль: /id123 или короткое имя (/durov). Короткие имена
 * переводим в числовые id через users.get (этот метод ключ VK ID разрешает).
 */
const { VkError } = require('./vk');

const PAGE_URL = 'https://m.vk.ru/like';
const PAGE_SIZE = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Разбор одной страницы: [{ id }] или [{ name }] в порядке списка. */
function parseLikersPage(html) {
  const out = [];
  const re = /<a\s+class="([^"]*\blike_user_item\b[^"]*)"\s+href="\/([^"?#]*)/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const byClass = /\bal_unew(\d+)\b/.exec(m[1]); // у вошедших на vk.com в классе бывает числовой id
    const href = m[2];
    const byHref = /^id(\d+)$/.exec(href);
    if (byClass) out.push({ id: Number(byClass[1]) });
    else if (byHref) out.push({ id: Number(byHref[1]) });
    else if (/^[A-Za-z0-9_.]+$/.test(href) && !/^(club|public|event)\d+$/.test(href)) out.push({ name: href });
    // сообщества (club123/public123) в списке лайков людей не нужны
  }
  return out;
}

class WebLikes {
  constructor({ fetch: fetchImpl, log, minInterval = 700, maxPages = 400 } = {}) {
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.log = log || (() => {});
    this.minInterval = minInterval; // бережно: не чаще ~1,5 страницы в секунду
    this.maxPages = maxPages; // 400 × 50 = 20 000 лайков — защита от бесконечного листания
    this.last = 0;
    this.aborted = false;
  }

  async _throttle() {
    const wait = this.last + this.minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  async _page(owner_id, post_id, offset) {
    const url = `${PAGE_URL}?act=members&object=wall${owner_id}_${post_id}&offset=${offset}`;
    for (let attempt = 1; ; attempt++) {
      if (this.aborted) throw new VkError('aborted', 'Обновление остановлено');
      await this._throttle();
      let err;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30000);
        let res;
        try {
          res = await this.fetch(url, {
            method: 'POST',
            body: '_ajax=1',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'include', // куки входа на vk.com (если вошли в программе)
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(t);
        }
        if (!res.ok) throw new VkError(res.status >= 500 || res.status === 429 ? 'temporary' : 'web', `Страница лайков ВКонтакте ответила ошибкой ${res.status}`);
        let json;
        try {
          json = await res.json();
        } catch (_) {
          throw new VkError('web', 'ВКонтакте вернул непонятную страницу лайков');
        }
        // вместо списка VK отправляет на профиль/сообщество ({"location":"id123"}) — лайки этой страницы скрыты от посторонних
        if (json && typeof json.location === 'string' && typeof json.html !== 'string') {
          throw new VkError(
            'access',
            'ВКонтакте скрывает, кто лайкнул посты этой страницы. Войдите на vk.com: «Настройки» → «Списки лайков». Если вы уже вошли — у вашего аккаунта нет доступа к этой странице.',
          );
        }
        if (!json || typeof json.html !== 'string') throw new VkError('web', 'ВКонтакте вернул непонятную страницу лайков');
        // raw — сколько строк на странице всего (вместе с сообществами): по нему понимаем, что страница последняя
        const guest = /UnauthorizedHeader|basis__header_unauthorized/.test(json.html);
        return { items: parseLikersPage(json.html), guest, raw: (json.html.match(/class="[^"]*like_user_item/g) || []).length };
      } catch (e) {
        err = e instanceof VkError ? e : new VkError('network', 'Нет связи с ВКонтакте. Проверьте интернет.');
      }
      if (!['temporary', 'network'].includes(err.code) || attempt >= 3) throw err;
      this.log('warn', `Страница лайков wall${owner_id}_${post_id}: ${err.message} — повтор`);
      await sleep(1500 * attempt);
    }
  }

  /**
   * Все, кто лайкнул пост: [{ id } | { name }] без повторов. expected — число лайков из VK (если известно).
   * out.partial = true, если VK показал не весь список: без входа на vk.com видны только первые ~350 человек,
   * дальше страница повторяется.
   */
  async list(owner_id, post_id, expected) {
    const seen = new Set();
    const out = [];
    out.partial = false;
    out.guest = false;
    for (let page = 0, offset = 0; page < this.maxPages; page++, offset += PAGE_SIZE) {
      const { items, raw, guest } = await this._page(owner_id, post_id, offset);
      if (guest) out.guest = true;
      let added = 0;
      for (const it of items) {
        const key = it.id ? `i${it.id}` : `n${it.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
        added++;
      }
      if (!raw && offset === 0 && expected > 0) {
        throw new VkError('access', 'ВКонтакте не показывает, кто лайкнул этот пост: пост или страница закрыты. Если у вас есть к ним доступ, войдите на vk.com: «Настройки» → «Списки лайков».');
      }
      if (raw < PAGE_SIZE) break; // последняя страница
      if (!added && items.length) {
        out.partial = true; // VK начал повторять одну и ту же страницу — дальше не пускает
        break;
      }
      if (page === this.maxPages - 1) out.partial = true;
    }
    return out;
  }
}

/**
 * Короткие имена → числовые id через users.get. Неизвестные имена (удалённые страницы, сообщества) пропускаются.
 * Если VK отклоняет всю пачку из-за одного имени, делим её пополам.
 */
async function resolveNames(vk, names) {
  const map = new Map();
  const run = async (part) => {
    if (!part.length) return;
    try {
      const res = await vk.call('users.get', { user_ids: part.join(','), fields: 'screen_name' });
      for (const u of res || []) {
        if (u.screen_name) map.set(String(u.screen_name).toLowerCase(), u.id);
      }
    } catch (e) {
      if (e.code !== 'not_found' && e.code !== 'api') throw e;
      if (part.length === 1) return; // одно неизвестное имя — пропускаем
      const mid = Math.ceil(part.length / 2);
      await run(part.slice(0, mid));
      await run(part.slice(mid));
    }
  };
  for (let i = 0; i < names.length; i += 200) await run(names.slice(i, i + 200));
  return map;
}

/** Список с веб-страницы → числовые id пользователей. */
async function likersToIds(vk, items) {
  const names = [...new Set(items.filter((x) => x.name).map((x) => x.name.toLowerCase()))];
  const map = names.length ? await resolveNames(vk, names) : new Map();
  const ids = [];
  const seen = new Set();
  for (const it of items) {
    const id = it.id || map.get(String(it.name).toLowerCase());
    if (id > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

module.exports = { WebLikes, parseLikersPage, likersToIds, resolveNames };
