# A3 · Android identidad + publicación · done

**Rama:** `a3-publicacion` (desde `integracion-offline-nativa`, para que el
APK/AAB del piloto lleve offline + impresión USB + escáner cámara ya
integrados). **4 commits, uno por frente, sin merge. El push lo hace Matías.**

**Estado final:** `./gradlew assembleDebug` → **BUILD SUCCESSFUL** (138 tasks)
y `./gradlew bundleRelease` → **BUILD SUCCESSFUL** con `.aab` **firmado**
(`signReleaseBundle` ejecutado), `versionName 1.0.0 / versionCode 1`,
validado con un keystore de usar-y-tirar que se destruyó tras la prueba.
`tpv-web build` con `VITE_API_URL=https://api.mipiacetpv.com` → la URL queda
**embebida en el bundle** (verificado con grep sobre `dist/assets/index-*.js`).

---

## ⚠️ Requisito de build CRÍTICO (hallazgo A2) — resuelto y verificado

El APK/AAB empaqueta el `dist` de Vite de `tpv-web`. Con el `VITE_API_URL`
por defecto (`/api`) el WebView resuelve contra `https://localhost` → app
**sin backend** (ni login, ni catálogo, ni cobros).

**El build de release DEBE fijar `VITE_API_URL=https://api.mipiacetpv.com`.**
El script `build-release-aab.sh` lo hace por defecto. Verificado: tras el
build, `grep https://api.mipiacetpv.com dist/assets/index-*.js` → **encontrado**.

Otros `VITE_*` revisados:
- `VITE_BUILD_HASH` — lo resuelve Vite del `git HEAD`; no hay que fijarlo.
- `VITE_SENTRY_DSN` — opcional (telemetría); si se quiere Sentry en la app,
  exportarlo antes del build.
- `VITE_TPV_URL` — **no se consume** en `apps/tpv-web/src` (grep vacío). El
  prompt lo citaba como ejemplo; no hace falta fijarlo. Si en el futuro se
  usa, añadirlo al `export` del script.

Cómo cambiar a staging en el futuro: `VITE_API_URL=https://staging... \
apps/tpv-android/scripts/build-release-aab.sh` (la env sobreescribe el
default del script).

---

## Comando exacto de build del `.aab` firmado

Prerrequisito: `apps/tpv-android/android/keystore.properties` relleno (ver
`keystore.properties.example`) y toolchain de A0.

```bash
# Toolchain (cada shell nuevo):
export JAVA_HOME=/usr/local/opt/openjdk@17
export ANDROID_HOME=/usr/local/share/android-commandlinetools

# Build completo (web con backend de prod + sync + .aab firmado):
apps/tpv-android/scripts/build-release-aab.sh

# Con versión explícita (bump en cada subida a Play):
VERSION_NAME=1.0.1 VERSION_CODE=2 apps/tpv-android/scripts/build-release-aab.sh
```

El `.aab` queda en:
`apps/tpv-android/android/app/build/outputs/bundle/release/app-release.aab`
(gitignored). Verificar firma: `jarsigner -verify -verbose -certs <aab>`.

Crear el keystore una sola vez (contraseña a 1Password):
```bash
keytool -genkeypair -v -keystore ~/keys/mipiacetpv-release.jks \
  -alias mipiacetpv -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=mipiace, O=mipiace, C=ES"
```

---

## Frente 1 · Identidad de app (commit `feat(android): A3 Frente 1`)

Derivada del logo canónico de `docs/design/tokens.md §1` (4 barras `ink`
`#1F2937` + corazón `coral` `#E97058`). **No se inventó marca nueva.**

**Android:**
- Icono adaptativo en **VectorDrawable** (`drawable/ic_launcher_foreground.xml`),
  nítido a cualquier densidad sin PNG. Un `<group>` escala el viewBox 0..28
  del logo a la zona segura del lienzo 108×108.
- **Monochrome** (`ic_launcher_monochrome.xml`) para themed icons de Android 13+.
- Fondo del icono = **stone `#F8F6F3`** (`values/colors.xml`) para dar
  contraste a las barras ink. `mipmap-anydpi-v26/ic_launcher{,_round}.xml`
  ahora apuntan al vector + monochrome.
- **Splash** = fondo `#0F172A` (theme_color) + **logo reversado** (barras en
  stone, corazón coral — tokens §9 modo oscuro): `drawable/splash.xml`
  (layer-list, Android <12) y `values-v31/styles.xml`
  (`windowSplashScreen*`, Android 12+).
- **StatusBar** `#0F172A` en `capacitor.config.ts` (coherente al revelar las
  barras; la app corre inmersiva por A0).
