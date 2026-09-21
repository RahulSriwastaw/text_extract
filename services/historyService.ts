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
import { 
  saveExtractedDocument, 
  getAllExtractedDocuments,
  saveMocktestSetToDb,
  getMocktestSetFromDb,
  getAllMocktestSetsFromDb,
  deleteMocktestSetFromDb
} from './aiDbService';

const HISTORY_LIMIT = 35;

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
        if (key === 'imageB64' && typeof val === 'string' && val.length > 5000) {
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
    console.warn('[historyService] LocalStorage quota reached, pruning oldest items:', e);
    try {
      if (Array.isArray(data)) {
        // Strip any heavy fields and trim to top 15 items
        const trimmed = data.slice(0, 15).map((item) => {
          if (item.elements) {
            return {
              ...item,
              elements: item.elements.map((el: any) => ({
                id: el.id,
                type: el.type,
                content: typeof el.content === 'string' ? el.content.slice(0, 1000) : '',
              })),
            };
          }
          return item;
        });
        localStorage.setItem(key, JSON.stringify(trimmed));
      }
    } catch (err) {
      console.error('[historyService] Failed to save to localStorage after trim:', err);
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

let isFirestoreAvailable = true;

/**
 * Executes a Firestore promise guarded by a timeout.
 * Cloud sync runs in the background and does not block the UI.
 */
async function withFirestoreTimeout<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  if (!db) {
    throw new Error('Firestore is unconfigured');
  }

  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Firestore operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer);
    return result;
  } catch (err: any) {
    clearTimeout(timer);
    const msg = String(err?.message || err);
    if (
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('not-found') ||
      msg.includes('disabled') ||
      msg.includes('has not been used in project')
    ) {
      console.warn(
        '[Firebase] Cloud Firestore is not active or rules need publishing in Firebase Console. Go to: https://console.firebase.google.com/project/text-extract-8210e/firestore'
      );
    }
    throw err;
  }
}

export async function addHistoryItem(userId: string, item: HistoryItem): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);

  // Clean elements: strip heavy imageB64 so localStorage and Firestore never hit quota limits!
  const cleanedElements = (item.elements || []).map((el) => ({
    id: el.id,
    type: el.type,
    content: el.content || '',
    bbox: el.bbox || null,
  }));

  const leanItem: HistoryItem = {
    id: item.id,
    userId: uid,
    fileName: item.fileName || 'Untitled Document',
    timestamp: item.timestamp || Date.now(),
    pagesCount: item.pagesCount || 1,
    elements: cleanedElements as any,
  };

  // 1. Save to user-scoped local storage immediately
  const localItems = loadFromLocalStorage<HistoryItem>(storageKey);
  const updated = [leanItem, ...localItems.filter((i) => i.id !== item.id)].slice(0, HISTORY_LIMIT);
  saveToLocalStorage(storageKey, updated);

  // Also keep general conversion_history fallback updated
  try {
    localStorage.setItem('conversion_history', JSON.stringify(updated));
  } catch (_) {}

  // 2. Also save to browser IndexedDB (stores document safely with no 5MB quota issue)
  try {
    const fullText = cleanedElements
      .map((e) => (e.type === 'text' ? e.content || '' : ''))
      .join('\n\n');
    await saveExtractedDocument({
      id: leanItem.id,
      fileName: leanItem.fileName,
      pageCount: leanItem.pagesCount,
      extractedText: fullText,
      elements: cleanedElements,
      timestamp: leanItem.timestamp,
    });
  } catch (_) {}

  // 3. Dispatch local notification event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conversion_history_updated', { detail: { item: leanItem } }));
  }

  // 4. Cloud sync to Firestore if authenticated (fire-and-forget in background, NEVER await!)
  if (!db || uid === 'guest') return;

  (async () => {
    try {
      const ref = doc(historyCollection(uid), leanItem.id);
      const sanitized = sanitizeForFirestore(leanItem);
      await withFirestoreTimeout(setDoc(ref, sanitized, { merge: true }), 10000);
      console.log(`[Firebase Cloud Sync] ✅ Conversion document "${leanItem.fileName}" synced to Firestore for user: ${uid}`);
    } catch (err: any) {
      console.warn(`[Firebase Cloud Sync] Notice: Cloud sync deferred (${err?.message || err}). Document safely preserved in local history.`);
    }
  })();
}

