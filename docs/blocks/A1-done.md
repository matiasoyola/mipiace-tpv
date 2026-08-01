# A1 · Android · impresión real (USB nativo) · done

**Rama:** `a1-impresion-usb` (desde `master`). Un commit por frente, sin
merge; el push lo hace Matías.
**Estado final:** capa `PrinterTransport` cableada en `tpv-web` con
regresión CERO en navegador (275 tests tpv-web + 29 builder verdes,
`tsc -b` limpio); plugin USB Host nativo implementado y **compilando**
(`./gradlew :app:compileDebugJavaWithJavac` → BUILD SUCCESSFUL).
**Validación en impresora real: PENDIENTE de Matías** (no tengo el
terminal ni la POS-80 delante — ver §Validación).

---

## Hito del bloque

El TPV ya no depende de WebUSB para imprimir dentro de la app: toda
impresión pasa por un `PrinterTransport` resuelto por plataforma. En
navegador sigue siendo WebUSB (idéntico); en la app Android es un
transporte USB Host nativo detrás del mismo contrato. El cajón se abre al
cobrar en efectivo. Falta la última milla: enchufar la POS-80 al terminal
y ver salir el ticket (obligatorio para cerrar, regla 6 de
`docs/android/README.md`).

## Commits (un frente cada uno)

1. `feat(tpv-web): adaptador de plataforma web/android` — carryover A0
   Frente 4 (`src/platform/index.ts` + test).
2. `feat(tpv-web): PrinterRegistry + refactor de escposPrint` — Frente 1.
3. `feat(android): UsbNativeTransport + plugin USB Host nativo` — Frente 2.
4. `feat(tpv): abrir cajón al cobrar en efectivo` — Frente 3.
5. Este `A1-done.md`.

(Frente 4 "permisos nativos" no genera commit propio: el permiso USB se
resuelve dentro del plugin del Frente 2 — ver §Decisión 5.)

## Estructura creada

```
apps/tpv-web/src/platform/
  index.ts                     getPlatform()/isCapacitor() (por global Capacitor, sin dep)
  printer/
    PrinterTransport.ts        contrato CANÓNICO (movido desde tpv-android)
    registry.ts                DefaultPrinterRegistry + singleton
    WebUsbTransport.ts         canal usb en navegador (extracción de escposPrint)
    UsbNativeTransport.ts      canal usb en Android (lado JS del plugin)
    WifiBackendTransport.ts    canal wifi (server-mediated)
    bootstrap.ts               registra transportes según plataforma
apps/tpv-android/android/app/src/main/java/es/mipiace/tpv/
    UsbPrinterPlugin.java      plugin Capacitor: USB Host / bulk OUT / cajón
    MainActivity.java          registerPlugin(UsbPrinterPlugin) en onCreate
apps/tpv-android/android/app/src/main/AndroidManifest.xml  uses-feature usb.host
packages/escpos-builder/src/helpers.ts  escOpenCashDrawer() canónico
apps/tpv-web/src/lib/escposPrint.ts      delega USB en el registry
```

---

## Cómo implementé el USB Host nativo detrás de `PrinterTransport` (lo clave)

El WebView de Capacitor no tiene WebUSB, así que el acceso al bus lo da un
**plugin Capacitor propio en Java** (`UsbPrinterPlugin`), y el lado JS
(`UsbNativeTransport`) lo encapsula tras el contrato. Reparto:

- **JS (`UsbNativeTransport`)**: obtiene el plugin por el global
  `Capacitor.registerPlugin("UsbPrinter")` (sin importar `@capacitor/core`,
  ver Decisión 2), serializa los bytes ESC/POS a **base64** (el bridge de
  Capacitor sólo pasa JSON/strings) y **mapea los códigos de error nativos
  a `PrinterError`** (`PERMISSION_DENIED`/`NOT_PAIRED`/`UNREACHABLE`/…).
