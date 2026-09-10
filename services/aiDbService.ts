/**
 * IndexedDB Service for User-Owned Gemini Integration
 * All AI data, conversation history, and user credentials stay strictly on the user's local browser.
 * Nothing is sent to or stored in any central database.
 */

export interface AiSettings {
  id: 'current_settings';
  authType: 'oauth' | 'apikey' | 'none';
  apiKey?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
  userEmail?: string;
  userName?: string;
  preferredLanguage: 'Hindi' | 'English' | 'Hinglish';
  updatedAt: number;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionType?: 'explain' | 'why_wrong' | 'concept' | 'teach' | 'followup';
  timestamp: number;
}

export interface AiConversation {
  questionId: string;
  questionText: string;
  options: { label: string; text: string }[];
  userAnswer?: string;
  correctAnswer?: string;
  topic?: string;
  messages: AiMessage[];
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'user_gemini_educational_db';
const DB_VERSION = 1;

const STORES = {
  SETTINGS: 'ai_settings',
  CONVERSATIONS: 'ai_conversations',
  EXTRACTED_PAGES: 'extracted_pages'
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
        const convStore = db.createObjectStore(STORES.CONVERSATIONS, { keyPath: 'questionId' });
        convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        convStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.EXTRACTED_PAGES)) {
        const pageStore = db.createObjectStore(STORES.EXTRACTED_PAGES, { keyPath: 'id' });
        pageStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ----------------- AI SETTINGS -----------------

export async function getAiSettings(): Promise<AiSettings> {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORES.SETTINGS, 'readonly');
      const store = tx.objectStore(STORES.SETTINGS);
      const req = store.get('current_settings');

      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result);
        } else {
          // Default initial settings
          resolve({
            id: 'current_settings',
            authType: 'none',
            preferredLanguage: 'Hindi',
            updatedAt: Date.now()
          });
        }
      };

      req.onerror = () => {
        resolve({
          id: 'current_settings',
          authType: 'none',
          preferredLanguage: 'Hindi',
          updatedAt: Date.now()
        });
      };
    });
  } catch (err) {
    console.error('[aiDbService] Failed to get settings:', err);
    return {
      id: 'current_settings',
      authType: 'none',
      preferredLanguage: 'Hindi',
      updatedAt: Date.now()
    };
  }
}

export async function saveAiSettings(settings: Partial<AiSettings>): Promise<AiSettings> {
  const current = await getAiSettings();
  const updated: AiSettings = {
    ...current,
    ...settings,
    id: 'current_settings',
    updatedAt: Date.now()
  };

  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SETTINGS, 'readwrite');
    const store = tx.objectStore(STORES.SETTINGS);
    const req = store.put(updated);
    req.onsuccess = () => resolve(updated);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAiCredentials(): Promise<void> {
  const current = await getAiSettings();
  await saveAiSettings({
    ...current,
    authType: 'none',
    apiKey: undefined,
    accessToken: undefined,
    tokenExpiresAt: undefined,
    userEmail: undefined,
    userName: undefined
  });
}

// ----------------- AI CONVERSATIONS -----------------

export async function getConversation(questionId: string): Promise<AiConversation | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONVERSATIONS, 'readonly');
    const store = tx.objectStore(STORES.CONVERSATIONS);
    const req = store.get(questionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveConversation(conversation: AiConversation): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONVERSATIONS, 'readwrite');
    const store = tx.objectStore(STORES.CONVERSATIONS);
    const req = store.put({
      ...conversation,
      updatedAt: Date.now()
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function appendMessageToConversation(
  questionId: string,
  questionData: {
    questionText: string;
    options: { label: string; text: string }[];
    userAnswer?: string;
    correctAnswer?: string;
    topic?: string;
  },
  newMessage: Omit<AiMessage, 'id' | 'timestamp'>
): Promise<AiConversation> {
  let conv = await getConversation(questionId);

  const fullMessage: AiMessage = {
    ...newMessage,
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now()
  };

  if (!conv) {
    conv = {
      questionId,
      questionText: questionData.questionText,
      options: questionData.options,
      userAnswer: questionData.userAnswer,
      correctAnswer: questionData.correctAnswer,
      topic: questionData.topic,
      messages: [fullMessage],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  } else {
    conv.messages.push(fullMessage);
    conv.userAnswer = questionData.userAnswer || conv.userAnswer;
    conv.correctAnswer = questionData.correctAnswer || conv.correctAnswer;
    conv.updatedAt = Date.now();
  }

  await saveConversation(conv);
  return conv;
}

export async function getAllConversations(): Promise<AiConversation[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONVERSATIONS, 'readonly');
    const store = tx.objectStore(STORES.CONVERSATIONS);
    const req = store.getAll();
    req.onsuccess = () => {
      const results: AiConversation[] = req.result || [];
      // Sort newest first
      results.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteConversation(questionId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONVERSATIONS, 'readwrite');
    const store = tx.objectStore(STORES.CONVERSATIONS);
    const req = store.delete(questionId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllAiHistory(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CONVERSATIONS, 'readwrite');
    const store = tx.objectStore(STORES.CONVERSATIONS);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function exportHistoryAsJson(): Promise<string> {
  const history = await getAllConversations();
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    totalQuestions: history.length,
    conversations: history
  }, null, 2);
}

// ----------------- LOCAL EXTRACTED DOCUMENTS -----------------

export interface SavedExtractedDoc {
  id: string;
  fileName: string;
  pageCount: number;
  extractedText: string;
  elements: any[];
  timestamp: number;
}

export async function saveExtractedDocument(doc: SavedExtractedDoc): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EXTRACTED_PAGES, 'readwrite');
    const store = tx.objectStore(STORES.EXTRACTED_PAGES);
    const req = store.put(doc);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllExtractedDocuments(): Promise<SavedExtractedDoc[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EXTRACTED_PAGES, 'readonly');
    const store = tx.objectStore(STORES.EXTRACTED_PAGES);
    const req = store.getAll();
    req.onsuccess = () => {
      const docs: SavedExtractedDoc[] = req.result || [];
      docs.sort((a, b) => b.timestamp - a.timestamp);
      resolve(docs);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteExtractedDocument(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EXTRACTED_PAGES, 'readwrite');
    const store = tx.objectStore(STORES.EXTRACTED_PAGES);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

