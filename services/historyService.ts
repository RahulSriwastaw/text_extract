import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { HistoryItem, MocktestHistoryItem } from '../types';

const HISTORY_LIMIT = 30;

function getUserHistoryKey(userId?: string): string {
  return `user_history_${userId && userId.trim() ? userId.trim() : 'guest'}`;
}

function getUserMocktestKey(userId?: string): string {
  return `user_mocktests_${userId && userId.trim() ? userId.trim() : 'guest'}`;
}

function historyCollection(userId: string) {
  if (!db) throw new Error('Cloud history is not configured on this deployment.');
  return collection(db, 'users', userId, 'history');
}

function mocktestCollection(userId: string) {
  if (!db) throw new Error('Cloud history is not configured on this deployment.');
  return collection(db, 'users', userId, 'mocktests');
}

/**
 * Clean and sanitize data before sending to Firestore:
 * 1. Recursively strip undefined values (which cause Firestore setDoc to throw)
 * 2. Strip huge base64 images from elements to avoid hitting Firestore's 1MB limit
 */
function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined) {
        // Strip huge base64 images from cloud sync to avoid 1MB limit
        if (key === 'imageB64' && typeof val === 'string' && val.length > 10000) {
          cleaned[key] = ''; // Omit heavy payload from cloud
        } else {
          cleaned[key] = sanitizeForFirestore(val);
        }
      }
    }
    return cleaned;
  }
  return obj;
}

function saveToLocalStorage(key: string, data: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e: any) {
    console.warn('[historyService] LocalStorage quota warning, trimming to top 15 items:', e);
    try {
      if (Array.isArray(data)) {
        // Strip heavy images if quota exceeded
        const trimmed = data.slice(0, 15).map(item => {
          if (item.elements) {
            return {
              ...item,
              elements: item.elements.map((el: any) => ({ ...el, imageB64: undefined }))
            };
          }
          return item;
        });
        localStorage.setItem(key, JSON.stringify(trimmed));
      }
    } catch (err) {
      console.error('[historyService] Failed to save to localStorage:', err);
    }
  }
}

function loadFromLocalStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('[historyService] Failed to parse localStorage item for key:', key, e);
    return [];
  }
}

// ==========================================
// 1. PDF TO DOCX / TEXT CONVERSION HISTORY
// ==========================================

export async function addHistoryItem(userId: string, item: HistoryItem): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);

  // 1. Always save immediately to user-scoped local storage
  const localItems = loadFromLocalStorage<HistoryItem>(storageKey);
  const updated = [item, ...localItems.filter((i) => i.id !== item.id)].slice(0, HISTORY_LIMIT);
  saveToLocalStorage(storageKey, updated);

  // Legacy fallback key for backwards compatibility
  try {
    localStorage.setItem('conversion_history', JSON.stringify(updated));
  } catch (_) {}

  // 2. Cloud sync to Firestore if user is authenticated and db is available
  if (!db || uid === 'guest') return;

  try {
    const ref = doc(historyCollection(uid), item.id);
    const sanitized = sanitizeForFirestore({
      id: item.id,
      userId: uid,
      fileName: item.fileName || 'Untitled Document',
      timestamp: item.timestamp || Date.now(),
      pagesCount: item.pagesCount || 1,
      elements: item.elements || [],
    });
    await setDoc(ref, sanitized, { merge: true });
  } catch (e: any) {
    console.warn(
      `[historyService] Saved locally for user ${uid}. (Cloud sync skipped: ${e?.message || e})`
    );
  }
}

export async function getHistoryItems(userId: string): Promise<HistoryItem[]> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);
  const localItems = loadFromLocalStorage<HistoryItem>(storageKey);

  // If guest or no db configured, return local items directly
  if (!db || uid === 'guest') {
    if (localItems.length === 0) {
      const legacy = loadFromLocalStorage<HistoryItem>('conversion_history');
      if (legacy.length > 0) {
        saveToLocalStorage(storageKey, legacy);
        return legacy;
      }
    }
    return localItems;
  }

  // Attempt to fetch from Firestore
  try {
    const q = query(historyCollection(uid), orderBy('timestamp', 'desc'), limit(HISTORY_LIMIT));
    const snap = await getDocs(q);
    const cloudItems = snap.docs.map((d) => d.data() as HistoryItem);

    // Merge cloud items with local items
    const cloudIds = new Set(cloudItems.map((i) => i.id));
    const localOnly = localItems.filter((i) => !cloudIds.has(i.id));

    // Push local-only items up to cloud in background
    localOnly.forEach((item) => {
      try {
        const ref = doc(historyCollection(uid), item.id);
        const sanitized = sanitizeForFirestore({ ...item, userId: uid });
        setDoc(ref, sanitized, { merge: true }).catch(() => {});
      } catch (_) {}
    });

    const merged = [...cloudItems, ...localOnly]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, HISTORY_LIMIT);

    saveToLocalStorage(storageKey, merged);
    return merged;
  } catch (e: any) {
    console.warn(
      `[historyService] Cloud fetch skipped for user ${uid}, serving user-scoped local history:`,
      e?.message || e
    );
    if (localItems.length === 0) {
      const legacy = loadFromLocalStorage<HistoryItem>('conversion_history');
      if (legacy.length > 0) {
        saveToLocalStorage(storageKey, legacy);
        return legacy;
      }
    }
    return localItems;
  }
}

