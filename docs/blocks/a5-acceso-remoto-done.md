# A5 · el terminal se deja ver (acceso remoto a la flota) — done

Rama `a5-acceso-remoto`, sobre `master` en `7ce5194`. **Sin pushear.**

---

## 0 · El incidente del 2026-09-04, primero

Antes que ninguna otra cosa: **una APK de laboratorio de este bloque dejó sin cobrar a un
cliente real.**

**Qué pasó.** Durante el desarrollo de A5 se cambiaron tres valores en
`apps/tpv-android/capacitor.config.ts`, marcados `TEMPORAL` y `REVERTIR` (commit `d6b0570`),
para poder probar contra una API local sin TLS:

| | era | quedó |
|---|---|---|
| `server.androidScheme` | `https` | `http` |
| `server.hostname` | `mipiacetpv.com` | `a5-lab.mipiacetpv.com` |
| `android.allowMixedContent` | `false` | `true` |

Esa config salió en una APK. El terminal instaló bien, arrancó bien, y **pidió un código de
emparejamiento de 6 dígitos en mitad del servicio**.

**Por qué.** El WebView guarda `localStorage` **por origen**, y el origen es
`androidScheme://hostname`. La vinculación del terminal —`mipiacetpv-device-token` y
`mipiacetpv-device-me`— vive ahí. Cambiar el esquema o el host no "reconfigura" nada: le da al
TPV un almacén vacío. El terminal no estaba roto ni revocado en el servidor: **estaba mirando
otro cajón**.

**Por qué no lo vio nadie.** El fallo tiene la peor forma posible:

- no rompe el build,
- no rompe la instalación,
- **no se ve en un terminal nuevo**, que no tiene vinculación que perder.

Sólo aparece al **actualizar** un terminal que ya funcionaba. Es decir, en el único caso que no
se prueba en la mesa antes de salir.

**Por qué no lo paró la guarda que ya había.** `build-release-apk.sh` validaba el origen desde
el hallazgo B2, y aun así el APK salió, por dos agujeros:

1. **Sólo miraba `hostname`.** `androidScheme` cambia el origen igual de bien
   —`https://mipiacetpv.com` y `http://mipiacetpv.com` son orígenes **distintos**, con
   `localStorage` distinto— y no se comprobaba. `allowMixedContent` tampoco.
2. **El valor esperado salía de `VITE_TPV_URL`**, así que la guarda se apagaba exportando una
   variable. Una guarda con interruptor no es una guarda.

Y `build-release-aab.sh`, el gemelo, **no tenía ninguna guarda de origen**.

**Qué se ha hecho** (commit `558a67c`, R5 en la tabla de sabotaje):

- Revertidos los tres valores.
- `apps/tpv-android/scripts/origen-del-webview.mjs` los fija en un solo sitio, **sin variable de
  entorno que los relaje**, y sabe leerlos de la fuente `.ts` (con un lector que ignora
  comentarios: el propio config **explica** los valores malos) y del `capacitor.config.json` que
  deja `cap sync`, que es lo que se empaqueta de verdad.
- Los **dos** scripts de release lo llaman **dos veces**: sobre la fuente antes de compilar (el
  origen malo no rompe el build, así que fallar al final serían dos minutos de Vite y un gradle
  de por medio) y sobre el JSON sincronizado después del `cap sync`, porque un `assets/` viejo
  deja la fuente impecable y el binario apuntando a otro origen.
- `infra/test/origen-del-webview.test.ts`, 15 tests.

**La lección, escrita para que no se repita:** para probar contra una API local **no se toca el
origen**. Se levanta la API con TLS, o se usa `server.url` (hot-reload), que no cambia el origen
del bundle instalado.

---

## 1 · Qué quedó hecho

### Frente 1 · el terminal se anuncia (`0105125`)

WebSocket **saliente** `GET /ws/device`, autenticado con el device token que ya existía. Al
conectar y cada 30 s el terminal publica: versión del **bundle en ejecución** (leída del asset
real, no de lo que diga el servidor — la lección de A4) y `versionCode` de la APK, turno abierto
y desde cuándo, **cola offline pendiente**, red / IP local / hora del dispositivo, y último
arranque. Actualiza `Device.lastSeenAt`.

Reconexión con **backoff exponencial y jitter** (`equal jitter`, mitad fija + mitad aleatoria).
Un `Device` con `revokedAt` no abre canal, y si se revoca con el canal abierto **se cierra en
ese momento**.

### Frente 2 · el panel los ve (`a5bd2b7`)

Pantalla **Terminales** en super-admin: online, hace cuánto se vio a cada uno, versión, cola
pendiente, turno abierto. Filtrable por cuenta y tienda. Marca **quién está desactualizado**
comparando contra la última APK del índice de A3 — ese listado es el que decide a qué local hay
que ir. Y delata un **bundle ajeno** dentro de la APK (A4, en una columna).

### Frente 3 · comandos con lista blanca (`ff53e36`)

Seis, cerrados: `recargar` · `volcar-logs` · `captura-de-pantalla` · `forzar-sync` ·
`reiniciar-app` · `decir-version`. Cada uno con super-admin identificado y **motivo
obligatorio**. Dos trazas en `SuperAdminAudit` por comando (`device_command` antes de enviar,
`device_command_result` después) — con una sola escrita al final, un comando que no vuelve no
dejaría ni rastro, y ése es justo el que hay que poder investigar. Timeout de 25 s: un comando
que no vuelve se ve como que no volvió.

### Frente 4 · la captura (`ff53e36`)

**Decisión: captura nativa de la ventana propia** (`PixelCopy` sobre la ventana de la Activity,
con dibujado software como respaldo), **no volcado del DOM**.

- **Por qué PixelCopy, y pesa más que cualquier otro motivo: funciona con el JS colgado**, que
  es justo cuando alguien llama. Un volcado del DOM lo produce el mismo JS que puede estar
  bloqueado, así que **falla exactamente en el caso que hay que diagnosticar**.
