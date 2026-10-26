import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  customersTable,
  invoiceLinesTable,
  invoiceNumberReservationsTable,
  invoicePaymentsTable,
  invoiceSeriesTable,
  invoicesTable,
  settlementClassificationsTable,
  teamInvitationsTable,
  teamMembersTable,
  versatCatalogTable,
} from "@workspace/db";

type ParsedLine = {
  sourceCode: string;
  description: string;
  unitCode: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type ParsedInvoice = {
  number: string;
  sequence: number;
  issueDate: string;
  customerCode: string;
  customerName: string;
  customerAddress: string | null;
  customerTaxId: string | null;
  paymentName: string;
  operationName: string;
  authorName: string | null;
  notes: string | null;
  bankAccountMC: string | null;
  total: number;
  lines: ParsedLine[];
  sourceFile: string;
};

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const attachmentsDir = resolve(workspaceRoot, "attached_assets");
const expectedMissingSequences = new Set([63, 84]);
const cxCOpenSequences = new Set([
  7, 8, 14, 22, 39, 48, 51, 53, 59, 60, 68, 69, 70, 72, 75, 76, 79, 80, 81, 82, 83,
]);
const fallbackCommercialCode = "74";
const historicalPartialPayment = {
  sequence: 51,
  amount: 4000,
  currency: "CUP",
  paidOn: "2026-06-29",
  reference: "LDC-1",
  idempotencyKey: "historical-cxc-2026-hab-26-051-ldc-1",
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function parseAmount(value: string): number {
  const parsed = Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) throw new Error(`Importe inválido: ${value}`);
  return parsed;
}

function toIsoDate(day: string, month: string, year: string): string {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseLines(text: string): ParsedLine[] {
  const sourceLines = text.split(/\r?\n/);
  const linePattern =
    /^\s*([0-9][0-9.\-]*?)\s{2,}(.+?)\s{2,}(Uno|Unidad|Mes|Horas|Mts2|Mts3|días|\$)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/i;
  const stopContinuation =
    /Subtotal|Rec\.\/Desc|Total Factura|Comentario|Forma de Pago|Digitally signed|Realizada por/i;
  const result: ParsedLine[] = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const match = sourceLines[index].match(linePattern);
    if (!match) continue;
    const [, sourceCode, initialDescription, unitCode, quantity, unitPrice, amount] = match;
    const descriptionParts = [initialDescription.trim()];

    for (let nextIndex = index + 1; nextIndex < sourceLines.length; nextIndex += 1) {
      const candidate = sourceLines[nextIndex];
      if (!candidate.trim() || linePattern.test(candidate) || stopContinuation.test(candidate)) break;
      if (candidate.search(/\S/) < 12) break;
      descriptionParts.push(candidate.trim());
      index = nextIndex;
    }

    result.push({
      sourceCode,
      description: descriptionParts.join(" "),
      unitCode,
      quantity: parseAmount(quantity),
      unitPrice: parseAmount(unitPrice),
      amount: parseAmount(amount),
    });
  }

  return result;
}

function parseComment(lines: string[]): string | null {
  const labelPattern = /C\s*o\s*m\s*e\s*n\s*t\s*a\s*r\s*i\s*o\s*:/i;
  const start = lines.findIndex((line) => labelPattern.test(line));
  if (start < 0) return null;

  const stopPattern = /Subtotal|Rec\.\/Desc|Total Factura CUP/i;
  const pieces: string[] = [];
  const firstLine = lines[start];
  const firstMatch = firstLine.match(labelPattern);
  if (firstMatch) {
    const remainder = firstLine.slice(firstMatch.index! + firstMatch[0].length)
      .split(stopPattern)[0]
      .trim();
    if (remainder) pieces.push(remainder);
  }

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const stop = line.search(stopPattern);
    const content = (stop >= 0 ? line.slice(0, stop) : line).trim();
    if (content) pieces.push(content);
    if (stop >= 0) break;
  }

  return pieces.join(" ").replace(/\s+/g, " ").trim() || null;
}

