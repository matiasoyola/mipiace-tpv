# @mipiacetpv/tpv-android

Shell **Capacitor** que empaqueta `apps/tpv-web` como app Android nativa
para Play Store. **No es un rewrite**: reutiliza el build de Vite de
`tpv-web` tal cual y solo añade el puente JS↔nativo para el hardware que
el WebView no puede tocar (impresora USB, cajón, permisos nativos).

> Respeta **ADR-011** (portabilidad de hardware): el núcleo
> (`tpv-web`/`api`) NUNCA depende de Android. Toda la dependencia de
> plataforma vive aquí y detrás de la interfaz `PrinterTransport`.

## Cómo encaja en el monorepo

```
apps/
├─ api/         ← backend (sin cambios; ya hace TCP a impresora WiFi)
├─ admin/       ← back-office (sin cambios)
├─ tpv-web/     ← PWA React/Vite — FUENTE ÚNICA DE UI
│  └─ src/platform/   ← (A0) adaptador: detecta si corre en Capacitor
└─ tpv-android/ ← ESTE paquete: shell Capacitor + plugins nativos
   ├─ capacitor.config.ts
   ├─ src/printer/PrinterTransport.ts   ← contrato (ya creado)
   └─ android/   ← proyecto Gradle/Android Studio (lo GENERA Code con `cap add android`)
```

`tpv-android` consume el `dist/` de `tpv-web`. La UI no se duplica: si
hay que cambiar una pantalla, se cambia en `tpv-web` y se ve en web y en
Android a la vez.

## Estado

A0 hecho: proyecto nativo `android/` generado y versionado, build debug
compila, WebView https + landscape + inmersivo. Pendientes A1 (impresión
USB), A2 (escáner/offline), A3 (identidad/publicación). Detalle en
`docs/blocks/A0-done.md`.

## Toolchain (este Mac, instalado en A0)

El Android Studio 2.2 / JDK 8 previos del Mac NO sirven. A0 instaló
toolchain CLI vía Homebrew; los comandos de build necesitan estos env:

```bash
export JAVA_HOME=/usr/local/opt/openjdk@17
export ANDROID_HOME=/usr/local/share/android-commandlinetools
```

(SDK Platform 34, build-tools 34, platform-tools y emulador viven bajo
ese `ANDROID_HOME`; el SDK viejo de `~/Library/Android/sdk` no se toca.)

## Build

```bash
pnpm --filter @mipiacetpv/tpv-web build   # genera dist/
pnpm --filter @mipiacetpv/tpv-android sync # cap sync (copia dist + plugins)
cd apps/tpv-android/android && ./gradlew assembleDebug  # APK debug
pnpm --filter @mipiacetpv/tpv-android open # abre Android Studio (si hay GUI moderna)
```

## Lo que NO va aquí

- Lógica de negocio, UI, o llamadas a la API → viven en `tpv-web`.
- Lógica fiscal → vive en Holded (ver memoria de proyecto).
- SDKs propietarios de fabricante → prohibido por ADR-011. Solo
  estándares: ESC/POS sobre BT/USB/TCP.
