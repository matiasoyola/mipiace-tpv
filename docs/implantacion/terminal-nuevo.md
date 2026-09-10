# Terminal nuevo · lo que se le hace en la mesa, antes de entregarlo

Este documento es para **antes de salir**, con el terminal delante y sin cliente esperando.

No sustituye a [`terminal-android.md`](terminal-android.md), que es el checklist de lo que se
hace **en el local**: descargar la APK, cotejar el SHA-256, teclear el código de 6 dígitos.
Éste cubre lo de antes, y existe porque hay decisiones que **sólo se pueden tomar con el
terminal en la mesa**. Una vez entregado, cada una de ellas cuesta un desplazamiento.

Hardware: **AP11-1006** (10,1", Android 11) y **AP12-1506** (15").

---

## Por qué este documento existe

Con dos terminales, todo se arregla yendo. Con quince, cada versión son quince viajes y cada
"no me va" es un viaje a ciegas. El bloque A5 construyó el canal que evita la mayoría de esos
viajes, pero **el canal sólo sirve si el terminal salió de la mesa bien preparado**.

Hay exactamente tres cosas que, si no se hacen aquí, después cuestan un desplazamiento:

1. La depuración por red, que es la escalada cuando el canal no basta (§4).
2. La decisión de Device Owner, que **exige reset de fábrica** (§6).
3. El nombre del terminal, que parece cosmético y no lo es (§3).

---

## 1 · Antes de tocar nada: apuntar lo que luego no se puede mirar

- [ ] **Modelo y número de serie.** Ajustes → Información del dispositivo.
- [ ] **Versión de Android** y versión del Chrome de fábrica (el del AP11 es el 81, de 2020 —
      por eso existe la APK).
- [ ] Foto de la etiqueta trasera. Cuando el terminal esté a 40 km, el número de serie es lo
      que identifica de cuál se está hablando.
- [ ] **Versión del WebView del sistema**, que no es la de Chrome. La APK no trae navegador
      propio: pinta con el WebView del sistema, y cada terminal trae el suyo.

      ```
      adb -s <ip:puerto> shell dumpsys webviewupdate | grep "Current WebView package"
      ```

      Tiene que ser **84 o más** (el front usa `gap` en flexbox). Si es menor, actualizar en
      la mesa: Play Store → **"WebView del sistema Android"** (Google LLC), o lanzar la ficha
      por adb con
      `adb shell am start -a android.intent.action.VIEW -d 'market://details?id=com.google.android.webview'`,
      y después `adb shell am force-stop es.mipiace.tpv`.

> **Por qué está en la mesa y no en el local.** El AP12 de Peluquería Sole llegó con el
> WebView **83** y la APK instalada enseñaba *"Este navegador es demasiado antiguo"*: se quedó
> corto por una versión. En el AP11 era el 93 y funcionaba, así que "la APK lo arregla" era
> cierto de un terminal, no del hierro. Con Play Store y cuenta de Google se arregla en 5
> minutos (83 → 151 el 04-09). **Un terminal sin Play o sin cuenta y con WebView < 84 no
> puede funcionar hoy**: no se entrega, y se avisa a desarrollo.

## 2 · Red y hora

- [ ] WiFi del local configurada, **y también** la compartición de datos del móvil del cliente
      si el local no tiene fijo (caso Las Lomas). El canal de soporte es saliente y funciona
      detrás de un 4G con CGNAT, pero sólo si el terminal tiene por dónde salir.
- [ ] **Hora automática por red activada.** Un reloj desviado explica errores raros que luego
      cuestan una tarde: el panel muestra el desvío (`clockSkewSeconds`) en cuanto el terminal
      se anuncia, pero es mejor que nazca bien.
- [ ] Suspensión de pantalla y bloqueo: sin PIN, sin patrón. Un TPV que pide desbloqueo a las
      7:00 es un TPV parado.
- [ ] Apagado de pantalla. Lo que se dejó en Sole el 2026-09-10, a petición de Matías:
      apagar a los 5 minutos y salvapantallas de reloj mientras está enchufado.

      ```
      adb shell settings put global stay_on_while_plugged_in 0
      adb shell settings put system screen_off_timeout 300000
      adb shell settings put secure screensaver_activate_on_sleep 1
      ```

      Efecto secundario que hay que saber: con la depuración inalámbrica, **cada apagado de
      pantalla cambia el puerto de adb** (§4).

> **El AP11 se cae de la red cuando está ocioso** y vuelve al tocarle la pantalla. No es un
> fallo de configuración: es su comportamiento. Condiciona toda la escalada de §4 y está sin
> resolver — ver el done-doc de A5.

## 3 · El nombre del terminal

- [ ] Ponerle nombre **antes de entregarlo**: `Device.name` en el emparejamiento.

