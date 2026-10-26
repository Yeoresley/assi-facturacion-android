import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCustomerBody,
  CreateCustomerResponse,
  CreateInvoiceBody,
  CreateInvoiceReceiptShareParams,
  CreateInvoiceResponse,
  CreateInvoiceShareParams,
  CreateInvoiceShareResponse,
  ListInvoiceSharesParams,
  ListInvoiceSharesResponse,
  RevokeInvoiceShareParams,
  DeleteCustomerParams,
  GetInvoiceParams,
  GetInvoiceResponse,
  GetInvoiceAcceptanceNotificationParams,
  GetInvoiceAcceptanceNotificationResponse,
  GetSharedInvoiceParams,
  GetSharedInvoiceResponse,
  GetSharedInvoiceReceiptParams,
  GetSharedInvoiceReceiptResponse,
  InviteTeamMemberBody,
  GetBillingOverviewResponse,
  GetPaymentMethodSummaryQueryParams,
  GetPaymentMethodSummaryResponse,
  ListCustomersQueryParams,
  ListCustomersResponse,
  ListInvoicesQueryParams,
  ListInvoicesResponse,
  ListOwnerInvoiceAssignmentReviewsResponse,
  AssignOwnerInvoiceToSpecialistBody,
  AssignOwnerInvoiceToSpecialistParams,
  AssignOwnerInvoiceToSpecialistResponse,
  ListInvoiceAcceptanceNotificationsResponse,
  ListTeamMembersResponse,
  UpdateCustomerBody,
  UpdateCustomerParams,
  UpdateCustomerResponse,
  UpdateInvoiceBody,
  UpdateInvoiceParams,
  UpdateInvoiceResponse,
  UpdateInvoiceStatusBody,
  UpdateInvoiceStatusParams,
  UpdateInvoiceStatusResponse,
  GetCurrentTeamMemberResponse,
  CreateInvoicePaymentParams,
  CreateInvoicePaymentBody,
  CreateInvoicePaymentResponse,
  CorrectInvoicePaymentParams,
  CorrectInvoicePaymentBody,
  CorrectInvoicePaymentResponse,
  DownloadInvoicePaymentCorrectionsParams,
  DownloadInvoicePaymentCorrectionsResponse,
  UpdateTeamMemberAccessBody,
  UpdateTeamMemberAccessParams,
  MarkInvoiceAcceptanceNotificationReadParams,
  MarkInvoiceAcceptanceNotificationReadResponse,
} from "@workspace/api-zod";
import {
  customersTable,
  db,
  invoiceAcceptanceNotificationsTable,
  invoiceLinesTable,
  invoicePaymentsTable,
  invoicePaymentCorrectionsTable,
  invoiceSharesTable,
  invoicesTable,
  issuerSettingsTable,
  teamInvitationsTable,
  teamMembersTable,
} from "@workspace/db";
import { resolveTeamMember, requireOwner, setTeamMemberSuspension, TeamAccessError, type CurrentTeamMember } from "../middlewares/team-access";
import { dateQuery, getInvoiceRow, getInvoiceRows, serializeInvoice, toDateOnly } from "../services/invoice-records";
import { activeInvoicePayments } from "../services/invoice-receipts";
import { prepareInvoice } from "../services/prepare-invoice";
import { activeInvoiceShare, canAccessInvoice, getActiveInvoiceShare, invoiceScope } from "../services/invoice-access";
import { versatCatalogTable } from "@workspace/db";
import seriesRouter from "./invoice-series";
import { lockNumbering, NumberingError, reserveNumber, validateSeriesSelection } from "../services/invoice-numbering";
import { transitionInvoice } from "../services/issue-invoice";
import {
  correctInvoicePayment, recordInvoicePayment, InvoicePaymentError, paymentFilter, summarizePaymentsByMethod, validPaymentDate,
} from "../services/invoice-payment";
import { outstandingByCurrency } from "../services/invoice-outstanding";
import { captureLegalImageSnapshot } from "../services/invoice-legal-images";

const router: IRouter = Router();
router.use(seriesRouter);
const shareTtlMs = 7 * 24 * 60 * 60 * 1000;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function toCustomer(customer: typeof customersTable.$inferSelect) {
  return { ...customer, createdAt: customer.createdAt.toISOString() };
}

function invoiceNumber(id: number, issueDate: string) {
  return `FAC-${issueDate.slice(0, 4)}-${String(id).padStart(6, "0")}`;
}

function isDuplicate(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; cause?: unknown };
  return value.code === "23505" || isDuplicate(value.cause);
}

async function resolveInvoiceAssignment(
  member: CurrentTeamMember,
  requestedSpecialistId: string | null | undefined,
  current?: Pick<typeof invoicesTable.$inferSelect, "specialistId" | "specialistName">,
) {
  if (member.role !== "owner") {
    return {
      specialistId: current?.specialistId ?? member.userId,
      specialistName: current?.specialistName ?? member.name,
    };
  }

  const specialistId = requestedSpecialistId === undefined
    ? current?.specialistId ?? member.userId
    : requestedSpecialistId ?? member.userId;
  if (specialistId === member.userId) {
    return { specialistId, specialistName: member.name };
  }
  const [specialist] = await db.select({
    userId: teamMembersTable.userId,
    name: teamMembersTable.name,
  }).from(teamMembersTable).where(and(
    eq(teamMembersTable.userId, specialistId),
    eq(teamMembersTable.role, "specialist"),
  )).limit(1);
  return specialist
    ? { specialistId: specialist.userId, specialistName: specialist.name }
    : null;
}

