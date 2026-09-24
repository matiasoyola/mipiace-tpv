# V1 · el ticket es una factura simplificada VERI*FACTU — PLAN (Frente 0)

Origen: el prompt de Matías del 23-09-2026. Rama `verifactu-1`, worktree
`mipiacetpv-verifactu-1`. Base: `82902fc` — master con el merge de **sole-ticket-email**
dentro, comprobado con `git log HEAD..master` (vacío). **Sin push, sin deploy.** **Con
migración** — ver §11.

Decisión estructural de este bloque: `docs/design/adr-019-cada-caja-es-un-sif.md` (se
escribe con el código, §10).

Este documento **revoca** la posición de `docs/legal/posicion-verifactu.md` (2026-06-13,
«mipiacetpv no es un SIF»). Esa posición se apoyaba en que la factura la hace Holded. Para
el comercio que no tiene Holded no la hace nadie, y ahí es donde entra este bloque.

---

## 0 · Qué compra este bloque

Un autónomo sin Holded tiene que poder entregar, desde el primer cobro, una **factura
simplificada** que cumpla el art. 7 del RD 1619/2012, con su **registro de facturación
encadenado** (RD 1007/2023 + Orden HAC/1177/2024) y su **código QR** de cotejo. Hoy entrega
un ticket con numeración interna y sin valor fiscal.

La remisión a la AEAT es V2. Aquí los registros **se generan, se encadenan, se guardan y
quedan listos para remitir**.

### 0.1 Un dato del prompt que hay que corregir

El prompt asume que la ley obliga «más adelante» sin fecha. La fecha existe y se ha movido
**dos veces**:

| Norma | IS (art. 3.1.a) | Resto (art. 3.1) |
|---|---|---|
| RD 1007/2023 original | 01-07-2025 (todos) | — |
| RD 254/2025, de 1 de abril | 01-01-2026 | 01-07-2026 |
| **RDL 15/2025, de 2 de diciembre** | **01-01-2027** | **01-07-2027** |

Fuente: FAQ de desarrolladores de la AEAT, 4-12-2025, §1 «PERIODO TRANSITORIO». No cambia
nada del bloque —la adopción temprana es válida y la AEAT «la recomienda vivamente» desde
que los servicios entraron en producción el 23-04-2025— pero sí cambia el discurso
comercial: el autónomo tiene hasta **julio de 2027**, no hasta 2026.

Lo que **no** tiene plazo de 2027 es la responsabilidad del fabricante: desde el 29-07-2025
un productor de SIF sólo puede ofrecer producto adaptado. Es el argumento de por qué esto se
hace ahora y no en 2027.

---

## 1 · Qué hay hoy

### 1.1 Lo que ya sirve y se copia tal cual

| Pieza | Dónde | Qué se copia |
|---|---|---|
| Inalterabilidad en el motor | `migrations/20260909000000_s1_sello_de_la_venta/migration.sql` | La tabla append-only con su trigger, la escapatoria comprobada contra el estado real (cascada del borrado del padre) y no contra una promesa, y el `ERRCODE = '23514'` con mensaje nombrado. |
| Registro inalterable completo | `migrations/20260923010000_fichaje_1_registro/migration.sql` | El guard que congela columna a columna, el índice único parcial que garantiza el invariante **en la base** (`employee_devices_one_active_key`), y el patrón de comentario que explica por qué cada excepción existe. |
| Capability por tenant | `Tenant.holdedEnabled` (`schema.prisma:524`) | Ya existe el interruptor exacto que este bloque necesita. No se crea ninguno nuevo. |
| Cola offline | `apps/tpv-web/src/lib/outbox.ts` | Persistir en IndexedDB **antes** del POST; idempotencia por `externalId`; lock optimista multi-pestaña. El registro fiscal viaja dentro del mismo item. |
| Emparejamiento de un solo uso | `apps/api/src/devices/routes.ts:184` | El claim atómico con `updateMany` (bug del 2026-05-27). Se le añade la revocación del anterior en la misma transacción. |
| Modelo abstracto de ticket | `packages/ticket-model` | `TicketDocument` es el único contrato entre datos y papel. El bloque fiscal se añade ahí, no en cada renderer. |
| QR en ESC/POS | `packages/escpos-builder/src/helpers.ts:62` `escQrCode` | El comando `GS ( k` ya está. Hay que parametrizar el nivel de corrección (hoy fijo a L, la AEAT exige M). |
| QR en PDF | `packages/ticket-pdf/src/render.ts:396` | `embedPng` de un QR de 25 mm ya existe. La AEAT exige entre 30×30 y 40×40 mm. |
| Desglose de IVA cuadrado al céntimo | `escpos-builder/src/ticket.ts` (`allocateRoundingRemainder`) | `CuotaTotal` del registro tiene que ser exactamente lo que imprime el papel. Ya está resuelto. |
| Aritmética fiscal por bucket de IVA | `apps/api/src/tickets/totals.ts` `computeTicket` | Agrega netos en precisión completa por tipo y redondea **una vez**. `ImporteTotal` y `CuotaTotal` salen de aquí. |

### 1.2 Lo que NO sirve, y por qué

