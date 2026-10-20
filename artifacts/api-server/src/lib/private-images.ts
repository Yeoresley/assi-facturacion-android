import { Storage } from "@google-cloud/storage";

// Replit App Storage sidecar authentication; never use public asset directories.
export const imageStorage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export function privateImage(path: string) {
  const root = process.env.PRIVATE_OBJECT_DIR;
  if (!root || !path.startsWith("/objects/legal/") || path.includes("..")) {
    throw new Error("Ruta de imagen privada no válida.");
  }
  const [bucket, ...parts] = `${root.replace(/^\/|\/$/g, "")}/${path.slice("/objects/".length)}`.split("/");
  return imageStorage.bucket(bucket).file(parts.join("/"));
}