router.get("/billing/overview", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const invoices = await getInvoiceRows(undefined, invoiceScope(member));
  const month = new Date().toISOString().slice(0, 7);
  const currency = invoices[0]?.currency ?? "CUP";
  const monthTotal = invoices
    .filter(
      (invoice) =>
        invoice.issueDate.startsWith(month) &&
        invoice.currency === currency &&
        ["finished", "accepted", "confirmed", "sent", "paid"].includes(invoice.status),
    )
    .reduce((total, invoice) => total + invoice.total, 0);
  const counts = {
    invoiceCount: invoices.length,
    draftCount: invoices.filter((invoice) => invoice.status === "draft").length,
    sentCount: invoices.filter((invoice) => invoice.status === "sent").length,
    paidCount: invoices.filter((invoice) => invoice.paymentStatus === "paid").length,
    finishedCount: invoices.filter((invoice) => invoice.status === "finished").length,
    acceptedCount: invoices.filter((invoice) => invoice.status === "accepted").length,
    confirmedCount: invoices.filter((invoice) => invoice.status === "confirmed").length,
    monthTotal: roundMoney(monthTotal),
    currency,
    outstandingByCurrency: outstandingByCurrency(invoices),
    recentInvoices: invoices.slice(0, 6).map(serializeInvoice),
  };
  res.json(GetBillingOverviewResponse.parse(counts));
});

router.get("/billing/payment-method-summary", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const parsed = GetPaymentMethodSummaryQueryParams.safeParse(dateQuery(req.query));
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const from = parsed.data.from?.toISOString().slice(0, 10);
  const to = parsed.data.to?.toISOString().slice(0, 10);
  if ((from && !validPaymentDate(from)) || (to && !validPaymentDate(to)) ||
      (from && to && from > to)) {
    res.status(400).json({ error: "Indica un período válido con fechas en orden." });
    return;
  }
  const rows = await db.select({
    id: invoicePaymentsTable.id,
    invoiceId: invoicePaymentsTable.invoiceId,
    amount: invoicePaymentsTable.amount,
    currency: invoicePaymentsTable.currency,
    paidOn: invoicePaymentsTable.paidOn,
    paymentMethod: invoicePaymentsTable.paymentMethod,
  }).from(invoicePaymentsTable)
    .innerJoin(invoicesTable, eq(invoicePaymentsTable.invoiceId, invoicesTable.id))
    .where(invoiceScope(owner));
  const invoiceIds = [...new Set(rows.map(({ invoiceId }) => invoiceId))];
  const corrections = rows.length
    ? await db.select({
        id: invoicePaymentCorrectionsTable.id,
        targetPaymentId: invoicePaymentCorrectionsTable.targetPaymentId,
        reversedPaymentId: invoicePaymentCorrectionsTable.reversedPaymentId,
        afterPaymentAmount: invoicePaymentCorrectionsTable.afterPaymentAmount,
        afterPaidOn: invoicePaymentCorrectionsTable.afterPaidOn,
        afterPaymentMethod: invoicePaymentCorrectionsTable.afterPaymentMethod,
      }).from(invoicePaymentCorrectionsTable)
        .where(inArray(invoicePaymentCorrectionsTable.invoiceId, invoiceIds))
    : [];
  res.json(GetPaymentMethodSummaryResponse.parse(summarizePaymentsByMethod(rows, corrections, from, to)));
});

router.get("/customers", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const parsed = ListCustomersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const customers = parsed.data.search
    ? await db
        .select()
        .from(customersTable)
        .where(
          and(
            eq(customersTable.active, true),
            or(
              ilike(customersTable.name, `%${parsed.data.search}%`),
              ilike(customersTable.email, `%${parsed.data.search}%`),
              ilike(customersTable.taxId, `%${parsed.data.search}%`),
            ),
          ),
        )
        .orderBy(customersTable.name)
    : await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.active, true))
        .orderBy(customersTable.name);
  res.json(ListCustomersResponse.parse(customers.map(toCustomer)));
});