**1. El número de ticket no es un número fiscal, y se asigna en el servidor.**
`apps/api/src/tickets/routes.ts:574` incrementa `registers.ticket_counter` dentro de la
transacción del cobro y formatea `String(n).padStart(6,"0")`. Es correcto para lo que hace
—trazabilidad operativa y arqueo— y **no puede ser el número fiscal**, porque el número
fiscal tiene que existir en el dispositivo en el momento de entregar la factura, también sin
red. `internalNumber` se queda exactamente como está (§5.3).

**2. El papel lo construye el servidor.** `apps/tpv-web/src/lib/escposPrint.ts:117`
(`fetchTicketEscposBinary`) hace un `fetch` a `GET /tickets/:id/escpos`; el overlay de éxito
además pide `/tickets/:id/digital` para el PDF y el QR. **Sin red hoy no sale papel.**
`@mipiacetpv/escpos-builder` no es dependencia de `apps/tpv-web`. Eso choca de frente con la
FAQ de la AEAT: la factura con su QR se entrega en el momento. Se arregla en el Frente 5, y
se arregla **compartiendo la función, no duplicándola** (decisión de Matías, §2.3).

**3. Una caja admite dos dispositivos activos a la vez.** `POST /devices/pair` crea el
`Device` sin revocar los anteriores de esa caja y no hay índice que lo impida.
`docs/code-prompts/bloque-v1-9-5-formacion-y-feedback.md:37` lo dejó anotado como «decisión
de producto pendiente». Con la cadena naciendo en el dispositivo eso ya no es una
preferencia de producto: dos dispositivos sin red en la misma caja producen **dos registros
en la misma posición de cadena**. Decisión de Matías (24-09-2026), §2.1.

**4. El sello de S1 no sirve como huella.** `apps/api/src/tickets/seal.ts` calcula un
SHA-256 **en el servidor**, **por venta**, **sin encadenar** — y su propio comentario dice
que eso «es justo lo que nos mantiene fuera del ámbito SIF». Es lo contrario de lo que hace
falta aquí. **No se toca, no se reutiliza, no se sustituye**: el sello sigue protegiendo el
dato económico y la huella fiscal es otra cosa que vive en otra tabla. Conviven.

**5. El QR que imprime hoy el ticket es el del ticket digital**
(`escpos-builder/src/ticket.ts:304`, al final del papel). El QR tributario tiene que ir **al
principio de la factura** y ser «siempre el primer código QR que aparecerá en la factura»
(spec QR AEAT v0.5.0 §3). Los dos conviven; el orden cambia.

**6. `fiscalProfile` es un `jsonb` libre que puede estar vacío.** `Tenant.fiscalProfile`
admite `{}`. Un registro de facturación sin `IDEmisorFactura` no es un registro. §3.5.

### 1.3 Lo que hay y hay que respetar

`docs/design/adr-015-sello-de-la-venta.md` §2 dice, literalmente, que **no** se hace
encadenamiento de huellas entre registros y que no se comunica «cumple Verifactu». Ese ADR
no se borra ni se reescribe: se le añade una nota de cabecera apuntando a ADR-019, que es
quien cambia la frontera. El sello (§4 de ADR-015) sobrevive intacto.

---

## 2 · Las tres decisiones que se preguntaron

### 2.1 Un dispositivo activo por caja, garantizado por la base

Índice único parcial `devices_one_active_per_register` sobre `devices(register_id) WHERE
revoked_at IS NULL`, copia literal de `employee_devices_one_active_key`. Emparejar un
dispositivo nuevo revoca el anterior **en la misma transacción** que crea el nuevo; si ese
`UPDATE` no corriera, el `INSERT` revienta contra el índice en vez de dejar dos dispositivos
vivos.

Dos añadidos que pidió Matías:

**(a) La migración no revoca nada por su cuenta.** Antes de crear el índice hace un chequeo:
si alguna caja tiene más de un `Device` con `revoked_at IS NULL`, **aborta** con un
`RAISE EXCEPTION` que nombra la tienda, la caja y cuántos dispositivos tiene. Decidir cuál
de las dos tablets de un cliente se queda no es cosa de una migración.

**(b) La revocación deja traza.** `devices.revoked_reason` (`PAIRED_NEW` | `ADMIN`) y
`devices.revoked_by_device_id` (a favor de cuál se revocó). El super-admin lo pinta en la
ficha del tenant: «Caja 1 · tablet-mostrador revocada el 24-09 al emparejar tablet-nueva». Un
laboratorio emparejado por error a la caja de un cliente se ve el mismo día, en vez de
descubrirse cuando la cadena de esa caja ya está rota.

### 2.2 Los datos del productor del SIF, constantes en el paquete fiscal

```
NombreRazon           MI PIACE INTERNET SOLUTIONS SL
NIF                   B45902186        (sin el prefijo ES, que es el del NIF-IVA)
IdSistemaInformatico  MP
NombreSistemaInformatico  mipiacetpv   (≤30, diseño de registro AEAT)
Version               la del despliegue (apps/api/src/version.ts)
NumeroInstalacion     registers.fiscal_installation_id (§3.2)
```

