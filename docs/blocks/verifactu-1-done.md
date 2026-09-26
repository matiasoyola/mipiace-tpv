# V1 · el ticket es una factura simplificada VERI*FACTU — DONE

Rama `verifactu-1`, worktree `mipiacetpv-verifactu-1`. Base: `82902fc` (master con el merge
de **sole-ticket-email** dentro). **Sin push, sin deploy.**

**HEAD del bloque: `a3de7145865fe5b4df165575717dcf9199918b9c`.**

Suite unitaria: **248 ficheros, 2.685 verdes, 3 saltados**.
Suite e2e contra Postgres real: **19 ficheros, 281 verdes**.
`git log HEAD..master`: vacío.

Decisión estructural: `docs/design/adr-019-cada-caja-es-un-sif.md`.
Plan del Frente 0: `docs/blocks/verifactu-1-plan.md`.

---

## 1 · Lo que hay ahora

Un comercio sin Holded (`holdedEnabled = false`) entrega, desde el primer cobro, una
**factura simplificada** del art. 7 del RD 1619/2012 con su **registro de facturación
encadenado** y su **QR tributario**. Con red y sin red.

```
  Cobrar
    │
    ├─ el DISPOSITIVO asigna el número (C1/000123), calcula la huella
    │  encadenada con la cabeza de SU caja, compone el QR e imprime
    │        ↓
    │  ┌──────────────────────────────────────────┐
    │  │ POST /tickets                            │
    │  │   { …la venta…, fiscalRecord: { … } }    │  ← un solo payload
    │  └──────────────────────────────────────────┘
    │        ↓ (outbox si no hay red)
    └─ el SERVIDOR verifica (huella, entrada, enlace, numeración) y
       guarda el payload BYTE A BYTE. Lo que no encadena se marca y
       se ve en el super-admin; nunca se descarta ni se recompone.
```

### 1.1 La forma final del dato

| Pieza | Dónde |
|---|---|
| Huella, QR, registro, cadena | `packages/verifactu` — sin dependencias, corre igual en Node y en la WebView |
| Desglose cuadrado (papel = registro) | `packages/ticket-model/src/desglose.ts` |
| Bytes del papel | `packages/escpos-builder` — **el único** constructor, lo llaman los dos lados |
| Identidad SIF de la caja | `registers.fiscal_series`, `registers.fiscal_installation_id` |
| El registro | `fiscal_records`, append-only |
| La verificación | `mipiacetpv_verify_fiscal_chain()` / `mipiacetpv_fiscal_chain_summary()`, en el motor |
| El modo | `Tenant.holdedEnabled === false`. No hay capability nueva |
| Estado del terminal | `localStorage` `mipiacetpv-fiscal-state`: config + cabeza de cadena |

### 1.2 Los seis triggers nuevos

| Trigger | Qué impide |
|---|---|
| `fiscal_records_append_only` | Modificar o borrar un registro. Sin vía de corrección (§2.3) |
| `registers_fiscal_identity_guard` | Cambiar la serie o la instalación de una caja que ya emitió |
| `registers_fiscal_identity_default` | Que una caja nazca sin serie ni instalación |
| `registers_fiscal_series_unique` | Dos cajas del mismo comercio con la misma serie |
| `devices_revoke_previous` | Que emparejar un terminal deje vivo al anterior |
| `tickets_fiscal_link_guard` | Borrar un ticket con factura emitida (el caso `TEST`, que S1 deja pasar) |

---

## 2 · Decisiones tomadas sin preguntar

### 2.1 Las tres que sí se preguntaron, y su respuesta

| Pregunta | Respuesta de Matías (24-09-2026) |
|---|---|
| Dos dispositivos activos en la misma caja | Forzar uno solo. La migración **aborta** si encuentra una caja con dos, nombrándola, y no revoca nada por su cuenta. La revocación deja traza de quién revocó a quién, visible en el super-admin |
| El papel sin red | Sí entra. **Un solo constructor**: `escpos-builder`, llamado por el servidor y por el dispositivo. El test que compara los bytes se queda como red de seguridad |
| Datos del productor del SIF | Constantes fijas: `MI PIACE INTERNET SOLUTIONS SL` / `B45902186` / `MP`, con test que valida el NIF con su dígito de control |