router.post("/customers", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let customer: typeof customersTable.$inferSelect;
  try {
    [customer] = await db.insert(customersTable)
      .values({ ...parsed.data, versatCode: parsed.data.versatCode?.trim() || null }).returning();
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    res.status(409).json({ error: "El código de entidad de Versat ya está registrado." });
    return;
  }
  res.status(201).json(CreateCustomerResponse.parse(toCustomer(customer)));
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = UpdateCustomerParams.safeParse(req.params);
  const body = UpdateCustomerBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const [existing] = await db.select().from(customersTable)
    .where(and(eq(customersTable.id, params.data.id), eq(customersTable.active, true))).limit(1);
  if (!existing) { res.status(404).json({ error: "Cliente no encontrado." }); return; }
  const code = body.data.versatCode === undefined ? existing.versatCode : body.data.versatCode?.trim() || null;
  if (existing.versatSourceId && code !== existing.versatCode) {
    res.status(409).json({ error: "No se puede cambiar el código de una entidad importada de Versat." });
    return;
  }
  let customer: typeof customersTable.$inferSelect | undefined;
  try {
    [customer] = await db.update(customersTable).set({ ...body.data, versatCode: code })
      .where(and(eq(customersTable.id, params.data.id), eq(customersTable.active, true))).returning();
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    res.status(409).json({ error: "El código de entidad de Versat ya está registrado." });
    return;
  }
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(UpdateCustomerResponse.parse(toCustomer(customer)));
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = DeleteCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [customer] = await db
    .update(customersTable)
    .set({ active: false })
    .where(and(eq(customersTable.id, params.data.id), eq(customersTable.active, true)))
    .returning({ id: customersTable.id });
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/invoices/owner-assignment-reviews", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const rows = await db.select({
    id: invoicesTable.id,
    number: invoicesTable.number,
    issueDate: invoicesTable.issueDate,
    specialistId: invoicesTable.specialistId,
    specialistName: invoicesTable.specialistName,
    versat: invoicesTable.versat,
    customerName: customersTable.name,
  }).from(invoicesTable)
    .innerJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(eq(invoicesTable.specialistId, owner.userId))
    .orderBy(desc(invoicesTable.createdAt));
  const eligibleRows = rows.filter(({ versat }) => !!versat);
  const specialists = eligibleRows.length
    ? await db.select({
        specialistId: teamMembersTable.userId,
        specialistName: teamMembersTable.name,
        commercialId: teamInvitationsTable.commercialId,
      }).from(teamMembersTable)
        .innerJoin(teamInvitationsTable, eq(teamMembersTable.email, teamInvitationsTable.email))
        .where(eq(teamMembersTable.role, "specialist"))
    : [];
  const reviews = eligibleRows.flatMap((invoice) => {
    const versat = invoice.versat;
    if (!versat) return [];
    return [{
      id: invoice.id,
      number: invoice.number,
      customerName: versat.customerName || invoice.customerName,
      issueDate: invoice.issueDate,
      currentSpecialistId: invoice.specialistId,
      currentSpecialistName: invoice.specialistName,
      versatCommercialId: versat.commercialId,
      versatCommercialName: versat.commercialName,
      matchingSpecialists: specialists
        .filter(({ commercialId }) => commercialId === versat.commercialId)
        .map(({ specialistId, specialistName }) => ({ specialistId, specialistName })),
    }];
  });
  res.json(ListOwnerInvoiceAssignmentReviewsResponse.parse(reviews));
});

router.patch("/invoices/:id/owner-assignment", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = AssignOwnerInvoiceToSpecialistParams.safeParse(req.params);
  const body = AssignOwnerInvoiceToSpecialistBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx.select({
        id: invoicesTable.id,
        versat: invoicesTable.versat,
      }).from(invoicesTable)
        .where(and(
          eq(invoicesTable.id, params.data.id),
          eq(invoicesTable.specialistId, owner.userId),
        ))
        .for("update")
        .limit(1);
      if (!invoice) throw new Error("INVOICE_NOT_FOUND");
      if (!invoice.versat) throw new Error("INVOICE_HAS_NO_VERSAT_COMMERCIAL");

      const [specialist] = await tx.select({
        userId: teamMembersTable.userId,
        name: teamMembersTable.name,
      }).from(teamMembersTable)
        .innerJoin(teamInvitationsTable, eq(teamMembersTable.email, teamInvitationsTable.email))
        .where(and(
          eq(teamMembersTable.userId, body.data.specialistId),
          eq(teamMembersTable.role, "specialist"),
          eq(teamInvitationsTable.commercialId, invoice.versat.commercialId),
        ))
        .for("update")
        .limit(1);
      if (!specialist) throw new Error("SPECIALIST_COMMERCIAL_MISMATCH");

      const [updated] = await tx.update(invoicesTable)
        .set({ specialistId: specialist.userId, specialistName: specialist.name })
        .where(and(
          eq(invoicesTable.id, invoice.id),
          eq(invoicesTable.specialistId, owner.userId),
        ))
        .returning({
          id: invoicesTable.id,
          specialistId: invoicesTable.specialistId,
          specialistName: invoicesTable.specialistName,
        });
      if (!updated) throw new Error("INVOICE_ASSIGNMENT_CHANGED");
      return updated;
    });
    res.json(AssignOwnerInvoiceToSpecialistResponse.parse(result));
  } catch (error) {
    if (error instanceof Error && error.message === "INVOICE_NOT_FOUND") {
      res.status(404).json({ error: "No se encontró una factura que siga asignada al propietario." });
    } else if (error instanceof Error && error.message === "INVOICE_HAS_NO_VERSAT_COMMERCIAL") {
      res.status(422).json({ error: "La factura no tiene datos comerciales de Versat para validar." });
    } else if (error instanceof Error && error.message === "SPECIALIST_COMMERCIAL_MISMATCH") {
      res.status(422).json({ error: "El especialista elegido no tiene asignado el comercial de Versat de esta factura." });
    } else if (error instanceof Error && error.message === "INVOICE_ASSIGNMENT_CHANGED") {
      res.status(409).json({ error: "La asignación de la factura cambió. Actualiza la lista e inténtalo de nuevo." });
    } else {
      throw error;
    }
  }
});