Constantes en `packages/verifactu/src/productor.ts`, con un test que falla si alguna está
vacía o si el NIF no pasa la validación de formato (letra de control incluida). **Estos
valores tienen que coincidir literalmente con los de la declaración responsable del SIF** —
va anotado en el `-done`, §12.

### 2.3 Un solo constructor del ticket

`@mipiacetpv/escpos-builder` pasa a ser dependencia de `apps/tpv-web` y es **la única**
función que arma los bytes. La llaman los dos lados: el servidor (`/tickets/:id/escpos`,
`/digital`, reimpresiones) y el dispositivo. Nada de una copia en `tpv-web` y un test que
compare dos implementaciones.

El test que compara los bytes de los dos caminos se queda, pero como **red de seguridad
contra que alguien bifurque el camino**, no como puente entre dos implementaciones. Tiene
que ponerse rojo si se toca uno de los dos lados, y en el `-done` va saboteado para
demostrarlo (§3 de la tabla de sabotaje).

---

## 3 · El modelo de datos

### 3.1 El interruptor: quién emite

No se crea ninguna capability nueva. La regla es una línea:

```ts
// El comercio emite factura simplificada propia ⟺ NO usa Holded.
const emiteMipiacetpv = tenant.holdedEnabled === false;
```

Se lee `=== false`, nunca `!holdedEnabled`. Es el criterio exacto que ya documenta
`schema.prisma:521` para `holdedEnabled` y el que usa `fichajeEnabled`: **sólo el valor
explícito contrario al default cambia el comportamiento de nadie**. Un tenant de hoy tiene
`holded_enabled = true` y no ve ni una diferencia.

Nunca pueden emitir los dos. El gate vive en un solo sitio
(`apps/api/src/fiscal/mode.ts`), y el dispositivo recibe el modo en el arranque de sesión
junto con el resto de la configuración de caja.

### 3.2 La instalación SIF, por caja

Columnas nuevas en `registers`:

| Columna | Tipo | Qué es |
|---|---|---|
| `fiscal_series` | `TEXT NULL` | La **serie** de la factura simplificada de esta caja. `C1`, `C2`… Editable desde el admin **mientras la cadena esté vacía**; después, inmutable por trigger. No se reutiliza `num_serie_holded`: esa es la serie de Holded y mezclarlas es exactamente el error que este bloque existe para no cometer. |
| `fiscal_installation_id` | `TEXT NULL UNIQUE` | El `NumeroInstalacion` del diseño de registro. UUID v4 generado **una vez** al activar la caja. Inmutable por trigger. |

Por qué la instalación es de la **caja** y no del dispositivo: el prompt decide que si cambia
el dispositivo la cadena continúa. Si el `NumeroInstalacion` colgara del dispositivo, cambiar
de tablet partiría el SIF en dos y la cadena tendría que empezar de cero. La FAQ de la AEAT
(§2, «Identificación del SIF») lo respalda: lo que identifica un SIF es
`(NIF productor + IdSIF + NumeroInstalacion)`, y «cada una de esas facturaciones distintas
(…) del mismo OEF pero de distintos centros de facturación independientes, como tiendas)
debe tener un nº de instalación propio y distinto al resto (pasado, presente o futuro)
porque se consideran SIF distintos». Una caja es una facturación independiente: su serie, su
numeración, su cadena.

**Lo que NO se guarda: un contador.** El prompt pide «su serie y su contador». El contador
no es una columna, es **el último registro de la cadena**. Una columna `fiscal_counter`
sería una segunda verdad que puede separarse de la cadena sin que nada lo note — y
justamente lo que garantiza que no hay huecos es el índice único sobre `(register_id, serie,
numero)` de la tabla append-only. El servidor lo deriva; el dispositivo lleva el suyo en
IndexedDB y lo resincroniza con el del servidor (§5.2).

### 3.3 El registro de facturación

