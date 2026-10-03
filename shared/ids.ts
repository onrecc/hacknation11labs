/** Sortable unique ids: `${prefix}_${ULID}` (time-ordered, 26 chars). */
const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ENC[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  let r = "";
  for (const b of rnd) r += ENC[b % 32];
  return time + r;
}

export const newId = (prefix: string) => `${prefix}_${ulid()}`;
