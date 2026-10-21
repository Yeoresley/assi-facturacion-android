import Decimal from "decimal.js";
import type { InvoiceInput } from "@workspace/api-zod";
import { customersTable, db, versatCatalogTable, type CatalogKind, type VersatInvoiceSnapshot } from "@workspace/db";

export async function prepareInvoice(
  input: Pick<InvoiceInput, "lines" | "currency" | "versat">,
  customer: typeof customersTable.$inferSelect,
  options: { allowInactiveCatalogIds?: Iterable<number>; currentCurrency?: string } = {},
) {
  const catalog = await db.select().from(versatCatalogTable);
  const allowedInactiveIds = new Set(options.allowInactiveCatalogIds ?? []);
  const entry = (id: number, kind: CatalogKind) => {
    const value = catalog.find((item) => item.id === id && item.kind === kind);
    if (!value) throw new Error(`El código seleccionado no existe en el catálogo de ${kind}.`);
    if (!value.active && !allowedInactiveIds.has(value.id)) {
      throw new Error(`El código seleccionado del catálogo de ${kind} está desactivado. Elige uno activo.`);
    }
    return value;
  };
  const currency = catalog.find((item) => item.kind === "currency" && item.code === input.currency);
  if (!currency) throw new Error("Selecciona una moneda del catálogo de Versat.");
  if (!currency.active && options.currentCurrency !== input.currency) {
    throw new Error("La moneda seleccionada está desactivada. Elige una moneda activa.");
  }
  const lines = input.lines.map((line, index) => {
    const quantity = new Decimal(line.quantity);
    const price = new Decimal(line.unitPrice);
    if (quantity.decimalPlaces() > 4 || price.decimalPlaces() > 5) {
      throw new Error(`Línea ${index + 1}: usa como máximo 4 decimales en cantidad y 5 en precio.`);
    }
    const service = line.serviceId ? entry(line.serviceId, "service") : null;
    const groupCode = line.groupCode?.trim() || service?.metadata.groupCode || null;
    const amount = quantity.mul(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (amount.gte("1000000000000")) throw new Error("El importe supera el límite permitido.");
    return {
      description: service?.name ?? line.description,
      quantity: quantity.toNumber(), unitPrice: price.toNumber(), amount: amount.toNumber(),
      serviceId: service?.id ?? null, serviceCode: service?.code ?? null,
      groupCode, unitCode: service?.metadata.unitCode ?? null,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum.add(line.amount), new Decimal(0));
  if (subtotal.gte("1000000000000")) throw new Error("El total supera el límite permitido.");
  let versat: VersatInvoiceSnapshot | null = null;
  if (input.versat) {
    const values = input.versat;
    const concept = entry(values.conceptId, "concept");
    const operation = entry(values.operationId, "operation");
    const commercial = entry(values.commercialId, "commercial");
    const payment = entry(values.paymentId, "payment");
    const clean = (value?: string | null) => {
      if (value && /[\r\n|]/.test(value)) throw new Error("Los campos de Versat no admiten saltos de línea ni el carácter |.");
      return value?.trim() || null;
    };
    versat = {
      conceptId: concept.id, operationId: operation.id, commercialId: commercial.id, paymentId: payment.id,
      number: clean(values.number), talon: clean(values.talon),
      bankAccountMC: clean(values.bankAccountMC), bankAccountOM: clean(values.bankAccountOM),
      contract: clean(values.contract),
      currencyName: currency.exportValue, conceptCode: concept.code,
      operationName: operation.exportValue, commercialName: commercial.exportValue,
      commercialPosition: commercial.metadata.position ?? "", paymentName: payment.exportValue,
      customerCode: customer.versatCode, customerName: customer.name,
      customerAddress: customer.address, customerTaxId: customer.taxId,
    };
  }
  return { lines, subtotal: subtotal.toNumber(), versat };
}
