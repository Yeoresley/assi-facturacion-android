import type { LegalImageSnapshot } from "@workspace/db";

export function captureLegalImageSnapshot(
  stampPath: string | null | undefined,
  signaturePath: string | null | undefined,
): LegalImageSnapshot {
  return {
    stampPath: stampPath ?? null,
    signaturePath: signaturePath ?? null,
  };
}

export function resolveLegalImageSnapshot(
  invoiceSnapshot: LegalImageSnapshot | null | undefined,
  currentSnapshot: LegalImageSnapshot,
): LegalImageSnapshot {
  return invoiceSnapshot ?? currentSnapshot;
}

export function hasCompleteLegalImageSnapshot(snapshot: LegalImageSnapshot): boolean {
  return Boolean(snapshot.stampPath && snapshot.signaturePath);
}
