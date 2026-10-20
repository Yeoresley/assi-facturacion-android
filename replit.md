# Facturación Equipo

Aplicación web en español para que especialistas remotos preparen facturas y el propietario las lleve a Versat Sarasola de escritorio.

## Contexto y estado

- El flujo actual del usuario consiste en confeccionar las facturas en Versat, guardar PDFs con cuño y firma y distribuirlos a los especialistas.
- La primera versión incluye clientes, borradores, estados, impresión mediante navegador y enlaces temporales de factura. WhatsApp y correo abren el canal del usuario; no hay envío automático ni adjuntos automáticos.
- El propietario se identifica por su correo verificado mediante `OWNER_EMAIL`, ya configurado. No conceder administración al primer registro. El propietario autoriza los correos de especialistas.
- Se recibieron un PDF, un `.Fac` y ocho catálogos Excel. Están cargados en la base de datos sin incorporar los originales al bundle público. La exportación de prueba usa `.Fac`, con descarga individual o ZIP por período. Falta validar una importación real en Versat.
- El documento impreso es preliminar: aún debe adaptarse al PDF aportado, incluidos los datos legales, cuño y firma autorizados.
- La moneda inicial es CUP, conforme al documento de referencia. No asumir que una factura guardada en la aplicación ya es compatible con Versat.
- Los enlaces públicos caducan y la base de datos conserva solo el hash del token.
- Ver `docs/versat-format.md` para las observaciones técnicas y preguntas abiertas sobre el formato.
- El catálogo no trae precios. No inventar tarifas, numeración, talones ni agrupadores de servicios desconocidos.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
