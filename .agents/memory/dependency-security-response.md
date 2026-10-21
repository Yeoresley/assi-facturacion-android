---
name: Respuesta a vulnerabilidades de dependencias
description: Cómo actuar cuando una dependencia transitiva vulnerable no tiene parche upstream.
---

Si una dependencia transitiva vulnerable no tiene versión corregida, elimina la ruta o el consumidor innecesario cuando sea viable en lugar de silenciar la alerta. Usa overrides estrechos solo para versiones corregidas. Tras cambiar overrides, sincroniza el workspace completo con `pnpm install --frozen-lockfile` y verifica tanto la auditoría como el grafo instalado.

**Why:** una auditoría limpia del lockfile no garantiza que los enlaces de `node_modules` hayan quedado actualizados, y algunas alertas no tienen parche upstream disponible.

**How to apply:** comprobar primero el estado del parche upstream; luego actualizar solo las dependencias afectadas, revisar el lockfile y las versiones instaladas, y compilar los proyectos que las usan.