router.get("/invoices", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const parsed = ListInvoicesQueryParams.safeParse(dateQuery(req.query));
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters: SQL[] = [invoiceScope(member)];
  if (parsed.data.search) {
    filters.push(or(
      ilike(customersTable.name, `%${parsed.data.search}%`),
      ilike(invoicesTable.number, `%${parsed.data.search}%`),
    )!);
  }
  if (parsed.data.status) filters.push(eq(invoicesTable.status, parsed.data.status));
  if (parsed.data.paymentStatus) filters.push(paymentFilter(parsed.data.paymentStatus));
  if (parsed.data.from) filters.push(gte(invoicesTable.issueDate, toDateOnly(parsed.data.from)));
  if (parsed.data.to) filters.push(lte(invoicesTable.issueDate, toDateOnly(parsed.data.to)));
  const rows = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .innerJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(invoicesTable.createdAt));
  const invoices = await getInvoiceRows(rows.map((row) => row.id));
  res.json(ListInvoicesResponse.parse(invoices.map(serializeInvoice)));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const assignment = await resolveInvoiceAssignment(member, parsed.data.specialistId);
  if (!assignment) {
    res.status(422).json({ error: "El especialista seleccionado ya no está disponible. Actualiza el equipo y vuelve a elegirlo." });
    return;
  }
  if (member.role !== "owner") {
    if (member.commercialId === null) {
      res.status(403).json({ error: "El administrador debe asignarte un comercial antes de facturar." }); return;
    }
    if (!canAccessInvoice(member, { versat: parsed.data.versat })) {
      res.status(422).json({ error: "Selecciona los datos de Versat correspondientes a tu comercial asignado." }); return;
    }
  }
  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, parsed.data.customerId), eq(customersTable.active, true)))
    .limit(1);
  if (!customer) {
    res.status(400).json({ error: "Choose an active customer" });
    return;
  }
  let prepared: Awaited<ReturnType<typeof prepareInvoice>>;
  try {
    prepared = await prepareInvoice(parsed.data, customer);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Datos de Versat no válidos." });
    return;
  }
  const { subtotal, versat } = prepared;
  let invoiceId: number;
  try {
    invoiceId = await db.transaction(async (tx) => {
    await lockNumbering(tx);
    await validateSeriesSelection(tx, parsed.data.seriesId ?? null, versat);
    const [issuerImages] = await tx.select({
      stampPath: issuerSettingsTable.stampPath,
      signaturePath: issuerSettingsTable.signaturePath,
    }).from(issuerSettingsTable).where(eq(issuerSettingsTable.id, 1)).limit(1);
    const [invoice] = await tx
      .insert(invoicesTable)
      .values({
        number: `DRAFT-${randomUUID()}`,
        customerId: customer.id,
        ...assignment,
        issueDate: toDateOnly(parsed.data.issueDate),
        dueDate: parsed.data.dueDate ? toDateOnly(parsed.data.dueDate) : null,
        currency: parsed.data.currency,
        status: "draft",
        notes: parsed.data.notes ?? null,
        legalImageSnapshot: captureLegalImageSnapshot(issuerImages?.stampPath, issuerImages?.signaturePath),
        versat,
        versatNumber: versat?.number ?? null,
        seriesId: parsed.data.seriesId ?? null,
        subtotal,
        total: subtotal,
      })
      .returning();
    await reserveNumber(tx, invoice.id, versat?.number ?? null, versat?.talon ?? null);
    const number = invoiceNumber(invoice.id, toDateOnly(parsed.data.issueDate));
    await tx
      .update(invoicesTable)
      .set({ number })
      .where(eq(invoicesTable.id, invoice.id));
    await tx.insert(invoiceLinesTable).values(
      prepared.lines.map((line) => ({
        ...line,
        invoiceId: invoice.id,
      })),
    );
    return invoice.id;
    });
  } catch (error) {
    if (error instanceof NumberingError) { res.status(error.status).json({ error: error.message }); return; }
    if (!isDuplicate(error)) throw error;
    res.status(409).json({ error: "Ese número de Versat ya está reservado por otra factura." });
    return;
  }
  const invoice = await getInvoiceRow(invoiceId);
  res.status(201).json(CreateInvoiceResponse.parse(serializeInvoice(invoice!)));
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const invoice = await getInvoiceRow(params.data.id, invoiceScope(member));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.json(GetInvoiceResponse.parse(serializeInvoice(invoice)));
});

router.get("/invoices/:id/acceptance-notification", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = GetInvoiceAcceptanceNotificationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [invoice] = await db.select({
    id: invoicesTable.id,
    number: invoicesTable.number,
    specialistName: invoicesTable.specialistName,
  }).from(invoicesTable).where(eq(invoicesTable.id, params.data.id)).limit(1);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const [notice] = await db.select().from(invoiceAcceptanceNotificationsTable)
    .where(eq(invoiceAcceptanceNotificationsTable.invoiceId, invoice.id)).limit(1);
  res.json(GetInvoiceAcceptanceNotificationResponse.parse({
    delivered: !!notice,
    invoiceNumber: invoice.number,
    specialistName: invoice.specialistName,
    reason: notice?.reason ?? null,
    deliveredAt: notice?.deliveredAt.toISOString() ?? null,
  }));
});

