---
name: Aceptación del cliente y exportación
description: Regla del usuario que separa la emisión, aceptación y pago de una factura.
---

Solo se puede exportar a Versat una factura cuando el especialista la haya marcado como Aceptada: esto confirma que el cliente la aceptó y va a pagarla, no que ya la pagó.

**Why:** El usuario necesita impedir la importación contable de facturas que el cliente todavía no ha aceptado.

**How to apply:** Aplicar la restricción tanto a exportación individual como por lote. No convertir automáticamente facturas históricas emitidas o pagadas en aceptadas. El catálogo proporcionado por el usuario es: 1 Edición, 2 Terminada, 3 Confirmada, 4 Anulada, 5 Cancelada, 6 Con Error, 7 Aceptada. No inferir una diferencia contable entre Anulada y Cancelada sin aclaración.

Confirmada significa «Confirmación de que ya se importó en Versat», según la respuesta expresa del usuario. No significa revisión interna anterior a la aceptación.

**Why:** La importación se realiza por separado en Versat de escritorio; descargar un fichero no demuestra que se haya importado.

**How to apply:** Mantener la confirmación de importación como una acción posterior y explícita, separada de generar o descargar el fichero.

Solo el Administrador debe tener la opción «Marcar Pagada» en el listado de facturas; los especialistas o comerciales deben poder ver sus facturas pendientes de pago.

**Why:** El usuario quiere centralizar en el administrador el registro de los pagos y que cada comercial conozca qué facturas todavía debe cobrar.

**How to apply:** Mantener el permiso de registrar pagos exclusivo del administrador y respetar el comercial asignado al consultar pendientes. El cobro no debe confundirse con aceptación del cliente ni con importación en Versat.

El usuario aprobó añadir pagos parciales: registrar cada abono, mostrar saldo y mantener la factura pendiente hasta completar el total.

**Why:** El usuario necesita seguir lo cobrado y lo que los clientes aún deben sin marcar una factura totalmente pagada antes de tiempo.

**How to apply:** Registrar abonos separados y auditables, prevenir sobrepagos y conservar el alcance de lectura de cada comercial.
