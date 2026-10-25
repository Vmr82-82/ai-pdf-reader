// =============================================================================
// IndexedDB Local Storage Manager for AI PDF Reader Lite
// =============================================================================

const DB_NAME = 'AIPdfReaderDB';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('highlights')) {
        const hlStore = db.createObjectStore('highlights', { keyPath: 'id' });
        hlStore.createIndex('docId', 'docId', { unique: false });
        hlStore.createIndex('docAndPage', ['docId', 'page'], { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export const Storage = {
  async saveDocument(id, name, arrayBuffer) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put({
        id,
        name,
        data: arrayBuffer,
        savedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getLatestDocument() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readonly');
      const req = tx.objectStore('documents').getAll();
      req.onsuccess = () => {
        const docs = req.result || [];
        if (!docs.length) return resolve(null);
        docs.sort((a, b) => b.savedAt - a.savedAt);
        resolve(docs[0]);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async saveSetting(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getSetting(key, defaultValue = null) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
      req.onerror = () => reject(req.error);
    });
  },

  async addHighlight(hl) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('highlights', 'readwrite');
      tx.objectStore('highlights').put(hl);
      tx.oncomplete = () => resolve(hl);
      tx.onerror = () => reject(tx.error);
    });
  },

  async deleteHighlight(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('highlights', 'readwrite');
      tx.objectStore('highlights').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getHighlightsForDoc(docId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('highlights', 'readonly');
      const idx = tx.objectStore('highlights').index('docId');
      const req = idx.getAll(docId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
};
