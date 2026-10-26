import { and, count, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { strToU8, zipSync } from "fflate";
import {
  CreateVersatCatalogEntryBody, CreateVersatCatalogEntryResponse,
  CompareVersatCatalogsBody, CompareVersatCatalogsResponse,
  DownloadInvoiceVersatFileBody, DownloadVersatExportFileBody,
  DownloadInvoiceVersatFileParams, DownloadInvoiceVersatFileResponse,
  DownloadVersatExportFileQueryParams, DownloadVersatExportFileResponse,
  ExportVersatInvoicesQueryParams, ExportVersatInvoicesResponse,
  GetVersatCatalogAuditQueryParams,
  GetVersatCatalogAuditResponse,
  GetVersatCatalogHistoryParams, GetVersatCatalogHistoryResponse,
  GetVersatCatalogsResponse,
  UpdateVersatCatalogEntryBody, UpdateVersatCatalogEntryParams, UpdateVersatCatalogEntryResponse,
} from "@workspace/api-zod";
import {
  customersTable, db, invoicesTable, versatCatalogAuditTable, versatCatalogTable,
  type CatalogKind, type VersatCatalogAuditAction, type VersatCatalogAuditValues,
} from "@workspace/db";
import { requireOwner, resolveTeamMember } from "../middlewares/team-access";
import { dateQuery, getInvoiceRows, toDateOnly } from "../services/invoice-records";
import { buildFac, encodeFac, facWarnings, getVersatIssues } from "../services/versat-file";
import type { BillingTransaction } from "../services/invoice-numbering";
import { facFilename, facNumber } from "../services/versat-identity";
import { acceptanceFromWorkflowEvent } from "../services/invoice-status";
import { compareCatalogCsv } from "../services/versat-catalog-check";

const router: IRouter = Router();

function serializeCatalogEntry(entry: typeof versatCatalogTable.$inferSelect) {
  const { metadata, ...data } = entry;
  return {
    ...data,
    unitCode: metadata.unitCode ?? null,
    unitName: metadata.unitName ?? null,
    groupCode: metadata.groupCode ?? null,
    position: metadata.position ?? null,
  };
}

function catalogAuditValues(entry: typeof versatCatalogTable.$inferSelect): VersatCatalogAuditValues {
  return {
    kind: entry.kind,
    sourceId: entry.sourceId,
    code: entry.code,
    name: entry.name,
    exportValue: entry.exportValue,
    unitCode: entry.metadata.unitCode ?? null,
    unitName: entry.metadata.unitName ?? null,
    groupCode: entry.metadata.groupCode ?? null,
    position: entry.metadata.position ?? null,
    active: entry.active,
  };
}

function catalogAuditRecord(
  entry: typeof versatCatalogTable.$inferSelect,
  actor: { userId: string; name: string; email: string | null },
  action: VersatCatalogAuditAction,
  previousValues: VersatCatalogAuditValues | null,
) {
  return {
    catalogEntryId: entry.id,
    kind: entry.kind,
    sourceId: entry.sourceId,
    action,
    actorUserId: actor.userId,
    actorName: actor.name,
    actorEmail: actor.email,
    previousValues,
    newValues: catalogAuditValues(entry),
  };
}

function cleanRequired(value: string): string {
  return value.trim();
}

function catalogMetadata(input: {
  unitCode?: string;
  unitName?: string;
  groupCode?: string;
  position?: string;
}) {
  const clean = (value?: string) => value?.trim() || undefined;
  return {
    ...(clean(input.unitCode) ? { unitCode: clean(input.unitCode) } : {}),
    ...(clean(input.unitName) ? { unitName: clean(input.unitName) } : {}),
    ...(clean(input.groupCode) ? { groupCode: clean(input.groupCode) } : {}),
    ...(clean(input.position) ? { position: clean(input.position) } : {}),
  };
}

async function catalogCodeExists(kind: CatalogKind, code: string, exceptId?: number): Promise<boolean> {
  const filters = [eq(versatCatalogTable.kind, kind), eq(versatCatalogTable.code, code)];
  if (exceptId !== undefined) filters.push(ne(versatCatalogTable.id, exceptId));
  const [match] = await db.select({ id: versatCatalogTable.id }).from(versatCatalogTable)
    .where(and(...filters)).limit(1);
  return !!match;
}

async function compareWithActiveCatalog(csv: string) {
  const activeEntries = await db.select({
    kind: versatCatalogTable.kind,
    sourceId: versatCatalogTable.sourceId,
    code: versatCatalogTable.code,
    exportValue: versatCatalogTable.exportValue,
  }).from(versatCatalogTable).where(eq(versatCatalogTable.active, true));
  return CompareVersatCatalogsResponse.parse(compareCatalogCsv(csv, activeEntries));
}

function catalogMismatchMessage(differences: Array<{ detail: string }>): string {
  const shown = differences.slice(0, 12).map(({ detail }) => detail).join(" ");
  const remaining = differences.length > 12 ? ` Y ${differences.length - 12} diferencias más.` : "";
  return `No se generó ningún .Fac: el catálogo activo no coincide con el archivo reciente de Versat. Corrige la configuración o carga un archivo actualizado y vuelve a comparar. ${shown}${remaining}`;
}

router.get("/versat/catalogs", async (req, res): Promise<void> => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const entries = member.role === "owner"
    ? await db.select().from(versatCatalogTable).orderBy(versatCatalogTable.kind, versatCatalogTable.code)
    : await db.select().from(versatCatalogTable).where(eq(versatCatalogTable.active, true))
      .orderBy(versatCatalogTable.kind, versatCatalogTable.code);
  const [customers] = await db.select({ total: count() }).from(customersTable)
    .where(eq(customersTable.active, true));
  res.json(GetVersatCatalogsResponse.parse({
    customerCount: customers.total,
    entries: entries.map(serializeCatalogEntry),
  }));
});