Parece cosmético. No lo es. Dentro de un año hay quince terminales y el soporte se hace por
teléfono: hay que poder decir *"el de la barra de Sirope"*, no un UUID. El panel de Terminales
y `infra/terminal.sh` resuelven **por nombre**; un terminal sin nombre se identifica sólo por
la tienda y la caja a la que cuelga, que es peor pero funciona.

Convención: **dónde está**, no qué es. `barra`, `terraza`, `cocina`. El local ya lo dice el
`Store`.

> **Lo que pasó en Sole el 2026-09-10.** La cuenta tenía 4 dispositivos activos, sin nombre y
> con el user-agent recortado como única pista. Uno de los que se "sabía" que era la tablet
> resultó ser un Mac, y el listado se reordena tras cada revocación: faltó poco para revocar
> el terminal bueno, que es lo único que deja al cliente sin cobrar. Mientras el listado no diga
> modelo ni "este es el que acaba de hablar", **el nombre es la única defensa**.

## 4 · Depuración por red (la escalada)

Esto es lo que permite `adb install -r` para actualizar sin desplazarse, y `scrcpy` para ver y
tocar la pantalla. **Se prepara en la mesa porque en el local hace falta un cable y un menú de
fábrica que no todo el mundo sabe abrir.**

- [ ] Activar Opciones de desarrollador (7 toques en el número de compilación).
- [ ] Activar **Depuración por USB**.
- [ ] Con el terminal por cable: `adb tcpip 5555`.
- [ ] Comprobar desde el Mac: `infra/terminal.sh connect <nombre>`.

> **Los terminales que hay hoy no van por el 5555.** AP11 y AP12 son Android 11 y lo que se ha
> usado en la práctica es la **Depuración inalámbrica** de Opciones de desarrollador, que
> escucha en un **puerto aleatorio** (`service.adb.tcp.port = 0`): el AP12 de Sole pasó del
> 37767 al 40471 en la misma sesión el 04-09, y el 10-09 estaba en el 41275. El puerto **cambia cada vez
> que se apaga la pantalla** o se toca el interruptor. La primera vez hay que emparejar
> (`adb pair <ip>:<puerto-de-emparejamiento>` con el código de la pantalla).
>
> Así que el puerto se lee **en la pantalla del terminal** (Depuración inalámbrica → IP y
> puerto) justo antes de conectar, y se le pasa al script:
> `TERMINAL_ADB_PORT=<puerto> infra/terminal.sh connect <nombre>`. El 5555 por defecto sólo
> vale si se hizo `adb tcpip 5555` por cable y el terminal no se ha reiniciado desde entonces.

> ### Lo que NO sobrevive a un reinicio
>
> `adb tcpip 5555` **se pierde al reiniciar el terminal**, y no hay forma de fijarlo sin root
> (`persist.adb.tcp.port`). El menú de fábrica del AP11 tiene un interruptor de depuración por
> red que **no persiste** entre reinicios, y —esto es lo que engaña— **puede verse activado con
> `adbd` caído**.
>
> **Comprueba el puerto, no el interruptor.** El interruptor miente.
>
> Consecuencia práctica: la escalada por adb sirve para una intervención puntual, no como canal
> permanente. Después de cada reinicio del terminal hay que volver a habilitarla, y para eso
> hace falta alguien delante. Por eso el camino principal es el canal propio de la APK y esto
> es la escalada.

- [ ] **macOS, permiso de Red Local.** Arrancar `adb start-server` **desde Terminal.app** y
      conceder el permiso cuando lo pida. Si el servidor de adb lo arranca un editor, un agente
      o un cron, macOS le bloquea la red local y `adb` devuelve `No route to host` u
      `Operation timed out` contra **toda** la LAN, incluidas IPs que sí responden al ping.
      No parece un problema de permisos, y ahí es donde se pierde la tarde.

## 5 · Primera instalación y vinculación

Se sigue [`terminal-android.md`](terminal-android.md). Dos cosas que conviene hacer **aquí** y
no en el local:

- [ ] Instalar la APK y **abrirla una vez**, para que el WebView descomprima sus assets. El
      primer arranque es el lento.
- [ ] **Comprobar que es el build de producción**, no uno de laboratorio:

      ```
      adb -s <ip:puerto> logcat -d | grep -E "Loading app at|Handling local request" | tail -3
      ```

      La URL tiene que ser `https://mipiacetpv.com`. Si sale `http://`, `a5-lab` o una IP de la
      LAN, es un build de desarrollo y **no sale de la mesa**. `versionName` y `versionCode` no
      sirven para distinguirlos: el build de laboratorio de A5 también decía 1.15.1 / 11501. Sólo
      la URL y el asset (`index-*.js`) los separan.

