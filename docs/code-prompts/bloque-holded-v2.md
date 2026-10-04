# Bloque holded-v2 · el TPV habla la API v2 de Holded con tokens `pat_`, sin soltar la v1

Rama `holded-v2`, worktree `~/Developer/Claude/Projects/mipiacetpv-holded-v2`, desde `master` = `de86d31`.
Frente C del tablero de dirección. Peldaño 1. Escrito por Dirección el 04-10-2026.

Antes de nada lee, en este orden: `docs/blocks/holded-pat-spike.md` (lo medido contra Holded real el
03-10), `docs/blocks/holded-pat-done.md` (lo que ya está en producción) y
`apps/api/src/holded/clave-rechazada.ts`.

## Por qué existe

Holded ha dado por obsoletas las API Keys v1 («dejarán de funcionar», sin fecha). Todo tenant con
Holded guarda hoy una v1. El spike del 03-10 cerró la vía corta: **un token `pat_` no entra en
`/invoicing/v1/…` con ninguna cabecera**; `pat_` es la API v2, que tiene otras rutas, otro envoltorio
(`{items, cursor, has_more}`), paginación por cursor (y `page` se ignora en silencio), `limit` máximo
100 y errores `application/problem+json`. El bloque `holded-pat` sólo arregló el mensaje del alta:
hoy un `pat_` se rechaza antes de la red y se le pide al implantador una v1.

El día que Holded apague v1, ninguna caja conectada sube un ticket ni baja catálogo. No hay día D
posible: se migra cuenta a cuenta. **El TPV tiene que hablar v1 y v2 a la vez, según la clave de cada
tenant.**

¿Y qué?, para quien lo usa:
1. El día del apagado las cajas siguen cobrando y sincronizando.
2. El implantador da de alta un cliente nuevo con el token que Holded le da hoy (`pat_`), y sabe
   **en el alta** si vale y **qué permiso le falta**, con el nombre del permiso.
3. Mi Piace ve en el super-admin cuántas cuentas quedan en v1: es la lista de trabajo de la migración.
4. La factura de Holded del cliente no sube: con v2 una descarga completa del catálogo cuesta ~5
   veces más llamadas (100 por página frente a 500), y v1 ya cuenta contra una cuota mensual por
   cuenta (PRUEBAS: techo de 5.000/mes; un tenant nuestro gasta hoy ~23.000/mes en sondeo).

## Lo que hay hoy (comprobado por Dirección el 04-10 sobre `de86d31`)

- **Toda** la HTTP con Holded vive en `packages/holded-client/src` (~1.800 líneas): `client.ts`
  (`ApiKeyClient`, `request`, `fetchBinary`, `fetchWithRetry`), y un módulo por recurso
  (`products`, `services`, `contacts`, `taxes`, `warehouses`, `salesreceipt`) que **construye rutas
  v1 y parsea formas v1**. Ningún fichero de `apps/` monta una ruta de Holded (sólo comentarios).
  Esa frontera es la que hace este bloque posible: respétala.
- La cabecera `key:` se fija en **tres** sitios: `client.ts` `request`, `fetchBinary`, y
  `salesreceipt.ts` `getReceiptPdf` (~287-300), que monta su propio fetch.
- `new ApiKeyClient(...)` se instancia en **13** sitios de `apps/api/src` (grep). La interfaz
  `HoldedClient` ya prevé un segundo cliente detrás (comentario de ADR-004).
- `apps/api/src/holded/clave-rechazada.ts` es el único traductor de errores de clave para alta,
  rotación y probe; `esTokenPat()` rechaza el `pat_` antes de la red con `HOLDED_KEY_V1_REQUIRED`.
- El sync incremental (`catalog/incremental-sync.ts`) corre cada 15 min por tenant (repeatable de
  BullMQ, `queues/catalog-incremental.ts`) y **re-descarga todo** cada tick: impuestos, almacenes,
  productos, servicios y contactos paginados hasta array vacío (≥ 8 llamadas por tick).
- Medido el 04-10 en producción (`infra/medir-429-holded.sh`): ningún 429 ha agotado reintentos;
  `ticket-upload` y `refund-upload` no han fallado nunca. Pero el cliente reintenta los 429 en
  silencio (`retry.ts`): un 429 recuperado no deja rastro. Y el sync sigue corriendo cada 15 min
  para un tenant con Holded suspendido (Thalía, 402: 96 fallos al día que llenan la cola de fallidos).
- `HoldedAuthMode` en BD: `API_KEY | OAUTH`. No hay columna con el tipo de clave.

## Paso 0 · spike de formas, contra Holded de verdad (PUERTA)

**Depende de una tarea de Matías:** rehacer el token `pat_` de PRUEBAS con los ámbitos que le
faltaban (`inventory:warehouses.read`, `inventory:products.read`, `sales:services.read`,
`sales:receipts.read`) **y los de escritura** que salen del inventario del spike (§2). Pídeselo como
variable de entorno (`HOLDED_PAT_PRUEBAS`); **nunca** lo pegues en el chat, un fichero, un commit, un
test ni el done. Lo mismo para la v1 de PRUEBAS, que necesitas para comparar lado a lado.