### 2.2 El interruptor es `holdedEnabled`, no una capability nueva

El prompt dice «modo fiscal por comercio». Se podía crear una columna `verifactuEnabled`
hermana de `cajaEnabled` y `fichajeEnabled`. **No se ha creado**: la pregunta que hay que
contestar —«¿emite este comercio sus propias facturas?»— es exactamente la negación de la que
ya contesta `holdedEnabled`, y dos columnas para una pregunta acaban desincronizadas. Se lee
`=== false`, nunca `!holdedEnabled`, que es el criterio que el propio `schema.prisma`
documenta para esa columna.

### 2.3 `fiscal_records` NO tiene vía de corrección, y la ausencia es la decisión

S1 tiene `record_ticket_correction` y F1 tiene `record_time_entry_correction` porque un
importe mal tecleado y una hora olvidada son errores humanos que hay que poder arreglar
dejando traza. Un registro de facturación no se arregla: **se anula y se emite otro**. Lo dice
la norma y es la razón de ser del registro de anulación. La tabla es append-only sin puertas.

### 2.4 El contador no es una columna

El prompt pide «su serie y su contador». El contador **es el último registro de la tabla
append-only**. Una columna `fiscal_counter` sería una segunda verdad que puede separarse de la
cadena sin que nada lo note; lo que garantiza que no hay huecos ni repetidos es el índice
único `(register_id, serie, numero)`.

### 2.5 La serie y la instalación las pone la BASE, no la aplicación

Primer intento: repartirlas en la ruta de alta de cajas y en la de activación del modo. Dos
caminos que hay que acordarse de tocar, y una caja sin serie es un comercio encendido que **no
puede cobrar**. Se movió a un trigger `BEFORE INSERT` con backfill de las cajas existentes.
Efecto colateral bueno: los bancos de pruebas existentes no vieron nada nuevo.

Lo mismo pasó con la revocación del terminal anterior: empezó en `POST /devices/pair` y acabó
en un trigger, por la misma razón (y porque en la ruta rompía los prismas falsos de los
bancos de emparejamiento, que es otra forma de decir lo mismo).

### 2.6 El suelo fiscal se comprueba al ENCENDER, no al cobrar

Un registro necesita NIF válido y razón social. Comprobarlo en el momento del cobro tumbaría
una venta con el cliente delante. Apagar Holded en el super-admin ahora exige esos datos
(409 `SUELO_FISCAL_INCOMPLETO`); a partir de ahí, cobrar no puede fallar por esto.

Y si aun así faltara algo (config cacheada vieja), **la venta sigue**: el registro no se
genera, queda en Sentry y la falta se ve en el panel de cadenas. *Cobrar siempre se puede.*

### 2.7 El número se gasta al generarlo, y un rechazo se cierra con una anulación

La cabeza de cadena avanza antes de que exista el envío. Si el servidor rechaza la venta para
siempre (`MANAGER_AUTHORIZATION_REQUIRED`, `PAYMENTS_MISMATCH`, `TICKET_ALREADY_PAID`), el
número **no vuelve**: se emite un registro de anulación con `SinRegistroPrevio = S` —el caso
«ANULACIÓN SIN REGISTRO PREVIO» del cuadro operativo del anexo— que viaja por el outbox
(`POST /fiscal/anulaciones`). Dos facturas con el mismo número es peor que un hueco.

### 2.8 El QR se reconstruye, no se guarda

Con los mismos cuatro datos del registro. Si se guardara, la misma URL viviría en dos sitios y
podrían separarse. Y el NIF sale del **registro emitido**, no del `fiscalProfile` de hoy: el
perfil puede haber cambiado y el cotejo dejaría de cuadrar.

### 2.9 `fecha_hora_huso_gen` va como TEXTO

El huso forma parte del dato («el que está usando el sistema informático de facturación en el
momento de generar el registro», anexo) y un `timestamptz` lo normaliza a UTC — con lo que la
huella, calculada sobre el texto con su huso, dejaría de poder recalcularse.

