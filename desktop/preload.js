'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/** Безопасный мост: интерфейс не имеет доступа к Node.js, только к этим функциям. */
const call =
  (channel) =>
  async (...args) => {
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r.ok) {
      const e = new Error(r.error.message);
      e.code = r.error.code;
      throw e;
    }
    return r.data;
  };

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  init: call('app:init'),
  openUrl: call('app:open-url'),
  info: call('app:info'),

  editPost: call('post:edit'),
  acceptOriginal: call('post:accept-original'),
  keepMine: call('post:keep-mine'),
  pickPhoto: call('post:pick-photo'),
  deletePosts: call('posts:delete'),
  addPost: call('post:add'),
  setPostTitle: call('post:set-title'),
  restorePosts: call('trash:restore'),
  forgetPosts: call('trash:forget'),
  clearTrash: call('trash:clear'),
  trashAllPosts: call('posts:trash-all'),
  allowReturn: call('trash:allow-return'),

  updateSettings: call('settings:update'),

  vkLogin: call('vk:login'),
  vkSetToken: call('vk:set-token'),
  vkLogout: call('vk:logout'),
  vkCheck: call('vk:check'),
  setServiceKey: call('vk:set-service-key'),
  clearServiceKey: call('vk:clear-service-key'),
  vkWebStatus: call('vkweb:status'),
  vkWebLogin: call('vkweb:login'),
  vkWebLogout: call('vkweb:logout'),

  syncStart: call('sync:start'),
  syncCancel: call('sync:cancel'),
  onSyncProgress: on('sync:progress'),
  onSyncDone: on('sync:done'),
  onDataChanged: on('data:changed'),

  openFolder: call('lib:open-folder'),
  usage: call('lib:usage'),
  integrity: call('lib:integrity'),
  changeLocation: call('lib:change-location'),
  readLogs: call('logs:read'),
  openLogs: call('logs:open'),
});