- Además enseña **el render de verdad**, no una reconstrucción, incluidos los diálogos nativos
  **de la propia app**.
- **El límite, dicho en voz alta:** `PixelCopy` copia el Surface de **nuestra** ventana. **El
  teclado de Android y los diálogos del sistema son ventanas distintas y NO salen.** Un volcado
  del DOM tampoco los vería. Verlos exigiría MediaProjection, que es lo que se descartó por
  pedir consentimiento tras cada reinicio. **Esto no se le promete a ningún cliente.**
- **No necesita MediaProjection ni consentimiento por sesión**, que es lo que hace inviable
  RustDesk en un TPV que se reinicia solo un lunes a las 7:00.

Tratada como lo que es —**una foto de la pantalla de un TPV contiene datos de clientes**—:
retención corta con caducidad, acceso sólo desde super-admin, cada captura auditada al pedirla
**y al abrirla** (son dos accesos distintos), barrido que borra fichero y fila, y un **aviso
visible en el terminal** de que se acaba de tomar una, que no captura toques para que un
camarero a media comanda pueda seguir pulsando.

### Frente 5 · la escalada (`infra/terminal.sh`) — parcial, ver §4

`~/bin/tpv.sh` tenía la IP de casa quemada (`192.168.5.75`) y servía para un terminal.
`infra/terminal.sh` resuelve el terminal **por nombre contra el inventario del frente 2**, con
`estado | connect | mirror | logs | install <apk>`.

**La verificación física sobre el AP11 NO se ha podido hacer. Ver §4, que es un resultado, no
una omisión.**

### Frente 6 · `docs/implantacion/terminal-nuevo.md`

Qué se le hace a un terminal en la mesa antes de entregarlo, y la pregunta de **Device Owner
planteada con sus dos opciones y su coste, sin decidir** (§6 de ese documento).

### Refactor de paso (`899b721`)

`master` había arreglado el bridge de Capacitor repitiendo la misma lógica en tres sitios
(`905bd21`, `7ce5194`). Se unificó en un helper `getNativePlugin<T>(name)` en
`platform/index.ts`; los tres consumidores pasan por él.

---

## 2 · Tabla de sabotaje

**Sabotajes aplicados de verdad sobre el código y revertidos.** Mensajes copiados de la salida
real de `vitest`, no redactados.

| # | Sabotaje | Test que se pone rojo | Mensaje de fallo real |
|---|---|---|---|
| S1 | Aceptar el WS sin validar el device token (un token desconocido abre canal igual) | `device-support-channel` › *un device token inválido NO abre canal* (+1) | `token inválido: NO puede abrir canal: expected 4500 to be 4401` |
| S2 | Ignorar `revokedAt` en el handshake | `device-support-channel` › *un device REVOCADO no conecta* (+1) | `device revocado: NO puede abrir canal: expected 4500 to be 4403` |
| S3 | Revocar no cierra el canal ya abierto | `device-support-channel` › *revocar desde admin cierra el canal abierto en ese momento* | `la revocación tiene que cerrar el canal: expected false to be true` |
| S4 | Aceptar un comando fuera de la lista blanca | `device-commands` › *un comando fuera de la lista se rechaza Y queda auditado* (+1) | `expected 500 to be 400` |
| S5 | Saltarse la escritura en `SuperAdminAudit` | `device-commands` › *todo comando deja registro, y el de intención va ANTES del envío* (+1) | `expected [ 'device_command_result' ] to include 'device_command'` |
| S6 | Quitar el jitter del backoff | `support-channel-backoff` › *quince terminales NO reconectan a la vez* (+3) | `sin jitter los quince terminales caen en el mismo milisegundo: expected 1 to be greater than 10` |
| S7 | Dejar que un terminal escriba el estado de otro tenant | `device-support-channel` › *un terminal no puede escribir el estado de otro tenant* | `expected 77 to be 1` |
| **R1** · S8 | El cliente reacciona a un 4403 desvinculando (`clearAllDeviceState()`) | **`support-channel-no-desvincula`** › *un cierre por REVOCADO (4403) tampoco desvincula* **y** *red estructural › index.ts no puede desvincular* | `ni un 4403 puede borrar el token: expected false to be true` |
| **R1** · S9 | El `hello` contesta `DEVICE_REVOKED` con el device sano | `device-support-channel` › **13 tests**, entre ellos *un device cuya fila ya no existe cierra 4401, no 4403* y *cerrar por silencio NO es una revocación (R1)* | `Error: cerrado con 4403` |
| **R2** · S10 | El latido escribe en `Device` algo que no es `lastSeenAt` | `device-support-channel` › *el latido sólo toca lastSeenAt* | `el canal no puede escribir nada más en Device: ahí vive la vinculación: expected [ 'lastSeenAt', 'name' ] to deeply equal [ 'lastSeenAt' ]` |
| **R4** · S11 | `recargar` limpia storage además de recargar | `support-channel-no-desvincula` › *el comando `recargar` es un reload y nada más (R4)* | `commands.ts menciona localStorage: ningún comando puede tocar el almacenamiento del terminal: expected true to be false` |
| **R5** · S12 | El origen del WebView vuelve a `http` / `a5-lab.mipiacetpv.com` / `allowMixedContent` | `origen-del-webview` › *capacitor.config.ts declara exactamente esos valores*, y los tres *aborta con …* | `capacitor.config.ts: androidScheme es "http" y tiene que ser "https"` + el build sale con **exit 1** |

### R1, demostrado sobre `support-channel-no-desvincula.test.ts`

Es el riesgo con nombre del bloque, así que se sabotea por los dos lados:

