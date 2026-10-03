import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import config from "./firebase-config.json";

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