router.get("/notifications", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const notices = await db.select().from(invoiceAcceptanceNotificationsTable)
    .where(eq(invoiceAcceptanceNotificationsTable.recipientUserId, member.userId))
    .orderBy(desc(invoiceAcceptanceNotificationsTable.deliveredAt))
    .limit(50);
  res.json(ListInvoiceAcceptanceNotificationsResponse.parse(notices.map((notice) => ({
    ...notice,
    deliveredAt: notice.deliveredAt.toISOString(),
    readAt: notice.readAt?.toISOString() ?? null,
  }))));
});

router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = MarkInvoiceAcceptanceNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let [notice] = await db.update(invoiceAcceptanceNotificationsTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(invoiceAcceptanceNotificationsTable.id, params.data.id),
      eq(invoiceAcceptanceNotificationsTable.recipientUserId, member.userId),
      isNull(invoiceAcceptanceNotificationsTable.readAt),
    ))
    .returning();
  if (!notice) {
    [notice] = await db.select().from(invoiceAcceptanceNotificationsTable).where(and(
      eq(invoiceAcceptanceNotificationsTable.id, params.data.id),
      eq(invoiceAcceptanceNotificationsTable.recipientUserId, member.userId),
    )).limit(1);
  }
  if (!notice) {
    res.status(404).json({ error: "Notice not found" });
    return;
  }
  res.json(MarkInvoiceAcceptanceNotificationReadResponse.parse({
    ...notice,
    deliveredAt: notice.deliveredAt.toISOString(),
    readAt: notice.readAt?.toISOString() ?? null,
  }));
});

router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = UpdateInvoiceParams.safeParse(req.params);
  const body = UpdateInvoiceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const [current] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, params.data.id), invoiceScope(member)))
    .limit(1);
  if (!current || !canAccessInvoice(member, current)) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (current.status !== "draft") {
    res.status(409).json({ error: "Only draft invoices can be edited" });
    return;
  }
  const assignment = await resolveInvoiceAssignment(member, body.data.specialistId, current);
  if (!assignment) {
    res.status(422).json({ error: "El especialista seleccionado ya no está disponible. Actualiza el equipo y vuelve a elegirlo." });
    return;
  }
  const effectiveVersat = body.data.versat ?? current.versat ?? undefined;
  if (!canAccessInvoice(member, { versat: effectiveVersat })) {
    res.status(422).json({ error: "No puedes trasladar la factura a otro comercial." }); return;
  }
  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, body.data.customerId), eq(customersTable.active, true)))
    .limit(1);
  if (!customer) {
    res.status(400).json({ error: "Choose an active customer" });
    return;
  }
  const existingLines = await db.select({ serviceId: invoiceLinesTable.serviceId })
    .from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, current.id));
  const allowedInactiveCatalogIds = [
    ...(current.versat ? [current.versat.conceptId, current.versat.operationId, current.versat.commercialId, current.versat.paymentId] : []),
    ...existingLines.flatMap((line) => line.serviceId == null ? [] : [line.serviceId]),
  ];
  let prepared: Awaited<ReturnType<typeof prepareInvoice>>;
  try {
    prepared = await prepareInvoice(
      { ...body.data, versat: effectiveVersat },
      customer,
      { allowInactiveCatalogIds: allowedInactiveCatalogIds, currentCurrency: current.currency },
    );
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Datos de Versat no válidos." });
    return;
  }
  const { subtotal, versat } = prepared;
  try {
    await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(invoicesTable).where(and(eq(invoicesTable.id, params.data.id), invoiceScope(member))).for("update");
    if (!locked || !canAccessInvoice(member, locked)) throw new Error("INVOICE_NOT_FOUND");
    if (locked.status !== "draft") throw new Error("INVOICE_NOT_DRAFT");
    await lockNumbering(tx);
    await validateSeriesSelection(tx, body.data.seriesId === undefined ? locked.seriesId : body.data.seriesId, versat);
    await reserveNumber(tx, locked.id, locked.versatNumber, locked.versat?.talon ?? null);
    await reserveNumber(tx, locked.id, versat?.number ?? null, versat?.talon ?? null);
    await tx
      .update(invoicesTable)
      .set({
        customerId: body.data.customerId,
        issueDate: toDateOnly(body.data.issueDate),
        dueDate: body.data.dueDate ? toDateOnly(body.data.dueDate) : null,
        currency: body.data.currency,
        notes: body.data.notes ?? null,
        ...assignment,
        legalDocument: null,
        versat,
        versatNumber: versat?.number ?? null,
        seriesId: body.data.seriesId === undefined ? locked.seriesId : body.data.seriesId,
        subtotal,
        total: subtotal,
      })
      .where(eq(invoicesTable.id, params.data.id));
    await tx
      .delete(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, params.data.id));
    await tx.insert(invoiceLinesTable).values(
      prepared.lines.map((line) => ({
        ...line,
        invoiceId: params.data.id,
      })),
    );
    });
  } catch (error) {
    if (error instanceof NumberingError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof Error && error.message === "INVOICE_NOT_FOUND") {
      res.status(404).json({ error: "Invoice not found" });
    } else if (error instanceof Error && error.message === "INVOICE_NOT_DRAFT") {
      res.status(409).json({ error: "La factura ya no es un borrador." });
    } else if (isDuplicate(error)) {
      res.status(409).json({ error: "Ese número de Versat ya está reservado por otra factura." });
    } else throw error;
    return;
  }
  const invoice = await getInvoiceRow(params.data.id);
  res.json(UpdateInvoiceResponse.parse(serializeInvoice(invoice!)));
});