### 2.10 `huella_input` se guarda aunque sea derivable

Redundante a propósito: es lo que permite verificar la huella **dentro del motor** con el
`sha256()` de Postgres 16, sin volver a formatear ni un importe.

### 2.11 El desglose de IVA sale del mismo cuadre que el papel

`cuadrarDesglose` se sacó del renderer de ESC/POS a `ticket-model`. Si la cuota del papel y la
del registro difirieran en un céntimo, el cliente cotearía su factura en la sede de la AEAT y
no cuadraría — y la huella estaría calculada sobre un importe que nadie imprimió.

### 2.12 Sin registro de eventos y sin firma XAdES

La FAQ de desarrolladores (§15, NOTA 1) exime del registro de eventos al SIF que **sólo** puede
actuar en modo VERI*FACTU, que es lo que declara `TipoUsoPosibleSoloVerifactu = S`. Y la firma
XAdES el propio diseño de registro la marca «obligatoria para conservación y para
requerimiento, **pero no para remisión**». Las dos cosas están anotadas: si algún día hay modo
NO VERI*FACTU, las dos pasan a ser obligatorias.

### 2.13 Dos cambios fuera del alcance estricto, y por qué

- **`SERIE_FISCAL_DUPLICADA` usa ERRCODE 23514 y no 23505.** Semánticamente es una violación de
  unicidad, pero el cliente Prisma convierte los 23505 en un error estructurado y **tira el
  mensaje**. Un mensaje que explica el problema y que nadie puede leer no sirve de nada.
- **`@mipiacetpv/util-validation` gana un subpath `./spanish-tax-id`.** Importar el barrel desde
  el navegador arrastra `node:crypto` (por `temporary-password`) y la build de Vite se cae. Es
  el mismo motivo por el que `tpv-web` ya importaba `/email` y no el índice.

---

## 3 · Tabla de sabotaje

Cada fila **se ha ejecutado**: se rompe el código de producción, se corre la suite, se anota
qué se pone rojo y se revierte.

| # | Sabotaje | Qué se pone rojo |
|---|---|---|
| 1 | Quitar el `.toUpperCase()` de la huella | `verifactu/huella.test.ts` · **6 tests**, incluidos los tres ejemplos oficiales de la AEAT |
| 1b | Intercambiar `CuotaTotal` e `ImporteTotal` en la cadena de entrada | `verifactu/huella.test.ts` · 3 tests (6.1, 6.2 y el de espacios) |
| 2 | Saltarse un número de la serie (`+2` en vez de `+1`) | `tpv-web/verifactu-dispositivo.test.ts` · 5 tests, entre ellos «tras anular un número gastado, la siguiente venta NO lo repite» |
| 3 | Que el servidor dé siempre veredicto `OK` | `api/verifactu-ingesta.test.ts` · 3 tests: ENLACE_ROTO (huella de otra caja), NUMERACION_CON_HUECO, y «un registro que no encadena se GUARDA, marcado» |
| 4 | Quitar el trigger `fiscal_records_append_only` | **e2e** · 4 tests: UPDATE a mano, DELETE a mano, reescribir la huella, y la verificación de la cadena |
| 5 | Que el gate deje emitir a un comercio con Holded | `api/verifactu-ingesta.test.ts` · «rechaza un registro de un comercio que factura con Holded» |
| 6 | Quitar `tickets_fiscal_link_guard` (borrar la venta en vez de anularla) | **e2e** · «el ticket TEST, que S1 sí deja borrar, lo para el guard fiscal» |
| 7 | Tocar el camino del papel **del dispositivo** (`methodLabel` en mayúsculas) | `api/verifactu-un-solo-papel.test.ts` · 2 tests: los bytes y las entradas |
| 7b | Tocar el camino del papel **del servidor** (`#` delante del número interno) | Los **mismos 2 tests**. La red de seguridad funciona en los dos sentidos |
| 8 | Quitar el QR tributario del papel | `api/verifactu-un-solo-papel.test.ts` · 4 tests: el orden, la leyenda, la URL y el nivel M |

### 3.1 El nº 7 merece su párrafo

