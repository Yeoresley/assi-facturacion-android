// Manual, owner-approved import from the locally extracted reference scans.
// Never mounted as an HTTP endpoint. Run from repository root.
import { readFile } from "node:fs/promises";
import { privateImage } from "../lib/private-images";

for (const [name, path] of [
  ["stamp", "/objects/legal/6338a097-3995-46cb-9e6b-c776f5fd237c.png"],
  ["signature", "/objects/legal/6d937bb7-e42d-497a-b245-398ed254d09e.png"],
]) {
  const file = privateImage(path);
  const [exists] = await file.exists();
  if (!exists) await file.save(await readFile(new URL(`../../../../generated-artifacts/authorized-images/${name}.png`, import.meta.url)), {
    resumable: false, contentType: "image/png", preconditionOpts: { ifGenerationMatch: 0 },
  });
}
