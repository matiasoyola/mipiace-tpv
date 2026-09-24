# ADR-019 · Cada caja es un SIF y el registro nace al cobrar

_2026-09-24. Decide cómo mipiacetpv emite facturas simplificadas conformes al RD 1007/2023
y a la Orden HAC/1177/2024 para los comercios que no usan Holded. Bloque V1-verifactu._

---

## 0. Tesis en dos frases

**Cada caja registradora es una instalación de sistema informático de facturación**, con su
serie, su numeración y su cadena de registros encadenados por huella.

**El registro de facturación nace en el dispositivo, en el momento de cobrar**, y viaja
dentro de la venta; el servidor lo verifica y lo guarda tal cual, sin recomponerlo.

## 1. Contexto

`docs/legal/posicion-verifactu.md` (2026-06) sostenía que mipiacetpv **no es un SIF** porque
la factura la hace Holded. Esa posición se apoyaba en una premisa que dejó de ser cierta:
desde `catalogo-local` (2026-09) hay comercios con `holdedEnabled = false`. Para ellos la
factura no la hace nadie.

Decisión de Matías (2026-09-23): mipiacetpv cumple la ley entera como SIF. Sin eso, ni el
autónomo sin Holded puede facturar, ni Holded nos va a incluir nunca como integración.

Dos plazos, y no son el mismo:

- **El del comercio.** RDL 15/2025: 01-01-2027 para quien declare Sociedades, 01-07-2027 para
  el resto. Hay tiempo.
- **El nuestro.** Desde el 29-07-2025 un productor de SIF sólo puede ofrecer producto
  adaptado. No hay tiempo, y por eso esto se hace ahora.

`docs/design/adr-015-sello-de-la-venta.md` §2 decía explícitamente que **no** se hace
encadenamiento entre registros. Ese ADR no se borra: el sello sigue protegiendo el dato
económico y lo hace bien. Lo que cambia es la frontera, y la cambia este ADR.

## 2. Decisión 1 · una cadena por caja

Cada `Register` tiene:

- `fiscal_series` — la serie de sus facturas simplificadas (`C1`, `C2`…).
- `fiscal_installation_id` — el `NumeroInstalacion` del diseño de registro de la AEAT.
- Y su propia cadena en `fiscal_records`, numerada por `chain_index`.

### Por qué

La FAQ de desarrolladores de la AEAT (4-12-2025, §2) define un SIF por la terna
`(NIF del productor; Id.SIF; NúmeroInstalación)` y dice, sobre ese último campo:

> El Nº de instalación es una forma de completar una identificación unívoca de cada SIF —por
> si tuviera varios— de un mismo OEF (…) **no puede repetirse nunca**: por ejemplo, incluso si
> se formatea el ordenador donde estaba instalado un SIF y se reinstala el mismo software de
> nuevo en ese mismo ordenador, el nuevo SIF así constituido debe llevar otro nº de
> instalación diferente al anterior.

Y sobre los comercios con varios puntos de facturación:

> Ha de tenerse en cuenta que si se utiliza un SIF que permite llevar distintas facturaciones,
> como contempla el artículo 7.a) del RRSIF, **cada una de esas facturaciones distintas** (sean
> de distintos OEF o del mismo OEF pero de distintos centros de facturación independientes,
> como tiendas) **debe tener un nº de instalación propio y distinto al resto** (pasado,
> presente o futuro) porque se consideran SIF distintos.

Una caja de un TPV es exactamente eso: un punto que expide sus facturas de forma
independiente, también cuando no hay red.

### La identidad cuelga de la CAJA, no del dispositivo

Si el `NumeroInstalacion` colgara de la tablet, cambiar de tablet partiría el SIF en dos y la
cadena tendría que empezar de cero. Colgando de la caja, un dispositivo nuevo pregunta por
dónde iba la caja (`GET /tpv/fiscal/head`) y continúa.

Esto exige que **una caja tenga un solo dispositivo activo a la vez**. No lo tenía: hasta este
bloque `POST /devices/pair` creaba el device sin revocar los anteriores. Ahora lo garantiza un
índice único parcial, y emparejar uno nuevo revoca el anterior en la misma transacción,
dejando traza de quién revocó a quién.

### El contador no es una columna

Es el último registro de una tabla append-only. Una columna `fiscal_counter` sería una segunda
verdad que puede separarse de la cadena sin que nada lo note; lo que garantiza que no hay
huecos ni repetidos es el índice único sobre `(register_id, serie, numero)`.

## 3. Decisión 2 · el registro nace en el dispositivo

Al pulsar Cobrar, la tablet asigna el número, calcula la huella encadenada, compone el QR y
mete el registro **dentro del cuerpo** del `POST /tickets`.

### Por qué en el dispositivo

La misma FAQ, §5, sobre arquitecturas TPV + backoffice:

> Que el registro de facturación, en general, esté **íntegramente producido en el momento de
> generar la factura y el código QR y entregarla al cliente** o de forma simultánea e
> inmediata.

Y admite expresamente nuestra arquitectura:

> Igualmente sería válida una [arquitectura en la que] (…) la TPV genere el Registro
> directamente, procediendo también a su impresión con el código QR y entrega al cliente, y en
> tiempo real traslade todo ello al backoffice central, para que este último sistema proceda a
> su envío a la sede electrónica en la modalidad VERI\*FACTU.

