import { AbrBrush } from './abrParser';

const DB_NAME = 'vertebrae_brushes_db';
const DB_VERSION = 1;
const STORE_NAME = 'brushes';

export function saveBrushesToDB(brushes: AbrBrush[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(brushes, 'saved_brushes');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export function loadBrushesFromDB(): Promise<AbrBrush[]> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => {
      const db = req.result;
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (e) {
        resolve([]);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get('saved_brushes');
      getReq.onsuccess = () => {
        resolve(getReq.result || []);
      };
      getReq.onerror = () => resolve([]);
    };
    req.onerror = () => resolve([]);
  });
}