function parsePdf(filePath: string): ParsedInvoice {
  const text = execFileSync("pdftotext", ["-layout", filePath, "-"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const numberMatch = text.match(/Número:\s*HAB[- ]?26[- ]?(\d{3})/i);
  const dateMatch = text.match(/Fecha Emisión:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  const customerMatch = text.match(/Cliente:\s*(\d+)\s+([^\r\n]+)/i);
  const paymentMatch = text.match(/Forma de Pago:\s*(.*?)\s+Operación:/i);
  const operationMatch = text.match(/Operación:\s*([^\r\n]+)/i);
  const totalMatch = text.match(/Total Factura CUP\s*([\d,]+\.\d{2})/i);
  const bankMatch = text.match(/Páguese CUP a .*?Cuenta:\s*([0-9 ]+?)\s+Sucursal:/i);
  const authorLine = text.split(/\r?\n/).find((line) => /Realizada por:/i.test(line));
  const commentLines = text.split(/\r?\n/);

  if (!numberMatch || !dateMatch || !customerMatch || !paymentMatch || !operationMatch || !totalMatch) {
    throw new Error(`No se pudieron leer los campos principales del PDF ${filePath}`);
  }

  const sequence = Number(numberMatch[1]);
  const customerStart = text.indexOf(customerMatch[0]);
  const paymentStart = text.indexOf(paymentMatch[0], customerStart);
  const customerBlock = text.slice(customerStart, paymentStart > customerStart ? paymentStart : undefined);
  const taxIds = [...customerBlock.matchAll(/\bNIT:\s*([0-9]+)/gi)];
  const addressMatches = [...customerBlock.matchAll(/Direcci[oó]n:\s*([^\r\n]+)/gi)];
  const customerAddress = addressMatches.at(-1)?.[1]?.trim() || null;
  const customerTaxId = taxIds.at(-1)?.[1] || null;

  let authorName: string | null = null;
  if (authorLine) {
    const label = authorLine.search(/Realizada por:/i);
    const afterLabel = authorLine.slice(label + "Realizada por:".length);
    const transporter = afterLabel.search(/(?:Trasportado|Transportado)\s+por:/i);
    const candidate = (transporter >= 0 ? afterLabel.slice(0, transporter) : afterLabel).trim();
    authorName = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(candidate) ? candidate : null;
  }

  const lines = parseLines(text);
  const total = parseAmount(totalMatch[1]);
  const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  if (!lines.length || Math.round(lineTotal * 100) !== Math.round(total * 100)) {
    throw new Error(
      `Las líneas no cuadran con el total de HAB-26-${String(sequence).padStart(3, "0")}: ` +
      `${lineTotal} frente a ${total}`,
    );
  }

  return {
    number: `HAB-26-${String(sequence).padStart(3, "0")}`,
    sequence,
    issueDate: toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]),
    customerCode: customerMatch[1],
    customerName: customerMatch[2].trim(),
    customerAddress,
    customerTaxId,
    paymentName: paymentMatch[1].trim(),
    operationName: operationMatch[1].trim(),
    authorName,
    notes: parseComment(commentLines),
    bankAccountMC: bankMatch?.[1]?.trim() || null,
    total,
    lines,
    sourceFile: filePath,
  };
}

function sameInvoiceData(left: ParsedInvoice, right: ParsedInvoice): boolean {
  return left.issueDate === right.issueDate
    && left.customerCode === right.customerCode
    && left.total === right.total
    && JSON.stringify(left.lines) === JSON.stringify(right.lines);
}

function assertExpectedSource(invoices: ParsedInvoice[]): void {
  const bySequence = new Map(invoices.map((invoice) => [invoice.sequence, invoice]));
  const expected = Array.from({ length: 90 }, (_, index) => index + 1)
    .filter((sequence) => !expectedMissingSequences.has(sequence));
  const missing = expected.filter((sequence) => !bySequence.has(sequence));
  const unexpected = [...bySequence.keys()].filter((sequence) => !expected.includes(sequence));

  if (invoices.length !== 88 || missing.length || unexpected.length) {
    throw new Error(
      `Cobertura inesperada. Únicas=${invoices.length}, faltantes=${missing.join(",")}, ` +
      `fuera de rango=${unexpected.join(",")}`,
    );
  }
}

async function loadSource(): Promise<ParsedInvoice[]> {
  const files = readdirSync(attachmentsDir)
    .filter((file) => file.toLowerCase().includes("hab") && file.toLowerCase().endsWith(".pdf"))
    .sort();
  const parsed = files.map((file) => parsePdf(resolve(attachmentsDir, file)));
  const byNumber = new Map<string, ParsedInvoice>();

  for (const invoice of parsed) {
    const existing = byNumber.get(invoice.number);
    if (existing && !sameInvoiceData(existing, invoice)) {
      throw new Error(`Hay PDFs diferentes para el mismo número ${invoice.number}`);
    }
    if (!existing) byNumber.set(invoice.number, invoice);
  }

  const unique = [...byNumber.values()].sort((left, right) => left.sequence - right.sequence);
  assertExpectedSource(unique);
  return unique;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply-development");
  if (apply && process.env.NODE_ENV !== "development") {
    throw new Error("La importación solo puede aplicarse con NODE_ENV=development.");
  }

  const source = await loadSource();
  const catalog = await db.select().from(versatCatalogTable);
  const customers = await db.select().from(customersTable);
  const members = await db.select().from(teamMembersTable);
  const invitations = await db.select().from(teamInvitationsTable);
  const series = await db.select().from(invoiceSeriesTable);
  const activeSeries = series.find((entry) =>
    entry.id === 100
      && entry.prefix === "HAB-26-"
      && entry.width === 3
      && entry.talon === "5"
      && entry.active,
  );
  if (!activeSeries) throw new Error("No coincide la serie HAB-26 con talón 5 de desarrollo.");

  const concept = catalog.find((entry) => entry.kind === "concept" && entry.code === "001" && entry.active);
  const currency = catalog.find((entry) => entry.kind === "currency" && entry.code === "CUP" && entry.active);
  if (!concept || !currency) throw new Error("Falta el concepto 001 o la moneda CUP en el catálogo.");

  const commercialByName = new Map(
    catalog.filter((entry) => entry.kind === "commercial" && entry.active)
      .map((entry) => [normalizeText(entry.name), entry]),
  );
  const serviceByCode = new Map(
    catalog.filter((entry) => entry.kind === "service" && entry.active)
      .map((entry) => [digitsOnly(entry.exportValue ?? entry.code), entry]),
  );
  const operationByName = new Map(
    catalog.filter((entry) => entry.kind === "operation" && entry.active)
      .map((entry) => [normalizeText(entry.name), entry]),
  );
  const paymentByName = new Map(
    catalog.filter((entry) => entry.kind === "payment" && entry.active)
      .map((entry) => [normalizeText(entry.name), entry]),
  );

  const prepared = source.map((invoice) => {
    const customerMatches = customers.filter((customer) =>
      customer.versatCode === invoice.customerCode
      || digitsOnly(customer.versatCode) === digitsOnly(invoice.customerCode),
    );
    if (customerMatches.length !== 1) {
      throw new Error(`El cliente ${invoice.customerCode} no tiene una coincidencia única en el catálogo.`);
    }

    const sourceAuthor = normalizeText(invoice.authorName ?? "");
    const commercial = sourceAuthor
      ? commercialByName.get(sourceAuthor)
      : commercialByName.get(normalizeText("Yeoresley Dominguez Gomez"));
    if (!commercial) {
      throw new Error(
        `No existe comercial de catálogo para ${invoice.authorName ?? "autor vacío"} en ${invoice.number}.`,
      );
    }

    const operation = operationByName.get(normalizeText(invoice.operationName));
    const payment = paymentByName.get(normalizeText(invoice.paymentName));
    if (!operation || !payment) {
      throw new Error(`Operación o forma de pago sin catálogo para ${invoice.number}.`);
    }

    const invoiceLines = invoice.lines.map((line) => {
      const service = serviceByCode.get(digitsOnly(line.sourceCode));
      if (!service) {
        throw new Error(`Código de servicio sin catálogo: ${line.sourceCode} en ${invoice.number}.`);
      }
      return { source: line, service };
    });

    const account = members.find((member) =>
      member.role === "specialist"
      && !member.suspended
      && invitations.some((invitation) =>
        invitation.email === member.email && invitation.commercialId === commercial.id,
      ),
    );
    const specialistId = account?.userId ?? `historical-commercial-${commercial.id}`;
    const specialistName = commercial.name;
    const metadata = commercial.metadata as { position?: unknown } | null;
    const commercialPosition =
      typeof metadata?.position === "string" ? metadata.position : "";
    const customer = customerMatches[0];
    const versat = {
      conceptId: concept.id,
      operationId: operation.id,
      commercialId: commercial.id,
      paymentId: payment.id,
      number: invoice.number,
      talon: "5",
      bankAccountMC: invoice.bankAccountMC,
      bankAccountOM: null,
      contract: null,
      currencyName: currency.name,
      conceptCode: concept.code ?? "001",
      operationName: operation.exportValue ?? operation.name,
      commercialName: commercial.exportValue ?? commercial.name,
      commercialPosition,
      paymentName: payment.exportValue ?? payment.name,
      customerCode: invoice.customerCode,
      customerName: invoice.customerName,
      customerAddress: invoice.customerAddress ?? customer.address,
      customerTaxId: invoice.customerTaxId ?? customer.taxId,
    };

    return {
      invoice,
      customer,
      operation,
      payment,
      commercial,
      specialistId,
      specialistName,
      versat,
      invoiceLines,
      paymentStatus: cxCOpenSequences.has(invoice.sequence) ? "pending" as const : "paid" as const,
    };
  });

  const cxcGross = prepared
    .filter((entry) => cxCOpenSequences.has(entry.invoice.sequence))
    .reduce((sum, entry) => sum + entry.invoice.total, 0);
  const cxcBalance = cxcGross - historicalPartialPayment.amount;
  if (cxcBalance !== 219900 || cxCOpenSequences.size !== 21) {
    throw new Error(`El CxC no concilia: saldo calculado ${cxcBalance} CUP.`);
  }

  const fallbackSequences = source
    .filter((invoice) => !invoice.authorName)
    .map((invoice) => invoice.sequence)
    .sort((left, right) => left - right);
  if (fallbackSequences.join(",") !== "4,29") {
    throw new Error(`Autores vacíos inesperados: ${fallbackSequences.join(",")}`);
  }

  const owners = members.filter((member) => member.role === "owner" && !member.suspended);
  if (owners.length !== 1) throw new Error("Se esperaba exactamente un propietario activo para registrar el abono.");
  const ownerId = owners[0].userId;
  const invoiceNumbers = prepared.map((entry) => entry.invoice.number);

  console.log(JSON.stringify({
    mode: apply ? "apply-development" : "dry-run",
    pdfFiles: readdirSync(attachmentsDir)
      .filter((file) => file.toLowerCase().includes("hab") && file.toLowerCase().endsWith(".pdf")).length,
    uniqueInvoices: prepared.length,
    lineCount: prepared.reduce((sum, entry) => sum + entry.invoiceLines.length, 0),
    paidInvoices: prepared.filter((entry) => entry.paymentStatus === "paid").length,
    unpaidCxcInvoices: cxCOpenSequences.size,
    cxcBalance,
    fallbackToYeoresley: fallbackSequences,
    historicalCommercialsWithoutAccounts: [...new Set(
      prepared.filter((entry) => entry.specialistId.startsWith("historical-commercial-"))
        .map((entry) => entry.specialistName),
    )],
    totalInvoiceValue: prepared.reduce((sum, entry) => sum + entry.invoice.total, 0),
  }, null, 2));

  if (!apply) {
    console.log("Sin escrituras. Para aplicar, ejecuta con --apply-development y NODE_ENV=development.");
    return;
  }

  const result = await db.transaction(async (tx) => {
    const allInvoices = await tx.select().from(invoicesTable);
    const existingByVersatNumber = new Map(
      allInvoices.flatMap((invoice) =>
        invoice.versatNumber ? [[invoice.versatNumber, invoice] as const] : [],
      ),
    );
    const existingByNumber = new Map(allInvoices.map((invoice) => [invoice.number, invoice]));
    const reservations = await tx.select().from(invoiceNumberReservationsTable);
    const reservationByNumber = new Map(reservations.map((reservation) => [reservation.number, reservation]));
    const ids = new Map<string, number>();
    let insertedInvoices = 0;
    let insertedLines = 0;

    for (const entry of prepared) {
      const { invoice, customer, specialistId, specialistName, versat, invoiceLines, paymentStatus } = entry;
      const existing = existingByVersatNumber.get(invoice.number);
      const conflictingInternalNumber = existingByNumber.get(invoice.number);
      if (conflictingInternalNumber && conflictingInternalNumber.versatNumber !== invoice.number) {
        throw new Error(`El número interno ${invoice.number} ya pertenece a otra factura.`);
      }

      let invoiceId: number;
      if (existing) {
        const compatible = existing.number === invoice.number
          && existing.issueDate === invoice.issueDate
          && existing.customerId === customer.id
          && Number(existing.total) === invoice.total
          && existing.status === "confirmed"
          && existing.paymentStatus === paymentStatus;
        if (!compatible) throw new Error(`La factura existente ${invoice.number} difiere del PDF.`);
        const existingLines = await tx.select().from(invoiceLinesTable)
          .where(eq(invoiceLinesTable.invoiceId, existing.id));
        if (existingLines.length !== invoiceLines.length) {
          throw new Error(`La factura existente ${invoice.number} tiene líneas incompletas.`);
        }
        invoiceId = existing.id;
      } else {
        const [created] = await tx.insert(invoicesTable).values({
          number: invoice.number,
          customerId: customer.id,
          specialistId,
          specialistName,
          issueDate: invoice.issueDate,
          dueDate: null,
          currency: "CUP",
          status: "confirmed",
          acceptedSource: "versat_import",
          paymentStatus,
          notes: invoice.notes,
          versat,
          versatNumber: invoice.number,
          seriesId: activeSeries.id,
          subtotal: invoice.total,
          total: invoice.total,
          createdAt: new Date(`${invoice.issueDate}T12:00:00.000Z`),
        }).returning({ id: invoicesTable.id });
        if (!created) throw new Error(`No se creó ${invoice.number}.`);
        invoiceId = created.id;
        insertedInvoices += 1;

        const createdLines = await tx.insert(invoiceLinesTable).values(
          invoiceLines.map(({ source, service }) => ({
            invoiceId,
            description: source.description,
            serviceId: service.id,
            serviceCode: service.exportValue ?? service.code,
            groupCode: (service.metadata as { groupCode?: string } | null)?.groupCode ?? null,
            unitCode: source.unitCode,
            quantity: source.quantity,
            unitPrice: source.unitPrice,
            amount: source.amount,
          })),
        ).returning({
          id: invoiceLinesTable.id,
          serviceCode: invoiceLinesTable.serviceCode,
          description: invoiceLinesTable.description,
        });

        const classifications = createdLines.map((line) => ({
          invoiceLineId: line.id,
          salesType: digitsOnly(line.serviceCode).startsWith("4651") ? "license" as const : "service" as const,
          label: `${digitsOnly(line.serviceCode).startsWith("4651") ? "Licencia" : "Servicio"} · ${line.serviceCode ?? line.description}`,
          updatedBy: ownerId,
        }));
        if (classifications.length) {
          await tx.insert(settlementClassificationsTable).values(classifications).onConflictDoNothing();
        }
        insertedLines += createdLines.length;
      }

      ids.set(invoice.number, invoiceId);
      const reservation = reservationByNumber.get(invoice.number);
      if (reservation?.invoiceId && reservation.invoiceId !== invoiceId) {
        throw new Error(`La reserva ${invoice.number} ya está asociada a otra factura.`);
      }
      await tx.insert(invoiceNumberReservationsTable).values({
        number: invoice.number,
        invoiceId,
        talon: "5",
      }).onConflictDoUpdate({
        target: invoiceNumberReservationsTable.number,
        set: { invoiceId, talon: "5" },
      });
    }

    const partialInvoiceId = ids.get("HAB-26-051");
    if (!partialInvoiceId) throw new Error("No se encontró HAB-26-051 para registrar su abono.");
    const priorPartial = await tx.select().from(invoicePaymentsTable)
      .where(and(
        eq(invoicePaymentsTable.invoiceId, partialInvoiceId),
        eq(invoicePaymentsTable.idempotencyKey, historicalPartialPayment.idempotencyKey),
      ));
    if (!priorPartial.length) {
      await tx.insert(invoicePaymentsTable).values({
        invoiceId: partialInvoiceId,
        idempotencyKey: historicalPartialPayment.idempotencyKey,
        amount: historicalPartialPayment.amount,
        currency: historicalPartialPayment.currency,
        paidOn: historicalPartialPayment.paidOn,
        reference: historicalPartialPayment.reference,
        paymentMethod: null,
        paidBy: ownerId,
      });
    }

    return { insertedInvoices, insertedLines };
  });

  console.log(JSON.stringify({ ...result, reservedNumbers: invoiceNumbers.length }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