- **Java (`UsbPrinterPlugin`)**, mismo algoritmo que ya estaba resuelto en
  la rama WebUSB:
  - `pair()`: enumera `UsbManager.getDeviceList()`, elige la primera
    **impresora de clase 7** (device o interface `USB_CLASS_PRINTER`), pide
    el **permiso USB del sistema** (diálogo nativo) y persiste
    vendor/product/serial en `SharedPreferences`.
  - `isPaired()`: hay device persistido presente en el bus **y** con
    permiso concedido.
  - `print()`: reabre el device autorizado sin diálogo, localiza el
    **endpoint bulk OUT**, `claimInterface(true)` + `bulkTransfer(...,
    5000ms)`; `<0` → `UNREACHABLE` (impresora apagada/desconectada).
  - `openCashDrawer()`: mismo `bulkTransfer` con el pulso kick.
  - `forget()`: limpia las prefs.
- **Permiso asíncrono**: `requestPermission` con `PendingIntent`
  (`FLAG_MUTABLE` en Android 12+) + `BroadcastReceiver`
  (`RECEIVER_NOT_EXPORTED` en Android 13+). La `PluginCall` de `pair()` se
  retiene (`bridge.saveCall`) y se resuelve/rechaza cuando el usuario
  decide; denegación → `PERMISSION_DENIED`.
- **Persistencia**: la lleva el transporte (nativo en SharedPreferences,
  web en el MISMO `localStorage` legacy) en vez del caller — desviación
  consciente del contrato de A0 "persistir es del caller" (Decisión 4).

---

## Decisiones tomadas sin preguntar (con justificación)

1. **Plugin USB nativo propio, no un plugin de terceros.** Evalué
   `@adeunis/capacitor-usb-serial` y `cordova-plugin-usb`: ambos apuntan a
   adaptadores **USB-serie/CDC** (FTDI/CP210x), no a impresoras de **clase
   7 con endpoint bulk OUT**, que es lo que usa ESC/POS. Adaptarlos sería
   más frágil que portar ~200 líneas de `UsbManager` cuyo algoritmo YA
   estaba validado en la rama WebUSB (filtro clase 7 + bulk OUT +
   transfer). Además ADR-011 empuja a minimizar dependencias. → plugin
   propio mínimo.

2. **`getPlatform()`/plugin sin dependencia `@capacitor/core` en tpv-web.**
   La detección usa el global `Capacitor` que el bridge inyecta, y el
   plugin se obtiene con `Capacitor.registerPlugin`. Así el bundle de la
   PWA **no gana una dependencia de Capacitor** → refuerza la regresión
   cero en navegador. (A0-done proponía exactamente `window.Capacitor?.…`.)

3. **El contrato `PrinterTransport` se MUEVE a `tpv-web`.** A0 lo dejó en
   `apps/tpv-android/src/printer/`, pero el JS que lo implementa (registry
   + transportes) viaja en el bundle de `tpv-web` y corre en ambos
   entornos; `tpv-android` no consume ese TS. Mantener dos copias sólo
   invita a que diverjan → el de `tpv-android` queda como **puntero** al
   canónico. El plugin Java sí vive en `tpv-android`.

4. **La persistencia la encapsula el transporte, no el caller** (desviación
   de A0). Motivo: no filtrar la forma **legacy** del `localStorage`
   (`mipiacetpv-tpv-printer-usb` con `{vendorId,productId,serialNumber}`)
   fuera del sitio que ya la conocía. Consecuencia buscada: una impresora
   ya emparejada en las tablets de pilotos **sigue funcionando sin
   re-emparejar** tras el refactor.

5. **Frente 4 (permisos) = el diálogo USB del sistema, dentro del plugin.**
   USB Host **no** lleva permiso en runtime en el manifest (a diferencia de
   BT). El permiso es un diálogo por device que ya gestiona `pair()`;
   denegar → `PERMISSION_DENIED`. Bluetooth (BT_CONNECT/BT_SCAN + location)
   queda **fuera** por restricción explícita del bloque. Por eso Frente 4
   no añade código nuevo ni commit.

6. **WiFi se conserva idéntico (server-mediated) y NO se fuerza al
   contrato de bytes.** El canal WiFi construye+manda el binario en el
   **backend** por `ticketId` (`printTicketWifi`, ya funcionaba); no
   consume bytes del cliente. `WifiBackendTransport` se registra para que
   el registry sea uniforme, pero su `print(bytes)` lanza `UNSUPPORTED`
   (documentado) — la ruta real WiFi sigue en `printTicketWifi`. No toqué
   backend (README §2.7).

