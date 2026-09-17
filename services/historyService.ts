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
import { HistoryItem } from '../types';

const HISTORY_LIMIT = 20;

function historyCollection(userId: string) {
  if (!db) throw new Error('Cloud history is not configured on this deployment.');
  return collection(db, 'users', userId, 'history');
}

export async function addHistoryItem(userId: string, item: HistoryItem): Promise<void> {
  if (!db) return;
  const ref = doc(historyCollection(userId), item.id);
  await setDoc(ref, {
    id: item.id,
    userId,
    fileName: item.fileName,
    timestamp: item.timestamp,
    pagesCount: item.pagesCount,
    elements: item.elements,
  });
}

export async function getHistoryItems(userId: string): Promise<HistoryItem[]> {
  if (!db) return [];
  const q = query(historyCollection(userId), orderBy('timestamp', 'desc'), limit(HISTORY_LIMIT));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as HistoryItem);
}

export async function deleteHistoryItem(userId: string, id: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(historyCollection(userId), id));
}

export async function clearAllHistory(userId: string): Promise<void> {
  if (!db) return;
  const snap = await getDocs(historyCollection(userId));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
