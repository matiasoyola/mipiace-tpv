# A4 · la APK ejecuta su propio bundle — done

**Commit del código:** `336f24b`
**Hallazgo:** `cc6302b` (docs)
**Pasada física:** AP11-1006, 2026-09-02 00:00–00:05 CEST
**Evidencia:** `docs/qa/2026-09-01-ap11-v1-14/` (capturas 08–12 y `a4-pasada-fisica-ap11.txt`)

---

## Qué pasaba

La APK no ejecutaba su propio bundle: enseñaba producción bajada por internet. Por eso
instalar una APK con v1.14 dentro no cambió nada en el AP11.

`server.hostname: "mipiacetpv.com"` (el arreglo de CORS de la ronda 2) hace que el origen del
WebView sea el dominio real. Capacitor intercepta las peticiones **del WebView** con su
`WebViewAssetLoader`, **pero no las del Service Worker**: el registro de `/sw.js` salía a la red,
traía el sw.js del VPS, precacheaba los assets del VPS y pasaba a controlar la página. Desde ahí,
y para siempre, la APK servía producción.

Verificado sobre el terminal antes de tocar nada (`a4-pasada-fisica-ap11.txt`, sección ANTES):

```
APK instalada:  assets/public/assets/index-DPJMFGpJ.js  +  assets/public/sw.js
Terminal ejecutando: index-CW8x8vhm.js
  desde app_webview/Default/Service Worker/CacheStorage/…
  con https://mipiacetpv.com/index.html y "Caddy" dentro de esa caché
```

---

## Lo que se ha hecho

### 1 · En el build de Android no se genera Service Worker

`apps/tpv-web/vite.config.ts`: `VitePWA({ disable: IS_ANDROID_BUILD, … })`, donde
`IS_ANDROID_BUILD` sale de `process.env.VITE_TARGET === "android"`, que fija el build de
`tpv-android`. Dentro de la APK los assets ya son locales: el SW no aporta offline y es
exactamente el vector del fallo.

`disable` es la vía soportada del plugin y hace las tres cosas a la vez: no emite `sw.js`, no
inyecta el registro en el HTML y resuelve `virtual:pwa-register` a un `registerSW` no-op. Por eso
`main.tsx` no cambia.

**La web no se toca.** Ahí el Service Worker **es** el offline, y el bloque no le entra. Hay tests
explícitos de regresión cero: el bundle de la web sigue emitiendo `sw.js`, `manifest.webmanifest` y
un precache.

#### Por qué NO se eligió el `ServiceWorkerClient` en `MainActivity`

La alternativa era registrar un `ServiceWorkerController.setServiceWorkerClient(…)` que delegase
las peticiones del SW en el mismo `WebViewAssetLoader` que ya usa el WebView. Se descartó:

- **Añade una pieza en vez de quitar una.** El SW dentro de la APK no aporta nada: los assets ya
  están en disco y el offline lo da el propio APK. La opción elegida borra el problema; ésta lo
  domestica y deja el SW vivo, precacheando copias de ficheros que ya existen a un palmo.
- **Deja el fallo a un despiste de distancia.** `setServiceWorkerClient` es global y silencioso: si
  un día se llama tarde, o una versión del WebView cambia el orden de arranque, el SW vuelve a
  salir a la red y volvemos al 01-09 sin que nada avise. Sin SW no hay peticiones que interceptar.
- **No se puede probar sin terminal.** Un `disable` en el config se afirma sobre el dist emitido en
  CI (ver tabla de sabotaje). Un `ServiceWorkerClient` sólo se puede comprobar con un WebView real
  y una petición real: el guardia se convertiría en "acuérdate de probarlo en el AP11".
- **No rescata a nadie.** Los terminales ya envenenados siguen ejecutando el JS de producción
  igual, así que el rescate nativo (§2) haría falta de todos modos.

Si algún día hace falta un SW dentro de la APK (por ejemplo, background sync nativo), esa
alternativa vuelve a estar sobre la mesa **con un ADR y una pasada en el AP11**, no en el emulador.

### 2 · Rescate nativo de terminales ya envenenados

`WebViewRescue.java` (lógica) + `MainActivity.rescatarWebViewSiCambioLaVersion()` (cableado).

Tiene que ser nativo y no hay alternativa: un terminal envenenado ejecuta el JS de producción, así
que cualquier rescate escrito en el front no llegaría nunca a correr.

- Se dispara cuando el `versionCode` instalado difiere del último anotado en SharedPreferences
  (`mipiacetpv-rescate-webview`). Se compara por desigualdad, no por "mayor que": reinstalar una
  versión anterior también deja caché de otra versión.
