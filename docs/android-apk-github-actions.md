# Descargar una APK Android de ASSI

La compilación se ejecuta manualmente en GitHub Actions, dentro de la cuota
gratuita disponible. El APK usa la variante `release` para incluir el código
JavaScript y poder abrirse sin Expo Go ni Metro. Se firma con la clave de
depuración de Android para pruebas privadas; no es una versión firmada para
Google Play. La firma automática de cada ejecución no sirve para actualizar una
instalación anterior, así que quizá haya que desinstalarla antes de probar una
nueva APK.

## Preparación en GitHub

1. Crea un repositorio **privado** y sube el proyecto. `attached_assets/` está
   excluido de Git para no subir los PDF y otros archivos fuente de contabilidad.
2. En **Settings → Secrets and variables → Actions**, añade:
   - Variable `EXPO_PUBLIC_DOMAIN`: el host público de la aplicación/API
     desplegada, sin `https://` ni rutas.
   - Secret `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: la clave publicable de Clerk
     correspondiente al entorno que usará la APK. No uses la clave secreta de
     Clerk.
3. Abre **Actions → Android APK → Run workflow**.
4. Al terminar, descarga el artefacto `assi-facturacion-android-apk`; contiene
   `app-release.apk`.

La APK incorpora el host y la clave publicable durante la compilación. Usa un
dominio estable del backend, no el dominio temporal de desarrollo de Replit.
El flujo no sube el código ni los datos a GitHub automáticamente; primero hay
que crear el repositorio privado y subirlo.

Para distribuir actualizaciones sin desinstalar o publicar en Google Play se
necesitaría una clave de firma de lanzamiento persistente y una configuración
de publicación aparte.
