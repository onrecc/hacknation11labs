import { test } from "node:test";
import assert from "node:assert/strict";
import { createToastStore, errorMessage, MAX_TOASTS } from "./toast";

test("show adds a toast and notifies subscribers with a new array", () => {
  // Arrange
  const store = createToastStore();
  const before = store.snapshot();
  let calls = 0;
  store.subscribe(() => calls++);

  // Act
  const id = store.show({ message: "Couldn't load" });

  // Assert
  assert.equal(calls, 1);
  assert.notEqual(store.snapshot(), before);
  assert.deepEqual(store.snapshot().map((t) => [t.id, t.message]), [[id, "Couldn't load"]]);
});

test("dismiss removes only that toast", () => {
  const store = createToastStore();
  const a = store.show({ message: "a" });
  const b = store.show({ message: "b" });

  store.dismiss(a);

  assert.deepEqual(store.snapshot().map((t) => t.id), [b]);
});

test("the same message replaces the older toast instead of stacking", () => {
  const store = createToastStore();
  store.show({ message: "offline" });
  const second = store.show({ message: "offline" });

  assert.deepEqual(store.snapshot().map((t) => t.id), [second]);
});

test(`keeps at most ${MAX_TOASTS} toasts, dropping the oldest`, () => {
  const store = createToastStore();
  const ids = Array.from({ length: MAX_TOASTS + 2 }, (_, i) => store.show({ message: `m${i}` }));

  assert.deepEqual(store.snapshot().map((t) => t.id), ids.slice(-MAX_TOASTS));
});

test("retry dismisses the toast and runs the action", async () => {
  // Arrange
  const store = createToastStore();
  let ran = 0;
  const id = store.show({ message: "failed", retry: () => void ran++ });

  // Act
  await store.retry(id);

  // Assert
  assert.equal(ran, 1);
  assert.equal(store.snapshot().length, 0);
});

test("a retry that fails again shows the toast again instead of rejecting", async () => {
  // Arrange
  const store = createToastStore();
  const retry = () => Promise.reject(new Error("still offline"));
  const id = store.show({ message: "Couldn't start Ada's voice", retry });

  // Act
  await store.retry(id);

  // Assert
  const [t] = store.snapshot();
  assert.equal(store.snapshot().length, 1);
  assert.equal(t?.message, "Couldn't start Ada's voice");
  assert.equal(t?.retry, retry);
});

test("retry on an unknown id is a no-op", async () => {
  const store = createToastStore();
  await store.retry(42);
  assert.equal(store.snapshot().length, 0);
});

test("unsubscribe stops notifications", () => {
  const store = createToastStore();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  off();
  store.show({ message: "x" });
  assert.equal(calls, 0);
});

test("errorMessage reads Error, string and unknown values", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage({ weird: true }), "Something went wrong.");
  assert.equal(errorMessage(new Error("")), "Something went wrong.");
});
