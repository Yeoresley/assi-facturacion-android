import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { db, invoiceImageAccessesTable, invoicesTable, issuerSettingsTable, type LegalDocument } from "@workspace/db";
import { AuthorizeInvoiceDocumentBody, GetInvoiceResponse, ListInvoiceImageAccessesParams, ListInvoiceImageAccessesResponse, UpdateIssuerBody, UpdateIssuerImagesBody } from "@workspace/api-zod";
import { requireOwner, resolveTeamMember } from "../middlewares/team-access";
import { getInvoiceRow, serializeInvoice } from "../services/invoice-records";
import { privateImage } from "../lib/private-images";
import { getActiveInvoiceShare, invoiceScope } from "../services/invoice-access";
import { hasCompleteLegalImageSnapshot, resolveLegalImageSnapshot } from "../services/invoice-legal-images";

const router = Router();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxIssuerImageBytes = 1024 * 1024;
const settings = async () => (await db.select().from(issuerSettingsTable).where(eq(issuerSettingsTable.id, 1)))[0];
const toSettings = (row: Awaited<ReturnType<typeof settings>>) => ({
  profile: row?.profile ?? null,
  hasStamp: Boolean(row?.stampPath && row.authorization),
  hasSignature: Boolean(row?.signaturePath && row.authorization),
});

router.get("/issuer", async (req, res) => {
  if (!await resolveTeamMember(req, res)) return;
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

function decodeIssuerPng(dataUrl: string): Buffer | null {
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const bytes = Buffer.from(base64, "base64");
  const width = bytes.length >= 24 ? bytes.readUInt32BE(16) : 0;
  const height = bytes.length >= 24 ? bytes.readUInt32BE(20) : 0;
  if (
    bytes.length < pngSignature.length ||
    bytes.length > maxIssuerImageBytes ||
    !bytes.subarray(0, pngSignature.length).equals(pngSignature) ||
    bytes.length < 33 ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    width < 1 || height < 1 || width > 6000 || height > 6000 || width * height > 24_000_000 ||
    bytes.toString("base64") !== base64
  ) return null;
  return bytes;
}

router.put("/issuer/images", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const parsed = UpdateIssuerImagesBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.stamp && !parsed.data.signature)) {
    res.status(400).json({ error: "Selecciona al menos una imagen PNG válida para sustituir." });
    return;
  }
  const row = await settings();
  if (!row) {
    res.status(422).json({ error: "Completa primero los datos del emisor en Ajustes." });
    return;
  }

  const replacements: Partial<Record<"stampPath" | "signaturePath", string>> = {};
  const validated: { field: "stampPath" | "signaturePath"; bytes: Buffer | null }[] = [];
  for (const [field, dataUrl] of [
    ["stampPath", parsed.data.stamp],
    ["signaturePath", parsed.data.signature],
  ] as const) {
    if (dataUrl) validated.push({ field, bytes: decodeIssuerPng(dataUrl) });
  }
  if (validated.some(image => image.bytes === null)) {
    res.status(422).json({ error: "Cada archivo debe ser un PNG válido de hasta 1 MB y con dimensiones razonables." });
    return;
  }
  const uploaded: string[] = [];
  try {
    for (const { field, bytes } of validated) {
      if (!bytes) continue;
      const path = `/objects/legal/${randomUUID()}.png`;
      await privateImage(path).save(bytes, {
        resumable: false,
        contentType: "image/png",
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      replacements[field] = path;
      uploaded.push(path);
    }
    const [updated] = await db.transaction(async tx => {
      // Pin the previous assets to pre-existing drafts before changing the current version.
      await tx.update(invoicesTable)
        .set({ legalImageSnapshot: { stampPath: row.stampPath, signaturePath: row.signaturePath } })
        .where(and(isNull(invoicesTable.legalImageSnapshot), isNull(invoicesTable.legalDocument)));
      return tx.update(issuerSettingsTable)
        .set({
          ...replacements,
          authorization: {
            source: "Aprobación del propietario al sustituir las imágenes autorizadas desde Ajustes.",
            approvedAt: new Date().toISOString(),
          },
        })
        .where(eq(issuerSettingsTable.id, 1))
        .returning();
    });
    if (!updated) throw new Error("No se pudo guardar la configuración de las imágenes.");
    res.set("Cache-Control", "private, no-store").json(toSettings(updated));
  } catch {
    await Promise.all(uploaded.map(path => privateImage(path).delete({ ignoreNotFound: true }).catch(() => undefined)));
    res.status(503).json({ error: "No se pudieron guardar las imágenes privadas. La configuración anterior sigue activa." });
  }
});

router.get("/issuer/images/:kind", async (req, res): Promise<void> => {
  if (!await requireOwner(req, res)) return;
  const kind = req.params.kind;
  if (kind !== "stamp" && kind !== "signature") {
    res.sendStatus(404);
    return;
  }
  const row = await settings();
  const path = kind === "stamp" ? row?.stampPath : row?.signaturePath;
  if (!path) {
    res.sendStatus(404);
    return;
  }
  try {
    const [data] = await privateImage(path).download();
    res.set({
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    }).send(data);
  } catch {
    res.status(503).json({ error: "No se pudo cargar la imagen privada del emisor." });
  }
});

router.put("/invoices/:id/legal-document", async (req, res) => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const id = Number(req.params.id);
  const parsed = AuthorizeInvoiceDocumentBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    res.status(400).json({ error: "Completa el responsable y su cargo, y confirma expresamente la autorización." }); return;
  }
  const current = await getInvoiceRow(id, invoiceScope(member));
  if (!current) { res.status(404).json({ error: "Factura no encontrada." }); return; }
  const input = parsed.data;
  if (!input.confirm || !input.preparedBy.trim() || !input.preparedPosition.trim()) {
    res.status(422).json({ error: "Indica el nombre de quien realiza la factura y su cargo antes de confirmar el modelo." }); return;
  }
  const row = await settings();
  if (!row || !UpdateIssuerBody.safeParse(row.profile).success) {
    res.status(422).json({ error: "Configura primero los datos legales y de pago del emisor en Ajustes." }); return;
  }
  if (!row.stampPath || !row.signaturePath || !row.authorization) {
    res.status(422).json({ error: "El propietario debe configurar el cuño ASSI y la firma autorizada antes de terminar facturas." }); return;
  }
  // New invoices capture image paths at creation. Legacy drafts without a snapshot keep
  // using the active paths until the first replacement backfills their previous version.
  const imageSnapshot = resolveLegalImageSnapshot(current.legalImageSnapshot, {
    stampPath: row.stampPath,
    signaturePath: row.signaturePath,
  });
  if (!hasCompleteLegalImageSnapshot(imageSnapshot)) {
    res.status(422).json({ error: "La factura se creó antes de configurar estas imágenes. Crea una factura nueva para usar las imágenes actuales." }); return;
  }
  const document: LegalDocument = {
    ...input, useStamp: true, useSignature: true, confirm: true, issuer: row.profile,
    stampPath: imageSnapshot.stampPath, signaturePath: imageSnapshot.signaturePath,
    authorizedAt: new Date().toISOString(), authorizedBy: member.userId,
  };
  const [saved] = await db.update(invoicesTable).set({ legalDocument: document })
    .where(and(eq(invoicesTable.id, id), invoiceScope(member), eq(invoicesTable.status, "draft"))).returning();
  if (!saved) {
    res.status(409).json({ error: "Solo se puede autorizar el modelo de un borrador; una factura emitida no se modifica." }); return;
  }
  res.json(GetInvoiceResponse.parse(serializeInvoice((await getInvoiceRow(id))!)));
});

