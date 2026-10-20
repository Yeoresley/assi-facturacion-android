import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { Router, type Response } from "express";
import { db, invoicesTable, invoiceSharesTable, issuerSettingsTable, type LegalDocument } from "@workspace/db";
import { AuthorizeInvoiceDocumentBody, GetInvoiceResponse, UpdateIssuerBody } from "@workspace/api-zod";
import { requireOwner, resolveTeamMember } from "../middlewares/team-access";
import { getInvoiceRow, serializeInvoice } from "../services/invoice-records";
import { privateImage } from "../lib/private-images";

const router = Router();
const settings = async () => (await db.select().from(issuerSettingsTable).where(eq(issuerSettingsTable.id, 1)))[0];
const toSettings = (row: Awaited<ReturnType<typeof settings>>) => ({
  profile: row?.profile ?? null,
  hasStamp: Boolean(row?.stampPath && row.authorization),
  hasSignature: Boolean(row?.signaturePath && row.authorization),
});

router.get("/issuer", async (req, res) => {
  if (!await requireOwner(req, res)) return;
  res.set("Cache-Control", "no-store").json(toSettings(await settings()));
});

router.put("/issuer", async (req, res) => {
  if (!await requireOwner(req, res)) return;
  const parsed = UpdateIssuerBody.safeParse(req.body);
  if (!parsed.success || Object.values(parsed.data ?? {}).some(value => !value.trim())) {
    res.status(400).json({ error: "Completa todos los datos legales y de pago del emisor." }); return;
  }
  const [row] = await db.insert(issuerSettingsTable).values({ id: 1, profile: parsed.data })
    .onConflictDoUpdate({ target: issuerSettingsTable.id, set: { profile: parsed.data } }).returning();
  res.json(toSettings(row));
});

router.put("/invoices/:id/legal-document", async (req, res) => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const id = Number(req.params.id);
  const parsed = AuthorizeInvoiceDocumentBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    res.status(400).json({ error: "Completa el responsable y su cargo, y confirma expresamente la autorización." }); return;
  }
  const input = parsed.data;
  if (!input.confirm || !input.preparedBy.trim() || !input.preparedPosition.trim() ||
      (input.useSignature && !input.accountedBy.trim())) {
    res.status(422).json({ error: "Indica los responsables reales; la firma escaneada corresponde a «Contabilizada por»." }); return;
  }
  const row = await settings();
  if (!row || !UpdateIssuerBody.safeParse(row.profile).success) {
    res.status(422).json({ error: "Configura primero los datos legales y de pago del emisor en Ajustes." }); return;
  }
  if ((input.useStamp && (!row.stampPath || !row.authorization)) ||
      (input.useSignature && (!row.signaturePath || !row.authorization))) {
    res.status(422).json({ error: "No hay imágenes autorizadas disponibles." }); return;
  }
  const document: LegalDocument = {
    ...input, confirm: true, issuer: row.profile,
    stampPath: input.useStamp ? row.stampPath : null,
    signaturePath: input.useSignature ? row.signaturePath : null,
    authorizedAt: new Date().toISOString(), authorizedBy: owner.userId,
  };
  const [saved] = await db.update(invoicesTable).set({ legalDocument: document })
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.status, "draft"))).returning();
  if (!saved) {
    res.status(409).json({ error: "Solo se puede autorizar el modelo de un borrador; una factura emitida no se modifica." }); return;
  }
  res.json(GetInvoiceResponse.parse(serializeInvoice((await getInvoiceRow(id))!)));
});

async function sendImage(id: number, kind: string, res: Response) {
  if (!["stamp", "signature"].includes(kind)) { res.sendStatus(404); return; }
  const invoice = await getInvoiceRow(id);
  // Drafts and cancellations never expose scans, even if an old share exists.
  const path = invoice?.legalDocument?.[kind === "stamp" ? "stampPath" : "signaturePath"];
  if (!invoice || !["sent", "paid"].includes(invoice.status) || !path) { res.sendStatus(404); return; }
  try {
    const file = privateImage(path);
    const [data] = await file.download();
    res.set({ "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(data);
  } catch {
    res.status(503).json({ error: "No se pudo cargar la imagen autorizada. No imprimas hasta resolverlo." });
  }
}

router.get("/invoices/:id/images/:kind", async (req, res) => {
  if (!await resolveTeamMember(req, res)) return;
  await sendImage(Number(req.params.id), req.params.kind, res);
});
router.get("/shared-invoices/:token/images/:kind", async (req, res) => {
  const hash = createHash("sha256").update(req.params.token).digest("hex");
  const [share] = await db.select().from(invoiceSharesTable)
    .where(and(eq(invoiceSharesTable.tokenHash, hash), gt(invoiceSharesTable.expiresAt, new Date()))).limit(1);
  if (!share) { res.sendStatus(404); return; }
  await sendImage(share.invoiceId, req.params.kind, res);
});

export default router;