Para cada recurso que el TPV **lee** (warehouses, taxes, products, producto por id, imagen de
producto, services, contacts y sus filtros, sales-receipt por id, PDF del sales-receipt):

1. La misma entidad pedida por v1 y por v2: **diff campo a campo** (nombres, tipos, anidamiento,
   importes —¿céntimos o euros?—, fechas, IVA, variantes, SKU, imagen, `serviceId`). Guarda los
   pares (sin datos personales: es PRUEBAS) como fixtures del paquete.
2. Paginación real: `limit` máximo, cursor, fin de lista, ¿hay filtro por fecha de modificación
   (`updated_after` o similar) en productos, servicios y contactos? Mira el `openapi` oficial **y
   compruébalo con una petición**: la guía ya mintió una vez sobre `page`.
3. Los casos raros que el cliente v1 trata a mano, ¿existen en v2 y cómo se ven?: 402 de suspensión,
   200 con HTML (ruta inexistente), PUT que «acepta» y no guarda (GET-back, ADR-010), el
   `paymentsPending` y la tolerancia de 5 céntimos, el `/pay` idempotente, cabeceras
   `X-RateLimit-*` y `Retry-After`.

Para las **escrituras** (crear sales-receipt, pagarlo, abono, `PUT`/`POST` de producto, crear y
editar contacto): **autorizadas por Matías el 04-10-2026, sólo en la cuenta PRUEBAS MIPIACE**. Ensaya
cada una por v1 y por v2 y compara lo que queda en Holded. Nunca en la cuenta de un cliente. Apunta en
el done qué documentos de prueba has creado (número y fecha), para que se puedan identificar.

**Puerta.** Si v2 no puede hacer algo que el TPV necesita hoy (p. ej. no hay forma de pagar un
sales-receipt, o el ticket pierde un dato que exige Verifactu o la conciliación), **para**: escribe
el hallazgo en `docs/blocks/holded-v2-spike.md`, commit, push, y no sigas. Lo decide Dirección.

## Alcance

### 1 · Un paquete, dos versiones, la misma cara

- Un segundo cliente (`TokenClient` o similar) detrás de `HoldedClient`, con
  `Authorization: Bearer`, el envoltorio de errores `problem+json` y el mismo 402, `fetchWithRetry`
  y `fetchBinary`. **`getReceiptPdf` deja de montar su fetch** y pasa por el cliente: los tres sitios
  de cabecera quedan en uno por versión.
- **Una fábrica** (`createHoldedClient(clave, opts)`) decide la versión por el prefijo de la clave
  (`pat_` → v2; si no → v1). Los 13 sitios de `apps/` cambian `new ApiKeyClient` por la fábrica y
  **nada más**.
- Los módulos de recurso **conservan sus firmas y sus tipos de salida** (`HoldedProduct`,
  `HoldedService`, …). Por dentro despachan por versión: v1 tal cual está; v2 con su ruta, su cursor
  y **un mapeo a la forma que ya consume `apps/`**, sacado de los fixtures del paso 0. Si un campo v1
  no tiene equivalente en v2, se dice en el done y en el tipo, no se rellena inventado.
- Los iteradores (`iterateAllProducts`, `iterateAllServices`, `iterateAllContacts`) paginan por
  cursor en v2. Un cursor que no avanza **corta con error**, no da vueltas.
- **v1 no cambia de comportamiento.** Los tests actuales de v1 siguen en verde sin tocarlos (salvo
  imports); si uno hay que cambiarlo, explica por qué en el done.
- Nada de lo que hay alrededor se toca: GET-back y sus invariantes, tolerancia de 5 céntimos, `/pay`
  idempotente con pre-check, 402, backoff (sólo GET). En v2 se reproducen, no se reinventan.

### 2 · El alta acepta `pat_` y comprueba los permisos

- `esTokenPat()` deja de rechazar: un `pat_` se valida contra v2 en los tres puntos (alta, rotación,
  probe de onboarding/H1), por el mismo traductor único de `clave-rechazada.ts`. Desaparece
  `HOLDED_KEY_V1_REQUIRED`; una v1 sigue entrando igual.
- **Lista canónica de ámbitos** en un solo módulo, sacada del inventario (no a ojo): identificador
  de Holded, nombre que ve el cliente en el panel (si el spike lo pudo ver; si no, dilo), para qué
  lo usa el TPV y si es imprescindible. **Incluye la escritura de productos** (bandeja de SKU hoy,
  espejo del catálogo mañana): no queremos volver a tocar ~40 tokens.
- Comprobación por **sonda de lectura** por recurso (`?limit=1`). El discriminante es el `detail`
  del 403, no el status: `"Insufficient permissions: <ámbito> required."` = falta ese ámbito;
  `"Access denied."` = token rechazado. **Nunca se escribe en el Holded de un cliente para probar un
  permiso**: los de escritura salen como «no comprobable: revísalo en Holded».
- Falta un imprescindible → rechazo con código nuevo (`HOLDED_TOKEN_MISSING_SCOPES`) y la lista de
  los que faltan, con su nombre. Mensaje que dice qué hacer y dónde.
