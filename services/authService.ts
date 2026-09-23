import { useEffect, useState } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { supabase } from './supabase';

export interface User {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt?: string;
}

/**
 * Syncs the Firebase authenticated user into Supabase's public.users table.
 */
async function ensureUserProfileInSupabase(user: User): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from('users')
      .upsert(
        {
          id: user.uid,
          email: user.email || '',
          display_name: user.displayName || '',
          photo_url: user.photoURL || '',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
  } catch (err) {
    // Non-fatal background sync
  }
}

/**
 * Sign in using Firebase Google Popup Auth
 */
export async function signInWithGoogle(): Promise<User> {
  if (!auth) {
    throw new Error('Firebase Auth is not configured on this deployment.');
  }

  const result = await signInWithPopup(auth, googleProvider);
  const appUser: User = {
    uid: result.user.uid,
    email: result.user.email,
    displayName: result.user.displayName,
    photoURL: result.user.photoURL,
  };

  ensureUserProfileInSupabase(appUser).catch(() => {});
  return appUser;
}

/**
 * Sign out from Firebase Auth
 */
export async function signOutUser(): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('[authService] Sign out warning:', err);
  }
}

/**
 * Hook to listen to Firebase Auth state changes while syncing with Supabase data layer.
 */
export function useCurrentUser(): [User | null, boolean] {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(!!auth);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (u: FirebaseUser | null) => {
        if (u) {
          const appUser: User = {
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL,
          };
          setUser(appUser);
          ensureUserProfileInSupabase(appUser).catch(() => {});
        } else {
          setUser(null);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );

    return unsubscribe;
  }, []);

  return [user, loading];
}
