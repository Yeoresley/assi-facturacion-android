---
name: Migración histórica de facturas
description: Reglas acordadas para importar facturas previas de Versat y conciliar sus cobros.
---

Para el histórico importado desde Versat:

- Mantener el comercial que aparece en la factura; si el campo de autor está vacío, asignar Yeoresley Dominguez.
- Según la instrucción del propietario, una factura que no aparece en el CxC detallado se considera cobrada. Las que sí aparecen conservan el saldo informado y los abonos documentados.
- En el caso de HAB-26-089, la instrucción más reciente de considerar cobradas las facturas ausentes del CxC prevaleció sobre la respuesta anterior de pendiente/parcial; quedó pagada, sin fecha de cobro.
- No inventar fechas de aceptación, confirmación ni cobro. Las facturas ya importadas en Versat se registran como confirmadas.
- El propietario no requiere reconstruir liquidaciones mensuales históricas exactas; los pagos registrados en adelante deben calcularse con sus fechas reales. Un pago histórico sin fecha no se asigna automáticamente a un mes.
- No crear facturas para números ausentes: el propietario indicó que una factura omitida puede haber sido eliminada.

**Why:** el archivo debe reflejar lo que se puede respaldar sin atribuir ventas ni fechas de forma ficticia.

**How to apply:** al importar otros lotes históricos, cotejar cada PDF con el CxC detallado, respetar el autor del documento y dejar sin fecha los cobros cuya fecha no esté documentada.