- **S8, lado cliente.** Se hizo lo que haría alguien "arreglando" un 4403: en el handler de
  `close` de `lib/supportChannel/index.ts`, llamar a `clearAllDeviceState()`. Caen **dos** tests
  del mismo fichero, y esto es lo importante: uno de **comportamiento** (el token desapareció
  del `localStorage`) y uno **estructural** (*«index.ts no puede desvincular»*, que prohíbe que
  el fichero mencione siquiera `unpair`, `clearAllDeviceState` o `useDeviceBootstrap`). La red
  estructural es la que sobrevive a un refactor que la de comportamiento no vería.
- **S9, lado servidor.** El `hello` contesta `DEVICE_REVOKED` con el device sano en BD. Caen 13
  tests de `device-support-channel`, incluidos los que fijan que 4403 es **sólo** para un
  `revokedAt` real y que cerrar por silencio no es una revocación.

Con ambos sabotajes revertidos, el cliente sigue emparejado ante 4401, 4403, 4500, un error de
socket, el `stop()` del canal, y nunca reescribe su token.

### R3 · `WebViewRescue` sigue verde con la APK de A5

A5 trae `versionCode` nuevo, así que el rescate de A4 **se va a disparar en todos los terminales
que actualicen**. Si el trabajo en `MainActivity` lo alterase, se llevaría la vinculación por
delante.

- `WebViewRescue.java` y `WebViewRescueTest.java`: **sin tocar** (diff vacío contra `7ce5194`).
- `MainActivity.java`: única modificación, una línea `registerPlugin(SupportAgentPlugin.class)`.
  **`rescatarWebViewSiCambioLaVersion()` sigue siendo lo primero de `onCreate`**, antes de
  registrar plugins y antes de `super.onCreate()`.
- Ejecutado el 2026-09-05 con el `MainActivity` de A5 compilado:
  `./gradlew :app:testDebugUnitTest` → **`WebViewRescueTest`: 9 tests, 0 fallos, 0 errores**,
  incluido *`purgaNoBorraLocalStorageNiElRestoDeDatos`*, que es el que guarda la vinculación.

### Suite

`181 ficheros · 1650 tests verdes · 3 skipped` (`pnpm db:generate` antes de `pnpm test`, o 36
suites fallan sin ejecutar un solo test).

---

## 3 · Qué NO cubre la suite

Con nombre y apellidos, porque una tabla de sabotaje verde invita a creer que está todo cubierto.

**Nada de lo físico.** Es lo más importante de esta lista. La suite no ha tocado un terminal:

- Que el terminal aparezca online en el panel en menos de 30 s desde que arranca.
- Que tras cortarle la red 5 minutos pase a offline y **reconecte solo** al volver.
- Que la captura de pantalla salga bien de la pantalla de venta **real**, con el terminal en
  manos de otra persona.
- Que funcione con el terminal en **compartición de datos del móvil** (el caso Las Lomas).
- Que revocar desde admin tire el canal **en el terminal de verdad**, no en un socket de test.

**El transporte real.** Todo el lado servidor se prueba con un `prisma` falso y sockets
inyectados; el lado cliente, con un `WebSocket` de mentira. No se ha probado: TLS, Caddy
delante, proxies intermedios, un 4G con CGNAT, ni el keepalive del kernel. El cierre por
silencio existe **precisamente** porque un socket TCP no se entera de que al terminal le
quitaron el enchufe (verificado a mano en el AP11 el 2026-09-04), y eso no lo puede reproducir
un test.

**La concurrencia de verdad.** El test del jitter comprueba que quince valores calculados salen
dispersos. No comprueba que quince terminales reales contra una API que acaba de reiniciarse no
la tumben. Es un test del **cálculo**, no del rebaño.

**La captura, por dentro.** `captureOwnWindow()` se prueba a través de un plugin nativo
simulado. Que el `SupportAgentPlugin.java` capture de verdad la ventana, que el PNG salga
legible, y que el aviso se vea en la pantalla del AP11, **no está probado por ningún test**.

**La retención de capturas en el tiempo.** El barrido se prueba con fechas manipuladas. Que el
cron corra de verdad en el VPS, no.

**R5 sólo cubre el origen.** El test fija `androidScheme`, `hostname`, `allowMixedContent` y que
`server.url` no esté activo. **No** cubre otras formas de perder el `localStorage` de un
terminal: un `adb install` sin `-r`, un borrado de datos de la app, un reset de fábrica (§6 de
`terminal-nuevo.md`), o un cambio de `appId`.

**Ni un solo test corre contra un Postgres real** en esta suite (los e2e viven aparte,
`pnpm test:e2e`).

---

## 4 · Frente 5 · resultado de la escalada: **no verificada, y por qué**

Aquí se aplica el tope acordado: **si no se puede verificar, se escribe lo que salga, aunque
salga que no.** Salió que no.

### Lo que se intentó, el 2026-09-05

| Comprobación | Resultado |
|---|---|
| `adb` disponible | Sí, `/usr/local/bin/adb` y `scrcpy` |
| **Tailscale instalado en el Mac** | **No.** `tailscale: command not found` |
| Terminal conectado por USB | Ninguno. `adb devices` vacío |
| Mac en la misma subred que el AP11 | Sí: Mac `192.168.5.249`, AP11 `192.168.5.75` |
| `ping 192.168.5.75` | **0 de 2 paquetes**, 100 % de pérdida |
| `adb connect 192.168.5.75:5555` | **`failed to connect: Operation timed out`** |
| Tabla ARP de la LAN | **Vacía** para ese segmento |

**El AP11 no estaba en la red.** No es un fallo de configuración del script: no hay terminal al
otro lado, y sin terminal las tres preguntas del frente no se pueden contestar.

### Las tres preguntas, sin responder

1. **¿Sobrevive `adb tcpip 5555` a un reinicio?** *Sin verificar.* Lo conocido, y escrito en
   `terminal-nuevo.md` §4: no sobrevive sin root (`persist.adb.tcp.port`), el menú de fábrica
   del AP11 no persiste la depuración de red, y **el interruptor puede verse activado con
   `adbd` caído** — hay que comprobar el puerto, no el interruptor.
