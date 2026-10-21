import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  db, invoicePaymentCorrectionsTable, invoicePaymentsTable, invoicesTable, type Invoice,
} from "@workspace/db";
import type { CurrentTeamMember } from "../middlewares/team-access";
import { acceptanceFromWorkflowEvent } from "./invoice-status";

export const collectibleStatuses = ["finished", "accepted", "confirmed", "sent", "paid"] as const;

export function paymentStatus(invoice: Pick<Invoice, "status" | "paymentStatus">): "pending" | "paid" {
  // Preserve historical payment records without treating acceptance/import as payment.
  return invoice.status === "paid" ? "paid" : invoice.paymentStatus;
}

export function canRecordPayment(invoice: Pick<Invoice, "status" | "paymentStatus">): boolean {
  return paymentStatus(invoice) === "pending" && (collectibleStatuses as readonly string[]).includes(invoice.status);
}

export function cents(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  const result = Math.round(value * 100);
  return Number.isSafeInteger(result) && Math.abs(result / 100 - value) < 1e-7 ? result : NaN;
}

export function validPaymentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function summarizePayments(invoice: Pick<Invoice, "id" | "status" | "paymentStatus" | "total">,
  payments: Array<Pick<typeof invoicePaymentsTable.$inferSelect, "id" | "amount" | "currency" | "paidOn" | "recordedAt" | "reference" | "paymentMethod">>,
  corrections: Array<typeof invoicePaymentCorrectionsTable.$inferSelect> = []) {
  const reversedPaymentIds = new Set(corrections.flatMap(({ reversedPaymentId }) =>
    reversedPaymentId === null ? [] : [reversedPaymentId]));
  const activePayments = payments.filter((payment) => !reversedPaymentIds.has(payment.id));
  const correctedPayments = new Map([...corrections].sort((a, b) => a.id - b.id).flatMap((correction) =>
    correction.targetPaymentId === null ? [] : [[correction.targetPaymentId, correction] as const]));
  const recordedCents = activePayments.reduce((sum, payment) => {
    const correction = correctedPayments.get(payment.id);
    return sum + cents(correction?.afterPaymentAmount ?? payment.amount);
  }, 0);
  // Legacy records marked paid before the payment ledger existed remain settled, without a fake receipt.
  const totalPaidCents = invoice.status === "paid" || invoice.paymentStatus === "paid"
    ? cents(invoice.total)
    : Math.min(recordedCents, cents(invoice.total));
  return {
    paymentStatus: invoice.status === "paid" || invoice.paymentStatus === "paid" ||
      totalPaidCents >= cents(invoice.total) ? "paid" as const : "pending" as const,
    totalPaid: totalPaidCents / 100,
    balanceDue: Math.max(0, cents(invoice.total) - totalPaidCents) / 100,
    payments: payments.map(({ id, amount, currency, paidOn, recordedAt, reference, paymentMethod }) => ({
      id, amount, currency, paidOn, recordedAt: recordedAt.toISOString(), reference, paymentMethod,
    })),
    paymentCorrections: corrections.map((correction) => ({
      ...correction,
      createdAt: correction.createdAt.toISOString(),
      originalPaidAt: correction.originalPaidAt?.toISOString() ?? null,
    })),
  };
}

export function paymentFilter(status: "pending" | "partial" | "paid") {
  if (status === "paid") {
    return or(eq(invoicesTable.paymentStatus, "paid"), eq(invoicesTable.status, "paid"))!;
  }

  const collectiblePending = and(
    inArray(invoicesTable.status, [...collectibleStatuses]),
    ne(invoicesTable.status, "paid"),
    eq(invoicesTable.paymentStatus, "pending"),
  )!;
  if (status === "pending") return collectiblePending;

  const activePaymentSum = sql<number>`(
    SELECT COALESCE(SUM(COALESCE((
      SELECT correction.after_payment_amount
      FROM invoice_payment_corrections AS correction
      WHERE correction.target_payment_id = ${invoicePaymentsTable.id}
      ORDER BY correction.id DESC
      LIMIT 1
    ), ${invoicePaymentsTable.amount})), 0)
    FROM ${invoicePaymentsTable}
    WHERE ${invoicePaymentsTable.invoiceId} = ${invoicesTable.id}
      AND NOT EXISTS (
        SELECT 1
        FROM ${invoicePaymentCorrectionsTable}
        WHERE ${invoicePaymentCorrectionsTable.reversedPaymentId} = ${invoicePaymentsTable.id}
      )
  )`;
  return and(
    collectiblePending,
    sql`EXISTS (
      SELECT 1
      FROM ${invoicePaymentsTable}
      WHERE ${invoicePaymentsTable.invoiceId} = ${invoicesTable.id}
        AND NOT EXISTS (
          SELECT 1
          FROM ${invoicePaymentCorrectionsTable}
          WHERE ${invoicePaymentCorrectionsTable.reversedPaymentId} = ${invoicePaymentsTable.id}
        )
    )`,
    sql`${activePaymentSum} > 0`,
    sql`${activePaymentSum} < ${invoicesTable.total}`,
  )!;
}

