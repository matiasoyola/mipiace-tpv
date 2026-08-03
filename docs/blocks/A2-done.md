# A2 · Android · escáner de cámara + auditoría offline · done

**Rama:** `a2-escaner-offline` (desde `a1-impresion-usb`, **NO** desde
`master` — necesita el adaptador de plataforma de A1). Un commit por
frente, sin merge; el push lo hace Matías. **No mergeable hasta que A1 se
mergee** — mismo stack nativo, es lo esperado.
**Estado final:** permiso de cámara nativo + selector de cámara cableados
en `tpv-web` con **regresión CERO en navegador** (`tsc -b` limpio; 204
tests tpv-web verdes, +5 nuevos; los 76 fallos rojos son de entorno jsdom,
**preexistentes** e idénticos con y sin mis cambios — ver §Pruebas).
Plugin Java `CameraPermissionPlugin` **compilando** (`./gradlew
:app:compileDebugJavaWithJavac` → BUILD SUCCESSFUL).
**Validación en dispositivo real: PENDIENTE de Matías** (no tengo el
terminal delante — ver §Validación).

---

## Hito del bloque

El escáner de código de barras (zxing sobre `getUserMedia`) ya funciona
dentro de la app Android: se pide el **permiso de cámara nativo** en
runtime detrás de la capa de plataforma, con mensaje de denegación
adaptado y selector cuando hay varias cámaras. El Service Worker y el
catálogo cacheado sirven la app sin red dentro del WebView (auditado a
nivel de código). La prueba integrada "venta entera sin red → sync sin
duplicar" queda **documentada como pendiente** de la integración
v1.10+A1+A2 (Frente 3 **no reimplementa** el offline: lo construyó v1.10).

## Commits (un frente cada uno)

1. `feat(android): permiso de cámara nativo + selector de cámara` — Frente 1.
2. `perf(android): frame de escaneo a 1280x720 ideal` — Frente 2.
3. `docs(android): auditoría offline catálogo+SW en WebView` — Frente 3
   (`docs/blocks/A2-offline-audit.md`; **sin código** — no se reimplementa
   v1.10).
4. `fix(android): saltar version-check dentro de Capacitor` — Frente 4.
5. Este `A2-done.md`.

## Estructura creada / tocada

```
apps/tpv-web/src/platform/camera/
    CameraPermission.ts          ensureCameraPermission() detrás de la plataforma (sin dep @capacitor/core)
apps/tpv-web/src/pages/SalePage.cameraScan.tsx
                                 gate de permiso + selector de cámara + constraints 1280x720 + msg denegación
apps/tpv-web/src/lib/version-check.ts
                                 no-op bajo Capacitor (isCapacitor())
apps/tpv-web/test/camera-permission.test.ts   wrapper de permiso (5 tests)
apps/tpv-android/android/app/src/main/java/es/mipiace/tpv/
    CameraPermissionPlugin.java  plugin Capacitor: CAMERA en runtime (alias @Permission)
    MainActivity.java            registerPlugin(CameraPermissionPlugin)
apps/tpv-android/android/app/src/main/AndroidManifest.xml  uses-permission CAMERA + uses-feature camera.any
docs/blocks/A2-offline-audit.md  auditoría Frente 3 (independiente de v1.10)
```

---

## Cómo implementé el permiso de cámara (lo clave)

Mismo patrón que A1: el WebView **no** hereda el permiso del prompt web, así
que un **plugin Capacitor propio en Java** (`CameraPermissionPlugin`) pide
el permiso `CAMERA` en runtime, y el lado JS
(`platform/camera/CameraPermission.ts`) lo encapsula tras la capa de
plataforma. Reparto:

- **JS (`ensureCameraPermission`)**: obtiene el plugin por el global
  `Capacitor.registerPlugin("CameraPermission")` (sin importar
  `@capacitor/core`). En navegador/PWA devuelve **"web"** y el llamador va
  directo a `getUserMedia` (su prompt gestiona el permiso). En android:
  `check()` → si falta, `request()` → mapea a `"granted"`/`"denied"`. Si el
  plugin peta, **degrada a "web"** (no bloquea el escaneo).
