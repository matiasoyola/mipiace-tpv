# Bloque A5 · el terminal se deja ver (acceso remoto a la flota)

## Contexto (leer antes)

- `docs/code-prompts/bloque-a3-distribucion-apk.md` — cómo se distribuye la APK hoy.
- `docs/code-prompts/bloque-a4-la-apk-ejecuta-su-bundle.md` — por qué actualizar un terminal
  exige APK nueva desde A4. Es la mitad del problema que abre este bloque.
- `apps/api/src/devices/` — `auth.ts` (device token, `requireDeviceToken`), `routes.ts`
  (emparejamiento por código de 6 dígitos), `alerts.ts` (alertas de login por IP/país).
- `apps/api/src/realtime/ws-route.ts` — el WebSocket que ya existe (`/ws/store/:storeId`,
  autenticado con cashier-session). **Este bloque imita ese patrón, no lo reutiliza.**
- `apps/api/src/superadmin/` — panel, `audit.ts` (`SuperAdminAudit`), `middleware.ts`.
- `packages/db/prisma/schema.prisma` — `Device` (ya tiene `lastSeenAt`, `revokedAt`,
  `deviceTokenHash`), `Register`, `SuperAdminAudit`.
- `apps/api/src/version.ts` — cómo se reporta hoy la versión.

## El problema, en una frase

**Tenemos terminales en casa de clientes y no hay forma de ver ninguno**: ni si están encendidos,
ni qué versión llevan, ni qué les pasa cuando alguien llama. Y desde A4, actualizar uno exige
instalar una APK **a mano, en el local**.

Con dos terminales se aguanta. Con quince es un negocio que no escala: cada versión son quince
desplazamientos, y cada "no me va" es un viaje a ciegas.

## La decisión de arquitectura (tomada, no re-debatir)

Se ha evaluado y **descartado** comprar acceso remoto de terceros, por hechos verificados el
2026-09-04:

- **AnyDesk y TeamViewer en Android sólo *ven* la pantalla.** Para *tocarla* necesitan un plugin
  firmado por el fabricante del terminal; hay ~40 fabricantes soportados y el Smart-tpv del AP11
  no está entre ellos. Sería pagar licencia por una sesión de sólo lectura.
- **RustDesk sí controla sin root** (servicio de accesibilidad + MediaProjection), pero **exige que
  alguien acepte la captura en el terminal tras cada reinicio**. Su propia documentación recomienda
  tratarlo como soporte asistido. Un TPV que se reinicia un lunes a las 7:00 no tiene a nadie que
  acepte nada.
- **MDM con Device Owner** (Headwind autoalojado) sí resolvería la instalación silenciosa, pero
  **exige reset de fábrica para enrolar**. Es otro bloque y otra decisión (ver §6).

**La opción con más libertad es la que ya tenemos en la mano: el agente lo llevamos dentro de
nuestra propia APK.** Nuestra app puede observarse a sí misma sin pedir permiso a Android, sin
plugin de fabricante, sin licencia y sin depender de nadie. Y el canal es **saliente**: funciona
detrás del router de cualquier cliente y detrás de un 4G con CGNAT — que es exactamente el caso de
Las Lomas, sin internet fijo.

Este bloque construye **la capa que se ve**. El shell crudo (adb sobre Tailscale) queda como
escalada documentada en §5, no como el camino principal.

## Alcance

### 1 · El terminal se anuncia

WebSocket **saliente** del terminal a la API, autenticado con el **device token** que ya existe
(`requireDeviceToken`), en la línea de `/ws/store/:storeId` pero con su propia ruta y su propia
autenticación: `GET /ws/device`.

Al conectar y luego cada N segundos, el terminal publica su estado:

- versión del **bundle que está ejecutando** (la del asset real, no la que diga el servidor — la
  lección de A4) y `versionCode` de la APK instalada,
- si hay turno abierto y desde cuándo,
- **tamaño de la cola offline pendiente de subir**,
- red (wifi/móvil), IP local, y hora del dispositivo (una hora desviada explica errores raros),
- último arranque.

Actualiza `Device.lastSeenAt`. Reconexión con **backoff exponencial y jitter**: quince terminales
reintentando a la vez contra una API que acaba de reiniciarse es un ataque a nosotros mismos.