export async function getHistoryItems(userId: string): Promise<HistoryItem[]> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);
  let localItems = loadFromLocalStorage<HistoryItem>(storageKey);

  // Check fallback keys if user-scoped key is empty
  if (localItems.length === 0) {
    const legacy = loadFromLocalStorage<HistoryItem>('conversion_history');
    if (legacy.length > 0) {
      localItems = legacy;
      saveToLocalStorage(storageKey, legacy);
    }
  }

  // If still empty, check IndexedDB
  if (localItems.length === 0) {
    try {
      const idbDocs = await getAllExtractedDocuments();
      if (idbDocs.length > 0) {
        localItems = idbDocs.map((d) => ({
          id: d.id,
          userId: uid,
          fileName: d.fileName || 'Untitled Document',
          timestamp: d.timestamp,
          pagesCount: d.pageCount || 1,
          elements: d.elements || [],
        }));
        saveToLocalStorage(storageKey, localItems);
      }
    } catch (_) {}
  }

  // If guest or no db configured, return local items directly (0ms)
  if (!db || uid === 'guest') {
    return localItems;
  }

  // Attempt fast fetch from Firestore; fallback to local items immediately
  try {
    const q = query(historyCollection(uid), orderBy('timestamp', 'desc'), limit(HISTORY_LIMIT));
    const snap = await withFirestoreTimeout(getDocs(q), 4000);
    const cloudItems = snap.docs.map((d) => d.data() as HistoryItem);

    // Merge cloud items with local items
    const cloudIds = new Set(cloudItems.map((i) => i.id));
    const localOnly = localItems.filter((i) => !cloudIds.has(i.id));

    // Push local-only items up to cloud in background
    localOnly.forEach((item) => {
      try {
        const ref = doc(historyCollection(uid), item.id);
        const sanitized = sanitizeForFirestore({ ...item, userId: uid });
        withFirestoreTimeout(setDoc(ref, sanitized, { merge: true }), 10000).catch(() => {});
      } catch (_) {}
    });

    const merged = [...cloudItems, ...localOnly]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, HISTORY_LIMIT);

    saveToLocalStorage(storageKey, merged);
    return merged;
  } catch (_) {
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

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conversion_history_updated'));
  }

  if (!db || uid === 'guest' || !isFirestoreAvailable) return;
  try {
    withFirestoreTimeout(deleteDoc(doc(historyCollection(uid), id)), 1200).catch(() => {});
  } catch (_) {}
}

export async function clearAllHistory(userId: string): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);
  saveToLocalStorage(storageKey, []);

  try {
    localStorage.removeItem('conversion_history');
  } catch (_) {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('conversion_history_updated'));
  }

  if (!db || uid === 'guest' || !isFirestoreAvailable) return;
  try {
    withFirestoreTimeout(
      (async () => {
        const snap = await getDocs(historyCollection(uid));
        if (!snap.empty) {
          const batch = writeBatch(db!);
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      })(),
      1500
    ).catch(() => {});
  } catch (_) {}
}

// ==========================================
// 2. MOCK TEST SETS HISTORY
// ==========================================

export async function addMocktestHistoryItem(userId: string, item: MocktestHistoryItem): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);

  const cleanQuestions = (item.questions || []).map((q) => ({
    ...q,
    question_hi: q.question_hi || '',
    question_en: q.question_en || '',
    option1_hi: q.option1_hi || '',
    option2_hi: q.option2_hi || '',
    option3_hi: q.option3_hi || '',
    option4_hi: q.option4_hi || '',
    option5_hi: q.option5_hi || '',
    option1_en: q.option1_en || '',
    option2_en: q.option2_en || '',
    option3_en: q.option3_en || '',
    option4_en: q.option4_en || '',
    option5_en: q.option5_en || '',
    answer: q.answer || '',
    solution_hi: q.solution_hi || '',
    solution_en: q.solution_en || '',
    subject: q.subject || '',
    difficulty_level: q.difficulty_level || 'medium',
  }));

  const leanItem: MocktestHistoryItem = {
    id: item.id || ('mock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
    userId: uid,
    setName: item.setName || 'Mock Test',
    timestamp: item.timestamp || Date.now(),
    questionCount: item.questionCount || cleanQuestions.length,
    questions: cleanQuestions,
    pages: item.pages || [],
  };

  // 1. Save full set (including PDF pages, images & content) to browser IndexedDB
  try {
    await saveMocktestSetToDb(leanItem);
  } catch (err) {
    console.warn('[historyService] Failed to save full mocktest to IndexedDB:', err);
  }

  // 2. Save locally to user-scoped key in localStorage (prune heavy base64 to avoid quota error)
  const storageLeanItem: MocktestHistoryItem = {
    ...leanItem,
    pages: (leanItem.pages || []).map((p: any) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      status: p.status || 'ready',
      mcqCount: p.mcqCount || 0,
      fileName: p.fileName || '',
      sourceType: p.sourceType || 'image',
      rawTextContent: typeof p.rawTextContent === 'string' ? p.rawTextContent.slice(0, 1500) : '',
      imageUrl: (typeof p.imageUrl === 'string' && p.imageUrl.length < 40000) ? p.imageUrl : '',
    }))
  };

  const localItems = loadFromLocalStorage<MocktestHistoryItem>(storageKey);
  const updated = [storageLeanItem, ...localItems.filter((i) => i.id !== leanItem.id)].slice(0, HISTORY_LIMIT);
  saveToLocalStorage(storageKey, updated);

  // Also keep general mocktests fallback and guest key updated so data is never lost across login
  try {
    localStorage.setItem('user_mocktests_all', JSON.stringify(updated));
    if (uid !== 'guest') {
      // Also update guest key so switching back preserves history
      localStorage.setItem('user_mocktests_guest', JSON.stringify(updated));
    }
  } catch (_) {}

  // 3. Dispatch custom event so any open UI / Drawer updates immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mocktest_history_updated', { detail: { item: leanItem } }));
  }

  // 4. Non-blocking cloud sync (fire-and-forget in background, NEVER await!)
  if (!db || uid === 'guest') return;

  (async () => {
    try {
      const ref = doc(mocktestCollection(uid), leanItem.id);
      const sanitized = sanitizeForFirestore(leanItem);
      await withFirestoreTimeout(setDoc(ref, sanitized, { merge: true }), 10000);
      console.log(`[Firebase Cloud Sync] ✅ Mocktest set "${leanItem.setName}" (${leanItem.questionCount} MCQs) successfully saved to Firebase Firestore for user: ${uid}`);
    } catch (err: any) {
      console.warn(`[Firebase Cloud Sync] Notice: Cloud sync deferred (${err?.message || err}). Questions safely preserved in local history.`);
    }
  })();
}

