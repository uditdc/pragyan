import test from "node:test";
import assert from "node:assert/strict";
import { acquire, note429 } from "./budget.ts";
import { config } from "./config.ts";

// Module state is shared across this file's tests (node runs each file in its own
// process), so these run in a deliberate order.

test("allows up to rpm requests per minute then blocks", () => {
  let granted = 0;
  for (let i = 0; i < config.llm.limits.rpm + 3; i++) {
    if (acquire("scorer", 10)) granted++;
  }
  assert.equal(granted, config.llm.limits.rpm);
});

test("blocks a request whose estimate exceeds the per-minute token cap", () => {
  assert.equal(acquire("summary", config.llm.limits.tpm + 1), false);
});

test("note429 parks all consumers", () => {
  note429(10_000);
  assert.equal(acquire("summary", 1), false);
});