### Por qué DENTRO de la venta y no en una llamada aparte

> De esta manera, no pueden quedar facturas expedidas ni registros de facturación (RF)
> generados, es decir, **no puede haber facturas expedidas sin sus RF generados, ni RF
> generados sin sus correspondientes facturas expedidas**.

Un registro y su factura son el mismo acto. Van en la misma transacción o no va ninguno.

### Por qué el servidor no lo recompone

> No sería acorde a la normativa la producción de los registros de facturación por parte de la
> TPV y **un reproceso posterior de los mismos (que los altere) desde el servidor Back Office
> central** para su conservación u otro fin.

El servidor verifica y guarda el `payload` byte a byte. Lo que no encadena se marca y se ve;
nunca se descarta ni se arregla.

## 4. Alternativas descartadas

### 4.1 El registro se genera en el servidor

**Descartada porque exige red para cobrar.**

La AEAT la admite —«se genere el registro de facturación en el Back Office, desde el que se
envíe y se devuelva una vez generado a la TPV para que sea esta la que lo imprima y entregue
al cliente con el QR»— pero sólo «siempre que la conexión sea en tiempo real».

mipiacetpv cobra sin red por diseño desde v1.5, y esa garantía se pagó con un outbox, un lock
multi-pestaña y una idempotencia por `externalId`. Renunciar a ella para cumplir una norma que
no lo pide es pagar dos veces.

El coste de no hacerlo: el TPV tiene que saber calcular SHA-256 (WebCrypto), llevar su propia
cabeza de cadena y poder imprimir sin red. Las tres cosas están hechas en este bloque.

### 4.2 Una cadena por comercio

**Descartada porque exige red para encadenar.**

Con una sola cadena, dos cajas cobrando a la vez tendrían que coordinarse para saber cuál va
detrás de cuál. Sin red no hay coordinación posible, y con red la habría que serializar contra
el servidor en el camino crítico del cobro.

Además contradice la FAQ: cada punto de facturación independiente es un SIF con su propio
número de instalación, y un SIF distinto es una cadena distinta.

### 4.3 Guardar el QR en la base de datos

**Descartada.** El QR se reconstruye al imprimir con los mismos cuatro datos del registro. Si
se guardara, la misma URL viviría en dos sitios y podrían separarse.

### 4.4 Una vía de corrección como la de S1 y F1

**Descartada, y su ausencia es la decisión.** `record_ticket_correction` (ADR-015) y
`record_time_entry_correction` (ADR-018) existen porque un importe mal tecleado y una hora
olvidada son errores humanos que hay que poder arreglar dejando traza.

Un registro de facturación no se arregla: se anula y se emite otro. Lo dice la norma, y es la
razón de ser del registro de anulación. `fiscal_records` es append-only sin puertas.

## 5. Consecuencias

**A favor**

- Un autónomo sin Holded puede facturar conforme a ley desde el primer cobro, con y sin red.
- Cumplimos como productor de SIF, que es la condición para que Holded nos integre.
- La verificación de la cadena vive en el motor (`sha256()` de Postgres 16): no depende de que
  la aplicación se porte bien.

**En contra / a vigilar**

- **Un comercio con dos cajas emite dos series.** Es correcto y es lo que la norma quiere, y
  hay que explicárselo al cliente en la implantación: sus facturas no van 1, 2, 3 sino C1/1,
  C2/1, C1/2…
- **Una caja tiene un dispositivo activo.** Quien hoy tenga dos tablets en la misma caja tiene
  que elegir. La migración no lo decide por él: aborta y dice cuál es la caja.
- **El número se gasta al generarlo.** Si el servidor rechaza la venta para siempre, ese número
  no vuelve: se cierra con un registro de anulación. Dos facturas con el mismo número es peor
  que un hueco.
- **El TPV depende de `crypto.subtle`.** Está en Node 18+ y en toda WebView moderna, pero es
  una dependencia nueva del camino de cobro y hay que comprobarla en cada terminal que se
  despliegue.
- **Sin remisión, el QR apunta al entorno de pruebas.** Un cliente que cotee su factura hoy no
  la encontrará. Pasar a producción es V2, y es una variable de entorno.

## 6. Lo que este ADR NO decide

La remisión a la AEAT y sus reintentos (V2), las facturas rectificativas y las devoluciones
(V3), la factura completa del art. 7.2/7.3, y la declaración responsable del SIF — que es un
documento, no código, y cuyos datos tienen que coincidir literalmente con las constantes de
`packages/verifactu/src/productor.ts`.

## Relación con otros documentos

- `docs/design/adr-015-sello-de-la-venta.md` — el sello de la venta. Convive intacto; su §2
  queda superado por este ADR en lo que dice sobre el encadenamiento.
- `docs/design/adr-018-el-registro-de-jornada-es-inalterable.md` — el patrón de
  inalterabilidad que este bloque copia.
- `docs/legal/posicion-verifactu.md` — la posición frente a Verifactu, reescrita por este
  bloque.
- `docs/blocks/verifactu-1-plan.md` — el plan, con las fuentes de la AEAT citadas.