Tabla `fiscal_records`. **Append-only, sin excepciones más allá de la cascada del borrado
del tenant** (mismo patrón exacto que `time_entries` en F1).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `UUID PK` | |
| `tenant_id`, `register_id` | `UUID NOT NULL` | |
| `external_id` | `UUID UNIQUE` | Idempotencia del outbox. Lo genera el dispositivo. |
| `kind` | `FiscalRecordKind` (`ALTA`\|`ANULACION`) | |
| `chain_index` | `INTEGER NOT NULL` | Posición en la cadena de la caja, 1-based. `UNIQUE (register_id, chain_index)`. |
| `serie` | `TEXT NOT NULL` | |
| `numero` | `INTEGER NOT NULL` | Sólo para `ALTA`: `UNIQUE (register_id, serie, numero) WHERE kind='ALTA'`. |
| `num_serie_factura` | `TEXT NOT NULL` | El literal que entra en la huella y en el QR: `"C1/000123"`. Se guarda entero, no se recompone. |
| `fecha_expedicion` | `DATE NOT NULL` | Se renderiza `dd-mm-yyyy` para huella y QR. |
| `tipo_factura` | `TEXT NOT NULL` | `F2` — factura simplificada (lista L2 del anexo). |
| `cuota_total`, `importe_total` | `DECIMAL(12,2)` | Los mismos números que imprime el papel. |
| `huella` | `CHAR(64) NOT NULL` | Hexadecimal **en mayúsculas**. |
| `huella_anterior` | `CHAR(64) NULL` | `NULL` ⟺ `primer_registro`. |
| `primer_registro` | `BOOLEAN NOT NULL` | |
| `fecha_hora_huso_gen` | `TEXT NOT NULL` | **La cadena exacta** que entró en la huella (`2026-09-24T10:11:12+02:00`). Texto y no `timestamptz`: el huso forma parte del dato y un `timestamptz` lo normaliza a UTC, con lo que la huella dejaría de poder recalcularse. |
| `huella_input` | `TEXT NOT NULL` | La cadena completa sobre la que se aplicó SHA-256. Redundante a propósito: es lo que permite al motor **recalcular** la huella y verificarla sin volver a formatear nada (§9.2). |
| `payload` | `JSONB NOT NULL` | El `RegistroAlta`/`RegistroAnulacion` completo tal y como lo generó el dispositivo. Es lo que V2 remitirá, **sin tocarlo**. |
| `ticket_id` | `UUID NULL` FK | La venta que documenta. |
| `anula_record_id` | `UUID NULL` FK self | Sólo `ANULACION`. |
| `device_id` | `UUID NULL` FK | Quién lo generó. |
| `generated_at` | `TIMESTAMPTZ NOT NULL` | Reloj del dispositivo. |
| `received_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Reloj del servidor. «Generado sin conexión» se **deriva** de la distancia entre las dos, no se guarda como flag (lección de F1). |
| `chain_status` | `FiscalChainStatus` (`OK`\|`BROKEN`) | Lo decide el servidor al insertar. |
| `chain_error` | `TEXT NULL` | Por qué no encadena. Se rellena a la vez que `BROKEN`. |

**Por qué `chain_status` se escribe en el INSERT y nunca después:** si fuera actualizable,
el trigger append-only tendría una puerta, y una puerta en una tabla cuyo valor entero es no
tener puertas no se paga. La verificación (§9.2) se ejecuta contra la tabla y **no la
modifica**: su salida es una consulta, no un `UPDATE`.

**Dónde vivirá el estado de remisión (V2):** en una tabla hermana
`fiscal_record_submissions`, no aquí. Así `fiscal_records` puede seguir siendo estrictamente
append-only cuando llegue V2.

### 3.4 Los triggers

Tres, con el patrón literal de S1 y F1:

1. `fiscal_records_append_only` — `BEFORE UPDATE OR DELETE`. Rechaza siempre, con una única
   escapatoria comprobada contra el estado real: el tenant ya no existe (cascada de su
   borrado). `ERRCODE = '23514'`, mensaje `REGISTRO_FISCAL_VIOLADO: …`.
2. `registers_fiscal_identity_guard` — `BEFORE UPDATE ON registers`. `fiscal_series` y
   `fiscal_installation_id` son inmutables **en cuanto existe un registro en la cadena de esa
   caja**; antes se pueden fijar y corregir. Cambiar la serie con la cadena viva es cambiar
   el número de las facturas ya emitidas.
3. `tickets_fiscal_link_guard` — un ticket que tiene registro fiscal de alta no se borra.
   El `DELETE` de S1 ya lo impide para tickets sellados; esto cubre el caso
   `status = 'TEST'`, que S1 deja pasar a propósito y aquí no puede pasar: si se emitió
   factura, hay factura.

### 3.5 El suelo: no se emite sin datos fiscales

Un registro necesita `IDEmisorFactura` (NIF válido), `NombreRazonEmisor`, serie e
instalación. Nada de eso se puede inventar en el momento del cobro.

La regla, que respeta la memoria «cobrar siempre se puede»: **el suelo se comprueba al
encender el modo, no al cobrar**. `POST /super-admin/tenants/:id/fiscal/activate` es lo
único que puede poner `holded_enabled = false` en un tenant, y falla con 409 si el
`fiscalProfile` no tiene NIF válido y razón social, o si alguna caja del tenant no tiene
serie e instalación. Una vez encendido, cobrar no puede fallar por falta de datos fiscales
porque los datos ya estaban ahí antes del primer cobro.

Si aun así faltara algo en el dispositivo (config cacheada vieja), **el cobro sigue
adelante** y el registro queda `BROKEN` con su motivo, visible en el super-admin. Una
invariante rota nunca tumba una venta.

---

## 4 · La huella

### 4.1 Lo que dice la AEAT, verificado

Documento: *Detalle de las especificaciones técnicas para generación de la huella o hash de
los registros de facturación*, AEAT, v0.1.2 del 27-08-2024.

Cadena de entrada, `nombre=valor` unidos por `&`, en este orden exacto:

```
ALTA
IDEmisorFactura=…&NumSerieFactura=…&FechaExpedicionFactura=…&TipoFactura=…
&CuotaTotal=…&ImporteTotal=…&Huella=…&FechaHoraHusoGenRegistro=…