- Borra, bajo `app_webview/Default`: `Service Worker`, `Cache`, `Code Cache`.
- **No toca** `Local Storage`, `Session Storage`, `IndexedDB` ni `databases`. Ahí viven la
  vinculación del terminal, el outbox de cobros pendientes (`mipiacetpv-outbox`) y el paquete
  offline de auth (`mipiacetpv-auth`). No se usa `WebStorage.deleteAllData()`, que sería lo cómodo
  y se los llevaría por delante; no hay API pública que borre sólo Service Workers, así que se
  borra por fichero.
- Corre **antes de `super.onCreate()`**, con los ficheros del perfil aún cerrados. No recarga ni
  reinicia nada, así que no puede entrar en bucle.
- Envuelto en `try/catch` entero: esto está en el camino crítico del arranque de una caja. Si
  falla, el terminal se queda como estaba —malo pero conocido—; una excepción aquí dejaría la barra
  sin TPV.

### 3 · `VITE_API_URL` fijada en el build de Android

`apps/tpv-android/package.json`:

```
"build:web": "VITE_TARGET=android VITE_API_URL=\"${VITE_API_URL:-https://api.mipiacetpv.com}\" pnpm --filter @mipiacetpv/tpv-web build"
```

Era la deuda de la ronda 2: el script iba en seco y quien compilara sin acordarse de exportar la
variable sacaba una APK muerta (`/api` la sirve Capacitor devolviendo `index.html` con 200 a todo).
Sobreescribible por entorno para apuntar a staging; `VITE_TARGET` no lo es en los scripts de
release: una APK de release con SW dentro es el fallo del 01-09 y no hay motivo legítimo para
construirla.

Los dos scripts de release (`build-release-apk.sh`, `build-release-aab.sh`) exportan `VITE_TARGET`
y abortan si aparece un `sw.js` — en el dist y, por separado, en lo que `cap sync` dejó en el
proyecto nativo. Misma doble puerta que ya tenía `VITE_API_URL`, y por el mismo motivo: un
`assets/public/` viejo traería el sw.js de vuelta con el dist limpio.

### 4 · Que se vea a simple vista

El bundle de Android lleva `VITE_TARGET=android` embebido por Vite; el de la web no lleva nada. En
runtime, `isForeignBundle()` (en `platform/AppInfo.ts`) dice que el JS en ejecución es ajeno a la
APK cuando el contenedor es Capacitor y el bundle no se declara `android`, y el menú del cajero
pinta `· ⚠ bundle ajeno a la APK`.

La etiqueta ya decía la verdad antes (`readBuildHash()` lee `import.meta.env.VITE_BUILD_HASH`, que
Vite sustituye dentro del propio chunk, así que siempre habla del bundle en ejecución). Lo que no
decía era **de dónde venía ese bundle**. Ahora sí.

En la pasada física el menú puso `build 336f24b`, que es exactamente el commit cuyo bundle va
dentro de la APK (`return"336f24b".trim()` en `index-ClvDUTbk.js`), y **sin** aviso.

---

## Verificación · sabotaje → test rojo

Los cuatro sabotajes se aplicaron sobre el código de verdad, se corrieron los tests, y se
revirtieron. Salida completa en el histórico de la sesión.

| Sabotaje aplicado | Test que se puso rojo | Mensaje |
|---|---|---|
| `const IS_ANDROID_BUILD = false` en `vite.config.ts` (vuelve a generarse el SW en el build de Android) | `bundle-android` › *no emite sw.js, registerSW.js ni workbox-\*.js*<br>`bundle-android` › *el bundle no llama a serviceWorker.register()* | `expected [ 'sw.js', 'workbox-16c398a5.js' ] to deeply equal []` |
| Quitar `VITE_API_URL=…` del `build:web` de `apps/tpv-android/package.json` | `bundle-android` › *la URL de producción aparece en los assets emitidos*<br>`bundle-android` › *no queda ningún `/api` relativo como base* | `expected false to be true` |
| `shouldPurge` devuelve `true` siempre (equivale a fingir que el versionCode siempre cambió) | `WebViewRescueTest` › `noSeDisparaDosVecesConElMismoVersionCode` | `mismo versionCode ya purgado: NO puede volver a purgar` |
| Añadir `"Local Storage"` a `DIRECTORIOS_A_BORRAR` (equivale a `WebStorage.deleteAllData()`) | `WebViewRescueTest` › `purgaNoBorraLocalStorageNiElRestoDeDatos` (+2) | `localStorage borrado: el terminal quedaría desvinculado y pediría código` |
| Quitar `"Service Worker"` de `DIRECTORIOS_A_BORRAR` | `WebViewRescueTest` › `purgaBorraServiceWorkerYCaches` (+1) | `tenía que borrar los 3 directorios objetivo expected:<3> but was:<2>` |

Cómo correr cada mitad:

