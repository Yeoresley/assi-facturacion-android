import { and, count, eq, gte, inArray, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { strToU8, zipSync } from "fflate";
import {
  ExportVersatInvoicesQueryParams, ExportVersatInvoicesResponse,
  GetInvoiceVersatFileParams, GetInvoiceVersatFileResponse,
  GetVersatCatalogsResponse, GetVersatExportFileQueryParams, GetVersatExportFileResponse,
} from "@workspace/api-zod";
import { customersTable, db, invoicesTable, versatCatalogTable } from "@workspace/db";
import { requireOwner, resolveTeamMember } from "../middlewares/team-access";
import { dateQuery, getInvoiceRow, getInvoiceRows, toDateOnly } from "../services/invoice-records";
import { buildFac, encodeFac, facWarnings, getVersatIssues } from "../services/versat-file";

const router: IRouter = Router();

router.get("/versat/catalogs", async (req, res): Promise<void> => {
  if (!await resolveTeamMember(req, res)) return;
  const entries = await db.select().from(versatCatalogTable).orderBy(versatCatalogTable.kind, versatCatalogTable.code);
  const [customers] = await db.select({ total: count() }).from(customersTable)
    .where(eq(customersTable.active, true));
  res.json(GetVersatCatalogsResponse.parse({
    customerCount: customers.total,
    entries: entries.map(({ metadata, exportValue: _, ...entry }) => ({
      ...entry, unitCode: metadata.unitCode ?? null, unitName: metadata.unitName ?? null,
      groupCode: metadata.groupCode ?? null, position: metadata.position ?? null,
    })),
  }));
});

async function periodInvoices(from: Date, to: Date) {
  const ids = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
    gte(invoicesTable.issueDate, toDateOnly(from)), lte(invoicesTable.issueDate, toDateOnly(to)),
    inArray(invoicesTable.status, ["sent", "paid"]),
  )).limit(501);
  if (ids.length > 500) throw new Error("El período supera 500 facturas. Selecciona un rango más corto.");
  return (await getInvoiceRows(ids.map(({ id }) => id))).sort((a, b) =>
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
        id: invoice.id, invoiceNumber: invoice.number, versatNumber: invoice.versat?.number ?? null,
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

router.get("/invoices/:id/versat-file", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const params = GetInvoiceVersatFileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Identificador inválido." }); return; }
  const invoice = await getInvoiceRow(params.data.id);
  if (!invoice) { res.status(404).json({ error: "Factura no encontrada." }); return; }
  const issues = getVersatIssues(invoice);
  if (issues.length) { res.status(422).json({ error: "Completa los datos de Versat antes de descargar.", issues }); return; }
  try {
    const bytes = encodeFac(buildFac(invoice), "windows-1252");
    res.setHeader("Cache-Control", "private, no-store");
    res.json(GetInvoiceVersatFileResponse.parse({
      filename: `B${invoice.versat!.number}.Fac`, base64: bytes.toString("base64"),
      contentType: "text/plain;charset=windows-1252", invoiceCount: 1, warnings: facWarnings,
    }));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "No se pudo generar el archivo." });
  }
});

router.get("/versat/export-file", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const parsed = GetVersatExportFileQueryParams.safeParse(dateQuery(req.query));
  if (!parsed.success || parsed.data.from > parsed.data.to) {
    res.status(400).json({ error: "Selecciona un intervalo y una codificación válidos." });
    return;
  }
  try {
    const invoices = await periodInvoices(parsed.data.from, parsed.data.to);
    if (!invoices.length) {
      res.status(422).json({ error: "No hay facturas emitidas o pagadas en el período." });
      return;
    }
    const invalid = invoices.flatMap((invoice) =>
      getVersatIssues(invoice).map((issue) => `${invoice.number}: ${issue}`));
    if (invalid.length) {
      res.status(422).json({ error: "El lote contiene facturas incompletas. No se ha exportado ninguna.", issues: invalid });
      return;
    }
    const files: Record<string, Uint8Array> = {};
    for (const invoice of invoices) {
      const name = `B${invoice.versat!.number}.Fac`;
      if (files[name]) throw new Error("Hay numeración duplicada en el lote.");
      files[name] = encodeFac(buildFac(invoice), parsed.data.encoding);
    }
    files["LEEME.txt"] = strToU8([
      "ARCHIVOS DE PRUEBA PARA VERSAT SARASOLA", ...facWarnings,
      `Codificación: ${parsed.data.encoding}. Separador de líneas: CRLF.`,
      "Descomprime el ZIP. Prueba primero un único .Fac en una copia de tu base de Versat.",
      "No importes este ZIP directamente ni repitas una factura ya importada.",
      "La fecha serial, los campos fijos y el agrupador se basan en un solo ejemplo.",
      "No se han generado firmas ni cuños digitales.",
    ].join("\r\n"));
    const bytes = zipSync(files, { level: 6 });
    res.setHeader("Cache-Control", "private, no-store");
    res.json(GetVersatExportFileResponse.parse({
      filename: `versat-prueba-${toDateOnly(parsed.data.from)}-${toDateOnly(parsed.data.to)}.zip`,
      base64: Buffer.from(bytes).toString("base64"), contentType: "application/zip",
      invoiceCount: invoices.length, warnings: facWarnings,
    }));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "No se pudo generar el lote." });
  }
});

export default router;
