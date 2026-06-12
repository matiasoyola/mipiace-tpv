# A0 · Android scaffold Capacitor · done

**Rama:** `a0-android-scaffold` (corre en paralelo con `v1-0-pilotos`; frontera de archivos respetada: solo `apps/tpv-android/**`, docs y este done).
**Estado final:** `./gradlew assembleDebug` → **BUILD SUCCESSFUL** (138 tasks). APK debug instalado y verificado en emulador Android 14 (API 34): el TPV arranca dentro de la app, renderiza la pantalla "Vincula este dispositivo" servida desde `https://localhost` (esquema https del WebView), en landscape y modo inmersivo, conectado a mipiacetpv.com. `pnpm-lock.yaml` sin cambios (las deps ya estaban resueltas por Cowork).

---

## Hito del bloque

✅ `tpv-web` se ve y navega dentro de una app Android nativa. Verificado con captura de pantalla: pantalla de vinculación de dispositivo renderizada, `MainActivity` con foco, assets (`index-*.js`, `index-*.css`, `version.json`, `workbox-window`) servidos por el bridge de Capacitor sin errores y sin ningún crash en logcat.

## Frente 1 · Dependencias e init

- Deps de `apps/tpv-android/package.json` ya resueltas en el workspace (Capacitor CLI 6.2.1). **Cero cambios en `package.json` ni en el lockfile.**
- `capacitor.config.ts` leído correctamente por `cap` desde `apps/tpv-android` (appId `es.mipiace.tpv`, appName `mipiacetpv`, webDir `../tpv-web/dist`).
- `cap add android` → proyecto nativo generado y **versionado** en `apps/tpv-android/android/` (53 archivos fuente; `build/`, `.apk`, keystore y `local.properties` quedan fuera por el `.gitignore` que genera la plantilla — verificado con `git status`).

## Frente 2 · Build + sync

```bash
# Toolchain (ver "Decisiones" §toolchain — necesario en cada shell):
export JAVA_HOME=/usr/local/opt/openjdk@17
export ANDROID_HOME=/usr/local/share/android-commandlinetools

pnpm --filter @mipiacetpv/tpv-web build      # dist/ de la PWA (verificado)
pnpm --filter @mipiacetpv/tpv-android sync   # build:web + cap sync android (verificado)
cd apps/tpv-android/android && ./gradlew assembleDebug   # APK debug (verificado)

# Emulador usado en la verificación (AVD ya creado, perfil pixel_tablet):
$ANDROID_HOME/emulator/emulator -avd tpv-a0 &
$ANDROID_HOME/platform-tools/adb install -r apps/tpv-android/android/app/build/outputs/apk/debug/app-debug.apk
$ANDROID_HOME/platform-tools/adb shell am start -n es.mipiace.tpv/.MainActivity

# Con Android Studio (cuando haya uno moderno instalado):
pnpm --filter @mipiacetpv/tpv-android open
```

## Frente 3 · WebView

- **Esquema https** explícito (`server.androidScheme: "https"` en `capacitor.config.ts`). Es el default de Capacitor 6, pero el SW y los permisos del TPV dependen de él → no se deja implícito. `allowMixedContent: false` ya venía del scaffold.
- **Landscape**: `android:screenOrientation="sensorLandscape"` en `MainActivity` (manifest). `sensorLandscape` y no `landscape` para que la tablet pueda girarse 180º (cable de corriente a izquierda o derecha).
- **Modo inmersivo**: resultó trivial → entra en A0 y no se difiere a A3. `MainActivity.onWindowFocusChanged` oculta las barras del sistema (API moderna `WindowInsetsController` en Android 11+, `systemUiVisibility` legacy por debajo); reaparecen con swipe desde el borde. Verificado en emulador (Android muestra el aviso "Viewing full screen" la primera vez).

## Frente 4 · Adaptador de plataforma — DIFERIDO (decisión de Matías)

