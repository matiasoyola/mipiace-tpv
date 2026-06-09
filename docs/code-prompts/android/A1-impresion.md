# Prompt para Claude Code — Bloque A1 (Android · impresión real)

EL bloque con más riesgo. Foco único: que el TPV imprima un ticket real
desde la app Android y abra el cajón. WebUSB no existe en el WebView, así
que aquí resolvemos el transporte de impresión nativo detrás de
`PrinterTransport`.

Pega esto en una sesión NUEVA de Claude Code, tras A0 revisado.

**Hardware decidido: impresora USB.** Los pilotos (Thalía incluida) usan
impresora térmica conectada por USB al terminal Android todo-en-uno
(coherente con ADR-011, terminal Smart-tpv con printer externo USB). El
canal a implementar en A1 es **USB nativo** (USB Host de Android), porque
WebUSB no existe en el WebView. La rama WiFi se mantiene como
`WifiBackendTransport` (ya funciona) pero NO es el foco.

---

Hola Code. A1 implementa la impresión real en Android. El builder de
bytes ESC/POS ya existe y NO cambia; lo que cambia es QUIÉN entrega los
bytes a la impresora.

## Contexto — leer antes de tocar nada

- `docs/android/README.md` §2.1 — por qué WebUSB no sirve y la tabla de
  canales (WiFi ya hecho / BT / USB).
- `apps/tpv-android/src/printer/PrinterTransport.ts` — el contrato que
  hay que implementar. **Léelo entero; define el comportamiento.**
- `apps/tpv-web/src/lib/escposPrint.ts` — impresión web actual: rama
  WebUSB (`printEscposUsb`) y rama WiFi (`printTicketWifi` →
  endpoint backend). La rama WiFi se reutiliza tal cual.
- `packages/escpos-builder/src/index.ts` — builder de bytes
  (`buildTicketReceipt`, `buildTestPrint`) y `sendOverTcp` (WiFi).
- `apps/api/src/tickets/` — endpoint `/tickets/:id/print/escpos` que ya
  devuelve el binario y ya hace TCP a impresora WiFi.
- `apps/tpv-web/src/platform/index.ts` — adaptador creado en A0.
- `docs/impresoras/despliegue-usb.md` y `despliegue-wifi.md` — cómo se
  despliega hoy.

## Alcance A1

### Frente 1 · Registro de transportes y wiring en tpv-web
- Implementar un `PrinterRegistry` (definido en `PrinterTransport.ts`).
- En el bootstrap de `tpv-web`, según `getPlatform()`:
  - **web**: registrar `WebUsbTransport` (extraer de `escposPrint.ts`
    sin cambiar comportamiento) + `WifiBackendTransport`.
  - **android**: registrar el transporte nativo del Frente 2 +
    `WifiBackendTransport` (idéntico).
- Refactor de `escposPrint.ts` para que la lógica de impresión del TPV
  llame al registry, no directamente a WebUSB. **El comportamiento en
  navegador debe quedar idéntico** (regresión cero en web).

### Frente 2 · Transporte USB nativo (canal decidido)
Implementar `UsbNativeTransport implements PrinterTransport` sobre el
USB Host de Android:

- Evaluar un plugin Capacitor de USB serie/host (p.ej.
  `@adeunis/capacitor-usb-serial`, `cordova-plugin-usb`, o un plugin
  nativo propio mínimo si ninguno encaja con ESC/POS bulk OUT). Justifica
  la elección en `A1-done.md`.
- `pair()`: lista dispositivos USB clase impresora (classCode 7, igual
  que el filtro WebUSB en `escposPrint.ts`), pide permiso USB nativo de
  Android al usuario, persiste vendor/product/serial.
- `connect()`: reabre el dispositivo ya autorizado por
  vendor:product:serial sin diálogo.
- `print()`: envía el binario ESC/POS al endpoint bulk OUT.
- `openCashDrawer()`: pulso kick ESC/POS por la misma impresora.
- Mapear desconexión/permiso/timeout a `PrinterError` con su `code`.

`WifiBackendTransport` se registra también (reutiliza la ruta TCP del
backend ya existente) como fallback, pero no es el foco del bloque.

Encapsular el plugin detrás de `PrinterTransport`. Ningún componente de
pantalla importa el plugin directamente. Nota: la lógica de selección de
endpoint bulk OUT y el filtro de clase 7 ya están resueltos en
`escposPrint.ts` para WebUSB — reusar ese conocimiento como referencia.

### Frente 3 · Cajón portamonedas
- `openCashDrawer()` por defecto: pulso kick ESC/POS a través de la
  impresora conectada (comando estándar). Reutilizar helper del builder
  o añadir uno mínimo en `escpos-builder/helpers.ts` si no existe.
- Conectar el cobro: al cerrar venta con pago en efectivo, abrir cajón.

### Frente 4 · Permisos nativos
- Pedir en runtime los permisos del canal elegido (BT_CONNECT/BT_SCAN en
  Android 12+, y ubicación si el escaneo BT lo exige). Mensajes claros en
  castellano. Manejar denegación → `PrinterError("PERMISSION_DENIED")`.

## Restricciones
- TypeScript estricto.
- **Regresión cero en web**: la PWA en navegador imprime igual que antes.
- Solo ESC/POS estándar (ADR-011). Nada de SDK de fabricante.
- El builder de bytes no se reescribe; se reutiliza.
- Errores siempre como `PrinterError` con `code` accionable.
- Implementar SOLO el canal USB nativo (+ WiFi backend ya existente). No
  implementar Bluetooth en este bloque.

## Tests
- Tests unitarios del `PrinterRegistry` (registro, get por canal,
  fallback).
- Test del refactor de `escposPrint.ts` mockeando el registry: la ruta
  web sigue llamando a WebUSB.
- Mock del transporte nativo (no se puede testear hardware en CI):
  verificar que `print()` pasa los bytes correctos y mapea errores a
  `PrinterError`.

## Validación en hardware real (obligatoria antes de cerrar)
- Imprimir un ticket real desde la app en la impresora de los pilotos.
- Abrir el cajón al cobrar en efectivo.
- Probar fallo: impresora apagada → mensaje claro al cajero, sin crash.
- Anotar en `A1-done.md` el modelo de impresora y dispositivo Android
  usados.

## Entregables
1. PR único con A1.
2. `UsbNativeTransport` implementado y probado en impresora USB real.
3. Refactor de `escposPrint.ts` al registry sin regresión web.
4. `docs/blocks/A1-done.md`: estructura, decisiones, canal elegido y por
   qué, hardware probado, dudas.

## Lo que NO entra en A1
- Escáner cámara nativo / offline audit → A2.
- Icono/splash/firma/Play Store → A3.
- Soportar múltiples modelos de impresora a la vez → v2 on-demand.

Cuando termines, Matías valida con impresora real y abrimos A2.
