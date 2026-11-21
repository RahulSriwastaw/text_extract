import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { adminDb } from './db.js';

let syncedAt = 0;
let pending: Promise<void> | undefined;

async function importMissingProfiles() {
  if (!adminDb) throw Error('Admin database unavailable.');
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const json = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  const account = json ? JSON.parse(json) : undefined;
  if (account && projectId && account.project_id !== projectId) throw Error('Firebase project mismatch.');
  const app = getApps().find(app => app.name === 'admin-directory') ||
    initializeApp({projectId, credential: account ? cert(account) : applicationDefault()}, 'admin-directory');
  let token: string | undefined;
  do {
    const result = await getAuth(app).listUsers(500, token);
    const rows = result.users.map(user => ({
      uid: user.uid, email: user.email || '', name: user.displayName || user.providerData[0]?.displayName || '',
      photo_url: user.photoURL || user.providerData[0]?.photoURL || '',
      first_seen_at: user.metadata.creationTime,
      last_seen_at: user.metadata.lastSignInTime || user.metadata.creationTime,
    }));
    if (rows.length) {
      // Existing rows carry app activity newer than Firebase's sign-in timestamp.
      const { error } = await adminDb.from('app_users').upsert(rows, {onConflict:'uid', ignoreDuplicates:true});
      if (error) throw error;
    }
    token = result.pageToken;
  } while (token);
  syncedAt = Date.now();
}

export async function syncDirectory() {
  if (Date.now() - syncedAt < 300000) return '';
  if (!pending) pending = importMissingProfiles().finally(() => { pending = undefined; });
  try { await pending; return ''; }
  catch { return 'Showing locally recorded profiles. Check Firebase Admin credentials, project ID and permission to list Authentication users to include older accounts.'; }
}
