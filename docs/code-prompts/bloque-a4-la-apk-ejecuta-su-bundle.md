# Bloque A4 · la APK ejecuta su propio bundle

## Contexto (leer antes)

- `docs/qa/2026-09-01-ap11-v1-14/` — las capturas de la noche del 01-09 y la evidencia de este bloque.
- `docs/qa/2026-09-01-pruebas-fisicas-ap11-ronda2.md` — de ahí salió el arreglo que causó esto (B2).
- `apps/tpv-android/capacitor.config.ts` y `apps/tpv-android/package.json`.
- ADR de offline: **offline = 1 terminal, bundle local**. Este bloque defiende esa promesa.

## El problema, en una frase

**La APK no ejecuta su propio bundle: enseña producción bajada por internet**, y por eso instalar
una APK con v1.14 dentro no cambió absolutamente nada en el AP11.

### La evidencia (01-09, sobre el terminal real)

La APK instalada contiene `assets/index-DPJMFGpJ.js`. Lo que el terminal estaba ejecutando era
`assets/index-B2g4RT4W.js`, y en la caché del Service Worker del propio terminal están las
cabeceras de esa respuesta:

```
HTTP/1.1 200
server: Caddy
last-modified: Mon, 31 Aug 2026 10:45:52 GMT
```

`server: Caddy` es el VPS. La APK estaba mirando el despliegue D2.

### La cadena

`server.hostname: "mipiacetpv.com"` (el arreglo de CORS de la ronda 2) hace que el origen del
WebView sea el dominio real. Capacitor intercepta las peticiones **del WebView** con su
`WebViewAssetLoader`, **pero no las del Service Worker**: ésas salen a la red. Entonces:

1. El WebView carga el `index.html` local (bien) y registra `/sw.js`.
2. Esa petición **sale a internet** y trae el `sw.js` de producción.
3. Ese SW precachea los assets de producción y **pasa a controlar la página**.
4. A partir de ahí, y para siempre, la APK sirve producción. El bundle local queda de adorno.

**Consecuencias que hay que tener presentes al diseñar el arreglo:**

- Una APK entregada a un cliente enseña lo que haya en el VPS en ese momento, no lo que se le
  entregó ni lo que se probó.
- El offline de la APK no es el que creemos: la caché la manda el servidor.
- **Borrar el Service Worker en el terminal NO arregla nada**: al recargar se lo vuelve a bajar.
  Verificado esa noche, dos veces.

## Alcance

### 1 · Que la APK sirva su propio bundle

En el build de Android **no se genera Service Worker**. Dentro de la APK los assets ya son locales:
el SW no aporta nada y es exactamente el vector del fallo. La web (PWA en navegador) **sí lo
conserva** — ahí el SW es el offline. Es decir, `vite-plugin-pwa` condicionado por una variable de
entorno que el build de `tpv-android` fija, no un borrado global.

Deja escrito en el done-doc por qué no se eligió la alternativa (registrar un `ServiceWorkerClient`
en `MainActivity` que delegue en el mismo `WebViewAssetLoader`). Si tras evaluarla la eliges tú,
hazlo con un ADR y **pruébala en el AP11**, no sobre el emulador.

### 2 · Rescatar los terminales ya envenenados — y esto tiene trampa

Un terminal que ya tiene el SW de producción registrado **seguirá sirviendo producción aunque se le
instale la APK nueva**, porque el JS que se ejecuta es el de producción: cualquier código de rescate
que escribas en el front **no llegará nunca a ejecutarse**.

Por eso **el rescate tiene que ser nativo**: en `MainActivity`, al detectar que el `versionCode`
instalado cambió desde el último arranque, limpiar el almacenamiento de Service Workers y la caché
del WebView antes de cargar la página. Debe ser idempotente, no puede entrar en bucle de recarga y
**no puede tocar `localStorage`**: ahí vive `mipiacetpv-device-me` y borrarlo desvincula el terminal
y obliga a pedir un código de 6 dígitos en la barra un lunes por la mañana.

### 3 · Fijar `VITE_API_URL` en el build de Android (deuda de la ronda 2)

`apps/tpv-android/package.json` tiene `build:web` en seco, así que si quien compila no se acuerda de
exportar `VITE_API_URL`, la APK sale muerta (`/api` la sirve Capacitor devolviendo `index.html` con
200 a todo). Fíjalo en el script. Que no dependa de la memoria de nadie.

### 4 · Que esto sea detectable a simple vista

El terminal ya dice qué versión lleva (`9d76904`). Asegúrate de que **esa versión es la del bundle
que se está ejecutando**, no la que reporta el servidor — si hubiera dicho el bundle, esta noche se
habría visto en dos segundos en vez de en hora y media.

## Verificación

Tabla **sabotaje → test rojo**, con los sabotajes aplicados de verdad sobre el código y revertidos:

| Sabotaje | Debe caer |
|---|---|
| Volver a generar el SW en el build de Android | test de que el bundle de Android no incluye `sw.js` |
| Quitar `VITE_API_URL` del `build:web` | test de que el bundle contiene la URL absoluta de la API |
| Fingir un `versionCode` sin cambios | test de que el rescate nativo no se dispara dos veces |
| Fingir un `versionCode` nuevo | test de que se limpia SW y caché y **no** `localStorage` |

Y declara **qué NO cubre la suite**.

**Pasada física obligatoria en el AP11** (sin ella el bloque no se cierra), sobre un terminal que
tenga el SW de producción ya registrado — que es el caso real:

1. Instalar la APK nueva y comprobar, sobre el binario y sobre el terminal, que el asset que se
   ejecuta es el de la APK y no el del VPS. El comando que lo demuestra:
   `adb shell "run-as es.mipiace.tpv sh -c 'grep -ao \"index-[A-Za-z0-9_-]*\\.js\" -r app_webview/Default 2>/dev/null'"`
2. Comprobar que **la vinculación sobrevive** (no vuelve a pedir código).
3. Cortar la red del terminal y comprobar que la app **sigue arrancando** desde su bundle.
4. Comprobar que la pantalla de venta que sale es la de v1.14 y no la de producción.

## Fuera de alcance (explícito)

- **No tocar `CORS_ORIGINS` en el VPS.** La ronda 2 ya descartó ensanchar la lista blanca.
- No tocar el flujo de cobro, el arqueo ni el cierre de turno.
- El keystore de release (frente 7 de A3) sigue siendo otro bloque.
- El bug del `CashPad` en campos pre-rellenos: su propio bloque.
