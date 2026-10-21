---
name: Desfase del esquema de desarrollo
description: La base compartida de desarrollo puede no tener las tablas declaradas actualmente por Drizzle.
---

Antes de probar una ruta de escritura que depende de una tabla reciente, confirma que esa tabla existe en la base conectada. Si falta, una prueba por HTTP puede fallar antes de llegar a la lógica que se quiere comprobar.

**Why:** El 21 de octubre de 2026, la base de desarrollo no tenía `versat_catalog_audit`; la ruta del propietario para desactivar un código falló al guardar el registro de auditoría, aunque la tabla ya estaba declarada en el esquema del repositorio.

**How to apply:** Distingue fallos de lógica de aplicación de desfases de esquema. Si una prueba cambia datos directamente para aislar la lógica, no afirmes que también verificó la ruta HTTP del propietario.