router.post("/invoices/:id/payments", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = CreateInvoicePaymentParams.safeParse(req.params);
  const body = CreateInvoicePaymentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message }); return;
  }
  try {
    const result = await recordInvoicePayment(params.data.id, {
      ...body.data, paidOn: toDateOnly(body.data.paidOn),
    }, owner);
    res.status(result.created ? 201 : 200).json(CreateInvoicePaymentResponse.parse({
      invoiceId: params.data.id,
      paymentStatus: result.paymentStatus,
      totalPaid: result.totalPaid,
      balanceDue: result.balanceDue,
      payments: result.payments,
    }));
  } catch (error) {
    if (error instanceof InvoicePaymentError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/invoices/:id/payment-corrections", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = CorrectInvoicePaymentParams.safeParse(req.params);
  const body = CorrectInvoicePaymentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  try {
    const result = await correctInvoicePayment(params.data.id, {
      ...body.data,
      paidOn: body.data.paidOn === undefined ? undefined : toDateOnly(body.data.paidOn),
    }, owner);
    res.status(result.created ? 201 : 200).json(CorrectInvoicePaymentResponse.parse({
      invoiceId: params.data.id,
      paymentStatus: result.paymentStatus,
      totalPaid: result.totalPaid,
      balanceDue: result.balanceDue,
      payments: result.payments,
      paymentCorrections: result.paymentCorrections,
    }));
  } catch (error) {
    if (error instanceof InvoicePaymentError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/invoices/:id/payment-corrections/export", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = DownloadInvoicePaymentCorrectionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [invoice] = await db.select({ id: invoicesTable.id, currency: invoicesTable.currency })
    .from(invoicesTable)
    .where(eq(invoicesTable.id, params.data.id))
    .limit(1);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const corrections = await db.select({
    correction: invoicePaymentCorrectionsTable,
    receipt: {
      reference: invoicePaymentsTable.reference,
      paidBy: invoicePaymentsTable.paidBy,
      recordedAt: invoicePaymentsTable.recordedAt,
    },
  }).from(invoicePaymentCorrectionsTable)
    .leftJoin(invoicePaymentsTable, and(
      eq(invoicePaymentsTable.invoiceId, invoice.id),
      eq(invoicePaymentsTable.id, sql`coalesce(
        ${invoicePaymentCorrectionsTable.targetPaymentId},
        ${invoicePaymentCorrectionsTable.reversedPaymentId}
      )`),
    ))
    .where(eq(invoicePaymentCorrectionsTable.invoiceId, invoice.id))
    .orderBy(invoicePaymentCorrectionsTable.createdAt, invoicePaymentCorrectionsTable.id);
  const csvEscape = (value: string | number | null): string => {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const paymentMethodLabel = (method: string | null) => ({
    transfer: "Transferencia",
    cash: "Efectivo",
    other: "Otro medio",
  }[method ?? ""] ?? "Sin especificar");
  const rows = [
    [
      "Abono",
      "Referencia del recibo",
      "Registrado por",
      "Fecha de registro",
      "Autor",
      "Fecha de corrección",
      "Motivo",
      `Importe antes (${invoice.currency})`,
      `Importe después (${invoice.currency})`,
      "Fecha antes",
      "Fecha después",
      "Medio antes",
      "Medio después",
      `Total abonado antes (${invoice.currency})`,
      `Total abonado después (${invoice.currency})`,
    ],
    ...corrections.map(({ correction, receipt }) => [
      correction.targetPaymentId ?? correction.reversedPaymentId ?? "Sin recibo original",
      receipt ? receipt.reference : null,
      receipt ? correction.originalPaidBy ?? receipt.paidBy : null,
      receipt ? (correction.originalPaidAt ?? receipt.recordedAt).toISOString() : null,
      correction.correctedBy,
      correction.createdAt.toISOString(),
      correction.reason,
      correction.beforePaymentAmount?.toFixed(2) ?? null,
      correction.afterPaymentAmount?.toFixed(2) ?? null,
      correction.beforePaidOn,
      correction.afterPaidOn,
      paymentMethodLabel(correction.beforePaymentMethod),
      paymentMethodLabel(correction.afterPaymentMethod),
      correction.beforeTotalPaid.toFixed(2),
      correction.afterTotalPaid.toFixed(2),
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
  res.json(DownloadInvoicePaymentCorrectionsResponse.parse({
    filename: `correcciones-factura-${invoice.id}.csv`,
    base64: Buffer.from(csv, "utf8").toString("base64"),
    contentType: "text/csv; charset=utf-8",
  }));
});

router.patch("/invoices/:id/status", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = UpdateInvoiceStatusParams.safeParse(req.params);
  const body = UpdateInvoiceStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  try {
    await transitionInvoice(params.data.id, body.data.status, invoiceScope(member), member);
  } catch (error) {
    if (error instanceof NumberingError) { res.status(error.status).json({ error: error.message }); return; }
    if (!isDuplicate(error)) throw error;
    res.status(409).json({ error: "Número de Versat ocupado. El propietario debe revisar la serie con el escritorio." });
    return;
  }
  const result = await getInvoiceRow(params.data.id);
  res.json(UpdateInvoiceStatusResponse.parse(serializeInvoice(result!)));
});

router.post("/invoices/:id/share", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = CreateInvoiceShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [invoice] = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, params.data.id), invoiceScope(member)))
    .limit(1);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + shareTtlMs);
  const [share] = await db.insert(invoiceSharesTable).values({
    invoiceId: invoice.id,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt,
    createdAt: new Date(),
  }).returning({ id: invoiceSharesTable.id });
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.protocol;
  const publicUrl = `${protocol}://${host}/share/${token}`;
  res.json(CreateInvoiceShareResponse.parse({ id: share.id, url: publicUrl, expiresAt: expiresAt.toISOString() }));
});

