# Facturación Equipo

Aplicación web en español para que especialistas remotos preparen facturas y el propietario las lleve a Versat Sarasola de escritorio.

## Contexto y estado

- El flujo actual del usuario consiste en confeccionar las facturas en Versat, guardar PDFs con cuño y firma y distribuirlos a los especialistas.
- La primera versión incluye clientes, borradores, estados, impresión mediante navegador y enlaces temporales de factura. WhatsApp y correo abren el canal del usuario; no hay envío automático ni adjuntos automáticos.
- El propietario se identifica por su correo verificado mediante `OWNER_EMAIL`, ya configurado. No conceder administración al primer registro. El propietario autoriza los correos de especialistas.
- Se recibieron un PDF, un `.Fac` y ocho catálogos Excel. Están cargados en la base de datos sin incorporar los originales al bundle público. La exportación de prueba usa `.Fac`, con descarga individual o ZIP por período. Falta validar una importación real en Versat.
- El modelo imprimible y compartido sigue el PDF aportado: emisor configurable solo por el propietario, detalle con 4/5/2 decimales y bloques de responsabilidad. El especialista puede confirmar el documento de su comercial usando el emisor administrado y responsables explícitos; editar el borrador invalida esa confirmación. Las facturas antiguas sin confirmación siguen etiquetadas como preliminares.
- Para las facturas nuevas, el propietario eligió dejar en blanco los espacios del cuño y las firmas. No reutilizar en estos PDF las imágenes escaneadas del ejemplo. Los responsables nunca se deducen de los nombres del PDF ni del especialista conectado.
- La moneda inicial es CUP, conforme al documento de referencia. No asumir que una factura guardada en la aplicación ya es compatible con Versat.
- Los enlaces públicos caducan y la base de datos conserva solo el hash del token.
- Ver `docs/versat-format.md` para las observaciones técnicas y preguntas abiertas sobre el formato.
- El catálogo no trae precios. No inventar tarifas, numeración, talones ni agrupadores de servicios desconocidos.

## Parámetros anuales confirmados

- La numeración oficial es una única secuencia compartida por todos los especialistas, no una secuencia por persona.
- Para 2026, la primera factura del aplicativo debe ser `HAB-26-091`; las siguientes continúan consecutivamente conservando ese formato. El número de registro del talón para la exportación es `1005`.
- El administrador configura el número inicial completo, el registro del talón y los datos de la entidad. La emisión del nuevo año debe quedar bloqueada hasta que configure sus parámetros; los de 2026 no se reutilizan automáticamente.
- El administrador vincula cada correo autorizado a un comercial del catálogo de Versat. Cada especialista solo accede a facturas de ese comercial, incluidas las preparadas por el administrador; el creador de la factura no determina el permiso. Sin comercial asignado no hay acceso a facturas. El propietario conserva acceso a todas.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts exec tsx --test ../artifacts/facturacion-equipo/src/lib/invoice-print.test.ts` — comprobar importes en letras
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

- Impresión: «Imprimir / Guardar PDF», papel Carta, escala 100 %. El modelo usa cabecera de tabla repetida y contadores de página en navegadores Chromium recientes. Desactivar los encabezados/pies automáticos del navegador para no añadir la URL del enlace compartido. No imprimir si falla la carga de cuño/firma.
- El post-merge instala dependencias, aplica el esquema de desarrollo e inicializa el emisor solo si no existe, comprobando primero las imágenes privadas ya importadas. No sobrescribe ajustes. Las imágenes y el PDF de referencia nunca se incorporan al bundle público.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
