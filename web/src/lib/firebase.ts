import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// Config comes from web/.env.local (gitignored), never from the repo.
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
if (!config.apiKey) throw new Error("Firebase config missing: copy web/.env.example to web/.env.local (or run `npm run setup -w tools`)");

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/** Resolves once signed in (anonymous by default; swap for Google sign-in for the team if you like). */
export const signedIn: Promise<User> = new Promise((resolve, reject) => {
  onAuthStateChanged(auth, (u) => {
    if (u) resolve(u);
    else signInAnonymously(auth).catch(reject);
  });
});