Un `Device` con `revokedAt` no abre canal, y si se revoca con el canal abierto, **el canal se cierra
en ese momento**.

### 2 · El panel los ve

Pantalla **Terminales** en superadmin: qué terminales existen, cuáles están online, hace cuánto se
vio a cada uno, qué versión lleva, cola pendiente, turno abierto. Filtrable por tenant y tienda.

El nombre importa más de lo que parece: dentro de un año habrá quince y hay que poder decir "el de
la barra de Sirope", no un UUID. Aprovecha `Device.name` y el `Register`/`Store` al que cuelga.

Y que se vea de un golpe **quién está desactualizado**: versión del terminal contra la última APK
publicada en el índice de A3. Ese listado es el que decide a qué local hay que ir.

### 3 · Comandos remotos, con lista blanca

Del panel al terminal, y **sólo estos**:

`recargar` · `volcar-logs` · `captura-de-pantalla` · `forzar-sync` · `reiniciar-app` · `decir-versión`

Reglas duras:

- **Lista blanca cerrada.** Ningún comando genérico, ninguna evaluación de código, ninguna ruta que
  acepte "ejecuta esto". Un comando desconocido se rechaza y se audita.
- Cada comando lo dispara un superadmin identificado, **con motivo**, y deja registro en
  `SuperAdminAudit` (quién, qué, a qué terminal, cuándo, resultado). Sin registro no hay comando.
- Timeout y resultado visible en el panel: un comando que no vuelve tiene que verse como que no
  volvió, no quedarse en "enviando".
- **Ningún comando toca dinero.** Nada de cerrar turnos, anular tickets, cobrar, ni tocar el
  arqueo desde el panel. Si el soporte necesita eso, se hace con un humano al teléfono.

### 4 · La captura de pantalla que no pide permiso a nadie

Es nuestra propia app mirándose a sí misma: se puede capturar **nuestra propia ventana** sin
MediaProjection y sin consentimiento, porque no estamos capturando el dispositivo, estamos
capturando lo nuestro. Ahí está la libertad que no da ningún producto de terceros.

Elige la vía (captura nativa de la ventana propia, o volcado del DOM del WebView) y **justifica la
elección en el done-doc**, con lo que cada una deja fuera: un diálogo nativo del sistema o el
teclado de Android encima no salen en un volcado del DOM, y eso puede ser justo lo que se está
diagnosticando.

Y trátala como lo que es: **una foto de la pantalla de un TPV contiene datos de clientes**.
Retención corta y declarada, acceso sólo desde superadmin, cada captura auditada, y un indicador
visible en el terminal de que se acaba de tomar una. Que un cliente pueda ver cuándo hemos mirado.

### 5 · La escalada: shell de verdad (frente de infraestructura)

Cuando el canal propio no baste, hace falta shell. La vía es **Tailscale en el terminal + adb +
scrcpy**, que además es lo único que permite `adb install -r` para actualizar sin desplazarse.

Esto es investigación con resultado, no una promesa: **verifícalo sobre el AP11 real y escribe lo
que salga, aunque salga que no**. Tres preguntas concretas, ya conocidas como problemáticas:

1. ¿Sobrevive el `adb tcpip 5555` a un reinicio del terminal, o hace falta `persist.adb.tcp.port`
   con root? El menú de fábrica del AP11 **no persiste** la depuración de red entre reinicios, y el
   interruptor puede verse activado con `adbd` caído: comprueba el puerto, no el interruptor.
2. **El AP11 se cae de la red cuando está ocioso** y vuelve al tocarlo. ¿Lo evita Tailscale con
   VPN siempre activa, o sigue cayéndose? De esto depende que la escalada sirva de madrugada o
   sólo con el local abierto.
3. ¿Arranca Tailscale solo tras un reinicio, sin que nadie toque nada?

Generaliza `~/bin/tpv.sh` (hoy con la IP de casa quemada, `192.168.5.75`) a un `terminal.sh <nombre>`
que resuelva el terminal **desde el inventario de §2**, con `connect | estado | mirror | logs |
install <apk>`. Y deja escrito en el done-doc que macOS bloquea la red local al proceso que lanza
`adb` en segundo plano (`No route to host` en toda la LAN): el servidor de adb se arranca desde
Terminal.app.

