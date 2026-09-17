import { signInWithPopup, signOut, User } from 'firebase/auth';
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
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

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
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  try {
    await ensureUserProfile(result.user);
  } catch (e) {
    console.error('[authService] Failed to sync user profile:', e);
  }
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
