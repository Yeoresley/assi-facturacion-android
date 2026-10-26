import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureLegalImageSnapshot,
  hasCompleteLegalImageSnapshot,
  resolveLegalImageSnapshot,
} from "./invoice-legal-images";

test("invoice image snapshots keep the asset versions that existed at creation", () => {
  const original = captureLegalImageSnapshot("/objects/legal/stamp-v1.png", "/objects/legal/signature-v1.png");
  const replaced = captureLegalImageSnapshot("/objects/legal/stamp-v2.png", "/objects/legal/signature-v2.png");

  assert.deepEqual(resolveLegalImageSnapshot(original, replaced), original);
  assert.equal(hasCompleteLegalImageSnapshot(original), true);
});

test("invoice created before images are configured does not inherit a later replacement", () => {
  const emptyAtCreation = captureLegalImageSnapshot(null, null);
  const laterConfiguration = captureLegalImageSnapshot("/objects/legal/stamp.png", "/objects/legal/signature.png");

  assert.deepEqual(resolveLegalImageSnapshot(emptyAtCreation, laterConfiguration), emptyAtCreation);
  assert.equal(hasCompleteLegalImageSnapshot(emptyAtCreation), false);
});

test("legacy invoices without an image snapshot continue using the current version", () => {
  const active = captureLegalImageSnapshot("/objects/legal/stamp.png", "/objects/legal/signature.png");
  assert.deepEqual(resolveLegalImageSnapshot(undefined, active), active);
});