router.post("/invoices/:id/payments/:paymentId/share", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = CreateInvoiceReceiptShareParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const invoice = await getInvoiceRow(params.data.id, invoiceScope(member));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (!activeInvoicePayments(invoice.payments, invoice.paymentCorrections)
    .some(({ id }) => id === params.data.paymentId)) {
    res.status(404).json({ error: "Active payment not found" });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + shareTtlMs);
  const [share] = await db.insert(invoiceSharesTable).values({
    invoiceId: invoice.id,
    paymentId: params.data.paymentId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt,
    createdAt: new Date(),
  }).returning({ id: invoiceSharesTable.id });
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
  const protocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.protocol;
  const publicUrl = `${protocol}://${host}/share/${token}?receipt=${params.data.paymentId}`;
  res.json(CreateInvoiceShareResponse.parse({ id: share.id, url: publicUrl, expiresAt: expiresAt.toISOString() }));
});

router.get("/invoices/:id/shares", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = ListInvoiceSharesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Identificador no válido." }); return; }
  if (!await getInvoiceRow(params.data.id, invoiceScope(member))) {
    res.status(404).json({ error: "Factura no disponible." }); return;
  }
  const shares = await db.select({
    id: invoiceSharesTable.id, createdAt: invoiceSharesTable.createdAt, expiresAt: invoiceSharesTable.expiresAt,
  }).from(invoiceSharesTable).innerJoin(invoicesTable, eq(invoicesTable.id, invoiceSharesTable.invoiceId))
    .where(and(eq(invoicesTable.id, params.data.id), invoiceScope(member), activeInvoiceShare()))
    .orderBy(desc(invoiceSharesTable.id));
  res.json(ListInvoiceSharesResponse.parse(shares.map(share => ({
    ...share, createdAt: share.createdAt?.toISOString() ?? null, expiresAt: share.expiresAt.toISOString(),
  }))));
});

router.delete("/invoices/:id/shares/:shareId", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const params = RevokeInvoiceShareParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Identificador no válido." }); return; }
  // Keep invoice scope and the targeted link in the write itself, not only a preflight check.
  const scopedInvoices = db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(eq(invoicesTable.id, params.data.id), invoiceScope(member)));
  const filter = and(eq(invoiceSharesTable.id, params.data.shareId),
    inArray(invoiceSharesTable.invoiceId, scopedInvoices));
  const [updated] = await db.update(invoiceSharesTable).set({ revokedAt: new Date(), revokedBy: member.userId })
    .where(and(filter, isNull(invoiceSharesTable.revokedAt))).returning({ id: invoiceSharesTable.id });
  if (!updated) {
    const [existing] = await db.select({ id: invoiceSharesTable.id }).from(invoiceSharesTable).where(filter).limit(1);
    if (!existing) { res.status(404).json({ error: "Enlace no disponible." }); return; }
  }
  res.sendStatus(204);
});

router.get("/shared-invoices/:token", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = GetSharedInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const share = await getActiveInvoiceShare(params.data.token);
  if (!share || share.paymentId !== null) {
    res.status(404).json({ error: "This invoice link is expired or unavailable" });
    return;
  }
  const invoice = await getInvoiceRow(share.invoiceId);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const serialized = serializeInvoice(invoice);
  const sharedInvoice = {
    number: serialized.number,
    customerName: serialized.customerName,
    issueDate: serialized.issueDate,
    dueDate: serialized.dueDate,
    currency: serialized.currency,
    status: serialized.status,
    confirmedAt: serialized.confirmedAt,
    notes: serialized.notes,
    versat: serialized.versat ? {
      number: serialized.versat.number ?? null,
      contract: serialized.versat.contract ?? null,
      customerCode: serialized.versat.customerCode,
      customerName: serialized.versat.customerName,
      customerAddress: serialized.versat.customerAddress,
      customerTaxId: serialized.versat.customerTaxId,
      paymentName: serialized.versat.paymentName,
      operationName: serialized.versat.operationName,
    } : null,
    legalDocument: serialized.legalDocument ? {
      preparedBy: serialized.legalDocument.preparedBy,
      preparedPosition: serialized.legalDocument.preparedPosition,
      deliveredBy: serialized.legalDocument.deliveredBy,
      accountedBy: serialized.legalDocument.accountedBy,
      transportedBy: serialized.legalDocument.transportedBy,
      transportId: serialized.legalDocument.transportId,
      vehiclePlate: serialized.legalDocument.vehiclePlate,
      drivingLicense: serialized.legalDocument.drivingLicense,
      receivedBy: serialized.legalDocument.receivedBy,
      receivedPosition: serialized.legalDocument.receivedPosition,
      receivedId: serialized.legalDocument.receivedId,
      customerIrcc: serialized.legalDocument.customerIrcc,
      customerBankAccount: serialized.legalDocument.customerBankAccount,
      issuer: serialized.legalDocument.issuer,
      hasStamp: Boolean(serialized.legalDocument.stampPath),
      hasSignature: Boolean(serialized.legalDocument.signaturePath),
    } : null,
    subtotal: serialized.subtotal,
    total: serialized.total,
    lines: serialized.lines.map(({ description, serviceCode, unitCode, quantity, unitPrice, amount }) => ({
      description, serviceCode, unitCode, quantity, unitPrice, amount,
    })),
  };
  res.set("Cache-Control", "private, no-store").json(GetSharedInvoiceResponse.parse(sharedInvoice));
});