router.post("/versat/catalogs/compare", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const body = CompareVersatCatalogsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    res.json(await compareWithActiveCatalog(body.data.catalogCsv));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo leer el catálogo de Versat." });
  }
});

router.post("/versat/catalogs", async (req, res): Promise<void> => {
  const actor = await requireOwner(req, res);
  if (!actor) return;
  const parsed = CreateVersatCatalogEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const code = cleanRequired(input.code);
  const name = cleanRequired(input.name);
  const exportValue = cleanRequired(input.exportValue);
  if (!code || !name || !exportValue) {
    res.status(400).json({ error: "Código, nombre y valor exportado son obligatorios." });
    return;
  }
  if (await catalogCodeExists(input.kind, code)) {
    res.status(409).json({ error: "Ya existe un registro con ese código en este catálogo." });
    return;
  }
  try {
    const entry = await db.transaction(async (tx) => {
      const [created] = await tx.insert(versatCatalogTable).values({
        kind: input.kind,
        sourceId: input.sourceId,
        code,
        name,
        exportValue,
        metadata: catalogMetadata(input),
        active: true,
      }).returning();
      await tx.insert(versatCatalogAuditTable).values(catalogAuditRecord(created, actor, "created", null));
      return created;
    });
    res.status(201).json(CreateVersatCatalogEntryResponse.parse(serializeCatalogEntry(entry)));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "Ya existe un registro con ese ID de origen en este catálogo." });
      return;
    }
    throw error;
  }
});

router.patch("/versat/catalogs/:id", async (req, res): Promise<void> => {
  const actor = await requireOwner(req, res);
  if (!actor) return;
  const params = UpdateVersatCatalogEntryParams.safeParse(req.params);
  const body = UpdateVersatCatalogEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message });
    return;
  }
  const [current] = await db.select().from(versatCatalogTable)
    .where(eq(versatCatalogTable.id, params.data.id)).limit(1);
  if (!current) {
    res.status(404).json({ error: "No encontramos ese registro del catálogo." });
    return;
  }
  if (!Object.keys(body.data).length) {
    res.status(400).json({ error: "Indica al menos un campo para modificar." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(versatCatalogTable)
      .where(eq(versatCatalogTable.id, current.id)).for("update").limit(1);
    if (!locked) return { error: "missing" as const };
    const code = body.data.code === undefined ? locked.code : cleanRequired(body.data.code);
    const name = body.data.name === undefined ? locked.name : cleanRequired(body.data.name);
    const exportValue = body.data.exportValue === undefined ? locked.exportValue : cleanRequired(body.data.exportValue);
    if (!code || !name || !exportValue) return { error: "empty" as const };
    if (body.data.code !== undefined) {
      const [duplicate] = await tx.select({ id: versatCatalogTable.id }).from(versatCatalogTable)
        .where(and(
          eq(versatCatalogTable.kind, locked.kind),
          eq(versatCatalogTable.code, code),
          ne(versatCatalogTable.id, locked.id),
        )).limit(1);
      if (duplicate) return { error: "duplicate" as const };
    }
    const metadata = { ...locked.metadata };
    for (const field of ["unitCode", "unitName", "groupCode", "position"] as const) {
      if (body.data[field] === undefined) continue;
      const value = body.data[field].trim();
      if (value) metadata[field] = value;
      else delete metadata[field];
    }
    const nextActive = body.data.active ?? locked.active;
    const previousValues = catalogAuditValues(locked);
    const nextValues: VersatCatalogAuditValues = {
      kind: locked.kind,
      sourceId: locked.sourceId,
      code,
      name,
      exportValue,
      unitCode: metadata.unitCode ?? null,
      unitName: metadata.unitName ?? null,
      groupCode: metadata.groupCode ?? null,
      position: metadata.position ?? null,
      active: nextActive,
    };
    if (JSON.stringify(previousValues) === JSON.stringify(nextValues)) return { entry: locked };
    const [updated] = await tx.update(versatCatalogTable).set({
      code,
      name,
      exportValue,
      metadata,
      active: nextActive,
    }).where(eq(versatCatalogTable.id, locked.id)).returning();
    const action: VersatCatalogAuditAction = locked.active !== updated.active
      ? updated.active ? "reactivated" : "deactivated"
      : "updated";
    await tx.insert(versatCatalogAuditTable)
      .values(catalogAuditRecord(updated, actor, action, previousValues));
    return { entry: updated };
  });
  if ("error" in result) {
    if (result.error === "missing") {
      res.status(404).json({ error: "No encontramos ese registro del catálogo." });
      return;
    }
    if (result.error === "duplicate") {
      res.status(409).json({ error: "Ya existe otro registro con ese código en este catálogo." });
      return;
    }
    res.status(400).json({ error: "Código, nombre y valor exportado no pueden quedar vacíos." });
    return;
  }
  res.json(UpdateVersatCatalogEntryResponse.parse(serializeCatalogEntry(result.entry)));
});