export async function deleteHistoryItem(userId: string, id: string): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);
  const localItems = loadFromLocalStorage<HistoryItem>(storageKey);
  const filtered = localItems.filter((i) => i.id !== id);
  saveToLocalStorage(storageKey, filtered);

  try {
    localStorage.setItem('conversion_history', JSON.stringify(filtered));
  } catch (_) {}

  if (!db || uid === 'guest') return;
  try {
    await deleteDoc(doc(historyCollection(uid), id));
  } catch (e) {
    console.warn('[historyService] Failed to delete from cloud Firestore:', e);
  }
}

export async function clearAllHistory(userId: string): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);
  saveToLocalStorage(storageKey, []);

  try {
    localStorage.removeItem('conversion_history');
  } catch (_) {}

  if (!db || uid === 'guest') return;
  try {
    const snap = await getDocs(historyCollection(uid));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn('[historyService] Failed to clear cloud Firestore history:', e);
  }
}

// ==========================================
// 2. MOCK TEST SETS HISTORY
// ==========================================

export async function addMocktestHistoryItem(userId: string, item: MocktestHistoryItem): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);

  // 1. Save locally to user-scoped key
  const localItems = loadFromLocalStorage<MocktestHistoryItem>(storageKey);
  const updated = [item, ...localItems.filter((i) => i.id !== item.id)].slice(0, HISTORY_LIMIT);
  saveToLocalStorage(storageKey, updated);

  // 2. Sync to Firestore
  if (!db || uid === 'guest') return;

  try {
    const ref = doc(mocktestCollection(uid), item.id);
    const sanitized = sanitizeForFirestore({
      id: item.id,
      userId: uid,
      setName: item.setName || 'Mock Test',
      timestamp: item.timestamp || Date.now(),
      questionCount: item.questionCount || (item.questions ? item.questions.length : 0),
      questions: item.questions || [],
    });
    await setDoc(ref, sanitized, { merge: true });
  } catch (e: any) {
    console.warn(
      `[historyService] Saved mocktest locally for user ${uid}. (Cloud sync skipped: ${e?.message || e})`
    );
  }
}

export async function getMocktestHistoryItems(userId: string): Promise<MocktestHistoryItem[]> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);
  const localItems = loadFromLocalStorage<MocktestHistoryItem>(storageKey);

  if (!db || uid === 'guest') {
    return localItems;
  }

  try {
    const q = query(mocktestCollection(uid), orderBy('timestamp', 'desc'), limit(HISTORY_LIMIT));
    const snap = await getDocs(q);
    const cloudItems = snap.docs.map((d) => d.data() as MocktestHistoryItem);

    const cloudIds = new Set(cloudItems.map((i) => i.id));
    const localOnly = localItems.filter((i) => !cloudIds.has(i.id));

    localOnly.forEach((item) => {
      try {
        const ref = doc(mocktestCollection(uid), item.id);
        const sanitized = sanitizeForFirestore({ ...item, userId: uid });
        setDoc(ref, sanitized, { merge: true }).catch(() => {});
      } catch (_) {}
    });

    const merged = [...cloudItems, ...localOnly]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, HISTORY_LIMIT);

    saveToLocalStorage(storageKey, merged);
    return merged;
  } catch (e: any) {
    console.warn(
      `[historyService] Cloud mocktests fetch skipped for user ${uid}, serving local history:`,
      e?.message || e
    );
    return localItems;
  }
}

export async function deleteMocktestHistoryItem(userId: string, id: string): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);
  const localItems = loadFromLocalStorage<MocktestHistoryItem>(storageKey);
  const filtered = localItems.filter((i) => i.id !== id);
  saveToLocalStorage(storageKey, filtered);

  if (!db || uid === 'guest') return;
  try {
    await deleteDoc(doc(mocktestCollection(uid), id));
  } catch (e) {
    console.warn('[historyService] Failed to delete mocktest from cloud Firestore:', e);
  }
}

export async function clearAllMocktestHistory(userId: string): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);
  saveToLocalStorage(storageKey, []);

  if (!db || uid === 'guest') return;
  try {
    const snap = await getDocs(mocktestCollection(uid));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn('[historyService] Failed to clear cloud mocktest history:', e);
  }
}