2. **¿Evita Tailscale que el AP11 se caiga de la red cuando está ocioso?** *Sin verificar, y sin
   poder verificarse desde aquí:* Tailscale no está instalado en el Mac ni, que se sepa, en el
   terminal. De esto depende que la escalada sirva de madrugada o sólo con el local abierto.
3. **¿Arranca Tailscale solo tras un reinicio?** *Sin verificar*, por lo mismo.

### Lo que sí quedó hecho del frente

- `infra/terminal.sh`, con resolución por nombre contra el inventario, `connect | estado |
  mirror | logs | install`. **Probado sólo hasta donde se puede sin terminal**: sintaxis, ayuda,
  y el error cuando falta `MIPIACETPV_SA_TOKEN`. La resolución nombre → IP **no se ha ejecutado
  contra la API real**, porque no hay token de super-admin en esta sesión.
- `install` usa `adb install -r` a propósito, y está comentado por qué: **sin `-r` se pierde el
  `localStorage`, y con él la vinculación** — el incidente del 04-09 por otra puerta.
- Queda escrito, en el script y en `terminal-nuevo.md` §4, que **macOS bloquea la red local al
  proceso que arranca el servidor de `adb`** si no tiene el permiso. El síntoma no es un error
  de permisos: es `No route to host` / `Operation timed out` contra **toda** la LAN, incluidas
  IPs que responden al ping. El servidor de adb se arranca **desde Terminal.app**.

### Qué hace falta para cerrar el frente

Un AP11 encendido y en red, y Tailscale instalado. Es una sesión con el terminal delante:
`adb tcpip 5555` por cable → reiniciar → comprobar el **puerto** → instalar Tailscale →
reiniciar → comprobar si levanta solo → dejarlo ocioso una hora → comprobar si sigue en red.

---

## 4 bis · Frente 5 · VERIFICACIÓN FÍSICA EJECUTADA (2026-09-13)

El AP11 estuvo en red esta vez. Se contesta **la pregunta 1**; las 2 y 3 siguen abiertas porque
Tailscale no está instalado ni en el terminal ni en el Mac.

Terminal: AP11-1006, Android 11, firmware `V11.2.20250603.110008-fy.userdebug`, 192.168.5.75.
APK instalada: **1.16.0 (11600)**, commit `0cd8ac6`. Capturas: `docs/qa/2026-09-13-ap11/`.

### Pregunta 1 · ¿sobrevive el adb por TCP a un reinicio? → **SÍ en este hierro**

Reinicio real ejecutado a las 13:08 (`adb reboot`, comprobado con `uptime` = 1 min después).
Con el **servidor de adb recién arrancado** —para que no valiera una entrada zombi del servidor
anterior—, `adb connect 192.168.5.75:5555` entra a la primera.

Y lo hace **sin `persist.adb.tcp.port`**:

| Propiedad | Antes del reinicio | Después |
|---|---|---|
| `service.adb.tcp.port` | `5555` | **`5555`** |
| `persist.adb.tcp.port` | *(vacía)* | *(vacía)* |
| `adb_wifi_enabled` | `0` | `0` |

⇒ Lo que persiste **no es** la propiedad de Android, sino **el ajuste de depuración de red del
fabricante**, que el firmware vuelve a aplicar al arrancar. Corrige la suposición de
`terminal-nuevo.md` §4 ("no sobrevive sin root"): en **este** modelo sí, pero por una vía del
fabricante. **No generalizar a otro hierro sin repetir la prueba.**

### El canal estable es el 5555, NO la depuración inalámbrica de Android 11

La depuración inalámbrica (menú de Android 11, puerto aleatorio) **no sobrevive**: `adb_wifi_enabled`
vuelve a `0`, y además el puerto **cambia en cada reconexión** y exige `adb pair` con un código de 6
dígitos y **un puerto distinto del de conexión**. Durante esta sesión se cayó dos veces (36679 →
38139 → muerta) mientras el `:5555` aguantó todo.

⇒ El `PORT=${TERMINAL_ADB_PORT:-5555}` de `infra/terminal.sh` **tiene el default correcto**.

### 🔴 Hallazgo nuevo: el TPV NO arranca solo tras el reinicio

Tras reiniciar, la actividad en primer plano es **`android.app.smdt.launcher/.Launcher`**, el
lanzador del fabricante. El TPV se queda cerrado hasta que alguien lo toca.

Es el mismo argumento que tumbó a RustDesk en la decisión de arquitectura: **un TPV que arranca un
lunes a las 7:00 no tiene quién le dé al icono.** Un corte de luz de madrugada deja al cliente con
la caja cerrada y sin saber por qué. Refuerza la duda 1 de §8 (**Device Owner**), que es lo que
permitiría modo kiosco y arranque automático.

### ✅ Lo que sí sobrevive al reinicio (y era lo que no se podía romper)

La **vinculación aguanta**: el TPV vuelve con "Caja 1 · Tienda principal" en la cabecera, sin pedir
código, y con el cajero en CAJEROS RECIENTES ("último acceso hoy 12:50"). Sólo pide el PIN. R5 y el
`bootstrap-decision` se comportan como dicen.

### Preguntas 2 y 3 · siguen sin respuesta

Tailscale **no está instalado** en el AP11 (`pm list packages` no lo encuentra) ni en el Mac. El
terminal **sí tiene Play Store y GMS** (`com.android.vending`, `com.google.android.gms`), así que se
puede instalar sin sideload. Falta una sesión con la cuenta de Google del terminal y el login del
tailnet: son credenciales, las teclea Matías.

Quedan igual que estaban:

2. ¿Evita Tailscale la caída de la LAN cuando el terminal está ocioso?
3. ¿Arranca Tailscale solo tras un reinicio?

⚠️ La caída en ocioso **se reprodujo otra vez hoy**: el terminal dejó de responder a `adb` a mitad
de sesión y hubo que despertarlo a mano. Sigue siendo el motivo por el que la pregunta 2 importa.

