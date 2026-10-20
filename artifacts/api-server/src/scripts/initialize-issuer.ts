/**
 * One-time reference bootstrap. The owner approved both scans in chat on
 * 2026-10-20. Never replace existing configuration or infer invoice signatories.
 * Images must already exist in private App Storage before metadata is seeded.
 */
import { db, issuerSettingsTable } from "@workspace/db";
import { privateImage } from "../lib/private-images";

const stampPath = "/objects/legal/6338a097-3995-46cb-9e6b-c776f5fd237c.png";
const signaturePath = "/objects/legal/6d937bb7-e42d-497a-b245-398ed254d09e.png";

async function initialize() {
  for (const path of [stampPath, signaturePath]) {
    const [exists] = await privateImage(path).exists();
    if (!exists) throw new Error("Faltan las imágenes autorizadas en App Storage.");
  }
  await db.insert(issuerSettingsTable).values({
    id: 1,
    profile: {
      name: "ASSI S.U.R.L.",
      nit: "50004197762",
      ircc: "1-XVI-61-294",
      address: "CALLE 98, #907 A E/ 9NA Y 11, PLAYA, LA HABANA",
      organization: "MIPYME",
      paymentBeneficiary: "MPM ASSI S.U.R.L.",
      bankAccount: "0524 2450 0004 2917",
      bankBranch: "242",
      bankName: "BANCO METROPOLITANO, S.A.",
    },
    stampPath, signaturePath,
    authorization: {
      source: "Aprobación expresa del propietario en conversación: Sí, autorizo ambos como propietario",
      approvedAt: "2026-10-20",
    },
  }).onConflictDoNothing();
}

initialize().then(() => process.exit(0)).catch(() => {
  process.stderr.write("No se pudo inicializar el emisor; comprueba App Storage y la base de datos.\n");
  process.exit(1);
});
