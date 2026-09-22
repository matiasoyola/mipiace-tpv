# ADR-017 · El catálogo tiene autoridad local

_2026-09-13. Decide de quién es la autoridad sobre una ficha de producto, y cómo existe en
mipiacetpv un comercio que **tiene caja y no tiene Holded**. Es el nivel 2 de la decisión del
05-09 ("Holded es opcional") y el escalón 2 de la independencia de Holded. Sucede a
[ADR-016](./adr-016-la-caja-es-un-modulo.md), que resolvió el nivel 1: la empresa sin caja._

---

## 0. Tesis en una frase

`Product.source` dice **quién manda** sobre cada ficha (`HOLDED` | `LOCAL`) y
`holded_product_id` deja de ser la **identidad** del producto para ser sólo el **enlace** con
el ERP; y como corolario obligado, `Tenant.holdedEnabled` separa "**está previsto** que use
Holded" de "**lo tiene conectado ya**", que hasta hoy eran la misma señal.

## 1. Contexto

El 05-09-2026 se decidió que Mi Piace **no entra en ERP y no será SIF**. Esa decisión tuvo una
consecuencia que se descubrió al tomarla: Holded hacía **dos** trabajos a la vez, el sistema
fiscal y **la autoridad del catálogo**. Al renunciar a lo fiscal, el TPV tiene que quedarse
con lo otro. No es opcional: cualquier sustituto barato de Holded cubre la mitad fiscal, no la
del catálogo.

Traducido a lo que se veía en el código: **un cliente con caja no podía vender nada que no
estuviera en Holded.** `Product.holded_product_id` era `NOT NULL`, el schema titulaba el
bloque *"Catálogo (cache local de Holded)"*, y en el admin no existía ni una ruta de escritura
de producto — la única pantalla bajo "Productos" era la bandeja de SKUs silenciados.

El inventario del acoplamiento (13-09) dejó **tres** puntos de fricción y sólo tres:

1. **La clave de identidad.** `@@unique([tenantId, holdedProductId])` era la clave del sync.
2. **`agenda/checkout.ts`** tipaba `holdedProductId: string` no-nullable.
3. **La rama SERVICE de `upload-ticket.ts`**: un servicio sin `holdedProductId` viajaba a
   Holded sin `serviceId` ni `sku`, Holded lo ponía a `price = 0` y el ticket entero caía por
   mismatch de total, **en silencio**. Ya pasó con Peluquería Sole.

El punto 3 es el que fijó la frontera: **un producto LOCAL nunca debe llegar al payload de
Holded**.

## 2. Lo que NO se decide aquí (frontera dura)

El renombrado a `ErpAdapter` / `externalProductId` / `externalSource` (es el escalón 1 y va en
su propio bloque; aquí se **añade** `source`, no se renombra nada). El **catálogo mixto** con
alta local abierta en un tenant con Holded. **Subir** productos locales a Holded y el
casamiento por SKU al conectarlo. `ProductVariant`, que sigue huérfano. Los comodines
`TPV-OTROS-*`. Y **nada fiscal**: este ADR no acerca ni aleja a mipiacetpv de ser SIF.

## 3. Decisión: `source`, y el enlace deja de ser la identidad

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Rediseñar la clave del sync a `(tenantId, sku)` | El SKU de Holded llega como llega y el cliente lo duplica en su ERP. El sync reventaría al traerlo. |
| Un `holded_product_id` sintético para lo local (`LOCAL-<uuid>`) | Un id falso en la columna del enlace es exactamente lo que un día acaba viajando en un payload a Holded. La ausencia de dato es una garantía; un dato inventado es una bomba. |
| Una tabla `local_products` aparte | Dos tablas que el TPV tendría que unir en cada consulta de catálogo, en el camino de cobro. Y dos sitios donde arreglar cada bug de catálogo. |
| Deducir el origen de `holded_product_id IS NULL` | Funciona hasta el primer producto local que se case con Holded por SKU. Además deja la intención implícita: el código tendría que adivinar en vez de leer. |

**Decisión:** `enum ProductSource { HOLDED, LOCAL }`, columna `source NOT NULL DEFAULT
'HOLDED'`, y `holded_product_id` pasa a **nullable**.

El `DEFAULT` **es** el backfill: desde PG 11 un `ADD COLUMN ... NOT NULL DEFAULT <constante>`
no reescribe la tabla (`pg_attribute.attmissingval`). Medido sobre 200.000 filas: 1,669 ms,
mismo `pg_relation_size` antes y después, `n_tup_upd = 0`.

El `@@unique([tenantId, holdedProductId])` **no se rediseña**: en Postgres un índice único
trata cada NULL como distinto de todos los demás, así que N productos locales conviven bajo
esa constraint. Lo que cambia no es la constraint, es lo que significa la columna.

### 3.1 La unicidad del SKU local vive en el SQL, no en el schema

`CREATE UNIQUE INDEX ... ON products (tenant_id, sku) WHERE source = 'LOCAL'`. Parcial, porque
gobernamos lo que nace aquí y no lo que llega de Holded. **Prisma 5 no sabe declarar un índice
parcial**, así que vive sólo en el SQL de la migración y `schema.prisma` lo documenta en su
sitio.

