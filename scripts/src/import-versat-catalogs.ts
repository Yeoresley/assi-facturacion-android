import { readFile } from "node:fs/promises";
import { db, pool, customersTable, versatCatalogTable } from "@workspace/db";

if (process.argv[2] !== "--apply" || !process.argv[3]) {
  throw new Error("Usage: import-versat-catalogs.ts --apply /tmp/normalized-catalogs.json");
}
const data = JSON.parse(await readFile(process.argv[3], "utf8")) as {
  entries: Array<typeof versatCatalogTable.$inferInsert>;
  customers: Array<typeof customersTable.$inferInsert>;
};
try {
  const result = await db.transaction(async (tx) => {
    const entries = await tx.insert(versatCatalogTable).values(data.entries)
      .onConflictDoNothing().returning({ id: versatCatalogTable.id });
    const customers = await tx.insert(customersTable).values(data.customers)
      .onConflictDoNothing().returning({ id: customersTable.id });
    return { catalogEntriesInserted: entries.length, customersInserted: customers.length };
  });
  console.log(result);
} finally {
  await pool.end();
}
