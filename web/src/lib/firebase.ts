/**
 * Lazy Firebase. Nothing initialises at import time, so pages that never touch Firestore (/login, /map/demo,
 * /erp) render even without web/.env.local. The first db()/storage()/auth()/signedIn() call initialises the app
 * and throws (or rejects) a FirebaseConfigError if the config is missing; callers surface that as a toast.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth, type User } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { firebaseConfigFrom } from "./firebaseConfig";

interface Firebase {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly db: Firestore;
  readonly storage: FirebaseStorage;
}

let instance: Firebase | null = null;

/** The initialised SDK handles; throws FirebaseConfigError when web/.env.local is missing. */
export function fb(): Firebase {
  if (instance) return instance;
  const app = initializeApp(firebaseConfigFrom(import.meta.env));
  instance = { app, auth: getAuth(app), db: getFirestore(app), storage: getStorage(app) };
  return instance;
}

export const db = (): Firestore => fb().db;
export const storage = (): FirebaseStorage => fb().storage;
export const auth = (): Auth => fb().auth;

let signIn: Promise<User> | null = null;

/** Resolves once signed in (anonymous by default). Memoised; a failed attempt (e.g. missing config) can be retried. */
export function signedIn(): Promise<User> {
  signIn ??= new Promise<User>((resolve, reject) => {
    const a = auth();
    onAuthStateChanged(a, (u) => {
      if (u) resolve(u);
      else signInAnonymously(a).catch(reject);
    }, reject);
  }).catch((e: unknown) => {
    signIn = null;
    throw e;
  });
  return signIn;
}
