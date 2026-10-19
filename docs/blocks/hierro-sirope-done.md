# Bloque `hierro-sirope` · lo que la pasada de la 1.27.0 encontró en el hierro

Rama `hierro-sirope` desde `origin/master` (`c4af017`). Lo que se audita es
`docs/qa/2026-10-18-sirope-hierro/README.md`: la pasada del 18-10 por la
cuenta real de **Cafetería Sirope** en ensayo, con el D8 como caja
(Sirope · Caja 2) y el AP11-1006 como KDS «Cocina · Barra». Las capturas
del antes están en esa carpeta (`01`–`52`); las medidas del después, en
`docs/blocks/hierro-sirope-shots/`.

**Los ocho apartados están hechos.** Lo único que no se puede verificar
aquí es el apartado B: el fallo que arregla no se reproduce en un banco
—necesita un terminal, un `force-stop` y tres aperturas—. Abajo está el
procedimiento exacto de la pasada.

---

## A · 🔴 Comandas huérfanas

### Lo que pasaba

M5 con un café enviado a BARRA y **sin** marcar Lista. «Vaciar mesa» →
Invitación: la mesa queda libre y la tarjeta sigue en el AP11, que es la
decisión de `auditoria-sirope` (#22) y se mantiene —un plato en la plancha
sigue en la plancha—. Cuando cocina pulsa «Lista», la tarjeta pasa a
«Listas» y **ahí se queda para siempre**: M5 con la etiqueta LISTO en el
mapa estando libre, y la banda «M5 · listo para servir» encima de
cualquier venta en todos los TPV. Nadie la puede apagar: su ticket ya no
existe. Reproducido en capturas 37–41; es el estado de la T6 (nueve horas)
y de M1.

`servirComandasListas` sólo sirve lo que **ya** tiene `readyAt`. El
`readyAt` que llega DESPUÉS lo ponían dos sitios y ninguno miraba si el
ticket seguía vivo.

### La regla, y dónde vive

`marcarListaYServirSiHuerfana` (`apps/api/src/kitchen/servir.ts`): pone
`readyAt` y, si el ticket ya no es DRAFT, sirve en la MISMA transacción
con `servedByUserId = null` y `servedAt = readyAt`.

Pasan por ella los dos caminos y **sólo por ella**:

- `kitchen/routes.ts` · el toque online del KDS, por sus dos puertas (el
  botón grande «Lista» y el último plato tachado). El `update` pelado de
  `readyAt` desapareció.
- `kitchen/lan.ts` · la marca `LISTA` que sube la tablet al volver la red.
  La regla de «una hora anterior no pisa» viaja ahora como
  `soloSiPosterior`, así que la condición sigue siendo la misma y la regla
  de la huérfana entra gratis.

### Decisiones tomadas sin preguntar

**Una huérfana emite `kitchen.order_served` y NO `kitchen.order_ready`.**
El evento «lista» existe para levantar la banda en todos los TPV;
levantarla sobre una comanda que nadie puede servir es exactamente el
fallo. Cocina la ve terminada igual —sale de pendientes en su propio GET—
y el `order_served` es lo que quita la etiqueta LISTO del mapa.

**`servedAt = readyAt`, no `now`.** Lo pide el CHECK (ver abajo) y además
es lo honesto: no la sirvió nadie, se cerró en el instante en que quedó
lista. Con una marca de LAN del pasado, las dos horas son la de la tablet.

**«Hoy» (deshacer «Lista») devuelve 409 sobre un ticket muerto.**
`POST /kitchen/comandas/:id/recuperar` borraba `readyAt` y `servedAt`: en
un ticket cobrado o vaciado eso FABRICA una huérfana nueva, que es justo
lo que este bloque cierra. Y no tendría sentido operativo —lo que se
recupera es un plato que todavía hay que hacer—. Se dice por qué
(`ORDER_TICKET_CERRADO`, «Esta comanda ya no tiene cuenta abierta: la mesa
se cobró o se vació») en vez de desaparecer el botón: la cocina tiene
derecho a saber que la mesa se fue.

**El CHECK `kitchen_orders_cronologia` gana la mitad que le faltaba.** El
prompt lo daba por hecho y no era verdad: kds-1 escribió «no estar listo
antes de enviado» y «no estar servido sin estar listo», pero **no** «no
servir antes de estar listo». Hoy `served_at = ready_at − 1 ms` entraba
sin que nada se quejara y el tiempo en el pase del informe del dueño salía
negativo. Importa ahora porque la regla escribe `served_at` a partir de
`ready_at` en tres sitios: la migración `20261019020000` repara las filas
que pudieran violarla (`served_at := ready_at`) y recrea el CHECK con las
tres condiciones. `CREATE OR REPLACE` no existe para un CHECK, así que se
borra y se vuelve a crear partiendo de la ÚLTIMA definición.

### Las que ya existen

**El corte de día.** `runComandasHuerfanasSweep`
(`apps/api/src/kitchen/huerfanas.ts`), enganchado a `runDayCutPass`
**detrás** del barrido de mesas abandonadas —ese barrido vacía drafts, o
sea que puede crear huérfanas nuevas en la misma pasada— y aislado igual:
una comanda no tira el cierre de caja de nadie. Sirve las comandas de
tickets muertos; las que nunca se marcaron Lista se cierran con
`readyAt = servedAt = ahora`.

**Decisión:** el barrido está acotado al corte de día del tenant (misma
puerta que `runAbandonedTableSweep`) y **no** actúa en el acto. Durante el
servicio sigue mandando la decisión de `auditoria-sirope` (#22): una
comanda sin tachar cuya mesa se acaba de vaciar tiene que seguir
viéndose, porque alguien la está haciendo. Al cruzar el corte eso deja de
ser cierto.

**La limpieza única.** `pnpm --filter @mipiacetpv/api huerfanas`
(`src/scripts/servir-comandas-huerfanas.ts`, con la lógica en
`src/kitchen/limpieza-huerfanas.ts` para que tenga banco). `--dry-run` por
defecto, `--apply` escribe, resumen por tenant (cuántas listas y cuántas
sin marcar) y detalle fila a fila. Idempotente: la segunda pasada informa
de 0.

**Dos desviaciones del prompt, dichas:**

1. Vive en `apps/api/src/scripts/`, no en `apps/api/scripts/`. Es donde
   están los otros dieciséis scripts del repo y lo que ven `tsx` y el
   `tsconfig`.
2. Tiene **edad mínima, 6 h por defecto** (`--edad-horas=N`, y `0` lo
   quita). Una mesa vaciada hace dos minutos con un plato en la plancha no
   es basura histórica. Correrlo a mediodía sin este tope borraría de la
   pantalla comida que se está haciendo.

**No se ha ejecutado contra producción.** Lo corre Matías tras el
despliegue.

### Bancos

`apps/api/test/comandas-huerfanas.test.ts` (15) · los dos caminos, la
mesa viva, el 409 de «Hoy», el barrido con sus cuatro casos y el script
con su dry-run y su reparto por tenant.

`apps/api/test-e2e/comandas-huerfanas.e2e.ts` (6) · contra Postgres: el
CHECK, el recorrido del 18-10 entero y el barrido sobre la base de verdad.

---

## B · 🔴 La app se queda en blanco tras reiniciarla

### La causa, con su evidencia

El logcat de la pasada:

```
ActivityManager: Unable to launch app es.mipiace.tpv/10110 for service
  Intent { cmp=es.mipiace.tpv/org.chromium.content.app.SandboxedProcessService0:0 }:
  process is bad
```

**1 · Por qué el mensaje nombra a nuestro paquete.** El renderer del
WebView corre en un **proceso aislado**. Los servicios
`SandboxedProcessServiceN` los declara el paquete del WebView con
`android:externalService="true"`, y el embebedor los enlaza con
`BIND_EXTERNAL_SERVICE`: el proceso aislado cuelga del uid del embebedor
—10110, nosotros— y el `ServiceRecord` lleva nuestro nombre. No es que
*nuestro* proceso esté corrupto.

**2 · Qué significa «process is bad».** Lo escribe
`ActiveServices.bringUpServiceLocked` de AOSP cuando `startProcessLocked`
devuelve `null`; la frase se añade al final de un mensaje genérico, así
que **cualquier** motivo por el que AMS no haya podido crear el proceso
del servicio se reporta igual. Para un proceso aislado el camino que
devuelve `null` es `ProcessList.newProcessRecordLocked`: o no queda rango
de uid aislado que asignar, o `allocateIsolatedUidLocked` devuelve −1
porque están todos en uso. Esos rangos viven en memoria de AMS — por eso
lo único que lo arregla es **reiniciar el aparato**, que es exactamente lo
observado.

**3 · Qué los deja ocupados.** El `force-stop` mata nuestro proceso y AMS
empieza a desmontar su renderer; la apertura siguiente pide enlazar el
servicio antes de que ese desmontaje termine y la petición se queda
colgada. Está reportado con el mismo logcat por terceros —freekiosk #280,
`Pending ServiceRecord{… SandboxedProcessService1:0} app=null`, donde el
disparador era una app que se relanzaba matándose a sí misma— y el
arreglo que les funcionó fue **esperar** antes de volver a arrancar.

**4 · Por qué el AP11 no lo sufre.** Medido hoy por `adb` contra el
AP11-1006 (`dumpsys webviewupdate`):

```
Current WebView package (name, version): (com.google.android.webview, 155.0.8059.43)
Multiprocess enabled: true    ·    Android 11 (SDK 30)
```

El D8 lleva `com.android.webview 101.0.4951.61` — el WebView de AOSP, de
2022, que no se actualiza por Play. Mismo síntoma en el N1
(`claude/n1-vertical-cierre-2026-10-18.md`).

**Hasta dónde llega esta certeza.** Los puntos 1 y 2 son lectura de AOSP y
del logcat, y son firmes. El punto 3 es la explicación que encaja con todo
lo observado y con el reporte de terceros, pero **no está medida en
nuestro hierro**: confirmarla pide un `dumpsys activity services | grep
Sandboxed` y un `dumpsys activity processes | grep -i isolated` justo
después de reproducirlo. Va en el procedimiento de la pasada.

### Lo que hace la APK

`VigilanteNativo.java` (la decisión, Java puro y probado en la JVM) +
`MainActivity` (el cableado). Independiente de la causa:

- **`onPageLoaded` desarma.** Sólo llega si el renderer vive y la página
  cargó: es exactamente «ha pintado». No vale `onPageStarted`.
- **`onRenderProcessGone` devuelve `true`.** Vale por sí sola: le dice al
  sistema que la muerte del renderer está gestionada. Sin eso Android se
  lleva por delante el proceso entero y la caja desaparece de la pantalla
  sin decir nada.
- **Plazo de 12 s** (10 tras el intento). Más largo que el arranque en
  frío del D8 con la caché recién purgada por el rescate de A4: enseñar
  «reinicia el terminal» a una caja que iba a abrir sola es peor que el
  fallo.
- **Un intento de recuperación**: tirar el WebView muerto de la jerarquía,
  `destroy()` y `recreate()`. **El intento se gasta por PROCESO, no por
  actividad** —`recreate()` construye una actividad nueva—, o la caja se
  quedaría parpadeando para siempre y el mensaje no se vería nunca.
- **Y si tampoco, pantalla NATIVA**, construida en código y sin tocar el
  WebView: «El TPV no puede abrir», que el dinero está a salvo, «mantén
  pulsado el botón de encendido → Reiniciar», un botón «Volver a
  intentarlo» y, al pie y pequeña, la versión del WebView y de Android
  para que soporte no tenga que pedir un logcat.

### Arreglo de raíz: por qué no hay uno en la APK

El agotamiento de uids aislados ocurre **en AMS**, fuera de nuestro
proceso; no hay API pública que libere un rango, que apague el
multiproceso del WebView por app, ni que elija el slot del servicio. Lo
que sí está en la APK es no morirse en silencio y decir cómo salir, que es
lo de arriba.

Dos palancas que NO son de la APK y que convienen al D8, por orden:

1. **Actualizar el WebView.** El AP11 con el 155 no lo reproduce. En un
   terminal sin Play, el apk del WebView se instala a mano.
2. **`adb shell settings put global webview_multiprocess 0`** en el D8. Es
   un ajuste de desarrollador y es **por aparato**, no por app: deja el
   renderer dentro del proceso de la app y no hay servicio aislado que
   enlazar. Cuesta memoria y aísla menos; es un parche mientras el WebView
   siga en la 101.

### No se puede probar en el banco

El banco (`VigilanteNativoTest`, 7 casos) cubre la máquina de estados: un
intento y sólo uno, que dos avisos del mismo fallo no gasten los dos, que
la actividad recreada no tenga intento, que el plazo deje margen al
arranque frío y que el mensaje diga cómo salir. Lo que no se puede
fabricar en una JVM es que AMS se niegue a crear el proceso.

### Procedimiento de la pasada en el hierro

Con la 1.28.0 instalada, **en el D8 y en el N1**, por separado:

```bash
adb connect 192.168.5.138:5555          # D8   (el N1, su IP)
adb -s <ip>:5555 logcat -c
adb -s <ip>:5555 logcat -v time | grep -Ei 'mipiacetpv|ActivityManager.*mipiace|Sandboxed' &

# Tres veces seguidas, sin reiniciar el aparato entre vueltas:
for i in 1 2 3; do
  adb -s <ip>:5555 shell am force-stop es.mipiace.tpv
  sleep 2
  adb -s <ip>:5555 shell monkey -p es.mipiace.tpv 1
  sleep 20
  adb -s <ip>:5555 exec-out screencap -p > vuelta-$i.png
done
```

**Qué se mira en cada vuelta:**

1. ¿Pinta el TPV? → el fallo no se reproduce en esta vuelta; anótalo.
2. ¿Sale `hierro-sirope B: el WebView no ha pintado en 12000 ms` y detrás
   `un intento de recuperación (recreate)`? → el vigilante actuó.
3. ¿Pinta tras el intento? → recuperado sin reiniciar: es el mejor
   desenlace y hay que decirlo en el informe.
4. ¿Sale la pantalla **negra con «El TPV no puede abrir»**? → el fallo
   sigue y la app ya no miente. Fotografía la pantalla: el pie lleva el
   paquete y la versión del WebView.
5. **Lo que NO puede pasar:** pantalla en blanco indefinida, ni la app
   desapareciendo sola.

**Y la medida que confirma la causa**, ejecutada *mientras* está en
blanco o en la pantalla de rendición:

```bash
adb -s <ip>:5555 shell dumpsys activity services | grep -i -A3 Sandboxed
adb -s <ip>:5555 shell dumpsys activity processes | grep -ci isolated
adb -s <ip>:5555 shell dumpsys webviewupdate | head -5
```

Si aparece un `ServiceRecord{… SandboxedProcessServiceN:0} app=null` en
«Pending», o el recuento de procesos aislados está pegado a su tope, la
hipótesis del punto 3 queda confirmada y se puede escribir aquí.

---

## C · 🟡 Las mesas vaciadas sólo estaban en el PDF del Z

`contarMesasVaciadas` existe desde `auditoria-sirope` (#18) y sólo llegaba
a `generateZReportPdf`. Quien cerraba el día no veía que se habían tirado
1,50 € de M5 (capturas 43, 44, 50).

Ahora viaja en `buildShiftDaySummary`, que es el payload único de los
cuatro consumidores del resumen, y se pinta en `DaySummaryCard`:

- en el mismo golpe de vista que «2 tickets · 1 devolución» →
  «· 1 mesa vaciada (1,50 €)»;
- desglosado por motivo en «Ver detalle», con el encabezado «comida que
  salió y no se cobró»;
- si es 0, no sale.

**Una sola fuente**, y no sólo en los números: el servidor manda la
**etiqueta ya resuelta** (`ETIQUETA_MOTIVO`, la misma tabla que escribe el
papel), así que la pantalla no puede decir «Invitacion» donde el PDF dice
«Invitación». El tipo del TPV lo lleva opcional: una APK nueva contra una
API vieja no pinta nada en vez de caerse.

**Banco:** `apps/api/test/cierre-mesas-vaciadas.test.ts` (4), que compara
el payload del resumen con lo que recibe el PDF sobre los mismos tickets.

---

## D · 🟡 Avisos de «listo»: duplicados, sin sección, y se comían el ticket

M3 con cocina y barra daba **dos bandas idénticas** «M3 · listo para
servir» (captura 25), dos tarjetas «M3» en «Listas» del AP11 (captura 24),
y con tres bandas la segunda línea del ticket quedaba bajo «Urgente».

La unidad mental del camarero no es la comanda: es **la mesa**. Va a M3 una
vez y recoge lo que haya.

- **Una banda por mesa** (o por mostrador), armada por `agruparAvisos`
  (`apps/tpv-web/src/kitchen/tpv/agruparAvisos.ts`): «M3 · cocina y barra
  listas», «M3 · barra lista (cocina en marcha)». Con una sola sección y
  nada pendiente se mantiene «M3 · listo para servir», que es el caso
  normal de un bar y está probado en el hierro.
- **Un toque sirve TODO lo listo de esa mesa** — y la etiqueta verde del
  mapa hace lo mismo, que antes servía sólo la comanda más antigua y
  dejaba el LISTO puesto.
- **`GET /kitchen/listas` manda también lo que sigue en marcha**
  (`pending`), en la MISMA petición: dos GET podrían contestar estados de
  instantes distintos, que es la banda que parpadea.
- **En el AP11**, la tarjeta de «Listas» lleva la sección cuando la
  pantalla muestra más de una.
- **La pila no pasa de dos filas plegada**: a partir de la tercera se
  pinta la más antigua —la que lleva más tiempo en el pase— y una fila
  «N mesas listas más · Ver» que despliega el resto con scroll propio.

**Decisiones sin preguntar.** El grupo es por `tableId` y, si no hay mesa,
por `ticketId`: dos cuentas partidas de la misma mesa son un solo viaje,
y «Mostrador nº 1» y «Mostrador nº 2» son dos clientes distintos. El orden
en que se nombran las secciones es fijo (cocina, barra, sala) y lo impone
`textoDeBanda`, no el llamante: lo que el camarero reconoce de un vistazo
es la forma de la frase. Y una sección que ya está lista no se cuenta como
«en marcha», que es lo que impide un «barra lista (barra en marcha)» en la
ventana entre el GET y el evento.

**Bancos:** `apps/tpv-web/test/avisos-listo-agrupados.test.ts` (16) y
`apps/tpv-web/test/listo-banner-pila.test.tsx` (5).

---

## E · 🟡 «Mostrador nº 1» no cabía en el KDS

Cabecera partida a mitad de palabra —«Mostra / dor nº 1», captura 11— y
cortada en la columna «Listas» —«Mostrado», captura 12c—.

- El título que pinta la pantalla de cocina es el **corto**: «Mostr. 1».
- Lo escribe la MISMA función que escribe el largo
  (`packages/ticket-model/src/comanda-titulo.ts`, mudado desde
  `api/src/kitchen/titulo.ts` porque ahora lo miran los dos lados). Dos
  textos separados se desincronizan en cuanto alguien renombre
  «Mostrador nº».
- `break-words` pasa a `break-normal` + `truncate`: **nunca** a mitad de
  palabra. Un nombre imposible se recorta con puntos suspensivos, que se
  lee; partido, no.

**Decisión:** «Mostr. 1» y no «M·1». En un bar con mesas M1…M9, «M·1» y
«M1» se leen igual desde dos metros, y confundir un mostrador con una mesa
manda al camarero al otro lado del local. Un nombre de MESA no se toca
nunca: lo puso la dueña.

---

## F · 🟡 Cuadrar caja cambiaba de tamaño con el teclado

Tocar un casillero ensanchaba el modal de `max-w-lg` a `max-w-3xl` (sale
el CashPad) y «Listo» lo volvía a estrechar: los casilleros se movían
**bajo el dedo** entre denominación y denominación, que es exactamente
como se cuenta un cajón —sin mirar— (capturas 45–47).

- **El hueco se reserva durante toda la fase de conteo.** El modal mide lo
  mismo con y sin pad; cuando no hay denominación activa, la columna
  enseña «Toca un casillero para contarlo». Cuesta 300 px de tarjeta vacía
  los dos segundos que hay entre abrir el arqueo y tocar la primera
  moneda.
- **«Listo» pasa al siguiente casillero** y sólo cierra en el último de su
  grupo, donde ya no hay siguiente. El botón dice «Siguiente» o «Listo»
  según el caso.

**Decisiones.** El hueco se reserva sólo a partir de `sm`: por debajo el
pad va debajo de la tarjeta, y reservarle 300 px de ALTO a un teclado que
no está sería peor que el problema. Y «Siguiente» avanza dentro de su
grupo: desde «1 ct» no salta a los billetes grandes, que viven plegados en
un `<details>` y se abren a propósito una vez al mes — saltar ahí dejaría
al cajero tecleando dentro de un bloque que no ve.

---

## G · 🟡 Numeración por caja sin distinguir

La Caja 2 empezó en #000001 con la Caja 1 por el #000028, las dos en la
misma lista y sin nada que las distinguiera salvo el texto pequeño de
debajo (captura 30).

**La numeración no se toca.** El correlativo por caja es fiscal: cada caja
es una instalación de SIF con su serie y su cadena de registros (ADR-019).
Lo que cambia es cómo se escribe y cómo se busca
(`packages/ticket-model/src/caja-en-el-numero.ts`):

- La **lista**, el **detalle** y el **papel** llevan «C2·» delante del
  número cuando la TIENDA tiene más de una caja. Con una sola, el papel y
  la pantalla salen exactamente igual que antes del bloque.
- La **etiqueta** es `Register.fiscalSeries` («C1», «C2»): la misma letra
  que ya lleva la factura simplificada de esa caja. Mientras la caja no ha
  emitido es NULL y se deriva del nombre («Caja 2» → C2, «Terraza 1» →
  T1). Un nombre sin número no se abrevia a ciegas: «Barra» → «BARRA»,
  porque inventar iniciales daría la misma etiqueta a dos cajas.
- La **búsqueda**: «000001» devuelve LOS DOS —quien teclea un número a
  secas se lo está leyendo a un cliente y no sabe de qué caja es— y
  «C2·000001» (o con espacio, guion o barra) sólo el de esa caja.

**Decisión:** el prefijo lo decide el SERVIDOR contando las cajas de la
tienda, no el contenido de la página. Si lo decidiera la página, el
prefijo aparecería y desaparecería al filtrar. En el detalle, debajo del
número va el nombre largo de la caja, por si «C2» no le dice nada a quien
acaba de entrar.

---

## H · ⚪ Detalles

**H1 · gris casi invisible.** Ni el importe de línea del detalle de ticket
ni el casillero de la devolución llevaban color propio: heredaban el del
contenedor. Y el contenedor del que heredan es la **sala oscura** de
hostelería, que fija `color: #F1F3F5`. El píxel más oscuro de «1,50 €» en
la captura 31 es exactamente `(241, 243, 245)` — contraste **1,11 sobre
blanco**. Las dos cifras que se comparan con el cliente delante eran lo
menos legible de la pantalla. Con color explícito pasan a 14,68 y 13,61.

**H2 · el chip «×N» tapaba el nombre.** `auditoria-sirope` (#5) sacó la
insignia del flujo —a la esquina, superpuesta— para que aparecer no
desplazara el texto; el efecto colateral es que con un nombre que llega al
borde se le sienta encima («Tostada York y», «Café Americano», capturas 09
y 21). Ahora se le reserva hueco **a los dos lados** —a los dos porque el
nombre va centrado y reservar sólo a la derecha lo descentraría, que es el
fallo que #5 arregló— y **sólo cuando hay insignia**: reservarlo siempre
le quitaría 68 px de ancho a todos los botones del catálogo. Lo que cuesta:
al añadir la primera unidad el nombre puede partirse en otra línea, en el
botón que acabas de tocar y una vez.

**H3 · la línea decía «EN COCINA» con la banda verde ya arriba** (captura
13b). Dos rótulos de la misma pantalla contando cosas distintas de la
misma comanda. `etiquetaDeLoEnviado` tiene tres formas: «EN COCINA ·
23:34» cuando no hay nada listo, «LISTO · 23:34» cuando lo está todo, y
por sección cuando va a medias («BARRA LISTA · COCINA EN MARCHA») — ahí la
hora del envío ya no dice nada útil y lo que hace falta saber es qué se
puede llevar ya.

**H4 · los 15–30 s no eran la red.** `useAvisosListo` dice en su cabecera
desde kds-1 que se refresca «con el evento del bus», y **no estaba
suscrito a nada**: el WebSocket de la tienda lo abren `SalePage` y
`TableMapScreen`, y sus manejadores llamaban a `kitchen.recargar()` (el
estado de la mesa) y a `load()` (el mapa), pero nunca a
`avisosListo.recargar()`, que vive un nivel más arriba, en `TpvHome`. El
único camino que quedaba era el repaso de 30 s — que es el retraso medido,
tanto para que salga la banda como para que el LISTO desaparezca del mapa
tras cobrar (13→13b, 27→29).

El arreglo es el patrón de `avisarAjustesCambiados` (#20): quien recibe el
evento lo relanza como evento del navegador (`avisoCocina.ts`) y quien
tiene la lista lo escucha. **Un segundo WebSocket desde `TpvHome` habría
costado una conexión más por terminal para enterarse de lo mismo.** El bus
del servidor es in-memory y el despliegue corre una sola instancia de API
(ADR-009), así que el evento llega: con esto el aviso es inmediato y el
repaso de 30 s vuelve a ser lo que decía ser, una red.

---

## Tabla de sabotajes

Cada fila: se rompió el código, se vio el rojo, se copió el mensaje real,
se restauró.

| Sabotaje | Qué cayó | Mensaje real |
|---|---|---|
| La regla de A sólo en `routes.ts`, no en `lan.ts` | `comandas-huerfanas.test.ts` › «camino LAN · el “Lista” que sube la tablet al volver la red, igual» | `AssertionError: expected undefined to be '2026-10-19T11:13:13.196Z' // Object.is equality` |
| Servir al marcar Lista aunque el ticket siga DRAFT | `comandas-huerfanas.test.ts` › «SABOTAJE · servir al marcar Lista aunque el ticket siga DRAFT» | `expected { ok: true, alreadyReady: false, …(1) } to match object { huerfana: false }` · recibido `"huerfana": true` |
| `servedAt` un ms antes que `readyAt` | `comandas-huerfanas.e2e.ts` › «la tarjeta se sirve sola y sale de la pantalla» (la ruta revienta) | `AssertionError: expected 500 to be 200` · y el motor: `ERROR: new row for relation "kitchen_orders" violates check constraint "kitchen_orders_cronologia"` |
| Quitarle al CHECK la tercera condición (la que añade el bloque) | `comandas-huerfanas.e2e.ts` › «el CHECK kitchen_orders_cronologia lo rechaza» | `AssertionError: promise resolved "1" instead of rejecting` |
| El corte de día deja las no listas | `comandas-huerfanas.test.ts` › «sirve la que NUNCA se marcó Lista…» | `AssertionError: expected [] to have a length of 1 but got +0` |
| El script escribe sin `--apply` | `comandas-huerfanas.test.ts` › «SABOTAJE · el script escribe sin `--apply`» | `AssertionError: expected 1 to be +0 // Object.is equality` |
| El resumen de cierre cuenta las vaciadas distinto que el PDF | `cierre-mesas-vaciadas.test.ts` › «y cuenta EXACTAMENTE lo mismo que el PDF del Z» | `AssertionError: expected 4 to be 3 // Object.is equality` |
| Dos secciones listas → dos bandas | `avisos-listo-agrupados.test.ts` › «SABOTAJE · dos secciones listas de la MISMA mesa son UNA banda» | `AssertionError: expected [ { …(9) }, { …(9) } ] to have a length of 1 but got 2` |
| El modal de cuadrar cambia de ancho al abrir el teclado | la medida (navegador, 1442 × 811) | sin teclado `512 × 762 @ (465, 24)` → con teclado `768 × 762 @ (337, 24)`; el casillero de 10 € salta de `(503, 468.8)` a `(375, 449.3)`: **128 px en horizontal y 19,5 en vertical, bajo el dedo** |
| «Mostrador nº 1» con `break-all` | la medida (navegador, 1280 × 800) | el título de la tarjeta sale `partida: true` (una sola palabra ocupando dos líneas, medido con `Range.getClientRects()`) |
| El importe de línea y el casillero de devolución sin color propio | la medida (navegador, 1442 × 811, dentro de la sala oscura) | contraste `1,11` y `1,03` sobre blanco (color heredado `rgb(241, 243, 245)`) |

---

## Tabla de medidas

Banco visual (`apps/tpv-web/visual/`, pantallas nuevas `hierro-tickets`,
`hierro-ticket-detalle`, `hierro-devolucion` y los parámetros `?bandas=N`,
`?en-marcha=1`, `?una-caja=1`). Capturas en
`docs/blocks/hierro-sirope-shots/`.

### D · la pila de bandas, a 1442 × 811 (D8)

| mesas listas | bandas pintadas | texto de la primera | fila de «ver» | alto de la pila | «Cobrar» visible |
|---|---|---|---|---|---|
| 1 (cocina + barra) | 1 | «M1 · cocina y barra listas» | — | 64 px | sí (`bottom 795` de 811) |
| 2 | 2 | + «T2 · listo para servir» | — | 124 px | sí (795 / 811) |
| 3 | 1 | la más antigua | «2 mesas listas más · Ver» | 124 px | sí (795 / 811) |
| 5 | 1 | la más antigua | «4 mesas listas más · Ver» | 124 px | sí (795 / 811) |

Y con `?en-marcha=1`: «M1 · cocina y barra listas (sala en marcha)».

### E · el KDS, a 1280 × 800 (AP11, densidad 240)

| sitio | texto | ¿partida? | ¿recortada? |
|---|---|---|---|
| cabecera de la tarjeta | `Mostr. 1` | no | no |
| cabecera de la tarjeta | `T6`, `T3` | no | no |
| columna «Listas» (160 px) | `Mostr. 1` | no | no |
| columna «Listas» | `M3`, `M3` | no | no |

Y la sección en la tarjeta de «Listas»: `BARRA`, `COCINA`, `BARRA` (la
pantalla muestra dos secciones).

### F · cuadrar caja, a 1442 × 811

| | sin teclado | con teclado | tras «Siguiente» |
|---|---|---|---|
| modal | `768 × 762 @ (337, 24)` | `768 × 762 @ (337, 24)` | `768 × 762 @ (337, 24)` |
| casillero de 10 € | `(375, 449.3)` | `(375, 449.3)` | `(375, 449.3)` |

El botón dice «Siguiente» y el pad sigue abierto en la denominación de
abajo.

### G · el número con su caja, a 1442 × 811

| tienda | lo que pinta la lista |
|---|---|
| dos cajas | `#C2·000002`, `#C2·000001`, `#C1·000028`, `#C1·000027` |
| una caja | `#000002`, `#000001`, `#000028`, `#000027` |

### H1 · contraste, a 1442 × 811 (dentro de la sala oscura)

| | antes | después |
|---|---|---|
| importe de línea del detalle | `rgb(241,243,245)` · **1,11** | `rgb(31,41,55)` · **14,68** |
| casillero de la devolución | `rgb(241,243,245)` · **1,03** | `rgb(31,41,55)` · **13,61** |

AA pide 4,5 para texto normal: las dos lo cumplen con holgura.

### H2 · el chip «×N», a 1442 × 811

Seis botones de nombre largo con el chip puesto («Croissant a la plancha»,
«Tostada de tomate y jamón», «Zumo de naranja natural», «Copa de vino
tinto de la casa»). Solape del rectángulo del TEXTO —no el del `span`—
contra el del chip: **`pisa: false` en los seis**.

### H3 · el rótulo del ticket, a 1442 × 811

| estado | rótulo |
|---|---|
| todo listo | `LISTO · 16:20` |
| a medias | `COCINA LISTA · BARRA LISTA · SALA EN MARCHA` |
| nada listo | `EN COCINA · 16:20` |

---

## APK

**1.28.0** (versionCode 12800), construida con
`apps/tpv-android/scripts/build-release-apk.sh 1.28.0`. **No se publica en
`/apk`.**

```
fichero   apps/tpv-android/build-releases/mipiacetpv-1.28.0-12800.apk
tamaño    8 750 453 bytes
SHA-256   24e1143628822240b7ffaf484947b01751bb5aa23ad2561bb4f21f451789186b
commit    213be73
```

Instalar por cable:
`adb install -r apps/tpv-android/build-releases/mipiacetpv-1.28.0-12800.apk`

Bancos de la JVM (`cd apps/tpv-android/android && JAVA_HOME=/usr/local/opt/openjdk@17 ANDROID_HOME=/usr/local/share/android-commandlinetools ./gradlew :app:testDebugUnitTest`):
`VigilanteNativoTest` 7/7, y los de antes —`WebViewRescueTest` 9,
`OrientacionPorTamanoTest` 7, `KitchenLanProtocolTest` 10,
`GuardiaAvisoTest` 6— siguen verdes.

---

## Estado de la suite

- `npx vitest run` desde la raíz: **425 ficheros, 6 100 tests verdes**
  (10 saltados, los de siempre).
- `pnpm test:e2e` contra Postgres: **48 ficheros, 1 058 tests verdes**,
  incluida la migración nueva aplicada desde cero.
- `tsc --noEmit` limpio en los cuatro `apps/` y en los trece `packages/`.
  Con una excepción que **ya venía de `master`** y no toca este bloque:
  `packages/verifactu` compilado suelto se queja de
  `scripts/generar-declaracion-responsable.ts` (TS6059, fuera de su
  `rootDir`). Comprobado en el árbol de `master`: el mismo error.

## Fuera del bloque, y sigue fuera

La impresora, la zona horaria de la tienda, el mapa a 360 px
(`n1-hosteleria`), cambiar la numeración fiscal y ejecutar la limpieza de
A contra producción.

## Qué queda por hacer, y de quién es

1. **Correr la limpieza de A contra producción**, después del despliegue.
   Primero `pnpm --filter @mipiacetpv/api huerfanas` (informa), leer el
   reparto por tenant, y luego `-- --apply`. Es de Matías.
2. **La pasada de B en el hierro**, con el procedimiento de arriba, en el
   D8 y en el N1. Si sale el `ServiceRecord … app=null`, cerrar la causa
   en este documento.
3. **Actualizar el WebView del D8** (y mirar el del N1). Es la única
   solución de raíz de B que existe.