- **Java (`CameraPermissionPlugin`)**: usa el flujo idiomático de permisos
  de Capacitor (`@Permission(alias="camera")` +
  `requestPermissionForAlias(..., "cameraPermsCallback")`), **no** el
  `BroadcastReceiver` manual del `UsbPrinterPlugin` — porque CAMERA es un
  permiso estándar de app, no un permiso por-device del bus USB.
- **Modal (`CameraScanModal`)**: `await ensureCameraPermission()` antes de
  abrir el stream; `"denied"` → mensaje claro adaptado a Android vs
  navegador. El escaneo zxing **no cambia**.

---

## Decisiones tomadas sin preguntar (con justificación)

1. **Plugin de cámara propio, no `@capacitor/camera`.** El prompt permitía
   `@capacitor/camera` "sólo para el permiso", pero eso arrastra una
   dependencia npm + su cadena para leer un único booleano. Coherente con
   A1 (Decisión 1/2) y ADR-011, escribí ~40 líneas de Java que sólo
   comprueban/piden `CAMERA`. Cero deps nuevas en el bundle de la PWA →
   refuerza la regresión cero en web.

2. **JS del permiso sin dependencia `@capacitor/core` en tpv-web.** Igual
   que A1: leo el global `Capacitor` inyectado y uso `registerPlugin`. El
   bundle de la PWA no gana Capacitor; en navegador el global no existe y
   `ensureCameraPermission` devuelve `"web"`.

3. **En navegador el permiso lo sigue gestionando `getUserMedia`.** No
   añado ninguna capa nueva en web: `"web"` = comportamiento idéntico al de
   siempre. Un fallo real cae en el `NotAllowedError` que el modal ya
   manejaba (mensaje ahora adaptado por plataforma).

4. **Flujo de permisos idiomático de Capacitor en el plugin Java**
   (`@Permission` + `requestPermissionForAlias`) en vez del
   `BroadcastReceiver`/`PendingIntent` de USB. CAMERA es permiso de app
   estándar; el patrón manual del USB era necesario sólo por ser permiso
   por-device. Menos código, menos superficie de error.

5. **Selector de cámara = botón que cicla, no dropdown.** El prompt pide
   "si hay varias cámaras, permitir elegir". Enumero `enumerateDevices()`
   **después** de abrir el stream (antes los `deviceId`/labels vienen
   vacíos por privacidad), guardo la lista en un `ref` (no re-render) y
   muestro un botón "Cambiar cámara" **sólo si hay >1**. Ciclar cambia
   `camIndex` → reinicia el lector con `deviceId` exacto. En web con una
   sola cámara: **sin botón, comportamiento idéntico**.

6. **Frente 2 = resolución 1280x720 IDEAL (no exact).** Un frame más nítido
   mejora la lectura de EAN-13/Code-128 en el terminal de caja. Uso `ideal`
   para que, si la cámara no lo soporta, el navegador **caiga** a lo que
   tenga en vez de lanzar `OverconstrainedError`. No toco framerate ni
   fuerzo focus (no es estándar en `MediaTrackConstraints`). El ajuste fino
   real depende de medir en hardware (§Validación).

7. **Frente 3 NO reimplementa nada** (instrucción explícita). El sistema
   offline es de v1.10 (`outbox.ts` ya presente en esta rama;
   `offlineAuth`/`offlineShift` sólo en v1.10). Audité lo independiente de
   v1.10 (catálogo cacheado + SW en WebView) en `A2-offline-audit.md` y dejé
   la prueba completa como **pendiente de integración**. Cero código.

