# Formato Versat recibido

## Observaciones verificadas

- El ejemplo `.Fac` es texto ASCII con saltos CRLF, no CSV.
- La cabecera contiene pares `clave=valor` con número, monedas MC/OM, fecha, entidad, concepto, comercial, forma de pago, operación y observaciones, entre otros datos.
- Secciones presentes: `[Propiedades]`, `[Detalle]` y `[PieFirma]`.
- El detalle contiene nueve servicios, cada uno con 14 campos separados por `|`. Los valores observados incluyen un tipo `S`, agrupador, código de servicio, unidad, cantidad y un valor monetario.
- El total de las nueve líneas coincide con el PDF: 36 120 CUP. Las descripciones se pueden relacionar por código aunque el orden de dos líneas difiera.
- La fecha numérica observada coincide con la fecha del PDF usando el calendario serial con origen 1899-12-30. Solo se ha comprobado un ejemplo.

## Catálogos y correspondencia

- Entidades: `codigo` es el valor de `Entidad`; `identidad` es un identificador interno distinto. Se preservan ambos y los ceros iniciales. `NIT` no sustituye al código de entidad.
- Servicios: `codigo` identifica el servicio; `idMedida` enlaza con `gen_medida`. La unidad exportada usa `clave` sin relleno, no la descripción larga.
- Monedas: la aplicación usa `sigla` (CUP/USD), y el `.Fac` usa `nombre` en MC y OM. Solo se contempla una misma moneda en ambos campos.
- Conceptos: se exporta `codigo`, no `idconcepto` ni la descripción.
- Operación, comercial y forma de pago: se conservan sus nombres de exportación. El espacio final de la forma de pago se preserva.
- Los CI personales del catálogo de comerciales no se importan: no son necesarios para esta integración.
- No hay precios en el catálogo de servicios. Se introducen al facturar.
- Solo los nueve servicios presentes en el ejemplo tienen el agrupador confirmado `4651`. Para los restantes se exige entrada explícita; no se infiere del prefijo.
- Los datos elegidos se guardan como una instantánea en la factura para que los cambios posteriores de catálogos o clientes no alteren documentos ya emitidos.

## Lo que aún no está confirmado

- El significado completo de las 14 posiciones del detalle y sus reglas para descuentos, impuestos u otros tipos de operación.
- Qué campos de cabecera son obligatorios, valores por defecto permitidos y códigos válidos.
- Codificación para nombres con acentos: el ejemplo no permite distinguir ASCII, Windows-1252 u otra codificación.
- Numeración y prevención de duplicados al importar, así como si Versat admite lotes o requiere un archivo por factura.

El número de Versat y el talón se introducen explícitamente. La aplicación impide reutilizar un número, pero no puede detectar números que solo existen en el Versat de escritorio.

La descarga es de prueba: se ofrece Windows-1252 o UTF-8 en el lote, CRLF y un `.Fac` por factura dentro de un ZIP. El ZIP no se importa directamente. Se bloquea todo el lote si alguna factura tiene campos pendientes, sin omitir documentos en silencio.

No se exportan mercancías, descuentos, recargos ni impuestos sin un nuevo ejemplo y sus reglas. Los campos opcionales de transporte/identidad/firma quedan vacíos; no se atribuye autorización a una persona automáticamente. La generación final requiere una prueba en una copia de la base de Versat y ajustar lo que esa prueba revele.

Se permite guardar borradores incompletos, pero no emitirlos hasta resolver sus correspondencias. Una factura emitida no vuelve a borrador, por lo que los datos necesarios no deben dejarse pendientes de completar después de la emisión.
