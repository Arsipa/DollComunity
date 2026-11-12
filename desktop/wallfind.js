'use strict';
/**
 * Получение конкретных постов по { owner_id, post_id }.
 *
 * Обычный путь — wall.getById. Но с ключом VK ID ВКонтакте отвечает на него
 * «Method is not available for this profile type» (код 1051), а wall.get при этом работает.
 * Тогда пост ищется на стене владельца через wall.get: стена идёт от новых к старым,
 * номера постов при этом убывают, поэтому нужная страница находится двоичным поиском
 * по offset за ~log2(число постов / 100) запросов. Найденное место запоминается
 * (post.wall_offset) — в следующий раз хватает одного запроса.
 */

const PAGE = 100;
let byIdUnsupported = false; // запоминаем на время работы программы, чтобы не спрашивать VK каждый раз

function namesFrom(res, out) {
  if (!res || Array.isArray(res)) return out;
  for (const g of res.groups || []) out[-g.id] = g.name;
  for (const u of res.profiles || []) out[u.id] = `${u.first_name} ${u.last_name}`.trim();
  return out;
}

class PostFetcher {
  constructor(vk, log = () => {}) {
    this.vk = vk;
    this.log = log;
    this.walls = new Map(); // owner_id -> { count, pages: Map(offset -> items) }
    this.names = {};
  }

  static reset() {
    byIdUnsupported = false;
  }

  /**
   * @param refs [{ owner_id, post_id, hint }] — hint: известное ранее место поста на стене
   * @returns { found: Map('wall<owner>_<id>' -> { item, offset }), names: { owner_id: name } }
   */
  async fetch(refs) {
    const found = new Map();
    if (!refs.length) return { found, names: this.names };
    if (!byIdUnsupported) {
      try {
        const res = await this.vk.call('wall.getById', { posts: refs.map((r) => `${r.owner_id}_${r.post_id}`).join(','), extended: 1 });
        const items = Array.isArray(res) ? res : (res && res.items) || [];
        for (const item of items) found.set(`wall${item.owner_id}_${item.id}`, { item, offset: undefined });
        namesFrom(res, this.names);
        return { found, names: this.names };
      } catch (e) {
        if (e.code !== 'unsupported') throw e;
        byIdUnsupported = true;
        this.log('warn', 'wall.getById недоступен для этого ключа — ищу посты через wall.get');
      }
    }
    for (const ref of refs) {
      try {
        const r = await this.find(ref);
        if (r) found.set(`wall${ref.owner_id}_${ref.post_id}`, r);
      } catch (e) {
        // нет доступа к стене или стена не найдена — пост просто «не найден», остальные проверяем дальше
        if (e.code !== 'access' && e.code !== 'not_found') throw e;
      }
    }
    return { found, names: this.names };
  }

  wall(owner) {
    let w = this.walls.get(owner);
    if (!w) this.walls.set(owner, (w = { count: null, pages: new Map() }));
    return w;
  }

  async page(owner, offset) {
    const w = this.wall(owner);
    if (w.pages.has(offset)) return w.pages.get(offset);
    const res = await this.vk.call('wall.get', { owner_id: owner, offset, count: PAGE, filter: 'all', extended: 1 });
    w.count = Number(res && res.count) || 0;
    namesFrom(res, this.names);
    const items = (res && res.items) || [];
    w.pages.set(offset, items);
    return items;
  }

  lookIn(items, offset, postId) {
    const i = items.findIndex((x) => x.id === postId);
    return i < 0 ? null : { item: items[i], offset: offset + i };
  }

  async find({ owner_id: owner, post_id: postId, hint }) {
    const w = this.wall(owner);
    for (const [off, items] of w.pages) {
      const r = this.lookIn(items, off, postId);
      if (r) return r;
    }
    // 1) рядом с прошлым местом (новые посты сдвигают старые дальше по стене)
    if (Number.isFinite(hint) && hint >= 0) {
      const off = Math.max(0, hint - 10);
      const r = this.lookIn(await this.page(owner, off), off, postId);
      if (r) return r;
    }
    // 2) начало стены (свежие посты и закреплённый)
    const r0 = this.lookIn(await this.page(owner, 0), 0, postId);
    if (r0) return r0;
    // 3) двоичный поиск страницы по номеру поста
    let lo = 0;
    let hi = Math.max(0, (w.count || 0) - 1);
    let last = 0;
    for (let guard = 0; lo <= hi && guard < 40; guard++) {
      const mid = Math.floor((lo + hi) / 2);
      last = mid;
      const items = await this.page(owner, mid);
      const r = this.lookIn(items, mid, postId);
      if (r) return r;
      const ids = items.filter((x) => !x.is_pinned).map((x) => x.id);
      if (!ids.length) {
        hi = mid - 1;
        continue;
      }
      const max = Math.max(...ids);
      const min = Math.min(...ids);
      if (postId > max) hi = mid - 1; // пост новее — ближе к началу стены
      else if (postId < min) lo = mid + items.length; // старше — дальше
      else break; // должен быть на этой странице, но его нет
    }
    // 4) порядок на стене бывает не строгим (отложенные записи) — смотрим соседние страницы
    for (const near of [last - PAGE, last + PAGE]) {
      if (near < 0 || near >= (w.count || 0)) continue;
      const r = this.lookIn(await this.page(owner, near), near, postId);
      if (r) return r;
    }
    return null;
  }
}

module.exports = { PostFetcher };
