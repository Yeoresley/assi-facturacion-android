# Modelo imprimible de factura

## Uso

1. El propietario revisa razón social, NIT, IRCC, dirección, organismo y datos de pago en **Ajustes → Emisor y datos de pago**.
2. En el detalle de un borrador confirma el emisor, los responsables reales y si autoriza incluir el cuño y/o la firma escaneados. No se copian responsables del PDF de muestra ni del usuario conectado.
3. La firma escaneada se ubica exclusivamente en **Contabilizada por** y requiere indicar a su responsable. Los campos opcionales pendientes quedan en blanco para su cumplimentación, no se firman automáticamente.
4. Tras emitir, **Imprimir / Guardar PDF** abre la impresión del navegador. Usar Carta, escala 100 % y desactivar los encabezados/pies automáticos del navegador. Los contadores del modelo funcionan en Chromium reciente.
5. El enlace compartido usa exactamente el mismo componente de documento y los mismos datos congelados.

Los escaneos no constituyen firma digital criptográfica. Adaptar el modelo aportado no equivale a certificar cumplimiento normativo ni compatibilidad con Versat.

## Protección y conservación

- La autorización original del propietario para reutilizar ambas imágenes se obtuvo expresamente en la conversación. Cada documento necesita además confirmación del propietario.
- Los originales escaneados están en App Storage privado; PostgreSQL conserva rutas y metadatos, no bytes ni base64.
- El acceso a imágenes requiere una sesión de equipo autorizada o el token vigente de un enlace de esa misma factura. No hay endpoint público de archivos ni URL pública del bucket.
- Los borradores y las facturas anuladas no sirven imágenes. Si una imagen falla, el botón de impresión lo comunica y no abre la impresión.
- La instantánea del emisor y los responsables no cambia al editar la configuración global. Editar un borrador invalida su confirmación previa. No se modifica retroactivamente una factura emitida.
- Las facturas anteriores sin emisor confirmado se muestran como preliminares. Los tokens compartidos se conservan solo como hash y se ocultan en los registros del servidor.
- La caducidad impide nuevas descargas; no puede retirar copias ya descargadas.

## Comprobaciones realizadas

Pruebas de navegador con facturas sintéticas, sin alterar facturas reales; se eliminaron los documentos y usuarios temporales al terminar.

| Caso | Resultado |
| --- | --- |
| Emisión sin confirmar el modelo | Rechazada; permanece en borrador |
| Guardar y recargar emisor y autorización | Persisten |
| Cambiar emisor después de emitir | La factura conserva su instantánea |
| Especialista configura emisor o autoriza documento | 403 |
| Imagen sin sesión; enlace ajeno o caducado | 401 / 404 |
| Enlace vigente, sin sesión | Muestra documento e imágenes autorizadas |
| Móvil de 390 px | Sin desbordamiento horizontal |
| PDF de 9 líneas, diseño final | 1 página Carta; totales y ambos escaneos completos |
| PDF de 85 líneas, diseño final | 3 páginas Carta; 85 filas, cabeceras compactas repetidas en ambas páginas de detalle y cierre íntegro |
| Selección/extracción de texto | Cuerpo y seis columnas seleccionables, sin rasterización |
| Precisión | Cantidad 1.2345, precio 123.45678, importe 152.41 |

Las vistas autenticada y compartida se comprobaron en navegador y en PDF. La corrección final de cabeceras/espaciado del componente común se volvió a comprobar desde el escritorio autenticado.

Los PDFs de prueba están en `generated-artifacts/`, excluidos de Git y de publicación. La exportación `.Fac` no se ha cambiado ni se declara validada.