### Trampa en la que se volvió a caer (y cómo se sale)

Hacer `adb kill-server` desde un shell sin permiso de **Red Local** de macOS deja el servidor nuevo
sin acceso a la LAN: el síntoma es `No route to host` **contra todo el segmento**, no un error de
permisos. Se arregla relanzando el servidor desde Terminal.app:

```bash
osascript -e 'tell application "Terminal" to do script "adb kill-server; adb start-server; adb connect 192.168.5.75:5555"'
```

---

## 5 · Decisiones tomadas sin preguntar, con su justificación

1. **Ruta y autenticación propias en vez de reutilizar `/ws/store/:storeId`.** Aquel canal es
   del cajero; éste es del terminal. Mezclarlos obligaría a que el bus de mesas supiera de
   comandos y a que revocar un device tocara la mensajería de sala. Se imita el patrón, no se
   reutiliza. (ADR-014.)
2. **El device token NO viaja en la query string.** `/ws/store` pasa su JWT por `?token=` y lo
   asume porque es de TTL corto; el device token **no caduca nunca** y en la URL acabaría en los
   logs de Caddy, de cualquier proxy y en el `request.log` de Fastify, donde no se puede
   redactar lo que no es una cabecera. El socket se abre sin autenticar y el primer mensaje es
   un `hello`; si no llega en 5 s, se cierra.
3. **Captura nativa (`PixelCopy`) de la ventana propia, no volcado del DOM.** El motivo que
   decide: funciona con el JS colgado, que es cuando alguien llama. Un volcado del DOM lo
   produce el mismo JS que puede estar bloqueado. Justificado arriba (frente 4), con su límite.
4. **Cierre por silencio del canal.** Un socket TCP no se entera de que al terminal le quitaron
   la WiFi: verificado en el AP11 el 04-09, el panel seguía pintándolo online. Un panel que dice
   "online" de un terminal apagado es peor que no tener panel.
5. **`equal jitter` en vez de jitter completo.** Con jitter completo un terminal puede sacar
   ~0 diez veces seguidas y machacar la API. La mitad fija garantiza que la espera crece de
   verdad.
6. **Un canal por device: la reconexión sustituye al viejo, no lo duplica** (cierre 4409).
7. **El "Probar TPV" del super-admin queda fuera del inventario.** Un JWT de tres segmentos no
   abre canal: el inventario de terminales tiene que ser de terminales de verdad, y una pestaña
   abierta no es uno.
8. **Doble lista blanca, servidor y terminal.** El `switch` cerrado se repite en el cliente a
   propósito: una APK antigua no debe poder ejecutar un comando inventado después, y un servidor
   comprometido no debe poder pedirle al terminal algo que no esté escrito en su propio binario.
9. **Auditar antes de enviar, y dos trazas por comando.** Con una sola escrita al final, un
   comando que no vuelve no dejaría rastro. Un comando desconocido **también** se audita
   (`device_command_rejected`) aunque no llegue a salir.
10. **La guarda de origen (R5) no admite ninguna variable de entorno.** La anterior sí
    (`VITE_TPV_URL`) y por eso no paró el APK del 04-09.
11. **`fix(test)` de `bundle-android.test.ts`, fuera del alcance de A5.** Ver §7.

---

## 6 · Qué quedó fuera, y con qué bloque

| Fuera | Va con |
|---|---|
| **Controlar el táctil en remoto** | La escalada por adb del frente 5. **No se le promete a ningún cliente en este bloque.** |
| **Instalación silenciosa de APK** | El bloque del MDM. Necesita Device Owner; la decisión queda planteada y **sin decidir** en `terminal-nuevo.md` §6 |
| Kiosco, bloqueo y borrado remoto | MDM |
| **El contrato de encargado de tratamiento** que ampare mirar pantallas con datos de clientes | Deuda **legal**, anotada aquí y sin resolver. El frente 4 permite mirar la pantalla de un negocio ajeno: eso necesita amparo contractual, no sólo técnico |
| La **pasada física** completa sobre el AP11 | §4. Sin ella, el bloque **no está cerrado del todo** |

---

## 7 · Deuda de A4 que apareció por el camino (`d8b35d8`)

`infra/test/bundle-android.test.ts` estaba **rojo en `master`** antes de tocar nada (verificado
sobre un worktree limpio en `7ce5194`).

El test lanza un `vite build` de verdad con `spawnSync` y heredaba el entorno de vitest, que fija
`NODE_ENV=test`. Con eso Vite resuelve React a su bundle de **desarrollo**:

| build | chunk |
|---|---|
| producción real | 1.587 kB |
| `NODE_ENV=test` | 2.117 kB ← pasa del tope de precaché de workbox (2 MiB) |

La suite se ponía roja **por el entorno del runner, no por el bundle**. A5 sólo suma ~6 kB.

Arreglado borrando `NODE_ENV` del entorno del build hijo, como ya se hacía con las `VITE_*`.
**No se toca `vite.config.ts`, ni el Service Worker, ni el tope de workbox** — eso lo cerró A4 y
la restricción del bloque lo prohíbe.

---

## 8 · Dudas para Matías

1. **Device Owner: A o B.** Es la única decisión con reloj corriendo. Está planteada con costes
   en `terminal-nuevo.md` §6. Cada terminal entregado sin enrolar es un desplazamiento futuro.
2. **Retención de capturas.** Está puesta corta y declarada. ¿Cuánto es "corto" para lo que
   diga el contrato con el cliente? Es un número que hoy elegimos nosotros.
3. **¿Se instala Tailscale en la flota, o la escalada se queda para el local?** De la pregunta 2
   del frente 5 depende que se pueda entrar de madrugada. Hoy no está verificado ni instalado.
4. **El aviso de captura en el terminal.** Hoy es un indicador visible y no bloqueante. ¿Debería
   quedar además un registro que el **cliente** pueda consultar, y no sólo nosotros en
   `SuperAdminAudit`?