- Eliminados los **placeholders del scaffold**: robot verde
  (`drawable-v24/ic_launcher_foreground.xml`), fondo teal
  (`drawable/ic_launcher_background.xml`), color duplicado
  (`values/ic_launcher_background.xml`) y los 11 `splash.png` de todas las
  densidades.

**Web (mismo set sirve web y app):**
- Completado el `TODO B4` del manifest PWA en `vite.config.ts`: iconos
  **192, 512 y maskable-512**. Verificado en `dist/manifest.webmanifest`.
- `favicon.svg` y `apple-touch-icon` de marca (antes: placeholder "m").
- `apps/tpv-web/scripts/gen-pwa-icons.mjs`: genera los PNG desde el logo
  canónico **sin dependencias nativas** (rasteriza barras + corazón con
  supersampling 4× y codifica PNG con `zlib`). Reejecutable:
  `node apps/tpv-web/scripts/gen-pwa-icons.mjs`. Se eligió esta vía porque
  el Mac no tiene `magick`/`rsvg`/`sharp` y evita añadir un binario nativo
  al toolchain.

## Frente 2 · Configuración de release (commit `build(android): A3 Frente 2`)

- `versionCode`/`versionName` → **1.0.0 / 1** (primer release de pilotos),
  sobreescribibles con `-PversionName`/`-PversionCode`.
- **Orientación landscape + modo inmersivo**: ya resueltos en A0
  (`sensorLandscape` + `WindowInsetsController` en `MainActivity`). Sin cambios.
- **Permisos** (`AndroidManifest`): sólo `INTERNET` + `CAMERA` (runtime, con
  `camera.any required=false`) + feature `usb.host required=false`. Mínimos y
  correctos desde A1/A2. Sin cambios.
- **minSdk 28 / targetSdk 34**: `minSdk 28` fijado en A0 (Android 9+).
  `targetSdk 34` es **suficiente para canal interno/cerrado** — Play sólo
  exige el nivel al día (35/36) para **producción abierta**. Bump a
  producción: subir `targetSdkVersion` en `variables.gradle` (requiere
  instalar la SDK Platform correspondiente + posible bump de AGP). Se dejó en
  34 a propósito para no romper el build local (SDK 34 es lo instalado).

## Frente 3 · Build firmado (commit `build(android): A3 Frente 3`)

- `signingConfigs.release` lee `keystore.properties` con `rootProject.file`
  (= `apps/tpv-android/android/keystore.properties`, **gitignored**). Guard:
  si el fichero no existe, no se configura firma → debug/CI siguen sin
  secretos.
- `keystore.properties.example` (**committed**) documenta claves + `keytool`.
- `scripts/build-release-aab.sh`: orquesta web (con `VITE_API_URL`) → `cap
  sync` → `bundleRelease` firmado.
- `minifyEnabled false` (R8 off): el JS ya va minificado en el dist; R8 sobre
  el shell Java fino no aporta y añade riesgo.

## Frente 4 · Checklist de publicación (pasos HUMANOS de Matías)

Code **no** ejecuta nada de esto.

1. **Cuenta Google Play Developer** (si no existe): alta en
   <https://play.google.com/console>, pago único de 25 USD, verificación de
   identidad (puede tardar días — hacerlo con margen).
2. **Crear la app** en la consola: nombre `mipiacetpv`, tipo App, gratis.
3. **App signing**: aceptar **Play App Signing** (Google guarda la clave de
   firma de la app; tú subes el `.aab` firmado con TU *upload key* = el
   keystore de `keystore.properties`). Guardar bien ese keystore: sin él no
   se pueden publicar updates.
4. **Canal interno/cerrado** (no producción): `Testing → Internal testing`
   (o *Closed testing*). Crear una release, **subir `app-release.aab`**.
5. **Lista de testers**: añadir los emails a invitar —
   **Thalía (piloto 1)** + resto de pilotos. Compartir el enlace de opt-in
   que genera Play; cada tester acepta e instala desde Play.
6. **Ficha mínima** (Store listing) para pasar revisión:
   - Descripción corta y larga (TPV para hostelería integrado con Holded).
   - **Icono 512×512**: usar `apps/tpv-web/public/icons/icon-512.png`.
   - **Feature graphic 1024×500** y **capturas** (mín. 2, en landscape del
     terminal). Pendiente de generar en hardware real (ver dudas).
   - **Política de privacidad (URL obligatoria)**: ya existe
     `docs/legal/politica-privacidad-y-aviso-legal.md`; publicarla en una URL
     accesible (p. ej. bajo mipiacetpv.com) y pegar el enlace.
   - **Data safety form**: declarar que la app usa cámara (escáner) y red;
     sin publicidad ni venta de datos.