router.get("/shared-invoices/:token/receipts/:paymentId", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = GetSharedInvoiceReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const share = await getActiveInvoiceShare(params.data.token);
  if (!share || share.paymentId !== params.data.paymentId) {
    res.status(404).json({ error: "This invoice link is expired or unavailable" });
    return;
  }
  const invoice = await getInvoiceRow(share.invoiceId);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const activePayments = activeInvoicePayments(invoice.payments, invoice.paymentCorrections);
  activePayments.sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id - b.id);
  const selectedIndex = activePayments.findIndex(({ id }) => id === params.data.paymentId);
  if (selectedIndex < 0) {
    res.status(404).json({ error: "Payment receipt not found" });
    return;
  }
  const payment = activePayments[selectedIndex];
  const paidThroughCents = activePayments.slice(0, selectedIndex + 1)
    .reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
  res.json(GetSharedInvoiceReceiptResponse.parse({
    invoiceNumber: invoice.versat?.number || invoice.number,
    customerName: invoice.versat?.customerName || invoice.customerName,
    currency: invoice.currency,
    amount: payment.amount,
    paidOn: payment.paidOn,
    paymentCurrency: payment.currency,
    reference: payment.reference,
    paymentMethod: payment.paymentMethod,
    remainingBalance: Math.max(0, Math.round(invoice.total * 100) - paidThroughCents) / 100,
    corrected: invoice.paymentCorrections.some((correction) => correction.targetPaymentId === payment.id),
  }));
});

router.get("/team/me", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res, true);
  if (!member) return;
  res.json(GetCurrentTeamMemberResponse.parse(member));
});

router.get("/team/members", async (req, res): Promise<void> => {
  const member = await requireOwner(req, res);
  if (!member) return;
  const members = await db.select().from(teamMembersTable).orderBy(teamMembersTable.name);
  const invites = await db.select().from(teamInvitationsTable).orderBy(teamInvitationsTable.createdAt);
  const currentEmails = new Set(members.map((item) => item.email).filter(Boolean));
  const combined = [
    ...members,
    ...invites
      .filter((invite) => !currentEmails.has(invite.email))
      .map((invite) => ({
        userId: `invite:${invite.email}`,
        name: invite.email,
        email: invite.email,
        role: "pending" as const,
        suspended: invite.suspended,
        createdAt: invite.createdAt,
      })),
  ].map((item) => ({
    userId: item.userId,
    name: item.name,
    email: item.email,
    role: item.role,
    suspended: item.suspended || invites.some(invite => invite.email === item.email && invite.suspended)
      || members.some(member => item.email !== null && member.email === item.email && member.suspended),
    commercialId: invites.find(invite => invite.email === item.email)?.commercialId ?? null,
  }));
  res.json(ListTeamMembersResponse.parse(combined));
});

router.post("/team/invitations", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const parsed = InviteTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const commercialId = parsed.data.commercialId;
  if (email === process.env.OWNER_EMAIL?.trim().toLowerCase()) {
    res.status(422).json({ error: "El propietario no necesita una asignación de comercial." }); return;
  }
  if (commercialId !== null) {
    const [commercial] = await db.select({ id: versatCatalogTable.id }).from(versatCatalogTable)
      .where(and(eq(versatCatalogTable.id, commercialId), eq(versatCatalogTable.kind, "commercial")));
    if (!commercial) {
      res.status(422).json({ error: "Selecciona un comercial del catálogo de Versat." }); return;
    }
  }
  const [invitation] = await db
    .insert(teamInvitationsTable)
    .values({ email, commercialId })
    .onConflictDoUpdate({
      target: teamInvitationsTable.email,
      set: { commercialId, createdAt: new Date() },
    })
    .returning();
  res.status(201).json({
    email: invitation.email,
    commercialId: invitation.commercialId,
    createdAt: invitation.createdAt.toISOString(),
  });
});

router.patch("/team/members/:userId/access", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = UpdateTeamMemberAccessParams.safeParse(req.params);
  const body = UpdateTeamMemberAccessBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Indica el acceso y su estado de suspensión." }); return;
  }
  try {
    await setTeamMemberSuspension(owner, params.data.userId, body.data.suspended);
    res.status(204).end();
  } catch (error) {
    if (!(error instanceof TeamAccessError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
});

export default router;