---

## 9 · Cómo arrancarlo de cero

```bash
pnpm install
pnpm db:generate          # ANTES de test: sin esto, 36 suites fallan sin ejecutar un solo test
pnpm db:migrate
pnpm test                 # 181 ficheros, 1650 verdes
pnpm dev:api              # la API, con /ws/device
pnpm dev:tpv              # el TPV; el canal se abre solo cuando el terminal está vinculado
```

**El canal de soporte** se abre desde `App.tsx` cuando el terminal está `paired` y **no** en
`testMode`. Es deliberadamente invisible: no pinta nada, no bloquea nada, y **ninguna pantalla
espera a que esté conectado**. Si la API está caída, reintenta en segundo plano y el TPV sigue
vendiendo.

**El panel** está en super-admin → Terminales.

**La escalada:**

```bash
export MIPIACETPV_SA_TOKEN='...'      # del panel; no como argumento: acabaría en el historial
infra/terminal.sh estado              # lista la flota con IP, versión y cola
infra/terminal.sh mirror "sirope"
infra/terminal.sh install "sirope" apps/tpv-android/build-releases/mipiacetpv-X.Y.Z-NNNNN.apk
```

Antes de nada, **una vez por Mac**: `adb start-server` **desde Terminal.app**, concediendo el
permiso de Red Local. Si no, `adb` da `Operation timed out` contra toda la LAN.

**Construir una APK:** `apps/tpv-android/scripts/build-release-apk.sh 1.16.0`. Se niega a
compilar si el origen del WebView no es `https://mipiacetpv.com` sin contenido mixto (R5). Si te
lo encuentras a las 8 de la mañana, el mensaje te cuenta por qué: §0.

---

## 10 · Integración en `master` (2026-09-18)

La rama estuvo cinco días parada y `master` se movió **95 commits**. Aquí no se abrió
nada nuevo: se trajo `master` a la rama (`git merge master`, commit de fusión `741953f`)
y se dejó A5 en condiciones de entrar. **Sin pushear y sin fusionar a `master`.**

Base común `7ce5194`. `master` en `3e254b8`, que es por donde va producción y de donde
salió la APK publicada, la **1.17.0**. Entró por medio B-9 (panel de salud de la agenda),
la carrera de dos altas 500→409 con su testigo del deadlock, el bloque reservas-mostrador
(merge `3e254b8`) y H1 («la caja es un módulo»).

### 10.1 · Lo primero: las dos migraciones de A5 llegan FUERA DE ORDEN

Las dos migraciones del bloque —`20260904100000_a5_device_heartbeats` y
`20260904110000_a5_device_screenshots`— llevan fecha **anterior** a tres que ya están
aplicadas en producción:

| Migración | Estado en producción (3e254b8) |
|---|---|
| `20260904100000_a5_device_heartbeats` | **sin aplicar** (A5) |
| `20260904110000_a5_device_screenshots` | **sin aplicar** (A5) |
| `20260909000000_s1_sello_de_la_venta` | aplicada |
| `20260911000000_b_reservas_7a_horario_centro` | aplicada |
| `20260912000000_h1_la_caja_es_un_modulo` | aplicada |

**Veredicto: el despliegue entra limpio. NO hay que renombrarlas.** Y no se dice de
memoria: se reprodujo contra Postgres de verdad (Prisma 5.22, `postgres:16-alpine`).
Producción despliega con `prisma migrate deploy` (`infra/deploy.sh:69` y
`infra/bootstrap-hostinger.sh:125`), que es justo el camino que se probó.

Lo que se hizo, y lo que salió:

1. Base limpia + **sólo las 54 migraciones de `master`** → `migrate deploy`. Eso es
   producción hoy.
2. Se añaden las dos de A5, que en orden lexicográfico caen **en medio** de las ya
   aplicadas. `migrate status`: *«Following migrations have not yet been applied»*, las
   dos, **sin una palabra sobre el orden**.
3. `migrate deploy` → `Applying migration 20260904100000…`, `…110000…`,
   **`All migrations have been successfully applied`**, salida 0. Ni aviso, ni error, ni
   reset.
4. La prueba que decide: se construye una base **de control** con las 56 migraciones
   desde cero (ahí A5 sí va en su sitio) y se comparan las dos bases con
   `prisma migrate diff --from-url … --to-url … --exit-code`:

   ```
   EXIT=0  →  No difference detected.
   ```

   **El esquema que deja el despliegue fuera de orden es idéntico al que deja el
   despliegue en orden.** Que es lo que había que saber.

`migrate deploy` no reordena ni valida el orden: aplica lo que no está en
`_prisma_migrations`, en orden de nombre, y sigue. El orden sólo importaría si las dos de
A5 dependieran de algo que crean las de septiembre, y no es el caso: `device_heartbeats` y
`device_screenshots` sólo cuelgan de `devices`, `tenants` y `super_admin_users`, que
existen desde mucho antes.

**Dos avisos, para no cantar victoria de más:**

- **El camino del desarrollador no es ése.** `pnpm db:migrate` es `prisma migrate dev`,
  no `deploy`. Sobre una base que ya iba por `master`, `migrate dev` **también aplica las
  dos sin resetear nada**, pero después se para a pedir nombre para una migración nueva
  (*«Enter a name for the new migration»*). Eso **no lo causa A5 ni el desorden**:
  es drift que `master` ya tiene por su cuenta —comprobado con `master` solo, salen
  **5 tablas**: las FKs a `super_admin_users` de `apk_download_codes`, las de
  `appointment_assignments` / `appointment_items`, el índice de `appointments` sobre
  `(tenant_id, timeslot)` y el GIN de `products.tags`—, todas cosas declaradas en SQL
  crudo que el datamodel de Prisma no sabe expresar. A5 añade **una** línea a esa lista
  (la FK `device_screenshots.requested_by_super_admin_id`) siguiendo **exactamente** la
  pauta que master estrenó en A3 con `apk_download_codes`. Quien vea el prompt en local
  que corte con Ctrl-C y use `pnpm --filter @mipiacetpv/db run migrate:deploy`.
