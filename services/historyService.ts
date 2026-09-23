import { supabase } from './supabase';
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

export async function addHistoryItem(userId: string, item: HistoryItem): Promise<void> {
  const uid = userId || 'guest';
  const storageKey = getUserHistoryKey(uid);

  // Clean elements: strip heavy imageB64 so localStorage never hits quota limits
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
  const fullText = cleanedElements
    .map((e) => (e.type === 'text' ? e.content || '' : ''))
    .join('\n\n');

  try {
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

  // 4. Cloud sync to Supabase if authenticated
  if (!supabase || uid === 'guest') return;

  (async () => {
    try {
      const { error } = await supabase
        .from('user_history')
        .upsert(
          {
            id: leanItem.id,
            user_id: uid,
            name: leanItem.fileName,
            original_name: leanItem.fileName,
            created_at: leanItem.timestamp,
            page_count: leanItem.pagesCount,
            elements: cleanedElements,
            raw_text: fullText.slice(0, 10000),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );

      if (error) {
        console.warn('[Supabase Sync] user_history sync notice:', error.message);
      } else {
        console.log(`[Supabase Sync] ✅ Document "${leanItem.fileName}" synced to Supabase PostgreSQL`);
      }
    } catch (err: any) {
      console.warn('[Supabase Sync] Sync deferred:', err?.message || err);
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

  // If guest or no supabase client, return local items directly (0ms)
  if (!supabase || uid === 'guest') {
    return localItems;
  }

  // Fetch from Supabase PostgreSQL
  try {
    const { data: cloudRows, error } = await supabase
      .from('user_history')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error || !cloudRows) {
      return localItems;
    }

    const cloudItems: HistoryItem[] = cloudRows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      fileName: r.name || r.original_name || 'Untitled Document',
      timestamp: Number(r.created_at) || Date.now(),
      pagesCount: r.page_count || 1,
      elements: r.elements || [],
    }));

    // Merge cloud items with local items
    const cloudIds = new Set(cloudItems.map((i) => i.id));
    const localOnly = localItems.filter((i) => !cloudIds.has(i.id));

    // Upload local-only items to Supabase in background
    localOnly.forEach((item) => {
      Promise.resolve(
        supabase
          .from('user_history')
          .upsert(
            {
              id: item.id,
              user_id: uid,
              name: item.fileName,
              created_at: item.timestamp,
              page_count: item.pagesCount,
              elements: item.elements || [],
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
      ).catch(() => {});
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

  if (!supabase || uid === 'guest') return;
  try {
    Promise.resolve(supabase.from('user_history').delete().eq('id', id)).catch(() => {});
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

  if (!supabase || uid === 'guest') return;
  try {
    Promise.resolve(supabase.from('user_history').delete().eq('user_id', uid)).catch(() => {});
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

  // 2. Save locally to user-scoped key in localStorage
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

  // Also keep general mocktests fallback and guest key updated
  try {
    localStorage.setItem('user_mocktests_all', JSON.stringify(updated));
    if (uid !== 'guest') {
      localStorage.setItem('user_mocktests_guest', JSON.stringify(updated));
    }
  } catch (_) {}

  // 3. Dispatch custom event so UI updates immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mocktest_history_updated', { detail: { item: leanItem } }));
  }

  // 4. Non-blocking cloud sync to Supabase
  if (!supabase || uid === 'guest') return;

  (async () => {
    try {
      const { error } = await supabase
        .from('user_mocktests')
        .upsert(
          {
            id: leanItem.id,
            user_id: uid,
            set_name: leanItem.setName,
            page_count: (leanItem.pages || []).length || 1,
            created_at: leanItem.timestamp,
            items: cleanQuestions,
            summary: `${cleanQuestions.length} Questions extracted`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );

      if (error) {
        console.warn('[Supabase Sync] user_mocktests notice:', error.message);
      } else {
        console.log(`[Supabase Sync] ✅ Mocktest set "${leanItem.setName}" saved to Supabase PostgreSQL`);
      }
    } catch (err: any) {
      console.warn('[Supabase Sync] Mocktest sync deferred:', err?.message || err);
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

  // Hydrate full pages from IndexedDB if available
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

  // If guest or no supabase, return local items IMMEDIATELY (0ms)
  if (!supabase || uid === 'guest') {
    return localItems;
  }

  try {
    const { data: cloudRows, error } = await supabase
      .from('user_mocktests')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error || !cloudRows) {
      return localItems;
    }

    const cloudItems: MocktestHistoryItem[] = cloudRows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      setName: r.set_name || 'Mock Test',
      timestamp: Number(r.created_at) || Date.now(),
      questionCount: Array.isArray(r.items) ? r.items.length : 0,
      questions: r.items || [],
      pages: [],
    }));

    const cloudIds = new Set(cloudItems.map((i) => i.id));
    const localOnly = localItems.filter((i) => !cloudIds.has(i.id));

    // Upload local-only items to Supabase in background
    localOnly.forEach((item) => {
      Promise.resolve(
        supabase
          .from('user_mocktests')
          .upsert(
            {
              id: item.id,
              user_id: uid,
              set_name: item.setName,
              page_count: (item.pages || []).length || 1,
              created_at: item.timestamp,
              items: item.questions || [],
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
          )
      ).catch(() => {});
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

  if (!supabase || uid === 'guest') return;
  try {
    Promise.resolve(supabase.from('user_mocktests').delete().eq('id', id)).catch(() => {});
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

  if (!supabase || uid === 'guest') return;
  try {
    Promise.resolve(supabase.from('user_mocktests').delete().eq('user_id', uid)).catch(() => {});
  } catch (_) {}
}