export async function getMocktestHistoryItems(userId: string): Promise<MocktestHistoryItem[]> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);
  let localItems = loadFromLocalStorage<MocktestHistoryItem>(storageKey);

  // Fallback to general mocktests list or guest list if user-scoped is empty
  if (localItems.length === 0) {
    const general = loadFromLocalStorage<MocktestHistoryItem>('user_mocktests_all');
    if (general.length > 0) {
      localItems = general;
      saveToLocalStorage(storageKey, general);
    } else {
      const guestItems = loadFromLocalStorage<MocktestHistoryItem>('user_mocktests_guest');
      if (guestItems.length > 0) {
        localItems = guestItems;
        saveToLocalStorage(storageKey, guestItems);
      }
    }
  }

  // Hydrate full pages from IndexedDB if available!
  try {
    const idbSets = await getAllMocktestSetsFromDb();
    if (idbSets && idbSets.length > 0) {
      const idbMap = new Map(idbSets.map((s: any) => [s.id, s]));
      localItems = localItems.map((lit) => {
        const matched = idbMap.get(lit.id);
        if (matched && matched.pages && matched.pages.length > 0) {
          return {
            ...lit,
            pages: matched.pages
          };
        }
        return lit;
      });
    }
  } catch (_) {}

  // If guest or no db, return local items IMMEDIATELY (0ms)
  if (!db || uid === 'guest') {
    return localItems;
  }

  try {
    const q = query(mocktestCollection(uid), orderBy('timestamp', 'desc'), limit(HISTORY_LIMIT));
    const snap = await withFirestoreTimeout(getDocs(q), 4000);
    const cloudItems = snap.docs.map((d) => d.data() as MocktestHistoryItem);

    const cloudIds = new Set(cloudItems.map((i) => i.id));
    const localOnly = localItems.filter((i) => !cloudIds.has(i.id));

    localOnly.forEach((item) => {
      try {
        const ref = doc(mocktestCollection(uid), item.id);
        const sanitized = sanitizeForFirestore({ ...item, userId: uid });
        withFirestoreTimeout(setDoc(ref, sanitized, { merge: true }), 10000).catch(() => {});
      } catch (_) {}
    });

    const merged = [...cloudItems, ...localOnly]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, HISTORY_LIMIT);

    saveToLocalStorage(storageKey, merged);
    return merged;
  } catch (_) {
    return localItems;
  }
}

export async function deleteMocktestHistoryItem(userId: string, id: string): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);
  const localItems = loadFromLocalStorage<MocktestHistoryItem>(storageKey);
  const filtered = localItems.filter((i) => i.id !== id);
  saveToLocalStorage(storageKey, filtered);

  try {
    localStorage.setItem('user_mocktests_all', JSON.stringify(filtered));
  } catch (_) {}

  // Also delete from IndexedDB
  deleteMocktestSetFromDb(id).catch(() => {});

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mocktest_history_updated'));
  }

  if (!db || uid === 'guest' || !isFirestoreAvailable) return;
  try {
    withFirestoreTimeout(deleteDoc(doc(mocktestCollection(uid), id)), 1200).catch(() => {});
  } catch (_) {}
}

export async function clearAllMocktestHistory(userId: string): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserMocktestKey(uid);
  saveToLocalStorage(storageKey, []);

  try {
    localStorage.removeItem('user_mocktests_all');
  } catch (_) {}

  // Also clean up all IndexedDB mocktest sets
  try {
    const idbSets = await getAllMocktestSetsFromDb();
    idbSets.forEach((s) => deleteMocktestSetFromDb(s.id).catch(() => {}));
  } catch (_) {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mocktest_history_updated'));
  }

  if (!db || uid === 'guest' || !isFirestoreAvailable) return;
  try {
    withFirestoreTimeout(
      (async () => {
        const snap = await getDocs(mocktestCollection(uid));
        if (!snap.empty) {
          const batch = writeBatch(db!);
          snap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      })(),
      1500
    ).catch(() => {});
  } catch (_) {}
}
