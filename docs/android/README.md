# App Android (Capacitor) — consideraciones y guía de trabajo

Subproyecto `apps/tpv-android`. Empaqueta `tpv-web` como app Android para
Play Store. Esta carpeta documenta **qué tener en cuenta** y **cómo debe
trabajar Claude Code** los bloques A0–A3.

Plan estratégico completo: `docs/android-capacitor-plan.md`.
Prompts por bloque: `docs/code-prompts/android/A0..A3.md`.

---

## 1. Decisión de arquitectura

Capacitor mete `tpv-web` (React/Vite, ya PWA) dentro de un WebView nativo
y expone un puente JS↔nativo para el hardware que el navegador no alcanza.

- **No se duplica UI.** `tpv-web` sigue siendo la fuente única. Android
  consume su `dist/`. Un cambio de pantalla se hace una vez.
- **Toda dependencia de plataforma vive detrás de interfaces.** La clave
  es `apps/tpv-android/src/printer/PrinterTransport.ts`. El TPV pide
  "imprime estos bytes" sin saber si está en Chrome o en Android.
- Respeta **ADR-011**: solo ESC/POS estándar sobre BT/USB/TCP. Cero SDKs
  de fabricante.

## 2. Lo que tenemos que tener en cuenta (riesgos reales)

### 2.1 WebUSB NO existe en el WebView de Android — punto rojo
`tpv-web/src/lib/escposPrint.ts` imprime USB vía WebUSB. Dentro de
Capacitor esa rama se rompe. Tres salidas, por preferencia:

| Canal | Cobertura | Esfuerzo | Reutiliza |
|---|---|---|---|
| **WiFi/TCP** | Impresoras de red | **Ya hecho** | El endpoint backend `/tickets/:id/print/escpos?target=wifi` y `sendOverTcp()` funcionan idénticos desde Android |
| **Bluetooth** (recomendado para USB-less) | Mayoría de térmicas modernas | Plugin BLE/SPP | El builder de bytes; solo cambia el transporte |
| **USB nativo** | Solo-USB (POS-80, etc.) | Plugin USB Host Android | El builder de bytes |

La capa `PrinterTransport` ya está diseñada para que añadir un canal sea
implementar una clase, no tocar el TPV.

### 2.2 Hardware decidido: impresora USB
Los pilotos (Thalía incluida) usan impresora térmica **USB** en el
terminal Android todo-en-uno. Por eso A1 implementa `UsbNativeTransport`
(USB Host de Android), no Bluetooth. `WifiBackendTransport` se mantiene
como fallback porque la ruta TCP del backend ya existe. No soportar
varios modelos a la vez en v1: elegir uno oficial y validarlo.

### 2.3 Offline ya existe, pero hay que auditarlo en dispositivo
`tpv-web` ya tiene Service Worker + Workbox + version-check agresivo. En
Capacitor el SW corre dentro del WebView; hay que verificar en un Android
real (no emulador) que: cobra sin red, imprime sin red (BT/USB no
dependen de internet; WiFi a impresora local tampoco), y encola la venta
para sincronizar con Holded al volver la red. La idempotencia del lado
Holded ya está resuelta (ver memoria de proyecto).

### 2.4 Permisos nativos
Cámara (escáner zxing ya usa getUserMedia → permiso nativo), Bluetooth
(BLUETOOTH_CONNECT/SCAN en Android 12+ son permisos en runtime),
ubicación (algunos Android la exigen para escanear BT). Pedirlos con
mensajes claros en castellano.

### 2.5 HTTPS / esquema del WebView
El TPV asume HTTPS (SW, cámara). Configurar el WebView con esquema https
y `allowMixedContent:false` para que el comportamiento sea igual a
producción.

### 2.6 Firma y Play Store
El keystore de firma vive SOLO en el Mac de Matías + 1Password. NUNCA al
repo (ya está en `.gitignore`). Publicar primero en canal interno/cerrado
para Thalía y pilotos antes de producción.

### 2.7 Lo que NO añade complejidad
- Capa fiscal → en Holded, la app no implementa nada fiscal.
- Backend `api` → sin cambios; la app consume los mismos endpoints.

## 3. Iteraciones (bloques)

| Bloque | Foco | Depende de |
|---|---|---|
| **A0** | Scaffold Capacitor: `cap add android`, build de `dist`, app que arranca y navega; adaptador `tpv-web/src/platform` que detecta Capacitor | — |
| **A1** | Impresión real: `PrinterTransport` + `UsbNativeTransport` (USB Host, canal decidido) + cajón | A0 |
| **A2** | Escáner cámara nativo + permisos + auditoría offline en dispositivo real | A0 |
| **A3** | Identidad (icono/splash/orientación), build firmado `.aab`, publicación canal interno | A1, A2 |

Cada bloque cierra con `docs/blocks/A{n}-done.md` (mismo sistema que
B1–B7).

## 4. Cómo debe trabajar Claude Code en este subproyecto

Mismas reglas que `docs/working-with-claude-code.md`, con matices Android:

1. **Sesión nueva por bloque.** Arrancar `claude` y pegar:
   `tienes el prompt en docs/code-prompts/android/A0-scaffold.md`
   (o el que toque). Code lee, resume y plantea discrepancias **antes**
   de tocar código. No darle luz verde sin revisar el resumen.

2. **Tooling nativo lo corre Code en el Mac, no Cowork.** `cap add
   android`, Gradle y Android Studio necesitan el Android SDK instalado
   localmente. Cowork prepara docs/contratos/prompts; Code genera el
   proyecto nativo `android/`. Requisito previo en el Mac: Android Studio
   + JDK 17 + SDK Platform 34+.

3. **Un solo código de UI.** Code NO duplica pantallas de `tpv-web` en
   `tpv-android`. Si una pantalla necesita comportamiento distinto en
   Android, va detrás del adaptador `tpv-web/src/platform`, no como copia.

4. **Todo periférico detrás de `PrinterTransport`** (o interfaz análoga
   para otros periféricos). Nada de llamar a un plugin nativo desde un
   componente de pantalla.

5. **Code NO commitea ni pushea.** Prepara el PR + `A{n}-done.md`. El
   commit lo hace Matías/Cowork tras revisar; el push lo hace Matías.

6. **Probar en hardware real antes de cerrar A1/A2.** Emulador no sirve
   para impresora, BT ni rendimiento de cámara. El `A{n}-done.md` debe
   indicar en qué dispositivo se probó.

7. **`.aab`/keystore nunca al repo.** Ya en `.gitignore`. El keystore se
   guarda en 1Password.

## 5. Referencias

- `docs/android-capacitor-plan.md` — plan estratégico y estimación.
- `docs/04-stack-y-decisiones.md` §ADR-011 — portabilidad de hardware.
- `apps/tpv-web/src/lib/escposPrint.ts` — impresión web actual (USB/WiFi).
- `packages/escpos-builder/` — builder de bytes ESC/POS (se reutiliza).
- `docs/impresoras/` — despliegue USB y WiFi actuales.
- `docs/working-with-claude-code.md` — flujo general con Code.