> Esto no es teórico. El 2026-09-04 un build de laboratorio (`http` + `a5-lab`) acabó encima de
> la release en la caja de Peluquería Sole y la dejó sin cobrar con el TPV hasta el 10-09: el terminal
> hablaba con otra API y el PIN se rechazaba. Se recuperó el 10-09 con `adb install -r` de la
> release, **sin perder la vinculación**, porque el `localStorage` va por origen y el de
> `https://mipiacetpv.com` seguía intacto. `build-release-apk.sh` ya se niega a compilar con el
> origen cambiado (R5), pero la comprobación en el terminal es la que cierra la puerta.
- [ ] Dejar el emparejamiento **para el local**, no para la mesa: el `Device` queda atado a un
      `Register` concreto, y si se empareja aquí contra una caja de prueba hay que revocarlo y
      repetirlo.

- [ ] Antes de cerrar la caja: comprobar que el terminal **aparece online en el panel de
      Terminales** en menos de 30 segundos desde que arranca, sin tocar nada. Si no aparece, el
      problema es de red o de vinculación y se arregla aquí, no en el local.

---

## 6 · La decisión que hay que tomar ahora: Device Owner

**Esto no lo decide quien lee este documento. Lo decide Matías.** Está escrito aquí porque el
coste depende de *cuándo* se decida, y ese reloj ya está corriendo.

### Qué es y qué resolvería

**Device Owner** es un modo de propiedad de Android que convierte a una app en administradora
del dispositivo. Con un MDM enrolado como Device Owner (Headwind autoalojado, por ejemplo) se
podría:

- **Instalar y actualizar la APK en silencio**, sin que nadie toque el terminal. Hoy, desde A4,
  actualizar un terminal exige instalar una APK **a mano, en el local**.
- Modo kiosco, bloqueo y borrado remoto.

Es exactamente lo que hoy no tenemos y lo que convierte quince desplazamientos por versión en
cero.

### El coste, y por qué depende de cuándo

**Device Owner exige un reset de fábrica para enrolar.** No hay forma de activarlo sobre un
terminal ya configurado.

| | Coste |
|---|---|
| **Terminal nuevo, en la mesa** | ~10 minutos. El reset es gratis: no hay nada que perder. |
| **Terminal ya entregado** | Un desplazamiento por terminal, más reconfigurar red y hora, más **volver a vincular** (el reset borra `localStorage`, y con él `mipiacetpv-device-token`). |

Hoy hay pocos terminales en la calle. Cada terminal que se entrega **sin** Device Owner es un
desplazamiento futuro si algún día se decide que sí.

### Las dos opciones

**A · Enrolar Device Owner en todos los terminales nuevos, desde ya.**
Cuesta 10 minutos por terminal en la mesa y obliga a montar el MDM autoalojado antes de la
próxima entrega. A cambio, todo terminal entregado a partir de ahora se actualiza solo.
Riesgo: se paga el montaje del MDM ahora, para un beneficio que sólo se cobra cuando haya
volumen. Y el MDM es infraestructura nueva que hay que mantener y asegurar.

**B · No enrolar, y seguir actualizando a mano.**
Cuesta cero hoy. Cada versión son N desplazamientos, y la deuda crece con cada terminal
entregado: el día que se decida hacerlo, hay que visitar todos los que haya.

### Lo que hace falta para decidir, y no está aquí

- Cuántos terminales se prevé entregar en los próximos 6-12 meses.
- Cada cuánto se publica versión de verdad (no cuántas se podrían publicar).
- Si el cliente acepta que su terminal tenga una app administradora del dispositivo, y qué dice
  de eso el contrato.

**No se decide en este documento.** Mientras no haya decisión, la opción por defecto es **B**,
que es lo que ya se está haciendo — pero es una decisión por omisión, y conviene que conste
como tal.

---

## 7 · Lo que este documento no cubre

- **Lo que la captura de pantalla NO enseña, y no se le promete a ningún cliente.** El panel
  captura **nuestra propia ventana** (`PixelCopy`). **El teclado de Android y los diálogos del
  sistema son ventanas distintas y no salen en la captura.** Si el diagnóstico depende de ver
  uno de ellos, la captura no sirve y hay que preguntar por teléfono. Verlos exigiría
  MediaProjection, que pide que alguien acepte un diálogo en el terminal **tras cada reinicio**
  — inviable en un TPV que se reinicia solo un lunes a las 7:00.
- El contrato de encargado de tratamiento que ampare mirar la pantalla de un terminal con
  datos de clientes (capturas del frente 4 de A5). Es deuda **legal**, está anotada en el
  done-doc de A5 y no se resuelve aquí.
- Kiosco, bloqueo y borrado remoto: van con el MDM, es decir, con la decisión de §6.
- Impresoras y periféricos: [`../impresoras/`](../impresoras/).