- Las sondas son las mínimas y sólo al conectar: cuentan contra la cuota del cliente.

### 3 · La cuota es requisito, no detalle

- **Mide** llamadas por tick del sync incremental, v1 y v2, contra PRUEBAS, y ponlo en el done.
- **Regla de diseño:** el coste mensual de un tenant en v2 **no puede superar** el de ese mismo
  tenant en v1 hoy. Si v2 filtra por fecha de modificación, el incremental v2 pide sólo lo cambiado
  y la descarga completa pasa a ser rara (decide tú la frecuencia, con el borrado/archivado de
  `archiveMissingProducts` funcionando: es lo que se rompe si sólo pides lo cambiado). Si no filtra,
  el intervalo del sondeo v2 se ajusta para cumplir la regla, y se documenta. **Webhooks no**: son
  otro bloque.
- **Un tenant con Holded suspendido (402) no se sondea cada 15 min.** Que se espacie (o se pause y se
  reanude al recuperar), sin perder el aviso del super-admin que ya lee el 402 de los stats.
- Los 429 reintentados **dejan rastro**: un log estructurado (tenant, ruta, `Retry-After`,
  `X-RateLimit-Remaining` si viene) en `fetchWithRetry`, para que la próxima medida no sea ciega.
  Sin la clave.

### 4 · Ver la migración

- El super-admin ve, por tenant, el tipo de clave (v1 / `pat_` / sin Holded) y en el listado
  cuántos siguen en v1. Si hace falta guardar el tipo en BD: migración aditiva + script idempotente
  de relleno, documentado para correrlo en producción dentro del contenedor (descifra con la misma
  variable que ya usa la API; no vuelca claves ni las loguea).
- La rotación de clave de un tenant v1 a un `pat_` es **el gesto de migrar una cuenta**: tiene que
  funcionar sin re-onboarding, sin duplicar catálogo ni contactos (los ids de Holded, ¿son los mismos
  en v1 y v2? → paso 0) y sin reenviar tickets ya subidos.

### 5 · Implantadores

- `docs/implantadores/checklist-implantacion-tenant.md`: el alta nueva es con `pat_`; cómo se
  genera, qué permisos se marcan (la lista canónica), qué hacer con cada error, y el procedimiento
  para migrar una cuenta v1 existente.

## Respeta

- **H1**: sin clave no se instancia el cliente ni se toca la red.
- **ADR-020 (Dejar Holded)**: la rotación rechaza un tenant desconectado.
- **Abonos** (`upload-refund.ts`), `holded/silencio.ts`, la conciliación diaria y el SIF
  (ADR-019): no cambian de comportamiento.
- El espejo TPV→Holded del catálogo es otro bloque: aquí sólo se pide su permiso.

## Fuera de alcance (declarado)

- Webhooks de catálogo (bloque propio, detrás de éste).
- Rotar las claves de los clientes: trabajo humano posterior, cuenta a cuenta, con la herramienta del §4.
- Apagar v1 en el TPV: no hasta que el listado del §4 marque cero.
- OAuth.

## Cómo se cierra

- Tests unitarios del paquete con los fixtures reales del paso 0 (v1 y v2), e2e de alta, rotación
  v1→`pat_`, probe, sync incremental y subida de ticket+pago+PDF con Holded simulado en las dos
  versiones. Suite entera verde **en CI** (recuerda el mock literal de `catalog.js` y las variables
  que tapa el `.env` de desarrollo).
- **Tabla de sabotajes**: por cada garantía (versión por prefijo; Bearer en los tres sitios; cursor
  que no avanza corta; mapeo v2→forma v1 de cada recurso; `detail` como discriminante del 403;
  ninguna escritura al comprobar permisos; tenant 402 no sondeado cada 15 min; 429 reintentado deja
  log; la clave nunca en un log), qué línea rompes, qué test se pone rojo y con qué mensaje real.
- **Qué NO cubre la suite**, por escrito.
- **Prueba final contra Holded de verdad, en PRUEBAS**: alta con `pat_` completo, con `pat_` sin un
  permiso y con basura; rotación de PRUEBAS de v1 a `pat_` y sync completo sin duplicados; y un
  ticket con cobro mixto subido, pagado y con PDF, y un abono (escrituras autorizadas en PRUEBAS). Lo que
  ve el implantador y lo que queda en Holded, en cada caso. Y el `GET /api/v2/usage` antes y después.
- `docs/blocks/holded-v2-done.md`: hallazgos del spike, el diff de formas, decisiones (**ADR-021**
  en `docs/design/`: dos versiones detrás de una cara, la fábrica por prefijo y la regla de cuota),
  la lista canónica de ámbitos, las llamadas por tick v1 vs v2, la tabla de sabotajes, lo que no
  cubre, el script de relleno (si existe) y cómo se despliega (¿migración? ¿script en producción?).
  El done dice si la rama está pusheada y si hay PR, y actualiza la línea del frente C del tablero.
- Commits pequeños en español, push de la rama y **PR contra `master`**. Ni merges ni despliegues:
  eso lo hace Dirección.
