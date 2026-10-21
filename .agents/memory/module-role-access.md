---
name: Acceso a módulos por rol
description: Restricción de acceso de especialistas a módulos administrativos.
---

Los especialistas no deben tener acceso a los módulos Exportar, Ajustes ni Catálogos. El propietario administra los catálogos, incluyendo altas, cambios y desactivaciones. Las opciones de catálogo necesarias para crear facturas siguen disponibles dentro del formulario, pero las desactivadas no se pueden seleccionar en nuevas facturas.

**Why:** El propietario indicó que Exportar, Ajustes y la administración de Catálogos deben quedar reservados para su cuenta de administrador.

**How to apply:** Ocultar los enlaces para especialistas y proteger las rutas directas, no solo el menú. Mantener las operaciones de administración en el servidor restringidas al propietario. No bloquear catálogos activos ni datos legales compartidos que los especialistas necesiten para preparar facturas o generar sus PDF.
