import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { auth } from './config';

export const authApi = {
  signIn: (email: string, password: string) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => fbSignOut(auth),
  onChange: (cb: (u: User | null) => void) => onAuthStateChanged(auth, cb),
};

export type { User };
