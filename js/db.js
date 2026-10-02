// Diary – on-device storage (IndexedDB).
// Two stores:
//   entries  – one record per diary date (used from Step 3)
//   settings – key/value pairs: GitHub connection, cached config, …

const DB_NAME = 'diary';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'date' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Ask the browser not to clear this app's storage when the phone runs low on space.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  return dbPromise;
}

// Runs one request in a transaction and resolves with its result once the transaction is done.
async function run(storeName, mode, makeRequest) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = makeRequest(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function dbGet(store, key) {
  return run(store, 'readonly', (s) => s.get(key));
}

// For "entries" the key is inside the value (value.date); for "settings" pass the key.
export function dbPut(store, value, key) {
  return run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
}

export function dbDelete(store, key) {
  return run(store, 'readwrite', (s) => s.delete(key));
}

export function dbGetAll(store) {
  return run(store, 'readonly', (s) => s.getAll());
}
