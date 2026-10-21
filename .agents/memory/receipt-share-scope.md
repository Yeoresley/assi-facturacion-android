---
name: Alcance de enlaces de comprobante
description: Límite de autorización para enlaces públicos de recibos de pago.
---

Los enlaces públicos de comprobante deben ser capacidades independientes limitadas a un único abono. No se debe reutilizar un token que permita abrir la factura completa, aunque la URL incluya un parámetro `receipt`.

**Why:** El destinatario controla la URL y puede quitar o cambiar sus parámetros; ocultar la factura solo en la interfaz no limita el acceso a la API.

**How to apply:** Al crear enlaces de recibo, asociar el token al pago seleccionado y rechazarlo en las rutas de factura e imágenes. Mantener la caducidad y revocación comunes a los enlaces compartidos.