Es el que pidió Matías explícitamente: «el test que compara los bytes tiene que ponerse en rojo
si se toca uno de los dos caminos». Se ha comprobado **tocando cada uno por separado**, no sólo
uno. En los dos casos caen los mismos dos tests, y el segundo —el que compara las *entradas*—
existe para que el diff sea legible: con sólo los bytes, el fallo es «5342 ≠ 5337».

### 3.2 Lo que el nº 4 enseña de paso

Al quitar el trigger, el test que se pone rojo **no es sólo** el del UPDATE: también el que
verifica la cadena entera después de todos los sabotajes. Es decir, el sabotaje no queda
contenido — se ve en el estado del sistema, que es el punto.

---

## 4 · El bucle visual

`docs/blocks/verifactu-1-shots/` (con su propio README).

**Encontró un fallo que ningún test veía.** La leyenda `VERI*FACTU` se pintaba a 4 puntos del
QR, y a 33 mm de lado eso mete las mayúsculas **dentro** del código. El documento técnico de la
AEAT (§3) exige un mínimo de 2 mm de blanco alrededor, recomendado 6.

No falla ningún dato: el texto está, la URL está, el nivel de corrección es M y los bytes
coinciden con los del servidor. Lo que falla es un milímetro.

| Antes | Después |
|---|---|
| `01-pdf-leyenda-pisaba-el-qr.png` | `02-pdf-factura-simplificada.png` |

Las piezas se generan con el código del bloque, no maquetadas: el volcado legible de los 1.236
bytes ESC/POS reales, el PDF con su QR, y el **mismo PDF sin parte fiscal** para comprobar que
un comercio con Holded no ve ni un punto de diferencia.

---

## 5 · Qué NO cubre la suite

### 5.1 El AP11 y el AP12 por adb · **PENDIENTE**

El prompt lo pide y **no se ha podido hacer**: `adb devices` no lista ningún terminal desde
este worktree. Lo que falta por comprobar, con los comandos:

```bash
adb devices                       # que haya terminal
adb shell am start -a android.intent.action.VIEW -d "<url del TPV>"
# En chrome://inspect → la WebView del TPV → consola:
#   typeof crypto.subtle?.digest          → "function"
#   await crypto.subtle.digest("SHA-256", new TextEncoder().encode("x"))
```

Y el cobro real: modo avión → cobrar → **que salga papel** con su QR arriba y su
`Factura C1/00000N` → volver la red → que el registro suba y el super-admin lo dé por `OK`.

**Mitigación mientras tanto**, no un sustituto: `refreshFiscalHead` comprueba `crypto.subtle`
al arrancar y, si falta en un comercio que emite, lo reporta a Sentry **antes** del primer
cobro, no con un cliente delante. Y si faltara, `generarRegistroDeVenta` lanza y la venta sigue
igual.

### 5.2 Que la leyenda no pise el QR

Lo que se arregló en §4 **no lo puede ver un test**: es un milímetro, no un dato. El test nuevo
(`ticket-pdf/test/verifactu-qr.test.ts`) es lo más cerca que se puede estar — si alguien quita
los márgenes del cálculo del alto, la página encoge y se pone rojo. El solape en sí sólo se ve
mirando el PDF.

### 5.3 El QR no se escanea en ningún test

Se comprueba la URL que va dentro, el nivel de corrección (leyendo el byte del comando ESC/POS)
y el tamaño reservado. **Nadie ha escaneado el papel con un móvil.** El módulo 6 se eligió con
aritmética (203 dpi, versión 6-7 del QR, 30,8–33,8 mm), no con una foto.

### 5.4 El cotejo real contra la AEAT

El QR apunta a `prewww2.aeat.es` y **nadie lo ha llamado**. No puede salir bien todavía: los
registros no se remiten (V2). Lo que sí está verificado es que la URL tiene el formato exacto
del documento, incluidos los ejemplos del propio documento como tests.

### 5.5 La concurrencia real del índice de un dispositivo por caja

El índice único parcial y el trigger se prueban secuencialmente. Dos emparejamientos
literalmente simultáneos contra el mismo register no se han lanzado. Es el mismo hueco que
dejó F1 con `employee_devices_one_active_key`.

