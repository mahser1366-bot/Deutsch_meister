const DB_NAME = 'deutsch-meister-db';
const DB_VERSION = 3;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is not available in this browser or context.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;
      const words = db.objectStoreNames.contains('words')
        ? tx.objectStore('words')
        : db.createObjectStore('words', { keyPath: 'id' });
      if (!words.indexNames.contains('german')) words.createIndex('german', 'german', { unique: false });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      const logs = db.objectStoreNames.contains('reviewLogs')
        ? tx.objectStore('reviewLogs')
        : db.createObjectStore('reviewLogs', { keyPath: 'id' });
      if (!logs.indexNames.contains('date')) logs.createIndex('date', 'date', { unique: false });
      if (!logs.indexNames.contains('wordId')) logs.createIndex('wordId', 'wordId', { unique: false });
      const sessions = db.objectStoreNames.contains('sessions')
        ? tx.objectStore('sessions')
        : db.createObjectStore('sessions', { keyPath: 'id' });
      if (!sessions.indexNames.contains('date')) sessions.createIndex('date', 'date', { unique: false });
      if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open the vocabulary database.'));
    req.onblocked = () => reject(new Error('Database upgrade is blocked by another open Deutsch Meister tab. Close other tabs and reload.'));
  });
}

let dbRef;
export function setDB(db) { dbRef = db; }
export function getDB() { return dbRef; }

function transact(stores, mode, action) {
  return new Promise((resolve, reject) => {
    if (!dbRef) return reject(new Error('Database is not initialized.'));
    let tx;
    try { tx = dbRef.transaction(stores, mode); }
    catch (error) { reject(error); return; }
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error || new Error('Database transaction failed.')); } };
    try { action(tx); }
    catch (error) { try { tx.abort(); } catch {} fail(error); return; }
    tx.oncomplete = () => { if (!settled) { settled = true; resolve(); } };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error || new Error('Database transaction was aborted.'));
  });
}

export function request(store, mode, action) {
  return new Promise((resolve, reject) => {
    if (!dbRef) return reject(new Error('Database is not initialized.'));
    let tx;
    try { tx = dbRef.transaction([store], mode); }
    catch (error) { reject(error); return; }
    let result;
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error || new Error('Database request failed.')); } };
    try {
      const req = action(tx.objectStore(store));
      if (req) {
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => { try { tx.abort(); } catch {} fail(req.error); };
      }
    } catch (error) { try { tx.abort(); } catch {} fail(error); return; }
    tx.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error || new Error('Database transaction was aborted.'));
  });
}

export function all(store) { return request(store, 'readonly', s => s.getAll()); }
export function put(store, value) { return request(store, 'readwrite', s => s.put(value)); }
export function remove(store, id) { return request(store, 'readwrite', s => s.delete(id)); }
export function clear(store) { return request(store, 'readwrite', s => s.clear()); }
export function saveReview(word, log) {
  return transact(['words', 'reviewLogs'], 'readwrite', tx => {
    tx.objectStore('words').put(word);
    tx.objectStore('reviewLogs').put(log);
  });
}
export async function getSetting(key, fallback) {
  const value = await request('settings', 'readonly', s => s.get(key));
  return value ? value.value : fallback;
}
export function setSetting(key, value) { return put('settings', { key, value }); }
