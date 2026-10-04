/** Firebase web config from Vite env (web/.env.local, gitignored). Pure, so it is testable without the SDK. */

export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
}

const KEYS = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  appId: "VITE_FIREBASE_APP_ID",
} as const satisfies Record<keyof FirebaseWebConfig, string>;

/** Only these are strictly required to talk to Firestore/Auth/Storage. */
const REQUIRED: ReadonlyArray<keyof FirebaseWebConfig> = ["apiKey", "projectId"];

export class FirebaseConfigError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(`Firebase config missing (${missing.join(", ")}): copy web/.env.example to web/.env.local (or run \`npm run setup -w tools\`).`);
    this.name = "FirebaseConfigError";
    this.missing = missing;
  }
}

export function firebaseConfigFrom(env: Readonly<Record<string, string | undefined>>): FirebaseWebConfig {
  const missing = REQUIRED.filter((k) => !env[KEYS[k]]).map((k) => KEYS[k]);
  if (missing.length) throw new FirebaseConfigError(missing);
  const read = (k: keyof FirebaseWebConfig): string => env[KEYS[k]] ?? "";
  return {
    apiKey: read("apiKey"),
    authDomain: read("authDomain"),
    projectId: read("projectId"),
    storageBucket: read("storageBucket"),
    messagingSenderId: read("messagingSenderId"),
    appId: read("appId"),
  };
}
