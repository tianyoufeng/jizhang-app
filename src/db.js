/**
 * 极简 IndexedDB 封装。
 * 浏览器、安卓 WebView、iOS WKWebView 里行为一致，数据存在 App 自己的目录下。
 *
 * 关于索引：这里建的 ledgerId / ledger_date 索引目前没有查询在用 ——
 * 所有查询都走内存里的 state（个人记账数据量小，几千条全载入内存反而更快）。
 * 之所以留着，是因为删索引要动 DB_VERSION，而版本号一涨，
 * 用户的旧版 APK 就再也打不开这个库了（IndexedDB 不允许降级打开）。
 * 索引只在写入时有极小的开销，留着比冒降级不兼容的风险划算。
 * 以后如果真要做分页查询，它们就能派上用场。
 */

const DB_NAME = 'jizhang';
const DB_VERSION = 1;

export const STORES = ['transactions', 'categories', 'ledgers', 'meta'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('ledgerId', 'ledgerId');
        s.createIndex('ledger_date', ['ledgerId', 'date']);
      }
      if (!db.objectStoreNames.contains('categories')) {
        const s = db.createObjectStore('categories', { keyPath: 'id' });
        s.createIndex('ledgerId', 'ledgerId');
      }
      if (!db.objectStoreNames.contains('ledgers')) {
        db.createObjectStore('ledgers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(storeName, mode) {
  return open().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async getAll(storeName) {
    const s = await tx(storeName, 'readonly');
    return wrap(s.getAll());
  },

  async put(storeName, value) {
    const s = await tx(storeName, 'readwrite');
    return wrap(s.put(value));
  },

  async putMany(storeName, values) {
    if (!values.length) return;
    const database = await open();
    return new Promise((resolve, reject) => {
      const t = database.transaction(storeName, 'readwrite');
      const s = t.objectStore(storeName);
      values.forEach((v) => s.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },

  async remove(storeName, key) {
    const s = await tx(storeName, 'readwrite');
    return wrap(s.delete(key));
  },

  async removeMany(storeName, keys) {
    if (!keys.length) return;
    const database = await open();
    return new Promise((resolve, reject) => {
      const t = database.transaction(storeName, 'readwrite');
      const s = t.objectStore(storeName);
      keys.forEach((k) => s.delete(k));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async clearAll() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const t = database.transaction(STORES, 'readwrite');
      STORES.forEach((name) => t.objectStore(name).clear());
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
};

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
