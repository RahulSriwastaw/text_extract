import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const env = (import.meta as any).env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyCYvErb-DoHudBer1mtei-sBljylPwSQSQ',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'text-extract-8210e.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'text-extract-8210e',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'text-extract-8210e.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '63551214682',
  appId: env.VITE_FIREBASE_APP_ID || '1:63551214682:web:4dbc3072dcd485d6d7b463',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-69SY45RXVB',
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