export class InvoicePaymentError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function recordInvoicePayment(
  id: number,
  input: {
    amount: number;
    paidOn: string;
    idempotencyKey: string;
    reference?: string;
    paymentMethod?: "transfer" | "cash" | "other";
  },
  actor: Pick<CurrentTeamMember, "role" | "userId">,
) {
  if (actor.role !== "owner") throw new InvoicePaymentError("Solo el administrador puede registrar abonos.", 403);
  const amountCents = cents(input.amount);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new InvoicePaymentError("El importe debe ser positivo y tener como máximo dos decimales.", 422);
  }
  if (!validPaymentDate(input.paidOn)) throw new InvoicePaymentError("Indica una fecha de pago válida.", 422);
  const reference = input.reference?.trim() || null;
  const paymentMethod = input.paymentMethod ?? null;
  if (reference && reference.length > 120) {
    throw new InvoicePaymentError("La referencia no puede superar 120 caracteres.", 422);
  }
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
    if (!invoice) throw new InvoicePaymentError("Factura no encontrada.", 404);
    const [duplicate] = await tx.select().from(invoicePaymentsTable).where(and(
      eq(invoicePaymentsTable.invoiceId, id),
      eq(invoicePaymentsTable.idempotencyKey, input.idempotencyKey),
    ));
    const corrections = await tx.select().from(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.invoiceId, id))
      .orderBy(invoicePaymentCorrectionsTable.id);
    if (duplicate) {
      if (cents(duplicate.amount) !== amountCents || duplicate.paidOn !== input.paidOn ||
          duplicate.reference !== reference || duplicate.paymentMethod !== paymentMethod) {
        throw new InvoicePaymentError("Esta solicitud ya se usó para otro abono.", 409);
      }
      const entries = await tx.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id));
      return { ...summarizePayments(invoice, entries, corrections), created: false };
    }
    if (!canRecordPayment(invoice)) {
      throw new InvoicePaymentError("Solo puedes registrar abonos de una factura terminada, aceptada o confirmada. No se admiten borradores, anuladas, canceladas ni facturas con error.", 409);
    }
    const entries = await tx.select().from(invoicePaymentsTable).where(eq(invoicePaymentsTable.invoiceId, id));
    const alreadyPaidCents = cents(summarizePayments(invoice, entries, corrections).totalPaid);
    const totalCents = cents(invoice.total);
    if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new InvoicePaymentError("El total de la factura no es válido.", 409);
    const remainingCents = Math.max(0, totalCents - alreadyPaidCents);
    if (paymentStatus(invoice) === "paid" || remainingCents === 0) {
      throw new InvoicePaymentError("La factura ya está pagada por completo.", 409);
    }
    if (amountCents > remainingCents) {
      throw new InvoicePaymentError(`El abono supera el saldo pendiente de ${(remainingCents / 100).toFixed(2)} ${invoice.currency}.`, 422);
    }
    const nextPaidCents = alreadyPaidCents + amountCents;
    const [payment] = await tx.insert(invoicePaymentsTable).values({
      invoiceId: id, idempotencyKey: input.idempotencyKey,
      amount: amountCents / 100, currency: invoice.currency, paidOn: input.paidOn,
      paidBy: actor.userId, reference, paymentMethod,
    }).returning();
    const nextPayments = [...entries, payment];
    const acceptance = acceptanceFromWorkflowEvent(invoice, actor.userId);
    const invoiceUpdate = {
      ...acceptance,
      ...(nextPaidCents === totalCents ? {
        paymentStatus: "paid" as const, paidAt: new Date(), paidBy: actor.userId,
      } : {}),
    };
    if (Object.keys(invoiceUpdate).length) {
      await tx.update(invoicesTable).set(invoiceUpdate).where(eq(invoicesTable.id, id));
    }
    return { ...summarizePayments(
      {
        ...invoice, ...acceptance,
        paymentStatus: nextPaidCents === totalCents ? "paid" : invoice.paymentStatus,
      },
      nextPayments,
      corrections,
    ), created: true };
  });
}