router.get("/versat/catalogs/audit", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const parsed = GetVersatCatalogAuditQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [];
  if (parsed.data.kind) filters.push(eq(versatCatalogAuditTable.kind, parsed.data.kind));
  const code = parsed.data.code?.trim();
  if (code) filters.push(sql`${versatCatalogAuditTable.newValues}->>'code' ILIKE ${`%${code}%`}`);
  const audit = await db.select().from(versatCatalogAuditTable)
    .where(and(...filters))
    .orderBy(desc(versatCatalogAuditTable.createdAt), desc(versatCatalogAuditTable.id))
    .limit(200);
  res.json(GetVersatCatalogAuditResponse.parse(audit));
});

router.get("/versat/catalogs/:id/history", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const params = GetVersatCatalogHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entry] = await db.select({ id: versatCatalogTable.id })
    .from(versatCatalogTable).where(eq(versatCatalogTable.id, params.data.id)).limit(1);
  if (!entry) {
    res.status(404).json({ error: "No encontramos ese registro del catálogo." });
    return;
  }
  const history = await db.select().from(versatCatalogAuditTable)
    .where(eq(versatCatalogAuditTable.catalogEntryId, entry.id))
    .orderBy(desc(versatCatalogAuditTable.createdAt), desc(versatCatalogAuditTable.id));
  res.json(GetVersatCatalogHistoryResponse.parse(history));
});

async function periodInvoices(from: Date, to: Date, tx?: BillingTransaction) {
  const reader = tx ?? db;
  const selection = reader.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
    gte(invoicesTable.issueDate, toDateOnly(from)), lte(invoicesTable.issueDate, toDateOnly(to)),
    inArray(invoicesTable.status, ["finished", "accepted"]),
  )).orderBy(invoicesTable.id).limit(501);
  // Keep state stable while bytes are generated; payment/confirmation/annulment waits.
  const ids = tx ? await selection.for("share") : await selection;
  if (ids.length > 500) throw new Error("El período supera 500 facturas. Selecciona un rango más corto.");
  return (await getInvoiceRows(ids.map(({ id }) => id), undefined, reader)).sort((a, b) =>
    a.issueDate.localeCompare(b.issueDate) || a.id - b.id);
}

router.get("/versat/export", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const parsed = ExportVersatInvoicesQueryParams.safeParse(dateQuery(req.query));
  if (!parsed.success || parsed.data.from > parsed.data.to) {
    res.status(400).json({ error: "Selecciona un intervalo de fechas válido." });
    return;
  }
  try {
    const invoices = await periodInvoices(parsed.data.from, parsed.data.to);
    res.json(ExportVersatInvoicesResponse.parse(invoices.map((invoice) => {
      const issues = getVersatIssues(invoice);
      return {
        id: invoice.id, invoiceNumber: invoice.number, versatNumber: invoice.versat?.number ? facNumber(invoice.versat.number) : null,
        issueDate: invoice.issueDate, customerName: invoice.customerName,
        taxId: invoice.versat?.customerTaxId ?? null, currency: invoice.currency,
        subtotal: invoice.subtotal, total: invoice.total, status: invoice.status,
        canExport: !issues.length, issues,
      };
    })));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "No se pudo preparar el período." });
  }
});