### 5.6 El reloj hacia atrás, sólo en unitario

`comprobarAntesDeGenerar` se prueba con relojes fijados a mano. Un terminal al que alguien le
cambia la hora de verdad, con ventas encoladas, no se ha reproducido.

### 5.7 Lo que se arregla de paso y por qué encaja

- El `escQrCode` de `escpos-builder` tenía el nivel de corrección **fijo en L**. Ahora es
  parámetro; el QR del ticket digital se queda en L (lo de siempre) y el tributario va en M
  porque el art. 21.1 lo exige.
- El QR del pie del PDF (el del ticket digital) tiene **el mismo patrón de 4 puntos** que
  causaba el solape del §4. No se ha tocado: lleva meses en producción, no es el QR tributario
  y cambiarlo movería el layout de todos los tickets. Queda anotado aquí.

---

## 6 · Criterio de hecho, punto por punto

| Criterio | Estado | Dónde se ve |
|---|---|---|
| Un comercio sin Holded cobra **con y sin red**, y cada ticket lleva serie, número correlativo, QR y leyenda | ✅ con red; ✅ sin red en código y en unitario; ⚠️ **falta la prueba en el AP11** | e2e «tres ventas con red» y «dos ventas generadas SIN RED»; `verifactu-dispositivo.test.ts`; §5.1 |
| Todos los campos de la factura simplificada (art. 7) | ✅ | `verifactu-un-solo-papel.test.ts` + el volcado del §4. El 7.1.c (fecha de operación distinta) no aplica en un TPV |
| Las huellas de los ejemplos oficiales de la AEAT salen idénticas | ✅ | `verifactu/test/huella.test.ts`, los tres casos del §6 del documento |
| La cadena de una caja se verifica íntegra tras ventas con y sin red | ✅ | e2e «la cadena se verifica ÍNTEGRA…», con la función que recalcula las huellas en el motor |
| Un UPDATE o DELETE a mano sobre un registro falla | ✅ | e2e, 3 tests, por `$executeRawUnsafe` |
| Un comercio con Holded no ve ningún cambio | ✅ | e2e (`{ emite: false }`, cobra igual, 409 si mandara registro) + `ticket-sin-verifactu.pdf` |
| Tabla de sabotaje con los siete mínimos | ✅ | §3, ejecutada, con el octavo que pidió Matías |

---

## 7 · Al desplegar

### 7.1 Necesita APK nueva

**Sí.** El registro nace en el dispositivo: un terminal con la APK vieja **no manda
`fiscalRecord`**. No se rompe nada —la venta entra igual y se anota— pero ese comercio no está
facturando conforme a ley hasta que actualice. Sale en el log (`fiscal.venta_sin_registro`) y
en el panel de cadenas, que enseñará una caja con 0 registros.

### 7.2 La migración puede ABORTAR, a propósito

Si algún comercio tiene hoy **dos terminales activos en la misma caja**, la migración se para y
dice cuál es la caja, la tienda y cuántos hay. No revoca nada: decidir cuál se queda no es cosa
de una migración, y apagar un terminal en mitad de un servicio es peor que una migración que no
corre.

Comprobarlo **antes**:

```sql
SELECT t.name AS comercio, s.name AS tienda, r.name AS caja, r.id AS caja_id,
       count(*) AS terminales_activos
  FROM devices   d
  JOIN registers r ON r.id = d.register_id
  JOIN stores    s ON s.id = r.store_id
  JOIN tenants   t ON t.id = s.tenant_id
 WHERE d.revoked_at IS NULL
   -- El dispositivo del «modo prueba» del super-admin NO es un terminal de
   -- caja y no cuenta (verifactu-1b). La columna que lo dice, `devices.kind`,
   -- la crea esta misma migración, así que ANTES de correrla hay que mirar
   -- los dos marcadores que usa su backfill.
   AND coalesce(d.user_agent, '') <> 'internal/mipiacetpv-test'
   AND coalesce(d.name, '')       <> 'mipiacetpv · modo prueba'
 GROUP BY r.id, t.name, s.name, r.name
HAVING count(*) > 1
 ORDER BY t.name, s.name, r.name;
```