ANULACIÓN
IDEmisorFacturaAnulada=…&NumSerieFacturaAnulada=…&FechaExpedicionFacturaAnulada=…
&Huella=…&FechaHoraHusoGenRegistro=…
```

Reglas, literales del documento:

- Valores **sin espacios al inicio y al final**.
- Campos numéricos: «se tratarán indistintamente los valores con una o dos posiciones en los
  decimales, sin tener relevancia los ceros a la derecha». `123.1` y `123.10` son ambos
  válidos. **Nosotros emitimos siempre dos decimales** — «indistintamente» es permisivo para
  quien valida, no una excusa para ser inconsistente al generar.
- Campo ausente o vacío: **el nombre y el `=`, y nada detrás** (`Huella=&`).
- La cadena se codifica en **UTF-8** antes de aplicar el algoritmo.
- Salida: **hexadecimal, en MAYÚSCULAS, 64 caracteres**.
- Algoritmo: lista L12 → `01` = SHA-256. Es el único permitido.
- Incluso el primer registro (`PrimerRegistro = S`) lleva su `Huella` calculada, con
  `Huella=` vacío en la entrada.

### 4.2 Los tres ejemplos oficiales, ya comprobados

Los tres casos del §6 del documento se han ejecutado contra `sha256` y **dan idénticos**.
Son los tests dorados del paquete; si la huella no sale igual, está mal:

| Caso | Huella esperada |
|---|---|
| 6.1 primer registro de alta | `3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60` |
| 6.2 alta con registro anterior | `F7B94CFD8924EDFF273501B01EE5153E4CE8F259766F88CF6ACB8935802A2B97` |
| 6.3 anulación con registro anterior | `177547C0D57AC74748561D054A9CEC14B4C4EA23D1BEFD6F2E69E3A388F90C68` |

### 4.3 Dónde se calcula

`packages/verifactu` — paquete nuevo del workspace, **sin dependencias**, que corre igual en
el navegador y en Node:

```
src/huella.ts        buildHuellaInputAlta(...) / buildHuellaInputAnulacion(...) → string
                     sha256HexUpper(input): Promise<string>   ← WebCrypto
src/qr.ts            buildQrUrl(...)  → string
src/registro.ts      buildRegistroAlta(...) / buildRegistroAnulacion(...) → payload
src/productor.ts     las constantes de §2.2
src/formato.ts       importe2dec, fechaDdMmYyyy, fechaHoraHusoIso8601
```

`crypto.subtle.digest("SHA-256", …)` está en Node 18+ (`globalThis.crypto`) y en toda
WebView moderna. **Hay que comprobarlo en el AP11 y en el AP12 por adb** (§11.4): el AP12 no
tiene `crypto.randomUUID`, y de ahí no se deduce que tenga o no tenga `subtle`. Si faltara,
el plan B es un SHA-256 en TypeScript puro dentro del mismo paquete, detrás de la misma
firma asíncrona — se decide con el dato en la mano, no antes.

### 4.4 La comprobación previa del art. 7.i

La Orden obliga, antes de generar cada registro que no sea el primero, a comprobar:

> 1.º El último registro de facturación generado está correctamente encadenado.
> 2.º La fecha y hora de generación del último registro de facturación generado no es
> superior en más de un minuto a la fecha y hora actuales (…).

La FAQ (§15.3) aclara el segundo punto, que se lee del revés con facilidad: lo **normal** es
que el registro nuevo sea posterior en más de un minuto y eso no es ningún problema. Lo que
no se admite es que el registro que se está generando tenga fecha y hora **más de un minuto
anterior** al anterior.

Traducción a código, en el dispositivo, antes de cada registro:

1. Recalcular la huella del último registro local desde su `huella_input` y comparar. Si no
   cuadra → **se genera igual** y se marca. La FAQ §15.2 es explícita: «será preciso generar
   el siguiente RF, ya que la facturación por este motivo NUNCA debe interrumpirse». La misma
   regla que la memoria «cobrar siempre se puede», escrita por la AEAT.
2. Si el reloj del dispositivo va más de un minuto por detrás del último registro, se usa
   `ultimo.fechaHoraHusoGen + 1s` en vez del reloj. Un cambio de hora manual en la tablet no
   puede partir la cadena.

---

## 5 · La numeración

### 5.1 La forma

`serie` de la caja + número correlativo, sin huecos, dentro de la serie. `NumSerieFactura`
es el literal `"C1/000123"` (art. 7.1.a RD 1619/2012: «Número y, en su caso, serie. La
numeración de las facturas simplificadas dentro de cada serie será correlativa»).

Longitud máxima 60 caracteres (diseño de registro); el nuestro son 9.

### 5.2 Quién lo asigna

**El dispositivo, al cobrar.** Lleva en IndexedDB, por caja:

```
{ registerId, serie, chainIndex, numero, huella, numSerieFactura,
  fechaExpedicion, fechaHoraHusoGen }
