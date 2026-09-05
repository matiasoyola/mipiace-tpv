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

## 2 · Red y hora

- [ ] WiFi del local configurada, **y también** la compartición de datos del móvil del cliente
      si el local no tiene fijo (caso Las Lomas). El canal de soporte es saliente y funciona
      detrás de un 4G con CGNAT, pero sólo si el terminal tiene por dónde salir.
- [ ] **Hora automática por red activada.** Un reloj desviado explica errores raros que luego
      cuestan una tarde: el panel muestra el desvío (`clockSkewSeconds`) en cuanto el terminal
      se anuncia, pero es mejor que nazca bien.
- [ ] Suspensión de pantalla y bloqueo: sin PIN, sin patrón. Un TPV que pide desbloqueo a las
      7:00 es un TPV parado.

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

## 4 · Depuración por red (la escalada)

Esto es lo que permite `adb install -r` para actualizar sin desplazarse, y `scrcpy` para ver y
tocar la pantalla. **Se prepara en la mesa porque en el local hace falta un cable y un menú de
fábrica que no todo el mundo sabe abrir.**

- [ ] Activar Opciones de desarrollador (7 toques en el número de compilación).
- [ ] Activar **Depuración por USB**.
- [ ] Con el terminal por cable: `adb tcpip 5555`.
- [ ] Comprobar desde el Mac: `infra/terminal.sh connect <nombre>`.

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