async function sendImage(id: number, kind: string, res: Response, scope?: SQL, shareId?: number) {
  if (!["stamp", "signature"].includes(kind)) { res.sendStatus(404); return; }
  const invoice = await getInvoiceRow(id, scope);
  // Drafts and cancellations never expose scans, even if an old share exists.
  const path = invoice?.legalDocument?.[kind === "stamp" ? "stampPath" : "signaturePath"];
  if (!invoice || !["finished", "accepted", "confirmed", "sent", "paid"].includes(invoice.status) || !path) { res.sendStatus(404); return; }
  try {
    const file = privateImage(path);
    const [data] = await file.download();
    if (shareId !== undefined) {
      await db.insert(invoiceImageAccessesTable).values({
        invoiceId: id,
        shareId,
        kind: kind as "stamp" | "signature",
      });
    }
    res.set({ "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(data);
  } catch {
    res.status(503).json({ error: "No se pudo cargar la imagen autorizada. No imprimas hasta resolverlo." });
  }
}

router.get("/invoices/:id/images/:kind", async (req, res) => {
  const member = await resolveTeamMember(req, res);
  if (!member) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.sendStatus(404); return; }
  await sendImage(id, req.params.kind, res, invoiceScope(member));
});
router.get("/shared-invoices/:token/images/:kind", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const share = await getActiveInvoiceShare(req.params.token);
  if (!share || share.paymentId !== null) { res.sendStatus(404); return; }
  await sendImage(share.invoiceId, req.params.kind, res, undefined, share.id);
});

router.get("/invoices/:id/image-accesses", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  if (!await requireOwner(req, res)) return;
  const params = ListInvoiceImageAccessesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Identificador no válido." }); return; }
  const invoiceId = params.data.id;
  const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId)).limit(1);
  if (!invoice) { res.status(404).json({ error: "Factura no disponible." }); return; }
  const accesses = await db.select({
    invoiceId: invoiceImageAccessesTable.invoiceId,
    shareId: invoiceImageAccessesTable.shareId,
    kind: invoiceImageAccessesTable.kind,
    openedAt: invoiceImageAccessesTable.openedAt,
  }).from(invoiceImageAccessesTable)
    .where(eq(invoiceImageAccessesTable.invoiceId, invoiceId))
    .orderBy(desc(invoiceImageAccessesTable.openedAt), desc(invoiceImageAccessesTable.id));
  res.json(ListInvoiceImageAccessesResponse.parse(accesses.map(access => ({
    ...access,
    openedAt: access.openedAt.toISOString(),
  }))));
});

export default router;