router.post("/invoices/:id/versat-file", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = DownloadInvoiceVersatFileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Identificador inválido." }); return; }
  const body = DownloadInvoiceVersatFileBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const comparison = await compareWithActiveCatalog(body.data.catalogCsv);
    if (!comparison.compatible) throw new Error(catalogMismatchMessage(comparison.differences));
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: invoicesTable.id }).from(invoicesTable)
        .where(eq(invoicesTable.id, params.data.id)).for("share");
      if (!locked) return null;
      const [invoice] = await getInvoiceRows([locked.id], undefined, tx);
      const issues = getVersatIssues(invoice);
      if (issues.length) throw new Error(issues.join(" "));
      const bytes = encodeFac(buildFac(invoice), "windows-1252");
      const response = DownloadInvoiceVersatFileResponse.parse({
        filename: facFilename(invoice.versat!.number!), base64: bytes.toString("base64"),
        contentType: "text/plain;charset=windows-1252", invoiceCount: 1, warnings: facWarnings,
      });
      const acceptance = acceptanceFromWorkflowEvent(invoice, owner.userId, "versat_export");
      if (Object.keys(acceptance).length) {
        await tx.update(invoicesTable).set(acceptance).where(eq(invoicesTable.id, invoice.id));
      }
      return response;
    });
    if (!result) { res.status(404).json({ error: "Factura no encontrada." }); return; }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "No se pudo generar el archivo." });
  }
});

router.post("/versat/export-file", async (req, res): Promise<void> => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const parsed = DownloadVersatExportFileQueryParams.safeParse(dateQuery(req.query));
  if (!parsed.success || parsed.data.from > parsed.data.to) {
    res.status(400).json({ error: "Selecciona un intervalo y una codificación válidos." });
    return;
  }
  const body = DownloadVersatExportFileBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const comparison = await compareWithActiveCatalog(body.data.catalogCsv);
    if (!comparison.compatible) throw new Error(catalogMismatchMessage(comparison.differences));
    const result = await db.transaction(async (tx) => {
    const invoices = await periodInvoices(parsed.data.from, parsed.data.to, tx);
    if (!invoices.length) {
      throw new Error("No hay facturas Terminadas o Aceptadas pendientes de importar en el período.");
    }
    const invalid = invoices.flatMap((invoice) =>
      getVersatIssues(invoice).map((issue) => `${invoice.number}: ${issue}`));
    if (invalid.length) {
      throw new Error(`El lote contiene facturas incompletas. No se ha exportado ninguna. ${invalid.join(" ")}`);
    }
    const files: Record<string, Uint8Array> = {};
    for (const invoice of invoices) {
      const name = facFilename(invoice.versat!.number!);
      if (files[name]) throw new Error("Hay numeración duplicada en el lote.");
      files[name] = encodeFac(buildFac(invoice), parsed.data.encoding);
    }
    files["LEEME.txt"] = strToU8([
      "ARCHIVOS DE PRUEBA PARA VERSAT SARASOLA", ...facWarnings,
      `Codificación: ${parsed.data.encoding}. Separador de líneas: CRLF.`,
      "Descomprime el ZIP. Prueba primero un único .Fac en una copia de tu base de Versat.",
      "La descarga registra las facturas como Aceptadas en esta aplicación; tras importarlas, márcalas Confirmadas.",
      "No importes este ZIP directamente ni repitas una factura ya importada.",
      "La fecha serial, los campos fijos y el agrupador se basan en un solo ejemplo.",
      "No se han generado firmas ni cuños digitales.",
    ].join("\r\n"));
    const bytes = zipSync(files, { level: 6 });
    const response = DownloadVersatExportFileResponse.parse({
      filename: `versat-prueba-${toDateOnly(parsed.data.from)}-${toDateOnly(parsed.data.to)}.zip`,
      base64: Buffer.from(bytes).toString("base64"), contentType: "application/zip",
      invoiceCount: invoices.length, warnings: facWarnings,
    });
    const acceptedAt = new Date();
    for (const invoice of invoices) {
      const acceptance = acceptanceFromWorkflowEvent(invoice, owner.userId, "versat_export", acceptedAt);
      if (Object.keys(acceptance).length) {
        await tx.update(invoicesTable).set(acceptance).where(eq(invoicesTable.id, invoice.id));
      }
    }
    return response;
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "No se pudo generar el lote." });
  }
});

export default router;
