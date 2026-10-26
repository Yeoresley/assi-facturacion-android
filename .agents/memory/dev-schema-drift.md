---
name: Desfase del esquema de desarrollo
description: La base compartida de desarrollo puede no tener las tablas declaradas actualmente por Drizzle.
---

Antes de probar una ruta de escritura que depende de una tabla reciente, confirma que esa tabla existe en la base conectada. Si falta, una prueba por HTTP puede fallar antes de llegar a la lógica que se quiere comprobar.

**Why:** El 21 de octubre de 2026, la base de desarrollo no tenía `versat_catalog_audit`; la ruta del propietario para desactivar un código falló al guardar el registro de auditoría, aunque la tabla ya estaba declarada en el esquema del repositorio.

**How to apply:** Distingue fallos de lógica de aplicación de desfases de esquema. Si una prueba cambia datos directamente para aislar la lógica, no afirmes que también verificó la ruta HTTP del propietario.

Para aplicar cambios del esquema de desarrollo, utiliza el script del paquete `pnpm --filter @workspace/db run push`. En este entorno, `drizzle-kit push` ejecutado directamente no encuentra la configuración automáticamente y rechaza combinar `--config` con otras opciones.

**Why:** Las opciones de configuración y alcance de `drizzle-kit push` no se pueden combinar en este workspace; el script del paquete ya apunta a la configuración correcta.

**How to apply:** Prefiere el script documentado del paquete y no fuerces un `push` global para sortear errores de configuración.
