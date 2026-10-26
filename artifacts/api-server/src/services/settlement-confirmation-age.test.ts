import assert from "node:assert/strict";
import { test } from "node:test";
import {
  settlementConfirmationAge,
  VERSAT_CONFIRMATION_WARNING_DAYS,
} from "./settlement-confirmation-age";

test("counts elapsed calendar days without timezone or time-of-day drift", () => {
  assert.deepEqual(
    settlementConfirmationAge("2026-10-19", new Date("2026-10-26T00:15:00-04:00")),
    { confirmationAgeDays: 7, confirmationOverdue: true },
  );
});

test("does not flag an invoice before the seven-day warning threshold", () => {
  assert.deepEqual(
    settlementConfirmationAge("2026-10-20", new Date("2026-10-26T12:00:00Z")),
    { confirmationAgeDays: 6, confirmationOverdue: false },
  );
});

test("keeps the displayed waiting age non-negative for a payment dated today", () => {
  assert.deepEqual(
    settlementConfirmationAge("2026-10-26", new Date("2026-10-26T23:59:00Z")),
    { confirmationAgeDays: 0, confirmationOverdue: false },
  );
  assert.equal(VERSAT_CONFIRMATION_WARNING_DAYS, 7);
});
