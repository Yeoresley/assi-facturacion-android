---
name: Pruebas de acceso a facturas
description: Aislamiento de fixtures de autorización cuando las pruebas de integración comparten una base de datos con datos existentes.
---

Las pruebas de alcance por comercial deben asignar a los fixtures IDs comerciales que no estén referenciados por facturas existentes. Al probar el acceso del propietario, comprobar que puede leer los registros sintéticos objetivo, no que su lista global contenga exclusivamente esos fixtures.

**Why:** Las pruebas de integración usan una base de datos compartida con otros registros; los IDs de catálogo hardcodeados pueden incluir accidentalmente una factura ajena al caso, y el propietario legítimamente ve toda la base.

**How to apply:** Antes de crear fixtures de facturas, reservar IDs comerciales sin uso entre las asignaciones existentes. Hacer cleanup solo de las filas sintéticas creadas por la prueba.
