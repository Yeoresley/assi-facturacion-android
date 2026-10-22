import { Router, type IRouter, type Response } from "express";
import { requireOwner } from "../middlewares/team-access";
import {
  deleteAuthorizedProductionTestData,
  getProductionTestCleanupPreview,
  TestCleanupError,
  type TestCleanupTargets,
} from "../services/production-test-cleanup";

const router: IRouter = Router();
const confirmationPhrase = "ELIMINAR DATOS DE PRUEBA";

function getTargets(): TestCleanupTargets | null {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.ASSI_PRODUCTION_TEST_CLEANUP !== "true"
  ) return null;

  const raw = process.env.ASSI_PRODUCTION_TEST_CLEANUP_TARGETS;
  if (!raw) throw new TestCleanupError("La herramienta de limpieza no tiene un alcance configurado.", 503);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TestCleanupError("La configuración de limpieza no es válida.", 503);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new TestCleanupError("La configuración de limpieza no es válida.", 503);
  }

  const value = parsed as Partial<TestCleanupTargets>;
  const validInvoices = Array.isArray(value.invoices) && value.invoices.length > 0 &&
    value.invoices.every((invoice) =>
      invoice && Number.isInteger(invoice.id) && invoice.id > 0 &&
      typeof invoice.number === "string" && invoice.number.length > 0 &&
      typeof invoice.versatNumber === "string" && invoice.versatNumber.length > 0 &&
      typeof invoice.talon === "string" && /^\d+$/.test(invoice.talon),
    );
  const validExpenses = Array.isArray(value.expenses) &&
    value.expenses.every((expense) =>
      expense && Number.isInteger(expense.id) && expense.id > 0 &&
      typeof expense.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(expense.period),
    );
  const invoiceIds = validInvoices ? value.invoices!.map(({ id }) => id) : [];
  const expenseIds = validExpenses ? value.expenses!.map(({ id }) => id) : [];
  if (
    !validInvoices || !validExpenses ||
    new Set(invoiceIds).size !== invoiceIds.length ||
    new Set(expenseIds).size !== expenseIds.length
  ) throw new TestCleanupError("La configuración de limpieza no es válida.", 503);

  return { invoices: value.invoices!, expenses: value.expenses! };
}

function reportError(res: Response, error: unknown) {
  if (error instanceof TestCleanupError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: "No se pudo completar la operación de limpieza." });
}

router.get("/admin/production-test-cleanup", async (req, res): Promise<void> => {
  try {
    const targets = getTargets();
    if (!targets) {
      res.status(404).end();
      return;
    }
    if (!(await requireOwner(req, res))) return;
    res.set("Cache-Control", "private, no-store");
    res.json(await getProductionTestCleanupPreview(targets));
  } catch (error) {
    reportError(res, error);
  }
});

router.post("/admin/production-test-cleanup", async (req, res): Promise<void> => {
  try {
    const targets = getTargets();
    if (!targets) {
      res.status(404).end();
      return;
    }
    if (!(await requireOwner(req, res))) return;
    res.set("Cache-Control", "private, no-store");
    if (req.body?.confirmation !== confirmationPhrase) {
      res.status(422).json({ error: `Escribe exactamente: ${confirmationPhrase}.` });
      return;
    }
    const result = await deleteAuthorizedProductionTestData(targets);
    res.json({ completed: true, ...result });
  } catch (error) {
    reportError(res, error);
  }
});

export default router;