```
pnpm exec vitest run --project infra bundle-android      # ~30 s (dos vite build)
pnpm exec vitest run --project tpv-web app-version-label
(cd apps/tpv-android/android && ./gradlew :app:testDebugUnitTest)
```

`infra/test/bundle-android.test.ts` construye el bundle de Android **ejecutando el `build:web` real
de `package.json`, con `VITE_API_URL` y `VITE_TARGET` borradas del entorno** — el caso real de quien
compila sin acordarse — y afirma sobre los ficheros emitidos, no sobre la intención del config. Es
caro (dos `vite build`) y es el único punto donde la afirmación es sobre el artefacto: el fallo del
01-09 no se veía ni al construir ni al instalar.

Suite completa tras el bloque: **1463 pasan, 3 skipped, 165 ficheros**. Gradle: **9/9**.

### Qué NO cubre la suite

- **Que el SW no se registre dentro de un WebView real.** Los tests afirman que no hay `sw.js` en el
  bundle y que nadie llama a `serviceWorker.register()`. Que el WebView de Android no se lo invente
  por su cuenta sólo lo dice la pasada física.
- **El borrado sobre un perfil de Chromium real.** `WebViewRescueTest` monta un árbol de ficheros
  con la forma del perfil del AP11, pero es un directorio de mentira. Que Chromium no reabra un
  handle a lo borrado, y que el borrado antes de `super.onCreate()` llegue a tiempo, lo dice la
  pasada física.
- **El disparo del rescate.** Se prueba `shouldPurge` y se prueba `purge`, que es toda la decisión;
  lo que no se prueba en JVM es la lectura del `versionCode` de `PackageManager` ni la escritura de
  SharedPreferences — son APIs de Android y harían falta Robolectric o un test instrumentado.
  Comprobado en el terminal (log y XML de prefs abajo).
- **El aviso de bundle ajeno, pintado.** Se prueba la decisión (`isForeignBundle`) y el formato de
  la etiqueta, y se prueba que la marca `android` sobrevive a la minificación. Que el aviso se vea
  en el menú con un bundle ajeno de verdad no se puede montar: tras el arreglo ya no hay forma de
  envenenar el terminal.
- **El resto de la app.** Cobro, arqueo y cierre de turno no se han tocado ni se han vuelto a
  probar aquí.
- **La firma de release en el terminal.** Ver la nota de la pasada física.

---

## Pasada física en el AP11 (obligatoria)

Sobre un terminal que **ya tenía el Service Worker de producción registrado**, que es el caso real.
Transcripción completa en `docs/qa/2026-09-01-ap11-v1-14/a4-pasada-fisica-ap11.txt`.

**Nota sobre la firma.** El AP11 tenía instalada una APK firmada con la clave de **debug**
(`CN=Android Debug`). Instalar encima la de release habría dado
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` y habría obligado a desinstalar — que borra los datos de la
app y desvincula el terminal, justo lo que la comprobación 2 tiene que verificar. Así que la pasada
se hizo con un APK **debug** de la misma versión (`1.14.1` / `versionCode 11401`), mismo bundle y
mismo código nativo. En paralelo se construyó el APK de release firmado y se verificó **sobre el
binario**:

```
build-releases/mipiacetpv-1.14.1-11401.apk   (7.184.066 bytes)
  Signer #1: CN=mipiacetpv, O=mipiace, L=Madrid, C=ES
  assets/public/  →  index-ClvDUTbk.js, index.html, version.json, icons/…
                     SIN sw.js, SIN registerSW.js, SIN workbox-*
  index-ClvDUTbk.js contiene  return"android".trim()  y  https://api.mipiacetpv.com
  capacitor.config.json sigue con "hostname": "mipiacetpv.com"  (B2 intacto)
