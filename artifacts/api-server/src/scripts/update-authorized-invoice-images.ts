// One-time owner-approved import of the current ASSI stamp and accounting signature.
// Run from the repository root through the workspace scripts package.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, issuerSettingsTable } from "@workspace/db";
import { privateImage } from "../lib/private-images";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sourceFiles = [
  ["stampPath", "stamp.png"],
  ["signaturePath", "signature.png"],
] as const;

async function updateAuthorizedImages() {
  const [settings] = await db.select({ id: issuerSettingsTable.id })
    .from(issuerSettingsTable)
    .where(eq(issuerSettingsTable.id, 1));
  if (!settings) throw new Error("No existe la configuración del emisor; no se modificó ninguna factura.");

  const paths: Record<(typeof sourceFiles)[number][0], string> = {
    stampPath: `/objects/legal/${randomUUID()}.png`,
    signaturePath: `/objects/legal/${randomUUID()}.png`,
  };
  const uploaded: string[] = [];

  try {
    for (const [field, filename] of sourceFiles) {
      const bytes = await readFile(new URL(`../../../../generated-artifacts/authorized-images/${filename}`, import.meta.url));
      if (bytes.length < pngSignature.length || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) {
        throw new Error(`El archivo ${filename} no es una imagen PNG válida.`);
      }
      await privateImage(paths[field]).save(bytes, {
        resumable: false,
        contentType: "image/png",
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      uploaded.push(paths[field]);
    }

    const [updated] = await db.update(issuerSettingsTable)
      .set({
        stampPath: paths.stampPath,
        signaturePath: paths.signaturePath,
        authorization: {
          source: "Aprobación expresa del propietario: incorporar el cuño ASSI y la firma entregada en el bloque Contabilizada por.",
          approvedAt: new Date().toISOString(),
        },
      })
      .where(eq(issuerSettingsTable.id, 1))
      .returning({ id: issuerSettingsTable.id });
    if (!updated) throw new Error("No se pudo guardar la configuración de las imágenes autorizadas.");
    process.stdout.write("Imágenes autorizadas actualizadas en almacenamiento privado.\n");
  } catch (error) {
    await Promise.all(uploaded.map(path => privateImage(path).delete({ ignoreNotFound: true }).catch(() => undefined)));
    throw error;
  }
}

updateAuthorizedImages().then(() => process.exit(0)).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "No se pudieron actualizar las imágenes autorizadas."}\n`);
  process.exit(1);
});
