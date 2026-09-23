import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';

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

export const isFirebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    authInstance = getAuth(app);
  } catch (e) {
    console.error('[firebase] Auth initialization failed:', e);
    app = null;
    authInstance = null;
  }
}

export const auth = authInstance;
export const googleProvider = new GoogleAuthProvider();
