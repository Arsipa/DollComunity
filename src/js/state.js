// Состояние интерфейса. Источник правды — главный процесс; здесь копия для показа и быстрых фильтров.

export const S = {
  settings: null,
  posts: [],
  users: {},
  deleted: [],
  history: { runs: [], snapshots: [], last_sync: 0 },
  account: { connected: false, info: null },
  paths: {},
  problems: [],
  blocked: [],
  syncing: false,
  version: '',
  // производные
  byId: new Map(),
  likedBy: new Map(), // uid -> [postId]
};

const listeners = new Set();
export const onState = (fn) => listeners.add(fn);
export const emit = (what) => listeners.forEach((fn) => fn(what));

export function setData(d) {
  Object.assign(S, d);
  reindex();
}

export function reindex() {
  S.byId = new Map(S.posts.map((p) => [p.id, p]));
  const liked = new Map();
  for (const p of S.posts) {
    for (const uid of Object.keys(p.likers || {})) {
      let arr = liked.get(uid);
      if (!arr) liked.set(uid, (arr = []));
      arr.push(p.id);
    }
  }
  S.likedBy = liked;
}

export function replacePost(p) {
  const i = S.posts.findIndex((x) => x.id === p.id);
  if (i >= 0) S.posts[i] = p;
  S.byId.set(p.id, p);
}

export async function reload() {
  setData(await window.api.init());
  emit('data');
}

// ---------- значения публикации ----------
export const eff = (p, f) => (p.overrides && p.overrides[f] ? p.local[f] : p.original[f]);
export const photos = (p) => eff(p, 'photos') || [];
export const text = (p) => eff(p, 'text') || '';
export const date = (p) => eff(p, 'date') || p.original.date;

function same(f, a, b) {
  if (f === 'photos') return (a || []).map((x) => x.key).join('|') === (b || []).map((x) => x.key).join('|');
  return (a ?? '') === (b ?? '');
}
export function localChanges(p) {
  return ['text', 'date', 'photos'].filter((f) => p.overrides?.[f] && !same(f, p.local[f], p.original[f]));
}
export const vkChanged = (p) => Object.keys(p.vk_changed || {});
/** Чья это стена: название сообщества или имя (из VK), иначе — номер */
export function ownerName(p) {
  if (p.owner_name) return p.owner_name;
  const legacy = (S.settings?.sources || []).find((x) => x.owner_id === p.owner_id); // данные старых версий
  if (legacy) return legacy.name;
  return p.owner_id < 0 ? `Сообщество ${-p.owner_id}` : `Страница id${p.owner_id}`;
}
export const likersOf = (p) => Object.keys(p.likers || {});
