import { useEffect, useState } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt?: string;
}

async function ensureUserProfile(user: User): Promise<void> {
  if (!db) return;
  try {
    const ref = doc(db, 'users', user.uid);
    // 1-second timeout guard so login is never stalled by Firestore
    const snap = await Promise.race([
      getDoc(ref),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
    ]);

    if (!snap.exists()) {
      const profile: UserProfile = {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        createdAt: new Date().toISOString(),
      };
      await setDoc(ref, profile);
    } else if (user.displayName || user.photoURL) {
      await updateDoc(ref, {
        displayName: user.displayName || snap.data().displayName || '',
        photoURL: user.photoURL || snap.data().photoURL || '',
      });
    }
  } catch (err) {
    // Gracefully ignore Firestore user profile sync failure when offline / disabled
  }
}

export async function signInWithGoogle(): Promise<User> {
  if (!auth) {
    throw new Error('Login is not configured on this deployment yet.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  try {
    await ensureUserProfile(result.user);
  } catch (e) {
    console.error('[authService] Failed to sync user profile:', e);
  }
  return result.user;
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

/**
 * Safe replacement for react-firebase-hooks' useAuthState: that hook reads
 * `auth.currentUser` synchronously, which throws if `auth` is null (i.e. when
 * Firebase env vars aren't configured on this deployment).
 */
export function useCurrentUser(): [User | null, boolean] {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!auth);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(
      auth,
      (u) => {
        setUser(u);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsubscribe;
  }, []);

  return [user, loading];
}