### 6 · El documento que evita quince desplazamientos

`docs/implantacion/terminal-nuevo.md`: qué se le hace a un terminal **en la mesa, antes de
entregarlo**. Incluida la decisión que hay que tomar ahora y no dentro de un año:

> Device Owner (el enrolamiento que permitiría instalación silenciosa de APK con un MDM) **exige
> reset de fábrica**. Sobre un terminal nuevo, en la mesa, son diez minutos. Sobre quince terminales
> ya entregados, son quince desplazamientos con reconfiguración y pérdida de la vinculación.

Plantea la pregunta con datos y **no la decidas tú**: déjala escrita para Matías con las dos
opciones y su coste.

## Restricciones

- TypeScript estricto, JSON Schema en los bodies, nada de secretos en logs — como el resto del repo.
- **No tocar el flujo de vinculación.** `mipiacetpv-device-me` en `localStorage` es lo que evita
  pedir un código de 6 dígitos un lunes por la mañana (lección de A4).
- No tocar el Service Worker ni `CORS_ORIGINS`. A4 cerró eso.
- No tocar cobro, turno, arqueo ni el cierre del día.
- Migraciones **aditivas**. El rollback de código no puede necesitar rollback de esquema.
- El canal tiene que ser **irrelevante para el camarero**: si la API está caída, el TPV vende igual.
  Ninguna pantalla puede quedarse esperando al canal de soporte.

## Verificación

Tabla **sabotaje → test que se pone rojo → mensaje de fallo real**, con los sabotajes aplicados de
verdad sobre el código y revertidos. Como mínimo:

| Sabotaje | Debe caer |
|---|---|
| Aceptar el WS sin validar el device token | test de que un token inválido no abre canal |
| Ignorar `revokedAt` | test de que un device revocado no conecta, y que se le cierra el canal abierto |
| Aceptar un comando fuera de la lista blanca | test de que se rechaza y queda auditado |
| Saltarse la escritura en `SuperAdminAudit` | test de que todo comando deja registro |
| Quitar el jitter del backoff | test de que N terminales no reconectan a la vez |
| Dejar que un terminal lea el estado de otro tenant | test de aislamiento por tenant |

Y declara **qué NO cubre la suite**.

**Pasada física obligatoria sobre el AP11** (sin ella el bloque no se cierra):

1. Arrancar el terminal: aparece **online** en el panel en menos de 30 s, sin tocar nada.
2. Cortarle la red 5 minutos: pasa a offline; al volver, **reconecta solo**.
3. Captura de pantalla desde el panel de la pantalla de venta real, con el terminal en manos de
   otra persona.
4. Volcado de logs de un error provocado a propósito.
5. Con el terminal en **compartición de datos del móvil** (simulando Las Lomas): sigue funcionando.
6. Revocar el device desde admin: el canal se cae en el momento.

## Fuera de alcance (explícito)

- **Controlar el táctil en remoto.** Eso es la escalada por adb de §5 y no se le promete a ningún
  cliente en este bloque.
- **Instalación silenciosa de APK.** Necesita Device Owner: es el bloque del MDM, y §6 sólo deja
  la decisión preparada.
- El contrato de encargado de tratamiento que ampare mirar pantallas con datos de clientes: es
  deuda **legal**, anótala en el done-doc y no la resuelvas aquí.
- Kiosco, bloqueo y borrado remoto: MDM.

## Entregables

- Rama `a5-acceso-remoto`, commits por frente cerrado. **No pushear** (lo hace Matías).
- `docs/blocks/a5-acceso-remoto-done.md` con el formato de siempre: qué quedó hecho, qué quedó
  fuera y con qué bloque, decisiones tomadas sin preguntar **con su justificación**, dudas, y cómo
  arrancarlo de cero.
- ADR nuevo en `docs/04-stack-y-decisiones.md` (el siguiente número libre) con la decisión de
  arquitectura de la cabecera: agente propio dentro de la APK frente a AnyDesk/RustDesk/MDM.
- `docs/implantacion/terminal-nuevo.md` (§6).

**Antes de tocar código**: lee el prompt y los docs referenciados, haz tu resumen y plantea las
discrepancias. No hay luz verde hasta revisar ese resumen.