Se agrupa por **`r.id`** y se enseña el **comercio**. La versión anterior de esta consulta
agrupaba por nombre de tienda y de caja, así que sumaba comercios distintos: tres clientes con
una «Tienda principal / Caja 1» cada uno salían como una caja con tres terminales, y la lista no
decía a quién llamar. La precondición de la migración siempre agrupó bien (`GROUP BY s.name,
r.name, r.id`); la que estaba mal era esta copia del -done.

Después de la migración, lo mismo sale de la columna:

```sql
SELECT t.name AS comercio, s.name AS tienda, r.name AS caja, r.id AS caja_id,
       count(*) AS terminales_activos
  FROM devices   d
  JOIN registers r ON r.id = d.register_id
  JOIN stores    s ON s.id = r.store_id
  JOIN tenants   t ON t.id = s.tenant_id
 WHERE d.revoked_at IS NULL AND d.kind = 'TERMINAL'
 GROUP BY r.id, t.name, s.name, r.name
HAVING count(*) > 1
 ORDER BY t.name, s.name, r.name;
```

> **verifactu-1b.** El dispositivo técnico del modo prueba no es un terminal de caja: no cuenta
> aquí, no releva a nadie y no genera registro de facturación. La migración de este bloque se
> corrigió **en su sitio** porque nunca llegó a correr en producción. Ver
> `docs/blocks/verifactu-1b-done.md`.

### 7.3 Variables de entorno

| Variable | Valor | Qué pasa si no está |
|---|---|---|
| `VERIFACTU_ENTORNO` | `PRUEBAS` (hoy) / `PRODUCCION` (V2) | Cae a `PRUEBAS`, que es el que no afirma nada. Un valor mal escrito **también** cae a `PRUEBAS` y no tumba la API |

### 7.4 Lo que hay que hacer a mano, fuera del código

1. **La declaración responsable del SIF.** Sus datos tienen que coincidir **literalmente** con
   `packages/verifactu/src/productor.ts`: `MI PIACE INTERNET SOLUTIONS SL`, `B45902186`, `MP`,
   `mipiacetpv`. Cambiar unos sin los otros convierte cada registro emitido en una declaración
   falsa.
2. **Revisar la cláusula 2 del contrato piloto.** La frontera fiscal que describe ya no es la
   que hay para un comercio sin Holded.
3. **Explicarle al cliente que dos cajas son dos series.** Sus facturas no van 1, 2, 3 sino
   C1/1, C2/1, C1/2. Es correcto y es lo que la norma quiere.
4. **Validación por asesor fiscal** de `docs/legal/posicion-verifactu.md`, que se ha reescrito
   entero.

### 7.5 Encender un comercio

`PATCH /super-admin/tenants/:id` con `holdedEnabled: false`. Exige NIF válido y razón social;
si faltan, 409 con la lista de lo que falta. Las cajas ya tienen serie e instalación desde que
se crearon (o desde el backfill de esta migración).

---

## 8 · La base del e2e

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U mipiacetpv -c "CREATE DATABASE mipiacetpv_verifactu_e2e;"
E2E_DATABASE_URL='postgresql://mipiacetpv:mipiacetpv_dev@127.0.0.1:5432/mipiacetpv_verifactu_e2e' \
  pnpm --filter @mipiacetpv/api test:e2e