- **Esto vale para desplegar sobre la producción de HOY.** Si antes de desplegar A5
  entrara en `master` otra migración que tocase estas tablas, hay que repetir la
  comprobación: el argumento es «no hay dependencia entre ellas», no «el orden da igual
  siempre».

### 10.2 · Conflictos y cómo se resolvieron

De los siete ficheros que tocan las dos partes, **dos** dieron conflicto de verdad.

**`packages/db/prisma/schema.prisma` — se queda lo de `master`.** El choque cae en la cola
del modelo `Ticket`. A5 **no aportaba nada** ahí: su lado del conflicto venía vacío, y lo
que había cambiado era sólo el realineado de espacios que deja `prisma format` al crecer
los nombres de tipo. `master` mete `sealedHash`/`sealedAt`, el sello de la venta (S1). Se
conserva el bloque de `master` tal cual y se pasa `prisma format` después, para que el
alineado no quede a medias. Los dos modelos nuevos de A5 —`DeviceHeartbeat` y
`DeviceScreenshot`— y las dos relaciones que cuelgan de `Device` están más arriba en el
fichero y fusionaron solos: siguen enteros.

**`apps/api/src/devices/routes.ts` — se quedan los dos.** Colisión de imports y nada más:
A5 trae `getDeviceChannelRegistry` / `WS_CLOSE` (cerrar el canal al revocar, S3 de la
tabla de sabotaje) y `master` trae `ensureCajaEnabled` (la puerta de H1). Los dos símbolos
se usan de verdad en el fichero fusionado. El bloque de A5 que cierra el canal abierto
dentro de `POST /admin/devices/:deviceId/revoke` queda intacto, ahora bajo el
`preHandler: [requireOwnerOrManager, ensureCajaEnabled]` nuevo.

Los otros cinco fusionaron solos, pero se miraron uno a uno porque «auto-merge» no es
«correcto»:

| Fichero | Qué pasó |
|---|---|
| `apps/api/src/server.ts` | Los dos registros de ruta se suman: `registerAgendaHoursRoutes` (master) y `registerDeviceWebSocketRoute` (A5, `/ws/device`). El worker `device-screenshot-sweeper` vive en `workers/index.ts`, que master no tocó: sigue arrancando. |
| `apps/api/src/superadmin/audit.ts` | Aditivo por los dos lados: los cinco esquemas de metadatos de A5 (`device_command`, `…_result`, `…_rejected`, `device_screenshot`, `…_viewed`) junto a los campos nuevos de H1. |
| `apps/admin/src/App.tsx` | La ruta `/superadmin/terminales` de A5 y el `<CajaGate>` de H1 conviven. **Terminales NO se envuelve en `CajaGate`, y es lo correcto**: es pantalla de super-admin, no cuelga de la caja de ningún tenant. |
| `apps/tpv-web/src/App.tsx` | H1 mete un `return` temprano nuevo (`cajaDisabled`). El `useEffect` del canal de soporte de A5 queda en la línea 207, **antes** del primer `return` (línea 339), así que el orden de hooks aguanta. |
| `infra/test/bundle-android.test.ts` | Ver abajo: las dos ramas arreglaron el mismo fallo. |

**El caso curioso del test de bundle.** A5 lo arregló en `d8b35d8` y `master` lo arregló
por su cuenta en el frente B de reservas-5 — el **mismo** fallo (el `vite build` hijo
heredaba `NODE_ENV=test` de vitest y sacaba React en modo desarrollo, 2,11 MB contra 1,59,
por encima del tope de precaché de workbox). A5 **borra** la variable del entorno del
hijo; `master` la **fija** a `production` dentro de `correr()`. **Se conservan las dos**:
no se contradicen y manda la de `master`, que es la que se pone al final. Lo único que se
tocó es el comentario de A5, que a partir del merge habría mentido —decía que el build
sale «sin `NODE_ENV`», y ya no—; ahora explica las dos capas. De paso, `master` traía un
test nuevo que hacía falta: que el `sw.js` precachee de verdad el JS principal, no que
contenga la palabra «precache».

### 10.3 · El blindaje del origen del WebView, después del merge

Sigue en pie, y **no hay divergencia que reconciliar**: `master` no ha tocado
`apps/tpv-android/scripts/` ni `capacitor.config.ts` desde la base común (`git diff
7ce5194 master` sobre esas rutas sale vacío). Así que el script de A5 sustituye al de
`master` sin pelearse con nadie, y **los dos criterios mandan juntos**, porque están en
pasos distintos del mismo script:

- **Producción embebida** (hallazgo A2, paso 2/6): el build falla si `VITE_API_URL` no
  aparece en `dist/assets/*.js`. Intacto, viene de antes.
- **Origen no-localhost** (R5, pasos previo y 4/6): `verificar-origen.mjs` sobre la fuente
  `.ts` **antes** de compilar y sobre el `capacitor.config.json` que deja `cap sync`
  **después**. Sustituye a la guarda vieja, que sólo miraba `hostname` y se apagaba
  exportando `VITE_TPV_URL`.

**El dato que importa para la 1.17.0 ya publicada:** esa APK salió de `3e254b8`, cuyo
`capacitor.config.ts` declara `androidScheme: "https"`, `hostname: "mipiacetpv.com"` y
`allowMixedContent: false` — el origen **correcto**. Lo que le faltaba era la guarda
fuerte, no el valor. Comparados línea a línea, **el origen del árbol fusionado es idéntico
al de la 1.17.0**, así que la siguiente APK cae en el **mismo** origen y **ningún terminal
actualizado pierde su `localStorage`**. El merge endurece el guardián; no mueve el origen.

### 10.4 · La tabla de sabotaje, revalidada sobre el código fusionado

