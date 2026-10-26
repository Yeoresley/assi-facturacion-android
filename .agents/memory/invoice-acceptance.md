---
name: Aceptación del cliente y exportación
description: Regla del usuario que separa la emisión, aceptación y pago de una factura.
---

Una factura Terminada o Aceptada puede exportarse a Versat. Al generar correctamente un .Fac individual o el ZIP del período, el sistema la marca como Aceptada y registra quién realizó la exportación.

**Why:** El propietario indicó que exportar a Versat es suficiente para marcar la aceptación del cliente; no quiere un paso obligatorio separado antes de exportar.

**How to apply:** Aplicar la aceptación al completar la generación del archivo, no al consultar la vista previa. No reexportar facturas ya confirmadas. Una acción manual del especialista para registrar una aceptación explícita puede seguir disponible.

Registrar cualquier abono parcial o total también marca como Aceptada una factura Terminada. El saldo y el estado de pago siguen siendo independientes: un abono parcial no equivale a Pagada.

**Why:** El propietario indicó que tanto un pago parcial como uno total representan aceptación del cliente.

**How to apply:** Al guardar un abono, conservar la aceptación aunque el saldo permanezca pendiente. No borrar ni reescribir una aceptación existente al corregir posteriormente un pago.

Confirmada significa «Confirmación de que ya se importó en Versat», según la respuesta expresa del usuario, y permanece como factura aceptada.

**Why:** La importación se realiza por separado en Versat de escritorio; descargar un fichero no demuestra que se haya importado.

**How to apply:** Permitir Confirmada solo tras registrar Aceptada y mantener ambos datos de fecha y responsable. La confirmación es una acción posterior a la importación manual.

No cambiar automáticamente facturas históricas con estado Enviada o Pagada: conservar sus datos hasta que el propietario solicite una regularización, porque no se debe inventar cuándo ni quién registró la aceptación.

**Why:** El historial anterior al flujo nuevo no necesariamente conserva una fecha o responsable de aceptación.

**How to apply:** La aceptación automática se aplica a pagos registrados ahora y a exportaciones válidas generadas desde la aplicación; no hacer una actualización masiva retroactiva.

Para la migración histórica de las facturas de Versat aportadas en PDF, el propietario indicó considerarlas aceptadas por los clientes y, puesto que ya están importadas en Versat, registrarlas también como Confirmadas. Si el PDF no identifica quién la realizó, asignarla a Yeoresley Dominguez.

**Why:** Es la instrucción expresa del propietario para atribuir y reflejar el estado de aceptación de este historial importado.

**How to apply:** Limitar esta regla a las facturas históricas entregadas para la migración. No inventar una fecha de aceptación distinta de la fecha de registro de la migración ni usar esta asignación para facturas nuevas.

Solo el Administrador debe tener la opción «Marcar Pagada» en el listado de facturas; los especialistas o comerciales deben poder ver sus facturas pendientes de pago.

**Why:** El usuario quiere centralizar en el administrador el registro de los pagos y que cada comercial conozca qué facturas todavía debe cobrar.

**How to apply:** Mantener el permiso de registrar pagos exclusivo del administrador y respetar el comercial asignado al consultar pendientes. Un abono marca Aceptada, pero el pago parcial sigue pendiente y no confirma la importación en Versat.

El usuario aprobó añadir pagos parciales: registrar cada abono, mostrar saldo y mantener la factura pendiente hasta completar el total.

**Why:** El usuario necesita seguir lo cobrado y lo que los clientes aún deben sin marcar una factura totalmente pagada antes de tiempo.

**How to apply:** Registrar abonos separados y auditables, prevenir sobrepagos y conservar el alcance de lectura de cada comercial.
