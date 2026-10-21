---
name: Esquema de pagos en desarrollo
description: Fallos de integración por desajuste de columnas entre el código de pagos y la base de desarrollo compartida.
---

En octubre de 2026, las pruebas de integración de facturas fallaron antes de ejecutar sus casos porque la base compartida no tenía `invoice_payments.reference`, aunque el código y el esquema actual ya la usan.

**Why:** Un esquema local desactualizado produce errores de SQL que parecen regresiones de pagos, pero no se corrigen cambiando la lógica de la aplicación.

**How to apply:** Si las pruebas de pagos fallan con `column "reference" does not exist`, revisar el estado de migración de la base de desarrollo antes de modificar el código.