Cada garantía del done, rota a mano **sobre el árbol ya fusionado**, y revertida después.
Los cuatro tests se comprobaron **verdes con el árbol intacto antes de romper nada**
(60 tests en los cuatro ficheros) y **verdes otra vez al revertir** (los mismos 60).
Mensajes copiados de la salida real de `vitest`.

| Garantía | Línea que rompo | Test que se pone rojo | Mensaje real |
|---|---|---|---|
| **Lista blanca de comandos** | `apps/api/src/devices/commands.ts` · `if (!esComandoConocido(accion))` → `if (false && …)` | `device-commands` › *un comando fuera de la lista se rechaza Y queda auditado* **y** *no hay comando genérico: 'eval' tampoco cuela* | `expected 500 to be 400` · `expected [ 400, 404 ] to include 500` |
| **Caducidad de las capturas** | `apps/api/src/devices/screenshots.ts` · `if (expiresAt.getTime() <= now.getTime()) return null;` → `if (false && …)` | `device-commands` › *una captura CADUCADA no se sirve aunque el fichero siga en disco* | `expected 200 to be 404` |
| **El canal NO desvincula** | `apps/tpv-web/src/lib/supportChannel/index.ts` · en el `close` por `CLOSE_REVOKED`, llamar a `clearAllDeviceState()` | `support-channel-no-desvincula` › *un cierre por REVOCADO (4403) tampoco desvincula* **y** *red estructural › index.ts no puede desvincular* | `ni un 4403 puede borrar el token: expected false to be true` · `index.ts menciona clearAllDeviceState: el canal de soporte no puede desvincular un terminal: expected true to be false` |
| **Origen del WebView** | `apps/tpv-android/capacitor.config.ts` · los tres valores del incidente (`http` / `a5-lab.mipiacetpv.com` / `allowMixedContent: true`) | `origen-del-webview` › *capacitor.config.ts declara exactamente esos valores* **y** *el comentario del fichero no cuenta como configuración* | `capacitor.config.ts no tiene el origen de producción: una APK con esto deja los terminales DESVINCULADOS (incidente del 2026-09-04)` |

Del último, además, lo que de verdad para un APK: `verificar-origen.mjs --ts` sobre la
config saboteada **sale con código 1** y escupe los tres valores malos uno a uno. Con el
árbol intacto: `OK · origen del WebView correcto en la fuente (R5)`, código 0.

Las dos redes de R1 siguen cayendo juntas: la de **comportamiento** (el token desapareció)
y la **estructural** (el fichero no puede ni mencionar `clearAllDeviceState`). La
estructural es la que sobrevive a un refactor.

### 10.5 · Qué cambió respecto a lo que decía el done

- **La suite es otra.** §2 decía `181 ficheros · 1650 tests · 3 skipped`. Ahora, desde la
  raíz y con `pnpm db:generate` antes: **216 ficheros · 2247 verdes · 3 saltados · 0
  fallos**. Los **3 saltados** son los mismos de siempre y **no son de A5**: el
  `describe.skip("super-admin · crear tenant (legacy flow B-SuperAdmin)")` de
  `apps/api/test/super-admin.test.ts:566`, tres tests que B-OnboardingV2 apagó en `master`
  al mover su cobertura a `onboarding-v2.test.ts`.
- **Los e2e ya no son «aparte».** §3 decía que ningún test de A5 corre contra un Postgres
  real. Sigue siendo cierto de los tests **de A5**, pero ahora la suite e2e de `master`
  (10 ficheros, **120 verdes**) **aplica las dos migraciones de A5** sobre base limpia en
  cada ejecución, así que el SQL del bloque sí pasa por un Postgres de verdad. Corridos
  como los corre el CI (`E2E_DATABASE_URL`, `TZ=UTC`, `CI=true`) contra una base propia,
  `mipiacetpv_a5_e2e`, **borrada al terminar** — hay otra sesión corriendo suites en
  paralelo y esta suite hace `DROP SCHEMA`.
- **Ningún test del reloj separa el CI de local.** Se corrieron los e2e **dos veces**, con
  `TZ=UTC` (como el CI) y con la TZ de la máquina (`CEST`, `+0200`): 120 verdes las dos
  veces. No hizo falta investigar de dónde venía ningún fallo, porque no hubo ninguno.
- **Novedad de comportamiento, por H1: en una empresa SIN caja el canal de soporte no se
  abre.** El efecto de A5 exige `state.kind === "paired"`, y un terminal de un tenant sin
  el módulo de caja aterriza en `cajaDisabled`. Consecuencia: **ese terminal no aparece en
  la pantalla Terminales**. Hoy es defendible —sin caja no hay TPV que atender— pero
  **nadie lo decidió**: sale del cruce de dos bloques. Queda anotado en §10.6.

### 10.6 · Qué queda pendiente

1. **Las preguntas 2 y 3 del frente 5 siguen sin respuesta.** Tailscale no está instalado
   ni en el AP11 ni en el Mac; son credenciales y las teclea Matías. §4 bis sin cambios.
2. **El TPV no arranca solo tras un reinicio** (hallazgo de §4 bis). El merge no lo toca.
   Sigue apuntando a la duda 1 de §8, Device Owner.
3. **Decidir si un terminal de una empresa sin caja debe salir en Terminales.** Ver §10.5.
   Si la respuesta es que sí, el arreglo es del lado del TPV: abrir el canal también en
   `cajaDisabled`. No se ha tocado nada por no decidirlo por mi cuenta.
4. **Las cuatro dudas de §8 siguen abiertas**, y la retención de capturas (duda 2) es
   ahora más urgente: con el bloque a punto de entrar, el número deja de ser hipotético.
5. **La deuda legal de §6** —el contrato de encargado de tratamiento que ampare mirar
   pantallas con datos de clientes— **sigue sin resolver**. El merge no la mueve.
6. **Repetir la comprobación de las migraciones si `master` se mueve otra vez** antes de
   desplegar. Ver el segundo aviso de §10.1.
