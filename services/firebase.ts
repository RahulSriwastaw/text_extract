import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const env = (import.meta as any).env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Login & cloud history are optional features: a missing/invalid config must
// never crash the whole app (Firebase's SDK throws synchronously on
// getAuth()/getFirestore() when the API key is missing or malformed), so
// every step here is defensive and falls back to `null`.
export const isFirebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

if (!isFirebaseConfigured && typeof window !== 'undefined') {
  console.warn('[firebase] VITE_FIREBASE_* env vars are missing. Login & cloud history will not work until they are set.');
}

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

try {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
} catch (e) {
  console.error('[firebase] Initialization failed, login & cloud history disabled:', e);
  app = null;
  authInstance = null;
  dbInstance = null;
}

export const auth = authInstance;
export const db = dbInstance;
export const googleProvider = new GoogleAuthProvider();
