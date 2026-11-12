'use strict';
/**
 * Клиент VK API: очередь запросов с ограничением частоты, повторы при временных ошибках,
 * понятные сообщения об ошибках.
 */
const API_VERSION = '5.199';
const API_URL = 'https://api.vk.com/method/';

class VkError extends Error {
  constructor(code, message, vkCode) {
    super(message || code);
    this.code = code; // auth | network | access | not_found | rate | api
    this.vkCode = vkCode;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Перевод ошибок VK на понятный язык */
function classify(err) {
  const c = err.error_code;
  if ([5, 1116, 1117].includes(c)) return new VkError('auth', 'Подключение к ВКонтакте устарело. Подключите аккаунт заново в настройках.', c);
  if (c === 6 || c === 9 || c === 29) return new VkError('rate', 'ВКонтакте просит немного подождать.', c);
  if (c === 1 || c === 10) return new VkError('temporary', 'ВКонтакте временно не отвечает.', c);
  if ([7, 15, 18, 19, 30, 203, 210, 211, 212, 260].includes(c)) return new VkError('access', 'Нет доступа (закрытый профиль, сообщество или удалённая запись).', c);
  if (c === 113 || c === 100) return new VkError('not_found', 'Страница или запись не найдена.', c);
  // 1051 — метод недоступен для этого типа ключа (например, likes.getList с ключом VK ID)
  if (c === 1051) return new VkError('unsupported', 'ВКонтакте не разрешает этот запрос с текущим способом входа.', c);
  if (c === 14) return new VkError('captcha', 'ВКонтакте попросил ввести капчу. Попробуйте обновить данные позже.', c);
  if (c === 8 || c === 3) return new VkError('api', 'ВКонтакте отклонил запрос. Возможно, приложению нужно обновление.', c);
  return new VkError('api', err.error_msg || 'Ошибка ВКонтакте', c);
}

class VkClient {
  constructor({ getToken, refreshToken, log, minInterval = 360 }) {
    this.getToken = getToken;
    this.refreshToken = refreshToken; // продление ключа VK ID при ошибке авторизации
    this.log = log || (() => {});
    this.minInterval = minInterval; // ~3 запроса в секунду — лимит VK для пользовательского ключа
    this.last = 0;
    this.chain = Promise.resolve();
    this.aborted = false;
  }

  /** Все запросы выстраиваются в очередь, чтобы не превышать лимит частоты. */
  call(method, params = {}) {
    const run = () => this._callWithRetry(method, params);
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async _throttle() {
    const wait = this.last + this.minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
  }

  async _callWithRetry(method, params) {
    let attempt = 0;
    let refreshed = false;
    for (;;) {
      if (this.aborted) throw new VkError('aborted', 'Обновление остановлено');
      await this._throttle();
      try {
        return await this._raw(method, params);
      } catch (e) {
        if (e.code === 'auth' && !refreshed && this.refreshToken) {
          refreshed = true;
          try {
            if (await this.refreshToken()) continue; // ключ продлён — повторяем запрос
          } catch (_) {}
        }
        const retriable = e.code === 'rate' || e.code === 'temporary' || e.code === 'network';
        attempt++;
        if (!retriable || attempt > 5) throw e;
        const delay = Math.min(15000, (e.code === 'rate' ? 1100 : 1500) * 2 ** (attempt - 1));
        this.log('warn', `${method}: ${e.message} — повтор через ${delay} мс`);
        await sleep(delay);
      }
    }
  }

  async _raw(method, params) {
    const token = await this.getToken();
    if (!token) throw new VkError('auth', 'Аккаунт ВКонтакте не подключён.');
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) body.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    body.set('access_token', token);
    body.set('v', API_VERSION);
    let res;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      res = await fetch(API_URL + method, { method: 'POST', body, signal: ctrl.signal });
    } catch (e) {
      throw new VkError('network', 'Нет связи с ВКонтакте. Проверьте интернет.');
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new VkError(res.status >= 500 ? 'temporary' : 'network', `ВКонтакте ответил ошибкой ${res.status}`);
    let json;
    try {
      json = await res.json();
    } catch (_) {
      throw new VkError('temporary', 'Непонятный ответ ВКонтакте');
    }
    if (json.error) {
      const e = classify(json.error);
      e.method = method;
      if (e.code === 'api' || e.code === 'unsupported') e.message = `${e.message} (${method}, код ${json.error.error_code})`;
      throw e;
    }
    return json.response;
  }

  static async online() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      await fetch('https://api.vk.com/', { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(t);
      return true;
    } catch (_) {
      return false;
    }
  }
}

/**
 * Разбор ссылки на пост: https://vk.com/wall-123_456, vk.ru/club?w=wall-123_456,
 * https://vk.com/feed?w=wall123_456, wall-123_456, -123_456.
 * Возвращает { owner_id, post_id } или null.
 */
function parsePostInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let m = /wall(-?\d+)_(\d+)/i.exec(s) || /^(-?\d+)_(\d+)$/.exec(s);
  if (!m) return null;
  const owner = Number(m[1]);
  const post = Number(m[2]);
  if (!owner || !post) return null;
  return { owner_id: owner, post_id: post };
}

/** Фото максимального качества из вложения photo */
function bestPhoto(photo) {
  if (!photo) return null;
  let best = null;
  if (photo.orig_photo && photo.orig_photo.url) best = photo.orig_photo;
  for (const s of photo.sizes || []) {
    if (!best || (s.width || 0) * (s.height || 0) > (best.width || 0) * (best.height || 0)) best = s;
  }
  if (!best || !best.url) return null;
  return { key: `${photo.owner_id}_${photo.id}`, url: best.url, width: best.width || 0, height: best.height || 0 };
}

/** Все фото публикации (включая репост, если своих фото нет) */
function extractPhotos(item) {
  const out = [];
  const take = (atts) => {
    for (const a of atts || []) {
      if (a.type === 'photo') {
        const p = bestPhoto(a.photo);
        if (p) out.push(p);
      } else if (a.type === 'album' && a.album && a.album.thumb) {
        const p = bestPhoto(a.album.thumb);
        if (p) out.push(p);
      } else if (a.type === 'video' && a.video && Array.isArray(a.video.image) && a.video.image.length) {
        const img = a.video.image.reduce((x, y) => ((y.width || 0) > (x.width || 0) ? y : x));
        out.push({ key: `v${a.video.owner_id}_${a.video.id}`, url: img.url, width: img.width || 0, height: img.height || 0, video: true });
      } else if (a.type === 'link' && a.link && a.link.photo) {
        const p = bestPhoto(a.link.photo);
        if (p) out.push(p);
      }
    }
  };
  take(item.attachments);
  if (!out.length && Array.isArray(item.copy_history)) for (const c of item.copy_history) take(c.attachments);
  const seen = new Set();
  return out.filter((p) => (seen.has(p.key) ? false : seen.add(p.key)));
}

function postText(item) {
  let t = item.text || '';
  if (!t && Array.isArray(item.copy_history) && item.copy_history[0]) t = item.copy_history[0].text || '';
  return t;
}

module.exports = { VkClient, VkError, parsePostInput, extractPhotos, bestPhoto, postText, API_VERSION };
