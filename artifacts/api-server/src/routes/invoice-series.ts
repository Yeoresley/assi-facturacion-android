import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, invoiceSeriesTable } from "@workspace/db";
import { CreateInvoiceSeriesBody, CreateInvoiceSeriesResponse, ListInvoiceSeriesResponse, UpdateInvoiceSeriesBody, UpdateInvoiceSeriesParams, UpdateInvoiceSeriesResponse } from "@workspace/api-zod";
import { requireOwner, resolveTeamMember } from "../middlewares/team-access";
import { formatSeries, lockNumbering, NumberingError } from "../services/invoice-numbering";

const router: IRouter = Router();
router.get("/billing/series", async (req, res) => {
  if (!await resolveTeamMember(req, res)) return;
  res.json(ListInvoiceSeriesResponse.parse(await db.select().from(invoiceSeriesTable).orderBy(invoiceSeriesTable.id)));
});
router.post("/billing/series", async (req, res) => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const parsed = CreateInvoiceSeriesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { confirmedWithVersat, ...input } = parsed.data;
  if (!confirmedWithVersat || !input.name.trim()) { res.status(422).json({ error: "Confirma los datos contrastados con Versat." }); return; }
  try {
    formatSeries(input);
    const series = await db.transaction(async (tx) => {
      await lockNumbering(tx);
      const [result] = await tx.insert(invoiceSeriesTable).values({ ...input, name: input.name.trim(), confirmedBy: owner.userId }).returning();
      return result;
    });
    res.status(201).json(CreateInvoiceSeriesResponse.parse(series));
  } catch (error) {
    if (error instanceof NumberingError) { res.status(error.status).json({ error: error.message }); return; }
    const code = (error as { cause?: { code?: string }; code?: string });
    if ((code.cause?.code ?? code.code) === "23505") { res.status(409).json({ error: "Ya existe una serie con ese nombre." }); return; }
    throw error;
  }
});
router.patch("/billing/series/:id", async (req, res) => {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const params = UpdateInvoiceSeriesParams.safeParse(req.params);
  const body = UpdateInvoiceSeriesBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Datos de serie no válidos." }); return; }
  try {
    const series = await db.transaction(async (tx) => {
      await lockNumbering(tx);
      const [current] = await tx.select().from(invoiceSeriesTable).where(eq(invoiceSeriesTable.id, params.data.id)).for("update");
      if (!current) throw new NumberingError("Serie no encontrada.", 404);
      if (!body.data.confirmedWithVersat || body.data.nextNumber < current.nextNumber) {
        throw new NumberingError("No se puede retroceder el contador. Actualiza y contrasta el siguiente número con Versat.");
      }
      // Retiring an exhausted series must still be possible.
      if (body.data.active) formatSeries({ ...current, nextNumber: body.data.nextNumber });
      const [result] = await tx.update(invoiceSeriesTable).set({
        active: body.data.active, nextNumber: body.data.nextNumber,
        confirmedBy: owner.userId, confirmedAt: new Date(),
      }).where(eq(invoiceSeriesTable.id, current.id)).returning();
      return result;
    });
    res.json(UpdateInvoiceSeriesResponse.parse(series));
  } catch (error) {
    if (!(error instanceof NumberingError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
});
export default router;