`apps/tpv-web/src/platform/index.ts` + test **no se crean en esta rama**: la frontera de archivos prohíbe tocar `apps/tpv-web` (rama paralela `v1-0-pilotos`). Decidido explícitamente con Matías al arrancar el bloque: **carryover para post-merge** (primer commit de A1, que es quien lo consume para elegir transporte de impresión). El contenido es pequeño y sin riesgo: `isCapacitor()` vía `window.Capacitor?.isNativePlatform?.()`, `getPlatform(): "web" | "android"`, test unitario con mock de `window.Capacitor`.

## Decisiones tomadas sin preguntar (con justificación)

1. **Toolchain CLI vía Homebrew, sin Android Studio** (esta opción sí se consultó y Matías la eligió): el Mac tenía Android Studio 2.2 (2016), JDK 8 y SDK máximo API 25 — inservible. Instalado: `openjdk@17` (formula) y `android-commandlinetools` (cask) + SDK Platform 34, build-tools 34.0.0, platform-tools, emulator e imagen de sistema API 34 x86_64 con `sdkmanager`. El SDK viejo de `~/Library/Android/sdk` no se tocó. Los builds necesitan `JAVA_HOME`/`ANDROID_HOME` como arriba (documentado también en el README del paquete).
2. **`minSdkVersion` 22 → 28** (`variables.gradle`): el plan (`docs/android-capacitor-plan.md` §riesgos) fija Android 9+ como mínimo razonable; el default de Capacitor (22 = Android 5.1) obligaría a probar en WebViews de 2015.
3. **Modo inmersivo en A0** (el prompt lo dejaba opcional): ~25 líneas en `MainActivity`, verificable en emulador, y el terminal de caja no debe enseñar barras de sistema. Si molesta en hardware real, se afina en A3.
4. **AVD con perfil `pixel_tablet`**: lo más parecido al terminal todo-en-uno de los pilotos disponible de serie.
5. **Dos errores de `tsc` pre-existentes del scaffold de Cowork, arreglados** (el bloque exige TypeScript estricto y `tsc` no pasaba): (a) `tsconfig.json` declaraba `rootDir: "src"` pero incluía `capacitor.config.ts` (TS6059) → se quita `rootDir` (no hay emit real, `outDir` se mantiene); (b) `PrinterTransport.ts` → `cause` en `PrinterError` necesita `override` porque `Error.cause` existe en ES2022 (TS4115). Cero cambios semánticos.

## Dudas / observaciones

- **Primer arranque en el emulador tardó ~12 s en mostrar la activity** (`Displayed +12s115ms`) y el proceso murió tras pasar a background; el segundo arranque fue estable e instantáneo. Atribuido al emulador x86_64 con GPU software (swiftshader) en frío — vigilar en hardware real, no parece problema de la app (cero stacktraces en logcat).
- El warning `Capacitor: Unable to read file at path public/plugins` es ruido conocido de Capacitor 6 (busca plugins Cordova que no usamos).
- La pantalla de vinculación pide código de 6 dígitos → la navegación post-login no se pudo ejercitar sin un tenant; el shell (router, assets, SW client, fetch a `version.json`) funciona.

## Entorno de prueba

- **Emulador**: AVD `tpv-a0`, Android 14 (API 34, google_apis x86_64), perfil pixel_tablet, headless (`-no-window -gpu swiftshader_indirect`), en el Mac Intel i9 de Matías.
- **Hardware real**: NO probado en este bloque (regla 6 de `docs/android/README.md` lo exige para cerrar A1/A2, no A0).

## Carryovers para A1

1. **Frente 4 completo** (`apps/tpv-web/src/platform/` + test) como primer commit de A1, ya sin frontera.
2. Probar en el terminal Android todo-en-uno real de los pilotos (obligatorio para cerrar A1).
3. Revisar el arranque en frío (observación de arriba) en hardware real.
4. El `.gitignore` de la plantilla cubre `local.properties`; si alguien abre Android Studio y lo genera, no entrará al repo — nada que hacer, solo saberlo.
