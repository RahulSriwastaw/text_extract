import type { ConvertedRow, Settings, SourceFile } from './universalCsv';

export interface ConversionJob {
  id: string; filename: string; createdAt: string; exportedRows: number;
  source: SourceFile; settings: Settings; rows: ConvertedRow[];
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vedatool-universal-csv', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('jobs')) {
        request.result.createObjectStore('jobs', { keyPath: 'id' });
        return;
      }
      // Preserve local conversions while removing the previous account partition.
      const store = request.transaction!.objectStore('jobs');
      if (store.indexNames.contains('owner')) store.deleteIndex('owner');
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        const { owner: _legacyOwner, ...job } = cursor.result.value;
        cursor.result.update(job);
        cursor.result.continue();
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function listJobs(): Promise<ConversionJob[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('jobs', 'readonly');
    const request = tx.objectStore('jobs').getAll();
    tx.oncomplete = () => { db.close(); resolve((request.result as ConversionJob[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveJob(job: ConversionJob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('jobs', 'readwrite');
    tx.objectStore('jobs').put(job);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('History save aborted.')); };
  });
}
export async function deleteJob(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('jobs', 'readwrite');
    tx.objectStore('jobs').delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
