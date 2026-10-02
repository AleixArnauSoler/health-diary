// Diary – on-device storage (IndexedDB).
// Two stores:
//   entries  – one record per diary date
//   settings – key/value pairs: GitHub connection, cached config, …
// The demo diary uses a separate database ("diary-demo"), so the real diary is never touched.

const DB_VERSION = 1;
const MODE_KEY = 'diary-mode';
const REAL_DB = 'diary';
const DEMO_DB = 'diary-demo';

export function isDemoMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'demo';
  } catch {
    return false;
  }
}

// Switches between the real and the demo diary (the app reloads afterwards).
export function setDemoMode(on) {
  try {
    if (on) localStorage.setItem(MODE_KEY, 'demo');
    else localStorage.removeItem(MODE_KEY);
  } catch {
    // ignore: without localStorage the app simply stays in the real diary
  }
}

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = openDatabase(isDemoMode() ? DEMO_DB : REAL_DB);
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

// Replaces the demo database with new contents: settings as { key: value }, entries as a list.
export async function writeDemoDatabase(settings, entries) {
  if (dbPromise && isDemoMode()) {           // close our own connection first, or the delete is blocked
    (await dbPromise).close();
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DEMO_DB);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = resolve;
  });
  const db = await openDatabase(DEMO_DB);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'settings'], 'readwrite');
    for (const [key, value] of Object.entries(settings)) tx.objectStore('settings').put(value, key);
    for (const entry of entries) tx.objectStore('entries').put(entry);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
