---
name: Verificación de impresión de facturas
description: Riesgos no evidentes de paginar desde el escritorio autenticado y desde el enlace compartido.
---

Comprobar los PDFs desde ambas vistas, no solo desde el componente de factura aislado; revisar texto seleccionable, todas las columnas y cabeceras de continuación por página.

**Why:** Chromium puede rasterizar y recortar una factura si un ancestro conserva una transformación de animación, y ocultar la barra lateral no elimina su margen reservado. Además, una cabecera de tabla superior a aproximadamente un cuarto de página deja de repetirse aunque tenga `table-header-group`.

**How to apply:** Mantener la cabecera de continuación compacta, fuera de la cabecera completa inicial. Al cambiar animaciones o contenedores del escritorio, verificar impresión autenticada y compartida con un caso corto y uno de varias páginas, incluyendo el bloque final de responsabilidades.