export async function correctInvoicePayment(
  id: number,
  input: {
    paymentId?: number;
    amount?: number;
    paidOn?: string;
    reason: string;
    idempotencyKey: string;
    confirmed: boolean;
  },
  actor: Pick<CurrentTeamMember, "role" | "userId">,
) {
  if (actor.role !== "owner") throw new InvoicePaymentError("Solo el administrador puede corregir un pago.", 403);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw new InvoicePaymentError("El motivo debe tener entre 5 y 1000 caracteres.", 422);
  }
  if (input.confirmed !== true) throw new InvoicePaymentError("Confirma explícitamente la corrección.", 422);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new InvoicePaymentError("La clave de corrección no es válida.", 422);
  }
  const hasAmount = input.amount !== undefined;
  const hasPaidOn = input.paidOn !== undefined;
  if ((input.paymentId === undefined && (hasAmount || hasPaidOn)) ||
      (input.paymentId !== undefined && (!hasAmount || !hasPaidOn))) {
    throw new InvoicePaymentError("Selecciona un abono e indica su importe y fecha corregidos.", 422);
  }
  const correctedAmountCents = input.amount === undefined ? null : cents(input.amount);
  if (correctedAmountCents !== null &&
      (!Number.isSafeInteger(correctedAmountCents) || correctedAmountCents < 0)) {
    throw new InvoicePaymentError("El importe corregido debe ser igual o mayor que cero y tener como máximo dos decimales.", 422);
  }
  if (input.paidOn !== undefined && !validPaymentDate(input.paidOn)) {
    throw new InvoicePaymentError("Indica una fecha de pago válida.", 422);
  }

  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
    if (!invoice) throw new InvoicePaymentError("Factura no encontrada.", 404);

    const [previousRequest] = await tx.select().from(invoicePaymentCorrectionsTable).where(and(
      eq(invoicePaymentCorrectionsTable.invoiceId, id),
      eq(invoicePaymentCorrectionsTable.idempotencyKey, input.idempotencyKey),
    ));
    const entries = await tx.select().from(invoicePaymentsTable)
      .where(eq(invoicePaymentsTable.invoiceId, id));
    const corrections = await tx.select().from(invoicePaymentCorrectionsTable)
      .where(eq(invoicePaymentCorrectionsTable.invoiceId, id))
      .orderBy(invoicePaymentCorrectionsTable.id);
    if (previousRequest) {
      if (previousRequest.reason !== reason ||
          previousRequest.targetPaymentId !== (input.paymentId ?? null) ||
          (input.paymentId !== undefined &&
            (previousRequest.afterPaymentAmount !== input.amount || previousRequest.afterPaidOn !== input.paidOn))) {
        throw new InvoicePaymentError("Esta solicitud ya se usó para otra corrección.", 409);
      }
      return { ...summarizePayments(invoice, entries, corrections), created: false };
    }

    const before = summarizePayments(invoice, entries, corrections);
    const reversedPaymentIds = new Set(corrections.flatMap(({ reversedPaymentId }) =>
      reversedPaymentId === null ? [] : [reversedPaymentId]));
    let beforePaymentAmount: number | null = null;
    let beforePaidOn: string | null = null;
    const targetedPayment = input.paymentId === undefined
      ? undefined
      : entries.find((payment) => payment.id === input.paymentId);
    if (input.paymentId !== undefined && !targetedPayment) {
      throw new InvoicePaymentError("El abono seleccionado no pertenece a esta factura.", 404);
    }
    if (targetedPayment) {
      const alreadyReversed = corrections.some((correction) =>
        correction.reversedPaymentId === targetedPayment.id);
      if (alreadyReversed) throw new InvoicePaymentError("Este abono ya no está activo.", 409);
      if (reversedPaymentIds.has(targetedPayment.id)) {
        throw new InvoicePaymentError("Este abono ya no está activo.", 409);
      }
      const previousTargetCorrection = [...corrections].sort((a, b) => b.id - a.id)
        .find((correction) => correction.targetPaymentId === targetedPayment.id);
      beforePaymentAmount = previousTargetCorrection?.afterPaymentAmount ?? targetedPayment.amount;
      beforePaidOn = previousTargetCorrection?.afterPaidOn ?? targetedPayment.paidOn;
      const otherActiveCents = entries.reduce((sum, payment) => {
        if (payment.id === targetedPayment.id || reversedPaymentIds.has(payment.id)) return sum;
        const previousCorrection = [...corrections].sort((a, b) => b.id - a.id)
          .find((correction) => correction.targetPaymentId === payment.id);
        return sum + cents(previousCorrection?.afterPaymentAmount ?? payment.amount);
      }, 0);
      const totalCents = cents(invoice.total);
      if (!Number.isSafeInteger(totalCents) || totalCents < 0 ||
          otherActiveCents + correctedAmountCents! > totalCents) {
        throw new InvoicePaymentError("El importe corregido supera el total de la factura.", 422);
      }
      if (correctedAmountCents === cents(beforePaymentAmount) && input.paidOn === beforePaidOn) {
        throw new InvoicePaymentError("El abono ya tiene ese importe y esa fecha.", 422);
      }
    } else if (paymentStatus(invoice) !== "paid" || entries.length > 0) {
      throw new InvoicePaymentError("Selecciona el abono concreto que quieres corregir.", 409);
    }

    const afterInvoiceStatus = invoice.status === "paid"
      ? invoice.confirmedAt ? "confirmed" : invoice.acceptedAt ? "accepted" : "sent"
      : invoice.status;
    const afterInvoice = {
      ...invoice,
      status: afterInvoiceStatus as Invoice["status"],
      paymentStatus: "pending" as const,
    };
    const [correction] = await tx.insert(invoicePaymentCorrectionsTable).values({
      invoiceId: id,
      idempotencyKey: input.idempotencyKey,
      reason,
      correctedBy: actor.userId,
      targetPaymentId: targetedPayment?.id ?? null,
      reversedPaymentId: null,
      beforePaymentAmount,
      afterPaymentAmount: correctedAmountCents === null ? null : correctedAmountCents / 100,
      beforePaidOn,
      afterPaidOn: input.paidOn ?? null,
      beforeInvoiceStatus: invoice.status,
      afterInvoiceStatus,
      beforePaymentStatus: paymentStatus(invoice),
      afterPaymentStatus: "pending",
      beforeTotalPaid: before.totalPaid,
      afterTotalPaid: 0,
      originalPaidBy: targetedPayment?.paidBy ?? invoice.paidBy,
      originalPaidAt: targetedPayment?.recordedAt ?? invoice.paidAt,
    }).returning();
    const after = summarizePayments(afterInvoice, entries, [...corrections, correction]);
    await tx.update(invoicePaymentCorrectionsTable).set({
      afterPaymentStatus: after.paymentStatus,
      afterTotalPaid: after.totalPaid,
    }).where(eq(invoicePaymentCorrectionsTable.id, correction.id));
    const savedCorrection = { ...correction, afterPaymentStatus: after.paymentStatus, afterTotalPaid: after.totalPaid };
    await tx.update(invoicesTable).set({
      status: afterInvoiceStatus,
      paymentStatus: after.paymentStatus,
      paidBy: after.paymentStatus === "paid" ? invoice.paidBy ?? actor.userId : null,
      paidAt: after.paymentStatus === "paid" ? invoice.paidAt ?? new Date() : null,
    }).where(eq(invoicesTable.id, id));
    return {
      ...summarizePayments(
        { ...afterInvoice, paymentStatus: after.paymentStatus },
        entries,
        [...corrections, savedCorrection],
      ),
      created: true,
    };
  });
}