7. **Content rating** y **target audience**: rellenar los cuestionarios
   (app de negocio, no dirigida a menores).
8. Enviar a revisión del canal interno. Cuando Play apruebe, los testers
   instalan y **empieza la validación en campo (Thalía primero)**.

---

## Decisiones tomadas sin preguntar (con justificación)

1. **Icono nativo en VectorDrawable, no PNG** (Frente 1): `minSdk 28` garantiza
   que **siempre** se usa el icono adaptativo (`anydpi-v26`), así que el vector
   basta y queda nítido a cualquier densidad. Los `ic_launcher*.png` legacy de
   `mipmap-*dpi` quedan como fallback muerto para <API 26 (nunca se renderizan);
   se dejaron para no regenerar PNGs sin `magick`/`sharp` — inertes.
2. **PNG del manifest PWA generados por script `zlib` propio** (Frente 1): el
   Mac no tiene rasterizador de SVG (`magick`/`rsvg`/`sharp` ausentes). En vez
   de añadir un binario nativo al toolchain, un script Node sin deps rasteriza
   el logo (barras exactas + corazón por flatten de béziers) con AA 4×.
   Reproducible y auditable.
3. **Fondo de icono claro (stone) + splash oscuro (navy)**: las barras del logo
   son `ink` oscuro → sobre el navy del splash desaparecerían, así que el icono
   va sobre stone y el splash usa el **logo reversado** (tokens §9). Coherente
   con la identidad, no una marca nueva.
4. **`versionName 1.0.0`** en vez de heredar la versión del monorepo: los
   `package.json` están todos en `0.0.0` (el monorepo no los bumpea; versiona
   por tags/roadmap del backend). La versión **pública de la app en Play** es
   independiente y arranca en `1.0.0` — lo convencional para el primer release.
5. **`targetSdk 34` (no 35/36)**: Play sólo exige el nivel al día en producción
   abierta; para canal interno/cerrado 34 vale y **es lo instalado localmente**
   (subir a 35 rompería el build sin instalar la SDK Platform + bump AGP). Se
   documenta el bump para cuando se promueva a producción.
6. **Se borró `res/xml/config 2.xml`** (cruft): un duplicado Finder (con
   espacio en el nombre) de `config.xml` (generado y gitignored) **rompía el
   `mergeDebugResources`** (`' ' is not a valid resource name character`). No
   es mío ni versionado; misma familia que los `print 2.ts`/`build 2.gradle`
   ambientes ya señalados en A1/A2. Borrado para desbloquear el build.
7. **Se commiteó uno por frente y NO se pushea** (instrucción explícita de
   Matías, que sobreescribe la regla 5 del README de "Code no commitea").

## Validación realizada

- `pnpm --filter @mipiacetpv/tpv-web build` con `VITE_API_URL` de prod → OK;
  manifest con 3 iconos + maskable; URL embebida en el bundle (grep OK).
- `cap sync android` → OK (2 plugins: app, status-bar).
- `./gradlew clean assembleDebug` → **BUILD SUCCESSFUL** (138 tasks); todos
  los VectorDrawable, splash, colors y `values-v31` compilan y enlazan.
- `./gradlew bundleRelease` con keystore de usar-y-tirar → **BUILD
  SUCCESSFUL**, `app-release.aab` (3.2 MB) **firmado**, versionName 1.0.0 /
  versionCode 1. Keystore temporal y `keystore.properties` **destruidos** tras
  la prueba; `git status` confirma que ningún `.aab`/`.jks`/`keystore.properties`
  quedó staged.

## Dudas / carryovers

1. **Capturas y feature graphic de Play**: hay que tomarlas en el **terminal
   real** del piloto en landscape (no en emulador) — pendiente para la ficha.
2. **Política de privacidad**: el `.md` existe; falta **publicarla en una URL**
   pública y pegar el enlace en la consola (paso humano).
3. **Verificación visual del icono/splash en hardware real**: validado que
   compila y que los PNG se ven correctos; falta confirmar en el terminal del
   piloto (densidad de pantalla real, recorte del launcher).
4. **Cruft ambiente restante** (no tocado, fuera de scope): `build 2.gradle` y
   `cordova.variables 2.gradle` en `capacitor-cordova-android-plugins/` son
   duplicados Finder inertes (no se auto-aplican; sólo `build.gradle` sí). No
   rompen el build; conviene limpiarlos algún día junto al resto de `* 2.*`.
5. **`minSdk`/`targetSdk` para producción abierta**: cuando se salga del canal
   interno, subir `targetSdkVersion` al nivel que Play exija ese día.

## Lo que NO entra en A3 (según el prompt)

Publicación a producción abierta, integración de datáfono, mDNS y auto-update
OTA → v2.