7. **Contrato ampliado con `isPaired()` y `forget()`** sobre los 6
   miembros de A0. El TPV necesita "¿hay impresora lista sin diálogo?" (no
   ofrecer "Emparejar" de más) y "olvida el emparejamiento" (cuando el
   admin borra/cambia la impresora). Universales: WiFi los resuelve
   trivial. Fuerza cambios menores de tipo en `escposPrint`
   (`getPairedUsbPrinter` ahora `boolean`, `pairUsbPrinter` `void`) — los
   dos únicos consumidores sólo usan la veracidad, regresión cero.

8. **Cajón al persistir en outbox, no al confirmar Holded.** En efectivo
   el cajón se abre justo al guardar la venta localmente (antes del POST),
   así funciona **offline** y sin latencia. Best-effort: si no hay
   impresora USB o el pulso falla, se ignora — el cobro nunca se rompe.

## Pruebas (automáticas)

- `platform.test.ts` (4) · adaptador web/android.
- `printer-registry.test.ts` (7) · registro/get/fallback/available + WiFi
  `print` UNSUPPORTED.
- `webusb-transport.test.ts` (9) · la rama web SIGUE en WebUSB y entrega
  **exactamente** los bytes al bulk OUT; errores → `PrinterError`; kick.
- `escpos-print-delegation.test.ts` (11) · `escposPrint` delega en el
  registry con los mismos bytes; cajón best-effort.
- `usb-native-transport.test.ts` (9) · mock del plugin: base64 round-trip
  exacto + mapeo de errores nativos.
- `builder.test.ts` (+1) · `escOpenCashDrawer` = ESC p 0 25 250.
- Java: `compileDebugJavaWithJavac` BUILD SUCCESSFUL (openjdk@17 +
  commandline-tools de A0).

## Validación en hardware real — PENDIENTE (obligatoria antes de cerrar)

No pude ejecutarla (sin el terminal ni la impresora delante). Checklist
para Matías, en el terminal Android todo-en-uno de los pilotos con la
POS-80 por USB:

1. `pnpm --filter @mipiacetpv/tpv-android run:android` (con
   `JAVA_HOME=/usr/local/opt/openjdk@17`,
   `ANDROID_HOME=/usr/local/share/android-commandlinetools`).
2. Emparejar la impresora → debe salir el **diálogo de permiso USB** del
   sistema; aceptar.
3. Cobrar y pulsar **Imprimir ticket (USB)** → sale el ticket real.
4. Cobrar en **efectivo** → el **cajón se abre** al confirmar.
5. Apagar la impresora e imprimir → mensaje claro al cajero
   (`UNREACHABLE`), **sin crash**.
6. Anotar aquí **modelo de impresora y dispositivo Android** usados.

## Dudas / riesgos a vigilar en hardware

- **Retención de la `PluginCall` del permiso**: uso `bridge.saveCall` +
  resolución directa en el receiver. Compila; si en device el `resolve()`
  llegara mudo, cambiar a `getBridge().getSavedCall(id)` explícito.
- **`FLAG_MUTABLE` / `RECEIVER_NOT_EXPORTED`**: ramas por versión de
  Android metidas; confirmar en el API real del terminal (¿Android 11? 13?
  anotar en paso 6).
- **Selección de device con varias clase-7**: cojo el primero (un modelo
  por terminal, coherente con "no multi-modelo en v1"). Si el terminal
  expone otra clase-7 (raro), habría que filtrar más.
- **`getSerialNumber()` sin permiso** devuelve null en API 29+: casamos por
  `vendor:product` hasta tener permiso; suficiente para un modelo único.

## Lo que NO entra (según el prompt)

Bluetooth, escáner cámara/offline (A2), icono/splash/firma/Play Store
(A3), soporte multi-modelo simultáneo (v2 on-demand).

## Nota de higiene

El árbol traía cambios ambientes NO míos (docs legales, roadmap, dirs
`Sirope/`, `Maestranza/`, `apps/api/src/tickets/print 2.ts`, etc.). No los
toqué ni los incluí en ningún commit de A1.
