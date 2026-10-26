---
name: Límites de compatibilidad con Versat
description: Criterio para no atribuir compatibilidad contable a un formato reconstruido a partir de un ejemplo.
---

El usuario confirmó que logró importar en Versat con dos correcciones: el talón correcto es 5 y el número importado no lleva guiones. Los parámetros corregidos figuran en `replit.md`. Esta confirmación valida el caso probado, no todas las operaciones ni una compatibilidad certificada.

También se verificaron exportaciones recientes de catálogo en libros XLSX separados: servicios, unidades, monedas, conceptos de venta, operaciones, comerciales y formas de pago. El libro `gen_entidad` contiene clientes y queda fuera de esta comparación de catálogos.

**Why:** El usuario proporcionó una muestra de una operación y después confirmó una importación, no una especificación completa. No hay un Versat de escritorio accesible desde este entorno para comprobar variantes de operación.

**How to apply:** Los libros XLSX confirmados prueban solo esas estructuras; para cambios de versión o entidades/clientes, pedir un ejemplo y validar el alcance antes. Para ampliar a mercancías, impuestos, descuentos, otras monedas MC/OM o agrupadores desconocidos, pedir reglas y validar antes. No inferir numeración ni autorización de firmas a partir de una factura histórica. Separar una firma/cuño escaneados de una firma digital verificable.