```

### 1 · El asset que se ejecuta es el de la APK, no el del VPS

El comando del bloque, sobre el terminal, **después** de instalar:

```
$ adb shell "run-as es.mipiace.tpv sh -c 'grep -ao \"index-[A-Za-z0-9_-]*\.js\" -r app_webview/Default'"
(sin salida)
```

Antes devolvía siete líneas con `index-CW8x8vhm.js` dentro del `Service Worker`. Ahora no queda
ninguna copia de red.

La prueba en positivo la da el propio Capacitor:

```
D Capacitor: Handling local request: https://mipiacetpv.com/assets/index-ClvDUTbk.js
```

`Handling local request` = servido por el `WebViewAssetLoader` desde los assets de la APK, y
`index-ClvDUTbk.js` es exactamente el fichero que va dentro del binario. Y el menú del cajero pone
`build 336f24b`, el commit del que salió ese bundle (captura 11).

El rescate nativo, en logcat:

```
I mipiacetpv: A4 rescate: versionCode -1 -> 11401, directorios purgados: 1
```

`app_webview/Default` después: `Service Worker` **desaparecido**; `Local Storage`, `IndexedDB`,
`Session Storage`, `Cookies` en su sitio.

**Idempotencia, en el terminal.** `shared_prefs/mipiacetpv-rescate-webview.xml` quedó con
`lastPurgedVersionCode = 11401`, y en los dos arranques siguientes (incluido el forzado del test
sin red) el rescate **no volvió a dispararse**: cero líneas `A4 rescate` en un logcat limpiado
antes.

### 2 · La vinculación sobrevive

Tras instalar, el terminal pide **el PIN del cajero**, no un código de 6 dígitos: la cabecera ya
dice `Caja 1 · Tienda principal` y la lista de cajeros recientes sale rellena — las tres cosas se
leen de `localStorage` (captura 09).

Al entrar, el turno seguía abierto y las mesas M2 y M6 seguían con sus 1,50 € y sus 11 h de
antigüedad. Nada se perdió.

Los leveldb lo confirman por otra vía: la numeración de ficheros **continúa** en vez de reiniciar
(`Local Storage`: `…000014.ldb/000015.log/MANIFEST-000013` → `000018.log/000019.ldb/MANIFEST-000016`;
`IndexedDB` igual). Un borrado habría reiniciado la secuencia en `000003`. Lo que hubo fue una
compactación normal de leveldb al arrancar la app.

> Detalle para quien repita esto: comparar claves con `grep` sobre el directorio **no vale** como
> prueba. Antes del reinicio las claves recientes viven sin comprimir en el `.log`; después de
> compactar quedan dentro de bloques snappy de un `.ldb` y el grep deja de verlas. Parece un borrado
> y no lo es.

### 3 · Sin red, la app arranca desde su bundle

adb va por WiFi en este terminal, así que el corte se hizo con un script lanzado **en el propio
AP11** (`/data/local/tmp/a4-offline.sh`), que apaga el WiFi, reinicia la app, captura pantalla y
vuelve a encenderlo:

```
-- red tras cortar --
(ip -o addr show wlan0 → sin salida: interfaz caída)
ping: unknown host api.mipiacetpv.com
-- reinicio de la app SIN red --
Starting: Intent { cmp=es.mipiace.tpv/.MainActivity }
```

Durante esa ventana:

```
D Capacitor: Loading app at https://mipiacetpv.com
D Capacitor: Handling local request: https://mipiacetpv.com/
D Capacitor: Handling local request: https://mipiacetpv.com/assets/index-ClvDUTbk.js
D Capacitor: Handling local request: https://mipiacetpv.com/assets/index-WPy-Op-4.css
```

La app arrancó entera y pintó la pantalla de PIN con la caja y el cajero reciente (captura 12).
Este es el offline que la promesa del ADR decía y que antes no era verdad: la caché la mandaba el
servidor.

### 4 · La pantalla de venta es la de v1.14

Abriendo M2 sale el panel del ticket a la derecha con `Enviar comanda` + `Cobrar 1,50 €`, que es
v1.14 (`073fc94`, "la comanda se ve · panel del ticket invertido") y no la de producción
(captura 10, comparable con `03-venta.png` del 01-09).

El terminal se dejó como se encontró: turno abierto, M2 y M6 con lo suyo, sesión iniciada.

---

## Fuera de alcance, respetado

- **No se tocó `CORS_ORIGINS` en el VPS.**
- No se tocó el flujo de cobro, el arqueo ni el cierre de turno.
- El keystore de release (frente 7 de A3) sigue siendo otro bloque.
- El bug del `CashPad` en campos pre-rellenos sigue siendo otro bloque.

---

## Cabos sueltos (no del bloque, vistos al pasar)

- **La etiqueta del menú no enseña `versionName (versionCode)`.** En la pasada puso `build 336f24b`
  a secas, sin `1.14.1 (11401)`, o sea que `getNativeAppInfo()` devolvió null. El plugin sí se
  registra (`D Capacitor: Registering plugin instance: App`), así que la llamada al bridge se queda
  a medias por otro motivo. No es una regresión de A4 —la noche del 01-09 el terminal también
  enseñaba sólo el hash— y no afecta al hallazgo, porque la identidad que importaba aquí es la del
  bundle y ésa sí sale. Es territorio de A3, frente 2.
- **`sw-message-handler.js` sigue viajando dentro de la APK.** Vive en `public/` y se copia siempre.
  Es inofensivo —sólo lo cargaría un SW que ya no existe— pero es un fichero muerto en el binario.
- **`emitVersionJson` escribía en un `dist` fijo** en vez de en el `outDir` resuelto. Arreglado de
  paso, porque hacía frágil el test de bundle: un build a otro directorio escribía el `version.json`
  en el sitio equivocado, y petaba si ese `dist` no existía.
