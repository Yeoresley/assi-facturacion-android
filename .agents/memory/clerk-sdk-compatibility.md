---
name: Compatibilidad de Clerk
description: Evitar cambios de autenticación causados por resolver una versión antigua del SDK o una publicación demasiado reciente.
---

Comprobar que la versión instalada de Clerk exporta las APIs canónicas de la guía antes de reemplazarlas por alternativas.

**Why:** Una instalación sin versión explícita puede conservar un rango antiguo que no incluye esas APIs. A su vez, el registro del entorno rechaza publicaciones demasiado recientes aunque sean la versión marcada como latest.

**How to apply:** Elegir una versión estable compatible que cumpla la antigüedad mínima del registro y los requisitos de React. No desactivar esa protección ni rediseñar el flujo de autenticación para acomodar un SDK obsoleto.