```

Es la **cabeza de la cadena**. Se rellena en tres momentos:

- Al emparejar el dispositivo → `GET /tpv/fiscal/chain-head`, que el servidor deriva del
  último `fiscal_records` de esa caja. Es lo que hace que cambiar de tablet continúe la
  cadena en vez de empezarla.
- Al arrancar con red → se vuelve a pedir y se compara. Si el servidor va **por delante**
  del dispositivo (otro dispositivo emitió, o este se reinstaló), gana el servidor. Si el
  dispositivo va por delante (tiene cola sin subir), gana el dispositivo.
- Después de cada registro generado → avanza local.

Con un solo dispositivo activo por caja (§2.1) las dos cabezas no pueden divergir de verdad:
la única fuente de registros nuevos para esa caja es este dispositivo.

### 5.3 `internalNumber` no se toca

Sigue siendo el contador operativo por caja que asigna el servidor
(`routes.ts:574`), sigue alimentando el arqueo, el Z, la búsqueda por número y el
`@@unique([registerId, internalNumber])`. **No es el número fiscal y no lo va a ser.** En el
papel conviven los dos, con el fiscal arriba y en grande y el interno como referencia
operativa pequeña.

### 5.4 El hueco: qué pasa si el servidor rechaza el cobro

El registro se genera **antes** del POST y viaja **dentro** del payload del ticket. No es una
comodidad: la FAQ §5 lo exige — «no puede haber facturas expedidas sin sus RF generados, ni
RF generados sin sus correspondientes facturas expedidas». Un registro y su factura son el
mismo acto o no son nada.

Eso deja una ventana: los 4xx permanentes que hoy `CheckoutPage.tsx` trata como «esto no ha
sido una venta» y borra del outbox.

| Código | Hoy | Con el registro fiscal |
|---|---|---|
| `MANAGER_AUTHORIZATION_REQUIRED` | Borra el item, pide PIN | **Se comprueba en el dispositivo antes de generar el registro.** El umbral (`discountThresholdPct`) ya está en la config de caja; el descuento efectivo lo calcula el dispositivo. Sin red no hay otra forma de hacerlo, así que hay que hacerlo igualmente. |
| `PAYMENTS_MISMATCH` | Borra el item, refresca la mesa | Igual: el dispositivo compara sus totales contra la proyección antes de generar. |
| `TICKET_ALREADY_PAID` | Borra el item, expulsa al mapa | **Este no se puede prever**: la mesa la cobró otra caja, que es otra cadena. La venta no existe pero el registro sí. Se resuelve como manda la norma: **registro de anulación** con `SinRegistroPrevio = S` (el alta nunca llegó a la AEAT). Es exactamente el caso «ANULACIÓN SIN REGISTRO PREVIO» del cuadro operativo del anexo. |

Ningún número se reutiliza nunca. Un número anulado es un número gastado, y eso es lo
correcto: la correlatividad no admite reciclaje.

---

## 6 · El QR y la leyenda

### 6.1 La URL

Documento: *Detalle de las especificaciones técnicas del código QR de la factura y de la URL
del servicio de cotejo*, AEAT, v0.5.0 del 10-12-2025.

```
Pruebas     https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR
Producción  https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR
```

Cuatro parámetros obligatorios, **y sólo cuatro**:

| Parámetro | Formato | Longitud |
|---|---|---|
| `nif` | formato NIF | 9 |
| `numserie` | texto ASCII 32–126 | ≤ 60 |
| `fecha` | `DD-MM-AAAA` | 10 |
| `importe` | punto decimal, `NNNNNNNNN.DD` | ≤12 enteros + 2 decimales |

Los valores van **URL-encoded en UTF-8** (el ejemplo del documento es una serie que contiene
`&`, que sin codificar parte la URL). El parámetro `formato=json` **nunca** puede ir en el QR
de la factura.

Mientras V2 no remita, el comercio está en **modo pruebas** y el QR apunta a `prewww2`. El
cambio a producción es una variable de entorno, no un despliegue de APK — va anotado en el
`-done`.

### 6.2 El QR en el papel y en el PDF

De la spec, §2 y §3, todo obligatorio:

- Tamaño entre **30×30 y 40×40 mm**, ISO/IEC 18004:2015, **nivel M** de corrección de
  errores. Hoy `escQrCode` fija nivel L (`0x30`) y el PDF dibuja 25 mm: las dos cosas
  cambian. En ESC/POS el nivel pasa a ser parámetro; el módulo se ajusta para caer en el
  rango de milímetros en 80 mm de papel.
- Mínimo **2 mm de blanco alrededor**, recomendado 6.
- **Encima** del QR, siempre: `QR tributario:`.
- **Debajo** del QR: `VERI*FACTU` (o «Factura verificable en la sede electrónica de la
  AEAT»). Tipo de letra y tamaño iguales o superiores al resto de datos de la factura.
- **Al principio de la factura**, antes del contenido, y siempre el primero si hay otros QR.

Eso último reordena el papel: el QR tributario va **arriba**, el QR del ticket digital se
queda donde está, al final. En el PDF, el QR tributario va en la cabecera, antes del bloque
fiscal.

El ticket **no dice que se ha remitido** mientras V2 no remita. Se imprime `VERI*FACTU`,
que es la leyenda del sistema, no un acuse de la AEAT.

---

## 7 · La factura simplificada, campo por campo

Art. 7.1 del RD 1619/2012 contra lo que imprime hoy `buildTicketReceipt`:

| Art. 7.1 | Hoy | Falta |
|---|---|---|
| a) Número y, en su caso, serie; correlativa dentro de la serie | `internalNumber` (correlativo por caja, **no fiscal**, sin serie) | **Serie + número fiscal.** §5 |
| b) Fecha de expedición | `formatDateTime(issuedAt)` ✅ | — |
| c) Fecha de la operación, si es distinta de la de expedición | — | Nada: en un TPV se cobra y se expide en el mismo acto. Se documenta como no aplicable en vez de dejarlo en blanco sin explicación. |
| d) NIF, nombre y apellidos o razón social del expedidor | `title` + `NIF: …` ✅ | Que **no puedan faltar**: hoy son opcionales. §3.5 |
| e) Identificación del tipo de bienes o servicios | descripción de cada línea ✅ | — |
| f) Tipo impositivo aplicado y, opcionalmente, «IVA incluido» | sólo si el caller pasa `taxBreakdown` | Que sea **obligatorio** cuando emite mipiacetpv. Un desglose opcional no cumple una letra que no lo es. |
| g) Contraprestación total | `TOTAL` ✅ | — |

Más, de la Orden: **QR tributario y leyenda `VERI*FACTU`** (§6).

Art. 7.2/7.3 —el cliente que pide NIF, domicilio y cuota separada para deducirse el IVA— es
**factura completa (`F1`) y queda fuera de este bloque**. El campo
`FacturaSimplificadaArt7273` del registro va a `N`. Se anota en §12 como lo primero que
pedirá el primer cliente que se lo pida a Ana.

---

## 8 · La anulación

Anular una venta ya cobrada **no borra nada**: genera un `fiscal_records` de tipo
`ANULACION` en la misma cadena de la caja, con su huella encadenada, y el ticket queda
marcado. El cuadro operativo del anexo distingue dos casos y los dos se implementan:

| Caso | Cuándo | Campos |
|---|---|---|
| Anulación normal | El alta existe en la cadena y llegó (o llegará) a la AEAT | `SinRegistroPrevio` sin informar |
| Anulación sin registro previo | El alta se generó pero nunca llegó a existir como factura (§5.4, `TICKET_ALREADY_PAID`) | `SinRegistroPrevio = S` |

`GeneradoPor = E` (expedidor) y el bloque `Generador` con los datos del obligado, en los dos
casos.

Lo que **no** entra aquí: las rectificativas (`R1`–`R5`) y las devoluciones. Una devolución
no es una anulación — la venta existió. V3.

---

## 9 · El espejo en el servidor

### 9.1 Llega por el outbox, dentro de la venta

El `POST /tickets` y el `POST /tickets/:id/checkout` aceptan un bloque `fiscalRecord` nuevo,
opcional (los comercios con Holded no lo mandan nunca). El servidor:

1. Verifica que el tenant está en modo emisor. Si llega un `fiscalRecord` de un tenant con
   `holdedEnabled !== false` → **409, y no se guarda**. Es el sabotaje nº 6.
2. Recalcula la huella desde `huella_input` y la compara con `huella`.
3. Comprueba que `huella_input` es exactamente lo que se deriva de los campos del registro
   (mismo constructor del paquete `verifactu` — el servidor no formatea por su cuenta).
4. Comprueba que `huella_anterior` es la huella del registro que ocupa `chain_index - 1` en
   **esta** caja, y que `numero` es el siguiente de la serie.
5. Inserta con `chain_status = OK`, o con `BROKEN` + `chain_error` si algo de 2–4 falla.

**Nunca se descarta en silencio y nunca se recompone.** La FAQ §5 lo prohíbe expresamente:
«no sería acorde a la normativa (…) la producción de los registros de facturación por parte
de la TPV y un reproceso posterior de los mismos (que los altere) desde el servidor Back
Office central». El servidor guarda lo que llegó, byte a byte, y dice si cuadra.

### 9.2 La verificación de la cadena

Función SQL `mipiacetpv_verify_fiscal_chain(p_register_id uuid)` que devuelve una fila por
registro con: `chain_index`, `huella_ok` (¿`sha256(huella_input)` = `huella`?),
`enlace_ok` (¿`huella_anterior` = huella del anterior?), `input_ok` (¿`huella_input`
contiene la `huella_anterior` declarada?), `numeracion_ok` (¿sin huecos?).

Postgres 16 trae `sha256(bytea)` nativo, así que **el motor recalcula la huella él mismo**:

```sql
upper(encode(sha256(convert_to(huella_input, 'UTF8')), 'hex')) = huella
```

No depende de que la aplicación se porte bien, que es la misma tesis de ADR-015 §4.2 y de
ADR-018. Se expone en el super-admin como «Verificar cadena» por caja, y en un script
`pnpm --filter @mipiacetpv/api verify-chains` para el VPS.

### 9.3 La colisión de posición de cadena

Dos registros con el mismo `(register_id, chain_index)`: el índice único los rechaza. El
segundo **no se pierde** — se inserta con el siguiente `chain_index` libre y
`chain_status = BROKEN`, `chain_error = 'POSICION_OCUPADA: …'`, y sale en el super-admin.

Con un dispositivo activo por caja esto no debería ocurrir nunca. Que exista el camino es
precisamente para que, si ocurre, se vea en vez de convertirse en un `INSERT` fallido y una
venta perdida.

---

## 10 · ADR-019

`docs/design/adr-019-cada-caja-es-un-sif.md` — «cada caja es un SIF y el registro nace al
cobrar». Número libre más alto (el último es ADR-018).

Contenido: las dos tesis, con las citas de la AEAT de §1 y §4; y las dos alternativas
descartadas, con el motivo:

- **El registro se genera en el servidor.** Descartada: exige red para cobrar. La AEAT la
  admite expresamente («se genere el registro de facturación en el Back Office, desde el que
  se envíe y se devuelva una vez generado a la TPV»), pero sólo «siempre que la conexión sea
  en tiempo real». mipiacetpv cobra sin red por diseño desde v1.5, y renunciar a eso para
  cumplir una norma que no lo pide es pagar dos veces.
- **Una cadena por comercio.** Descartada: exige red para encadenar. Dos cajas cobrando a la
  vez tendrían que coordinarse para saber cuál va detrás de cuál. Y la FAQ dice que cada
  facturación independiente es un SIF con su propio número de instalación.

Y las consecuencias, incluida la incómoda: **un comercio con dos cajas emite dos series**, y
eso hay que explicárselo al cliente en la implantación.

---

## 11 · Frentes, migración y pruebas

### 11.1 Los frentes

| # | Qué | Commit |
|---|---|---|
| 0 | Este plan | `docs(verifactu-1)` |
| 1 | `packages/verifactu`: huella, QR, registro, formato, productor. Los 3 ejemplos de la AEAT como tests dorados | `feat(verifactu-1)` |
| 2 | Migración: `fiscal_records`, columnas de `registers`, revocación con traza, índice de un dispositivo por caja, triggers, función de verificación | `feat(verifactu-1)` |
| 3 | Servidor: modo fiscal, activación con suelo, ingesta y verificación en `POST /tickets`, anulación, super-admin | `feat(verifactu-1)` |
| 4 | Dispositivo: cabeza de cadena en IndexedDB, generación al cobrar, comprobación del art. 7.i, el registro dentro del outbox | `feat(verifactu-1)` |
| 5 | El papel: `escpos-builder` compartido, QR tributario arriba con nivel M y su leyenda, desglose de IVA obligatorio, PDF | `feat(verifactu-1)` |
| 6 | ADR-019, nota en ADR-015, reescritura de `posicion-verifactu.md` | `docs(verifactu-1)` |
| 7 | Bucle visual, e2e, AP11 por adb, `-done` | `qa(verifactu-1)` / `docs(verifactu-1)` |

### 11.2 La migración

Aditiva. No toca una fila existente salvo el backfill de `revoked_reason` (que queda `NULL`
para las revocaciones históricas: no sabemos por qué se hicieron y no vamos a inventarlo).
El chequeo previo de §2.1(a) aborta antes de crear nada si hay una caja con dos dispositivos
vivos.

`pnpm db:generate` antes de `pnpm test`. La suite de `tpv-web` **se corre desde la raíz**.

### 11.3 e2e

Base propia: `mipiacetpv_verifactu_e2e`. Se borra al terminar.

### 11.4 El AP11

Por adb, y esto no es opcional:

1. `crypto.subtle` existe en la WebView del AP11 y del AP12.
2. Un cobro **en modo avión** genera su registro, su serie, su número y su QR, y sale el
   papel con el QR tributario arriba.
3. Al volver la red, el registro sube y el servidor lo verifica `OK`.
4. La huella calculada en el dispositivo para los datos del ejemplo 6.1 de la AEAT sale
   idéntica a la del documento.

---

## 12 · Lo que queda fuera

| | Bloque |
|---|---|
| Remisión a la AEAT, reintentos, `Incidencia = S`, certificado cualificado | **V2** |
| Rectificativas (`R1`–`R5`) y devoluciones | **V3** |
| Factura completa `F1` y el art. 7.2/7.3 (cliente que pide NIF y cuota separada) | V3 |
| Registro de eventos | **No aplica**: la FAQ §15 NOTA 1 exime al SIF que sólo puede actuar en modo VERI*FACTU. `TipoUsoPosibleSoloVerifactu = S`. Si algún día hay modo NO VERI*FACTU, el registro de eventos pasa a ser obligatorio |
| Firma XAdES del registro | **No aplica** en VERI*FACTU (el propio diseño de registro dice «Obligatorio para conservación y para requerimiento, pero no para remisión») |
| Apagar Holded en un comercio que ya lo tiene | Bloque aparte |
| Declaración responsable, acuerdo de colaboración social | Fuera de código |

### 12.1 Lo que V2 necesitará y este bloque le deja hecho

- El `payload` de cada registro, verbatim y listo para serializar a XML.
- La cadena verificable, para no remitir sobre una cadena rota.
- `fiscal_record_submissions` como el único sitio donde escribir estado de remisión, sin
  tocar `fiscal_records`.
- El interruptor pruebas/producción del QR, que en V2 pasa a ser el mismo que el del
  endpoint de remisión.

---

## Relación con otros documentos

- `docs/design/adr-015-sello-de-la-venta.md` — el sello de la venta. Convive; no se toca.
- `docs/design/adr-018-el-registro-de-jornada-es-inalterable.md` — el patrón de
  inalterabilidad que este bloque copia.
- `docs/legal/posicion-verifactu.md` — **queda revocado** por este bloque; se reescribe en el
  Frente 6.
- `docs/blocks/fichaje-1-plan.md` — el formato de este documento.