docker compose exec -T postgres psql -U mipiacetpv -c "DROP DATABASE mipiacetpv_verifactu_e2e;"
```

Base propia por sesión: la suite hace `DROP SCHEMA public` antes de migrar. **Borrada al
terminar.**

Una nota del propio e2e: su limpieza (`DELETE FROM tenants`) no siempre puede completarse,
porque `shifts.user_id` es RESTRICT y los guards de S1 y de este bloque impiden borrar tickets
con venta sellada o factura emitida. Es decir: **no se puede limpiar del todo precisamente
porque el bloque funciona.** Se intenta y no se hace fallar la suite por ello.

---

## 9 · Qué le falta a V2 para remitir

Lo que este bloque le deja hecho:

- El `payload` de cada registro, verbatim y listo para serializar a XML.
- La cadena verificable, para no remitir sobre una cadena rota.
- El interruptor `VERIFACTU_ENTORNO`, que en V2 pasa a ser también el del endpoint de remisión.

Lo que V2 tiene que traer:

1. **`fiscal_record_submissions`** — la tabla hermana donde vive el estado de remisión. Se
   diseñó así para que `fiscal_records` pueda seguir siendo estrictamente append-only.
2. **El XML y el envío** con certificado electrónico cualificado y TLS mutuo contra la sede.
3. **Los reintentos y la `Incidencia = S`** cuando toque. Las incidencias de remisión «NO
   suponen en ningún caso que deba interrumpirse la facturación».
4. **El cambio del QR a producción**, que es una variable de entorno y una decisión de
   producto: hasta que se remita de verdad, un QR de producción promete un cotejo que no puede
   salir bien.
5. **El agrupado por lotes** (el servicio admite hasta 1.000 registros por envío) y el respeto
   del tiempo de espera que devuelve la AEAT.

Y fuera de V2: rectificativas y devoluciones (V3), la factura completa del art. 7.2/7.3, y
desconectar Holded en un comercio que ya lo tiene (bloque aparte).

---

## 10 · Commits

```
a3de714 qa(verifactu-1): el bucle visual · la leyenda se metía dentro del QR
5e8a0a7 feat(verifactu-1): el registro que no encadena se ve en el super-admin
6df9a02 test(verifactu-1): la cadena contra Postgres real, y la revocación al motor
eae64b4 docs(verifactu-1): ADR-019 y la posición fiscal reescrita
e964cff feat(verifactu-1): el papel dice lo que la norma pide, y sale sin red
8bed194 feat(verifactu-1): la factura nace en la tablet · con red o sin ella
7796c5c feat(verifactu-1): el espejo del servidor · verifica, guarda y no recompone
91b631d feat(verifactu-1): el registro es inalterable · la cadena, en el motor
fa39d2d feat(verifactu-1): la huella, el QR y el registro · un paquete que corre en los dos lados
50ebc62 docs(verifactu-1): el plan · qué hay hoy, qué dice la AEAT y dónde nace la huella
```

76 ficheros, +9.741 / −280.

---

## 11 · Las fuentes

Todo lo que este bloque afirma sobre la norma sale de estos documentos, citados con su
apartado en el plan y en ADR-019:

- **Orden HAC/1177/2024** (BOE-A-2024-22138) — arts. 13 (huella), 20 y 21 (QR y leyenda), 7.i
  (comprobación previa), y el anexo con los diseños de registro y las listas.
- **RD 1007/2023** y **RD 1619/2012** art. 7 (contenido de la factura simplificada) y art. 4
  (cuándo procede).
- **Detalle de las especificaciones técnicas para generación de la huella o hash**, AEAT,
  v0.1.2 del 27-08-2024 — sus tres ejemplos del §6 son tests dorados.
- **Detalle de las especificaciones técnicas del código QR**, AEAT, v0.5.0 del 10-12-2025.
- **Diseños de registro** (`DsRegistroVeriFactu.xlsx`) — la estructura del `RegistroAlta`, del
  `RegistroAnulacion`, del bloque `SistemaInformatico` y las listas L1-L17.
- **Preguntas frecuentes de empresas de desarrollo**, AEAT, 4-12-2025 — §2 (identificación del
  SIF y número de instalación), §5 (arquitecturas TPV + backoffice), §15 (comprobación del
  encadenamiento y exención del registro de eventos), §1 (plazos tras el RDL 15/2025).

## Relación con otros documentos

- `docs/blocks/verifactu-1-plan.md` — el plan del Frente 0.
- `docs/design/adr-019-cada-caja-es-un-sif.md` — la decisión estructural.
- `docs/design/adr-015-sello-de-la-venta.md` — el sello, que convive; lleva la nota de qué
  párrafo suyo quedó superado.
- `docs/legal/posicion-verifactu.md` — reescrito entero por este bloque.
