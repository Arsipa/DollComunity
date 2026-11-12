'use strict';
/**
 * Вход через VK ID (OAuth 2.1 + PKCE) — единственная схема, которую принимают новые приложения VK.
 *  1. Окно с id.vk.com/authorize → пользователь входит на официальной странице VK.
 *  2. VK перенаправляет на доверенный адрес (https://localhost/...) с ?code&state&device_id —
 *     программа перехватывает этот адрес внутри окна, никакой сервер не нужен.
 *  3. Код меняется на ключ (access_token живёт ~1 час) и ключ продления (refresh_token).
 *  4. Перед запросами к API ключ при необходимости продлевается незаметно для пользователя.
 */
const crypto = require('crypto');

const AUTHORIZE_URL = 'https://id.vk.com/authorize';
const TOKEN_URL = 'https://id.vk.com/oauth2/auth';
const LOGOUT_URL = 'https://id.vk.com/oauth2/logout';
const DEFAULT_REDIRECT = 'https://localhost/vk-callback';
const DEFAULT_SCOPE = 'wall groups';

class VkIdError extends Error {
  constructor(message, code = 'vkid', details = '') {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce() {
  const verifier = b64url(crypto.randomBytes(48)); // 64 символа из [A-Za-z0-9-_]
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthUrl({ clientId, redirectUri, scope, state, challenge }) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: String(clientId),
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    lang_id: '0',
    scheme: 'light',
  });
  if (scope) p.set('scope', scope);
  return `${AUTHORIZE_URL}?${p}`;
}

/** Понятные сообщения для ошибок VK ID */
function humanError(code, desc) {
  const d = String(desc || '');
  if (code === 'access_denied') return new VkIdError('Вход отменён.', 'cancelled', d);
  if (code === 'invalid_scope' || /scope/i.test(d)) return new VkIdError('ВКонтакте не разрешил запрошенные права. Программа попробует войти без них.', 'invalid_scope', d);
  if (/redirect/i.test(d) || code === 'invalid_redirect_uri')
    return new VkIdError('Адрес перенаправления не совпадает с указанным в настройках приложения VK. Проверьте поле «Доверенный Redirect URL» — он должен в точности совпадать с адресом в программе.', 'redirect', d);
  if (code === 'invalid_client' || /client/i.test(d)) return new VkIdError('ВКонтакте не узнал приложение. Проверьте ID приложения.', 'client', d);
  if (code === 'invalid_grant') return new VkIdError('Ключ входа устарел. Подключите ВКонтакте заново.', 'auth', d);
  return new VkIdError(`ВКонтакте отклонил вход${d ? `: ${d}` : ''}.`, code || 'vkid', d);
}

async function postForm(url, params, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(), signal: ctrl.signal });
  } catch (_) {
    throw new VkIdError('Нет связи с ВКонтакте. Проверьте интернет.', 'network');
  } finally {
    clearTimeout(t);
  }
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  if (!json) throw new VkIdError(`ВКонтакте ответил ошибкой ${res.status}`, res.status >= 500 ? 'temporary' : 'vkid');
  if (json.error) throw humanError(json.error, json.error_description);
  return json;
}

/** Разбор адреса, на который VK вернул пользователя */
function parseCallback(url, expectedState) {
  const u = new URL(url);
  const q = u.searchParams;
  // на всякий случай поддерживаем и параметры после #
  const h = new URLSearchParams(u.hash.replace(/^#/, ''));
  const get = (k) => q.get(k) || h.get(k);
  if (get('error')) throw humanError(get('error'), get('error_description'));
  // VK ID может вернуть всё одним параметром payload (JSON)
  let payload = null;
  if (get('payload')) {
    try {
      payload = JSON.parse(get('payload'));
    } catch (_) {}
  }
  const code = get('code') || payload?.code;
  const state = get('state') || payload?.state;
  const deviceId = get('device_id') || payload?.device_id;
  if (!code) throw new VkIdError('ВКонтакте не вернул код входа.', 'vkid', url.slice(0, 300));
  if (expectedState && state && state !== expectedState) throw new VkIdError('Ошибка безопасности входа (state). Попробуйте ещё раз.', 'state');
  return { code, deviceId, state };
}

function sessionFromTokens(json, base) {
  return {
    kind: 'vkid',
    client_id: String(base.clientId),
    redirect_uri: base.redirectUri,
    device_id: base.deviceId,
    access_token: json.access_token,
    refresh_token: json.refresh_token || base.refreshToken || '',
    expires_at: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    user_id: json.user_id || base.userId || 0,
    scope: json.scope || base.scope || '',
  };
}

async function exchangeCode({ clientId, redirectUri, code, deviceId, verifier, state }, fetchImpl) {
  const json = await postForm(
    TOKEN_URL,
    { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: String(clientId), device_id: deviceId || '', redirect_uri: redirectUri, state },
    fetchImpl,
  );
  if (!json.access_token) throw new VkIdError('ВКонтакте не выдал ключ доступа.', 'vkid', JSON.stringify(json).slice(0, 300));
  return sessionFromTokens(json, { clientId, redirectUri, deviceId });
}

async function refresh(session, fetchImpl) {
  if (!session.refresh_token) throw new VkIdError('Подключение к ВКонтакте устарело. Подключите аккаунт заново в настройках.', 'auth');
  const state = b64url(crypto.randomBytes(16));
  try {
    const json = await postForm(
      TOKEN_URL,
      { grant_type: 'refresh_token', refresh_token: session.refresh_token, client_id: session.client_id, device_id: session.device_id || '', state },
      fetchImpl,
    );
    return sessionFromTokens(json, { clientId: session.client_id, redirectUri: session.redirect_uri, deviceId: session.device_id, refreshToken: session.refresh_token, userId: session.user_id, scope: session.scope });
  } catch (e) {
    if (e.code === 'network' || e.code === 'temporary') throw e;
    throw new VkIdError('Подключение к ВКонтакте устарело. Подключите аккаунт заново в настройках.', 'auth', e.details || e.message);
  }
}

async function logout(session, fetchImpl = fetch) {
  try {
    await postForm(LOGOUT_URL, { client_id: session.client_id, access_token: session.access_token }, fetchImpl);
  } catch (_) {}
}

module.exports = { pkce, buildAuthUrl, parseCallback, exchangeCode, refresh, logout, VkIdError, DEFAULT_REDIRECT, DEFAULT_SCOPE, b64url };