8. **Frente 4 = version-check no-op bajo Capacitor.** En la app el bundle es
   estático y se actualiza vía Play Store; el `version.json` empaquetado
   siempre coincide con el embebido, así que `runVersionCheck` sería un
   no-op — pero lo **salto explícitamente** con `isCapacitor()` para que
   `purgeAndReload()` **nunca** pueda purgar el precache local (el WebView
   no tiene origen de red del que re-descargar el bundle). Regresión cero en
   web (isCapacitor() = false en navegador).

## Pruebas (automáticas)

- `camera-permission.test.ts` (5, **nuevo**) · mock del plugin Capacitor:
  `"web"` sin global, no pide si ya concedido, pide+mapea
  concedido/denegado, degrada a `"web"` si el plugin lanza.
- `tsc -b` limpio en `tpv-web`.
- Java: `compileDebugJavaWithJavac` **BUILD SUCCESSFUL** (openjdk@17 +
  command-line tools de A0).
- **Suite completa:** 204 pasan / 76 fallan. Los 76 fallos son de entorno
  **jsdom** (`navigator is not defined`, etc.) y son **preexistentes**:
  con `git stash` de mis cambios la base da 199 pasan / 76 fallan **los
  mismos**. Mis cambios sólo suman +5 verdes, **cero fallos nuevos**
  (carryover conocido "tests TPV jsdom diferidos").

## Validación en dispositivo real — PENDIENTE (obligatoria antes de cerrar)

No pude ejecutarla (sin el terminal delante). Checklist para Matías, en el
terminal Android de los pilotos:

1. `pnpm --filter @mipiacetpv/tpv-android run:android` (con
   `JAVA_HOME=/usr/local/opt/openjdk@17`,
   `ANDROID_HOME=/usr/local/share/android-commandlinetools`).
2. Abrir el escáner → debe salir el **diálogo de permiso de cámara** del
   sistema; aceptar. Escanear un **producto real** y ver que lo añade.
3. Denegar el permiso a propósito → mensaje claro en castellano, **sin
   crash**.
4. Si el terminal tiene cámara frontal+trasera → botón **"Cambiar
   cámara"**; verificar que la trasera es la de por defecto.
5. Medir la **velocidad de lectura** con 1280x720; si va lento, anotar y
   ajustar constraints (§Decisión 6).
6. **Prueba offline completa** (`A2-offline-audit.md` §4) — **sólo** cuando
   v1.10+A1+A2 estén integrados. Hoy NO cerrable.
7. Anotar aquí **modelo de dispositivo y versión de Android**.

## Dudas / riesgos a vigilar en hardware

- **`requestPermissionForAlias` + `@PermissionCallback`**: patrón estándar
  de Capacitor 6; compila. Si en device el callback llegara mudo, revisar
  que el nombre del método (`"cameraPermsCallback"`) case exactamente.
- **Enumeración de cámaras**: `enumerateDevices()` sólo da `deviceId`/label
  **tras** conceder permiso y abrir el stream — por eso enumero después. En
  algún WebView viejo podría venir vacío → simplemente no sale el selector
  (degradación limpia).
- **Base de la API en el APK** (de la auditoría): el build **debe** fijar
  `VITE_API_URL` al backend remoto; con `/api` por defecto el WebView
  apuntaría a `https://localhost`. Acción para A3/deploy (ver
  `A2-offline-audit.md` §3).
- **1280x720**: es `ideal`; en cámaras muy básicas podría no aplicarse.
  Confirmar que no ralentiza en el hardware real antes de subir el valor.

## Lo que NO entra (según el prompt)

Impresión (A1), reimplementación del offline (v1.10), icono/splash/firma/
publicación (A3), integración de datáfono (v2).

## Nota de higiene

El árbol traía cambios ambientes **NO míos** (docs legales, roadmap, dirs
`Sirope/`, `Maestranza/`, `apps/api/src/tickets/print 2.ts`, etc., ya
señalados en A1-done). No los toqué ni los incluí en ningún commit de A2.
Cada commit staged sólo sus propios ficheros.
