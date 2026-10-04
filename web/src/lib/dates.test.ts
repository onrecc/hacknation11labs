/** cd web && node --import tsx --test src/lib/dates.test.ts */
process.env.TZ = "Europe/Berlin"; // CEST in October: UTC+2, before any Date is built
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, localDate, whenLabel } from "./dates";

test("localDate uses the local calendar day, not UTC", () => {
  // 00:30 CEST on Oct 4 is still Oct 3 in UTC: toISOString() would say 2026-10-03
  const justAfterMidnight = new Date("2026-10-03T22:30:00Z");
  assert.equal(justAfterMidnight.toISOString().slice(0, 10), "2026-10-03");
  assert.equal(localDate(justAfterMidnight), "2026-10-04");
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("dayLabel says Today / Yesterday, else a short date", () => {
  const now = new Date(2026, 9, 4, 0, 30);
  assert.equal(dayLabel("2026-10-04", now), "Today");
  assert.equal(dayLabel("2026-10-03", now), "Yesterday");
  assert.equal(dayLabel("2026-09-28", now), "Mon 28 Sep");
  assert.equal(dayLabel("2025-12-24", now), "Wed 24 Dec 2025");
  assert.equal(dayLabel("not a date", now), "not a date");
});

test("whenLabel adds the local time of day", () => {
  const now = new Date(2026, 9, 4, 9, 0);
  assert.equal(whenLabel(new Date(2026, 9, 4, 8, 5).toISOString(), now), "Today 08:05");
  assert.equal(whenLabel(new Date(2026, 9, 3, 17, 40).toISOString(), now), "Yesterday 17:40");
  assert.equal(whenLabel(new Date(2026, 8, 30, 12, 0).toISOString(), now), "Wed 30 Sep 12:00");
  assert.equal(whenLabel("2026-10-01garbage", now), "2026-10-01");
});