⚠️ **Consecuencia a vigilar**: `prisma migrate dev` lo verá como deriva y ofrecerá borrarlo.
**No aceptar.** `catalogo-local-migracion.test.ts` guarda el contrato del SQL y es lo único
que se pone rojo si alguien acepta.

### 3.2 `Product.taxRate` es un decimal plano, y de eso depende todo esto

No es una FK a `TenantTax`. Es lo que hace posible el alta local sin tocar nada más, porque
`TenantTax` **se puebla sólo desde el sync de Holded** y en el tenant que nos ocupa está vacía
por definición. Por eso el IVA del alta local es una **lista fija en el código** (21/10/4/0)
con una vía de escape **"otro"** validada: el IGIC canario (7/3/0) y cualquier tipo que cambie
por ley dejarían al cliente parado esperando un despliegue.

**Si algún día alguien convierte `taxRate` en una relación, este bloque se rompe entero.**

## 4. Decisión: `holdedEnabled`, porque "sin clave" significaba dos cosas

Esto no estaba en el prompt del bloque. Salió al comprobar que el criterio 1 ("un tenant sin
Holded y con caja da de alta tres productos, los ve en el TPV y cobra") era **imposible de
cumplir**, por una línea de `apps/admin/src/App.tsx`:

```ts
if (!me.tenant.hasHoldedKey) navigate("/onboarding", { replace: true });
```

ADR-016 abrió la puerta del panel **sólo** para `cajaEnabled === false` — el colegio. El
comercio que tiene caja y no tiene Holded seguía cayendo en la pantalla de "Conectar Holded", y
de ahí no salía. El bloque le daba un catálogo local **al que no podía llegar**.

La raíz es que `!hasHoldedKey` responde a la vez a dos preguntas distintas:

- *"todavía no lo ha conectado"* → está a mitad del onboarding, y el muro es **correcto**.
- *"no lo va a conectar nunca"* → es el cliente de este ADR, y el muro es **un error**.

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Deducirlo de "¿tiene productos LOCAL?" | **Circular**: para crear productos hay que entrar al panel, y para entrar habría que tener productos. |
| Deducirlo de `initialSyncStatus = NOT_APPLICABLE` | Ese estado lo pone el alta sin clave, que es justo el caso ambiguo. Estaríamos deduciendo de la misma señal con otro nombre. |
| Un botón "trabajar sin Holded" en el onboarding del propietario | Decisión de Matías, y es de producto, no técnica: la implantación de Holded es una **venta de Mi Piace**. Poner la salida barata a un clic en la misma pantalla donde se vende es regalarla. Y el cliente que se la marcara por no leer acabaría con catálogo local queriendo el ERP, sin marcha atrás cómoda. |

**Decisión:** `Tenant.holdedEnabled Boolean @default(true) @map("holded_enabled")`, hermana en
forma y en gobierno de `cajaEnabled` (ADR-016 §3.1): **la mueve sólo el super-admin**, y en el
alta. Hoy todas las altas pasan por Matías, así que no añade trabajo real.

### 4.1 La guarda: sólo se apaga sin clave conectada

Apagarlo en un tenant que ya está subiendo tickets dejaría documentos a medias en su
contabilidad y ventas sin subir sin que nadie se enterara. **409 con el motivo**, no un toggle
que obedece. Encenderlo no tiene guarda: es volver al camino de siempre.

### 4.2 El vocabulario, que estaba a punto de colisionar

`onboarding-health.ts` tenía un `usesHolded` que significaba *"tiene clave"*. Ahora son dos
preguntas y se llaman distinto:

| Pregunta | Fuente | Nombre |
|---|---|---|
| ¿Está previsto que use Holded? | `Tenant.holdedEnabled` | `holded.enabled` |
| ¿Lo tiene conectado ya? | `holdedApiKeyCiphertext != null` | `holded.connected` |

Y el alta del super-admin pasa de **dos** opciones a **tres**: "sí, ahora", "sí, más adelante"
y "no lo usa". Las dos últimas eran la misma casilla y necesitan cosas opuestas.

## 5. Decisión: el destino de Holded es un valor de tres estados, no un booleano

El gate único del encolado (`tickets/holded-upload-gate.ts`, que v1.8-Fiado creó) preguntaba
`tenantHasHoldedKey`. Es la misma señal de dos significados, y aquí las dos ramas **hacen** lo
mismo y **no significan** lo mismo:

| `HoldedDestination` | ¿encola? | estado al cobrar | log |
|---|---|---|---|
| `NONE` — no usa Holded | no | `PAID` | info |
| `NOT_CONNECTED_YET` — previsto, sin clave | no | `PAID` | **warning** |
| `READY` — previsto y conectado | sí | `PENDING_SYNC` | — |

La fila del medio es una **anomalía**: un cliente que compró el ERP está cobrando antes de
conectarlo y esas ventas **no llegarán nunca a su contabilidad**. Por eso no comparte la línea
de log con la primera, y por eso hay además un check en la salud del onboarding
(`tickets-before-holded`) que lo canta los días en que nadie mira los logs.

Es un tipo de tres valores y no un `boolean` a propósito: obliga a mirar los tres casos, y un
`if` con dos ramas no puede olvidarse del de en medio sin que el compilador lo cante.

### 5.1 Lo que NO se hace: mandar la fila del medio a `PENDING_SYNC`

Sería lo intuitivo ("que espere y suba cuando llegue la clave"). Pero **no hay sweeper** que
recoja `PENDING_SYNC` — se comprobó al escribir el bloque —, así que el ticket se quedaría ahí
para siempre y arrastraría tres consecuencias visibles para el cliente: no se podría devolver
(`POST /tickets/:id/refunds` exige `SYNCED` o `PAID`), el corte y el Z lo contarían como
incidencia pendiente cada día, y el cliente cerraría en falso.

`PAID` + warning es peor de lo ideal y mejor que todo lo demás. Un sweeper que suba lo cobrado
antes de conectar es un bloque aparte, y tendría que resolver primero la pregunta fiscal de las
fechas pasadas.

## 6. Decisión: forward-only al conectar Holded

Si un tenant con catálogo local conecta Holded después, **no se suben los productos locales ni
los tickets del periodo local**: generaría documentos fiscales con fecha pasada. El histórico
local se queda local y Holded arranca limpio. El `taxRate` local **no se casa** con ningún
`holdedTaxId`.

Lo sostiene la **ausencia de datos**, no la memoria de nadie: al no crear filas `HoldedUpload`
para lo que no sube, no hay nada que un sweeper futuro pueda barrer hacia arriba.

## 7. Las cuatro puertas, y por qué una falla al revés que las otras

1. **El sync no toca lo local** — `initial-sync`, `incremental-sync` y `reconcile` filtran por
   `source = HOLDED` en todo lo que escriben o archivan. Un producto local no puede ser
   archivado por "no estar en Holded": es que nunca estuvo.
2. **El upload nunca ve un producto local** — falla ruidosamente, nunca en silencio con
   `price = 0`.
3. **El alta local se abre si y sólo si `holdedEnabled === false`** (§4).
4. **El TPV vende lo local igual que lo demás** — los tres filtros de `tpv-catalog` (`active`,
   `sellableViaTpv`, `sku` no nulo) valen tal cual.

`lib/caja-gate.ts` es **tolerante** y falla hacia "caja encendida": lo peor que puede hacer es
dejar sin cobrar a quien cobra. `lib/catalogo-local-gate.ts` falla al **revés**, hacia cerrado,
y devuelve **503** (no 403) si no puede comprobarlo. Razón: no está en el camino de cobro —
nadie se queda sin vender porque no pueda dar de alta un producto—, y fallar hacia abierto
crearía un producto local en un tenant con Holded, que es el estado que todo esto existe para
impedir. Un 403 se va; esa fila se queda.

## 8. Consecuencias

**Buenas.** Un comercio con caja puede vender sin ERP. El admin gana la pantalla que enseña el
catálogo que el TPV va a vender — la ceguera que dejó **54 servicios de Peluquería Sole
invisibles durante semanas** en mayo de 2026 no tenía dónde mirarse. Y el tenant con caja y sin
Holded deja de tener la bandeja de errores encendida con todos sus tickets, para siempre.

**A pagar.**

- El **sidebar cambia** para Sole, Cachitos, Thalía y La Maestranza: aparece "Catálogo" y
  "Productos" pasa a llamarse "Revisión de SKU". Es aditivo y no toca cobro, sync ni catálogo.
- El índice parcial vive fuera del schema y `migrate dev` ofrecerá borrarlo (§3.1).
- `holdedEnabled` es **forward-only en la práctica**: apagarlo y volver a encenderlo deja un
  periodo de ventas que no sube. Está avisado en el confirm, en el check de salud y aquí.
- **Al desplegar**: el `DEFAULT true` deja a todos los tenants de hoy exactamente como estaban,
  pero un tenant en DRAFT sin clave que nunca vaya a usar Holded quedará "no listo" hasta que el
  super-admin le apague el interruptor. Se listan con
  `SELECT id, name FROM tenants WHERE holded_api_key_ciphertext IS NULL;`.

## 9. Referencias

- `docs/design/adr-016-la-caja-es-un-modulo.md` — el nivel 1, y el patrón de capability.
- `docs/design/adr-r8-motor-reservas-agnostico.md` y ADR-R6 — capacidades por tenant, no
  verticales clavados.
- `docs/04-stack-y-decisiones.md` §ADR-010 — verificar siempre con GET tras escritura.
- `docs/07-nucleo-comun.md` §2.5 y §2.6 — auto-SKU y comodines.
- `docs/blocks/catalogo-local-done.md` — el cierre del bloque, con la tabla sabotaje → test.
- `docs/code-prompts/bloque-catalogo-local.md` y sus addenda 1, 2 y 3.
