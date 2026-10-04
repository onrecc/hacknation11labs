import { test } from "node:test";
import assert from "node:assert/strict";
import { FirebaseConfigError, firebaseConfigFrom } from "./firebaseConfig";

const FULL = {
  VITE_FIREBASE_API_KEY: "k",
  VITE_FIREBASE_AUTH_DOMAIN: "d",
  VITE_FIREBASE_PROJECT_ID: "p",
  VITE_FIREBASE_STORAGE_BUCKET: "b",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "m",
  VITE_FIREBASE_APP_ID: "a",
};

test("maps the VITE_FIREBASE_* env vars to Firebase options", () => {
  // Arrange / Act
  const cfg = firebaseConfigFrom(FULL);

  // Assert
  assert.deepEqual(cfg, { apiKey: "k", authDomain: "d", projectId: "p", storageBucket: "b", messagingSenderId: "m", appId: "a" });
});

test("throws a FirebaseConfigError naming the missing keys", () => {
  // Arrange
  const env = { ...FULL, VITE_FIREBASE_API_KEY: "", VITE_FIREBASE_PROJECT_ID: undefined };

  // Act / Assert
  assert.throws(() => firebaseConfigFrom(env), (e: unknown) => {
    assert.ok(e instanceof FirebaseConfigError);
    assert.deepEqual(e.missing, ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID"]);
    assert.match(e.message, /web\/\.env\.local/);
    return true;
  });
});

test("throws when no env is set at all", () => {
  assert.throws(() => firebaseConfigFrom({}), FirebaseConfigError);
});
