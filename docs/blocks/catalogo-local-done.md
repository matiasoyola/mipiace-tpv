# catalogo-local · el catálogo nace en la BD (Holded opcional, nivel 2) — DONE

_Rama `catalogo-local`. Cierra `docs/code-prompts/bloque-catalogo-local.md` y sus **tres
addenda**. Decide [ADR-017](../design/adr-017-el-catalogo-tiene-autoridad-local.md)._

**No se ha hecho push ni merge: eso lo hace Matías.**

---

## 0 · El incidente, primero, porque afecta a cómo leer este documento

**Dos sesiones de Claude escribiendo el mismo worktree, el 13-09-2026.**

Qué pasó, en orden:

1. La sesión **A** (worktree `mipiacetpv-catalogo-local`, la dueña) llevaba el bloque: prompt
   y addenda 1 y 2 implementados, suite verde, y estaba corriendo el e2e.
2. La sesión **B** (worktree principal, `master`) recibió de Matías el encargo del addendum 3,
   entró en el árbol de A **sin comprobar que estaba ocupado**, corrió la suite, y commiteó el
   trabajo de A en `0f5a113` mientras A tenía ficheros a medio escribir en disco.
3. A lo detectó al volver del e2e, **paró de escribir** y avisó por mensaje.
4. B aceptó retirarse; Matías decidió lo contrario: que B terminara el addendum 3 entero y A
   cerrara. A cerró antes de contestar.

**Qué se solapó de verdad:** el `git add -A -- apps packages` de B sobre el árbol de A. Nada
se perdió — el e2e `catalogo-local.e2e.ts` de A tiene mtime 11:55 y el commit de B es de las
11:54:37, así que aún no existía en disco cuando B hizo el `add`. **Fue suerte de treinta
segundos de reloj, no cuidado.**

**Cómo se detectó:** no por una herramienta. Lo vio A al encontrar en `git log` un commit que
no había escrito.

**Qué queda de eso en este documento.** B firma el done-doc, así que:

- Se **repitieron** todas las mediciones de la migración en vez de heredarlas (§7). Las cifras
  de tamaño que había en los comentarios del SQL no se reprodujeron y están reescritas con las
  medidas de verdad.
- Se revisó el contenido de `0f5a113` antes de construir encima.
- Lo que A tuviera **sólo en memoria** y no en disco (parte de su bucle visual) se perdió al
  cerrar. El bucle visual de §9 se rehízo entero.

**La regla, para que no vuelva a pasar:** un worktree, un escritor. Antes de tocar un árbol
que no es el tuyo, comprobar si hay alguien dentro; y no commitear nunca el árbol de otro.

---

## 1 · Lo que hay ahora

Un comercio **con caja y sin Holded** da de alta sus productos en el TPV, los vende y cobra
con ellos, y el sistema no intenta subir nada a ninguna parte. Antes de este bloque eso era
imposible por partida doble: `Product.holded_product_id` era `NOT NULL` y no existía ninguna
ruta de escritura de producto en el admin; y aunque hubiera existido, **el propietario no
podía llegar a ella**, porque caía en la pantalla de "Conectar Holded" y no salía.

Dos commits en la rama:

| Commit | Qué cierra |
|---|---|
| `0f5a113` | El prompt + addenda 1 y 2: datos, CRUD, las cuatro puertas, y el arreglo del encolado |
| `614d9bd` | El addendum 3: `Tenant.holdedEnabled`, el muro, el predicado de tres estados, el toggle del super-admin |
| (este) | ADR-017, done-doc, capturas y los tres arreglos del bucle visual |

45 ficheros, +5 932 / −110.

### 1.1 La forma final del dato

```
Product.source          ProductSource (HOLDED | LOCAL)  NOT NULL DEFAULT 'HOLDED'
Product.holdedProductId String?                          (era NOT NULL)
Tenant.holdedEnabled    Boolean                          NOT NULL DEFAULT true
+ UNIQUE (tenant_id, sku) WHERE source = 'LOCAL'         (índice parcial, sólo en el SQL)
```

Todo en **una** migración, `20260913000000_catalogo_local`. El bloque despliega una vez.

### 1.2 Las tres preguntas que antes eran una

| Pregunta | Fuente | Quién la usa |
|---|---|---|
| ¿Tiene caja? | `Tenant.cajaEnabled` | H1 / ADR-016 |
| ¿Está previsto que use Holded? | `Tenant.holdedEnabled` | el muro, el alta local, la salud, el encolado |
| ¿Lo tiene conectado ya? | `holdedApiKeyCiphertext != null` | el encolado, el sidebar, la barra de salud |

---

## 2 · Decisiones tomadas sin preguntar, una a una

### 2.1 `source` como enum y no como "`holded_product_id IS NULL`"

Deducir el origen de la ausencia del enlace funciona hasta el primer producto local que se case
con Holded por SKU, y deja la intención implícita. Un enum se lee; una ausencia se adivina.

### 2.2 La clave del sync NO se rediseña

`@@unique([tenantId, holdedProductId])` se queda. En Postgres cada NULL es distinto de todos
los demás, así que N locales conviven bajo esa constraint. Lo que cambia no es la constraint:
es que la columna deja de ser la **identidad** y pasa a ser el **enlace**. Comprobado sobre
filas reales en el e2e, no supuesto.

### 2.3 El índice del SKU local es PARCIAL y vive fuera del schema

Prisma 5 no sabe declarar un `WHERE`. Un `@@unique([tenantId, sku])` a secas haría chocar los
SKU que llegan de Holded —que llegan como llegan, y duplicarlos es problema del cliente en su
ERP— y el sync reventaría al traerlos.

⚠️ `prisma migrate dev` lo verá como deriva y ofrecerá borrarlo. **No aceptar.**
`catalogo-local-migracion.test.ts` es lo único que se pone rojo si alguien acepta.

### 2.4 El SKU se valida además en el handler

El índice parcial no gobierna los NULL (también son distintos entre sí ahí), así que N locales
sin SKU pasarían. El SKU obligatorio es una regla de producto y vive en la ruta.

### 2.5 El IVA del alta local es una lista fija en el código, con vía de escape

`TenantTax` se puebla **sólo** desde el sync, así que en este tenant está vacía por definición
(addendum 2). Cuatro tramos peninsulares (21/10/4/0) más **"otro"** validado: el IGIC canario
(7/3/0) o cualquier tipo que cambie por ley dejarían al cliente parado esperando un despliegue.
Y no sólo un campo libre, porque teclear `2,1` en vez de `21` se cobraría mal en todos los
tickets hasta que alguien lo notara, y el papel no lo canta.

### 2.6 La puerta del alta local falla al REVÉS que la de la caja, y con 503

`caja-gate.ts` es tolerante y falla hacia "caja encendida": lo peor que puede hacer es dejar
sin cobrar a quien cobra. Aquí es al contrario, porque **esto no está en el camino de cobro**
—nadie se queda sin vender porque no pueda dar de alta un producto— y fallar hacia abierto
crearía un producto local en un tenant con Holded, que es el estado que el bloque entero existe
para impedir. Un 403 se va; esa fila se queda.

Y devuelve **503**, no 403, cuando no puede comprobarlo: decirle "tu comercio tiene Holded"
cuando lo que pasa es que la base no contesta sería mentirle.

### 2.7 El alta local se abre por el INTERRUPTOR, no por la ausencia de clave

Esto **cambia** lo que decía el §3 del prompt ("si el tenant tiene Holded conectado"), y el
addendum 3 lo dice explícitamente. Es más estricto: el que usa Holded y aún no lo ha conectado
está a mitad de su onboarding, y dejarle crear productos locales le fabricaría el catálogo
mixto que este bloque impide, justo el día antes de conectar su ERP.

### 2.8 El destino de Holded es un valor de TRES estados, no un booleano

Detalle en ADR-017 §5. La razón de que sea un tipo y no un `if`: obliga a mirar los tres casos,
y dos ramas no pueden olvidarse del de en medio sin que el compilador lo cante.

### 2.9 El cobro sin conectar NO va a `PENDING_SYNC`

Lo intuitivo sería "que espere y suba cuando llegue la clave". **No hay sweeper** que recoja
`PENDING_SYNC` — se comprobó —, así que el ticket se quedaría enterrado: no se podría devolver
(`POST /tickets/:id/refunds` exige `SYNCED` o `PAID`), y el corte y el Z lo contarían como
incidencia pendiente cada día. `PAID` + warning es peor de lo ideal y mejor que todo lo demás.

### 2.10 `taxes-ratio` se muda de `caja` a `holded`

`TenantTax` sólo lo puebla el sync, así que en un comercio sin Holded tiene cero filas por
definición: el check no medía su salud, medía la existencia del sync.

**Lo que hay que vigilar al mudarlo**, y tiene test propio: cambia **quién** bloquea a la
empresa a mitad de onboarding. Antes la bloqueaba `taxes-ratio` con sus cero taxes; ahora la
bloquea `sync-done`, que pasa a aplicarle. Sigue sin poder activarse — que es lo que importa —
pero por el check que lo dice de verdad.

### 2.11 El check de cobros huérfanos se cuenta con `$queryRaw`

No hay relación Prisma entre `Ticket` y `HoldedUpload`: se casan por `external_id`, pero las
filas de tipo `REFUND` apuntan al externalId del **abono**, que no es ningún ticket. Declarar la
relación generaría una FK que reventaría esas filas.

Y no vale contar `status = 'PAID'` a secas: un fiado saldado en un tenant conectado pasa por
`PAID` mientras su upload está en cola, y saldría como falso positivo. Hace falta el
`NOT EXISTS`. Hay un e2e que lo demuestra en las dos direcciones.

### 2.12 `holdedEnabled` NO es un módulo

Fuera de `MODULE_FIELDS`: no entra en el invariante "al menos un módulo encendido". Una empresa
con caja y sin Holded es una empresa completa, no una empresa vacía.

### 2.13 El alta del super-admin pasa de dos opciones a TRES

"No, sin Holded" significaba a la vez *"lo conectará más adelante"* y *"no lo va a usar
nunca"*, y esas dos empresas necesitan cosas opuestas. Ahora: **"sí, ahora"** / **"sí, más
adelante"** / **"no lo usa"**.

De regalo, se corrige un texto que ya era **falso antes de este bloque**: la opción "sin
Holded" decía *"ni se le pedirá conectarlo al propietario"*, y era exactamente lo que sí pasaba
— el muro de `/onboarding`.

### 2.14 La entrada "Productos" se renombra y cambia de capability

Pasa a **"Revisión de SKU"** (es la bandeja de SKUs que Holded silenció, no un CRUD) y su
capability de `caja` a `holded`. Sin Holded no puede tener ni una fila, y su texto entero habla
de Holded.

### 2.15 Fuera de alcance, arreglado porque está en el camino

- **`shouldEnqueueHoldedUpload` decidía sólo por `TicketStatus`.** Un tenant con caja y sin
  Holded —que existe desde H1— cobraba bien, se le creaba la fila `HoldedUpload`, se encolaba el
  job y `uploadTicket` lo tumbaba con `no_holded_key` → `SYNC_FAILED`. Vendía perfectamente y
  tenía la bandeja de errores encendida con todos sus tickets, para siempre. Y eran **cuatro**
  los caminos que encolaban, no dos: mesa y devolución no pasaban por el gate.
- **La barra roja "Holded está desconectado"** se le pintaba a diario al comercio que no ha
  comprado el ERP. Misma mentira que H1 le quitó al colegio, servida por el otro lado.
- **"Sync Holded"** seguía en el sidebar de ese comercio (§9).
- **`agenda/checkout.ts`** tipaba `holdedProductId` como no-nullable. Resuelto de verdad, no
  silenciado con un `!`.

---

## 3 · Sabotaje → test rojo

Cada fila: se rompe la guarda a mano y se mira qué test lo caza.

| Sabotaje | Test que se pone rojo |
|---|---|
| `DEFAULT 'LOCAL'` en la columna `source` | `catalogo-local-migracion.test.ts` · "NO nace nada como LOCAL" |
| Quitar el índice único parcial del SQL (lo que ofrece `migrate dev`) | `catalogo-local-migracion.test.ts` · "crea el índice PARCIAL" + e2e "rechaza dos SKU locales iguales" |
| `DEFAULT false` en `holded_enabled` | `catalogo-local-migracion.test.ts` · "el interruptor NO nace apagado" |
| Quitar el filtro `source = HOLDED` del reconcile | `catalogo-local-sync-no-toca.test.ts` + e2e "un catálogo mixto sobrevive a una conciliación" |
| Dejar que un producto LOCAL entre en el payload de Holded | `catalogo-local-upload.test.ts` |
| Abrir el alta local por `!hasHoldedKey` en vez de por el interruptor | `catalogo-local-crud.test.ts` · "403 TAMBIÉN si usa Holded y todavía NO lo ha conectado" |
| **Apagar el interruptor a mano en un tenant con clave** | `h1-alta-sin-holded.test.ts` · "EL SABOTAJE: apagarlo con la clave puesta → 409" |
| Mover la comprobación de `holdedEnabled` detrás de la de la clave en `App.tsx` | `catalogo-local-muro-onboarding.test.tsx` · "el interruptor manda sobre la clave" |
| Escribir `!holdedEnabled` en vez de `=== false` (en el gate, el muro o el destino) | `catalogo-local-encolado.test.ts` · "un tenant sin la columna se comporta como el de siempre" + `catalogo-local-muro-onboarding.test.tsx` · "sin el campo se comporta como master" |
| Mandar `NOT_CONNECTED_YET` a `PENDING_SYNC` | `catalogo-local-encolado.test.ts` · "el que aún no ha conectado TAMPOCO va a PENDING_SYNC" |
| Unificar los dos logs ("son el mismo caso") | `catalogo-local-encolado.test.ts` · "los dos motivos NO comparten la línea" |
| Contar los cobros huérfanos con `status = 'PAID'` a secas | e2e · "el falso positivo que el NOT EXISTS evita" |
| Meter `holdedEnabled` en `MODULE_FIELDS` | `h1-alta-sin-holded.test.ts` · "NO es un módulo" |
| Dejar `editable: p.source === "LOCAL"` sin mirar la puerta | `catalogo-local-crud.test.ts` · "un producto LOCAL de antes sale editable:false" |
| Dar de alta sin SKU por la API | `catalogo-local-crud.test.ts` + e2e, los tres casos (sin campo, vacío, espacios) |

**El sabotaje obligatorio del addendum 3, hecho a mano además del test:** con un tenant con
`holdedApiKeyCiphertext` puesto, `PATCH /super-admin/tenants/:id { holdedEnabled: false }`
devuelve `409 HOLDED_ENABLED_HAS_KEY` y la fila **no** cambia. El botón del detalle además sale
deshabilitado, pero eso es cortesía: la puerta es el 409.

---

## 4 · Lo que la suite NO cubre

- **Holded de verdad.** Ni una llamada real. El criterio 4 se demuestra con que los caminos de
  Holded no cambian de comportamiento, no con una cuenta viva.
- **La migración sobre las bases de producción.** Se midió sobre una réplica del schema real
  con 200.000 productos, no sobre los datos de Sole.
- **El TPV pintando un producto local.** El e2e comprueba que sale por
  `/tpv/catalog/products` y que se cobra; que la grid lo pinte bien no lo mira nadie
  automáticamente.
- **El día que un tenant local conecte Holded.** El forward-only está escrito y el código no
  intenta subir nada, pero el casamiento por SKU es otro bloque y no hay test de algo que no
  existe.
- **Concurrencia sobre el índice parcial.** Dos altas simultáneas con el mismo SKU: la segunda
  recibe el `P2002` y se traduce a 409, pero no hay test de carrera real.
- **El bucle visual no es un test de regresión.** Las capturas son de un momento; nadie las
  compara automáticamente en el siguiente commit.

---

## 5 · Criterio de "funciona" — las cinco frases

| # | Frase | Dónde se demuestra |
|---|---|---|
| 1 | Un tenant sin Holded y con caja da de alta tres productos con SKU, los ve en el TPV y cobra | e2e `catalogo-local.e2e.ts` §"criterio 1", tres tests |
| 2 | Ese ticket no intenta subir nada, y se ve en los logs que no lo intenta | e2e §"criterio 2" (cero jobs, cero filas `HoldedUpload`, estado `PAID`) + `catalogo-local-encolado.test.ts` para la línea de log |
| 3 | El sync incremental deja intactos los productos locales | `catalogo-local-sync-no-toca.test.ts` + e2e §"criterio 3", incluido el caso de un set vivo vacío |
| 4 | Un tenant con Holded se comporta exactamente igual que antes | e2e §"criterio 4" + `catalogo-local-encolado.test.ts` ("con destino READY, el comportamiento de siempre") + la suite entera, que no cambió de expectativas en ningún camino de Holded |
| 5 | Dar de alta sin SKU es imposible por interfaz y por API | `catalogo-local-crud.test.ts`, `catalogo-local-pantalla.test.tsx` y e2e §"criterio 5" |

**El criterio 1 era imposible de cumplir antes del addendum 3** y eso es lo que lo justifica:
el muro de `/onboarding` dejaba al comercio fuera de su propio panel.

**Sobre el criterio 4, y hay que decirlo:** el **sidebar SÍ cambia** para Sole, Cachitos,
Thalía y La Maestranza. Les aparece "Catálogo" y "Productos" pasa a llamarse "Revisión de SKU".
El criterio 4 se refiere a **cobro, sync y catálogo**, y esos no se tocan; la pantalla es
aditiva. Pero el cambio del sidebar es real y se avisa aquí en vez de descubrirse en un
WhatsApp.

---

## 6 · El alcance por encima del prompt, y por qué se acepta

El addendum 3 entero (la columna, el muro, el toggle, el predicado de tres estados) está **por
encima del prompt original**, y Matías lo sabe. Se acepta porque:

1. Sin ello el criterio 1 es imposible.
2. Todo está puesto **detrás de "no usa Holded"**, así que el criterio 4 sigue en pie.

Lo segundo se demuestra, no se afirma: un tenant con `holdedEnabled = true` (el default, y lo
que tienen los cinco de producción) recorre exactamente las mismas ramas que antes en el
encolado, el estado del ticket, el muro de entrada, la salud del onboarding y la puerta del
alta local. Los tests de cada una llevan su caso "READY" / "como master" al lado del caso nuevo.

---

## 7 · Las mediciones, repetidas para este documento

No se heredaron del frente anterior: se volvieron a tomar sobre una réplica creada para esto
(`mipiacetpv_medicion2`, PostgreSQL **16.13**, schema real del proyecto con las migraciones
anteriores desplegadas, **5 tenants** y **200.000 productos**).

| Sentencia | Tiempo | `pg_relation_size` antes → después |
|---|---|---|
| `ALTER TABLE products ADD COLUMN source ... DEFAULT 'HOLDED'` | **1,669 ms** | 31 506 432 → 31 506 432 |
| `ALTER TABLE products ALTER COLUMN holded_product_id DROP NOT NULL` | **0,946 ms** | — |
| `CREATE UNIQUE INDEX ... WHERE source = 'LOCAL'` | **32,754 ms** | índice de 8 192 bytes (una página) |
| `ALTER TABLE tenants ADD COLUMN holded_enabled ... DEFAULT true` | **2,507 ms** | 8 192 → 8 192 |

Y lo que de verdad prueba que no hubo rewrite:

- `pg_attribute.atthasmissing = t`, `attmissingval = {HOLDED}` y `{t}` respectivamente.
- `pg_stat_user_tables.n_tup_upd = 0` en **las dos** tablas: ni una fila actualizada.
- Las 200.000 filas viejas leen `source = 'HOLDED'` sin haber sido tocadas.

El tamaño absoluto depende del ancho de fila con el que se rellene la réplica, así que lo que
demuestra la ausencia de rewrite no es el número: es que antes y después coinciden **al byte**
con `n_tup_upd` en cero. Los comentarios del SQL llevaban cifras de tamaño que no se
reprodujeron; están reescritas con éstas.

---

## 8 · Al desplegar

```sql
-- 1 · el backfill ES el default; los cinco de hoy tienen que salir así:
SELECT id, name, source IS NOT NULL AS tiene_source FROM products LIMIT 5;
SELECT count(*) FROM products WHERE source <> 'HOLDED';   -- tiene que ser 0
SELECT count(*) FROM tenants  WHERE holded_enabled IS NOT TRUE;  -- tiene que ser 0

-- 2 · el índice parcial tiene que existir. Si algún `migrate dev` lo borró,
--     esto sale vacío y el SKU local deja de ser único:
SELECT indexdef FROM pg_indexes WHERE indexname = 'products_tenant_id_sku_local_key';

-- 3 · a quién hay que revisarle el interruptor a mano (§8.1):
SELECT id, name, onboarding_state FROM tenants WHERE holded_api_key_ciphertext IS NULL;
```

### 8.1 El repaso manual que hay que hacer una vez

`holded_enabled` nace en `true` para todo el mundo, que es lo correcto para los cinco tenants
vivos. Pero un tenant **en DRAFT y sin clave que nunca vaya a usar Holded** —el colegio de H1—
quedará **"no listo"** hasta que el super-admin le apague el interruptor desde su detalle. No
rompe nada de un tenant ya activo; sólo bloquea su activación, que es reversible con un clic.

La consulta 3 de arriba los lista. Hoy, en producción, se espera que devuelva **cero filas**:
los cinco tenants tienen Holded conectado. **Si devuelve alguna, hay que decidir uno a uno** si
es "lo conectará más adelante" (se deja encendido) o "no lo usa" (se apaga).

### 8.2 Lo que NO hace falta

Ni reindexar, ni re-sincronizar, ni tocar ningún cron. Ninguna columna se ha renombrado y
ningún job ha cambiado de forma.

---

## 9 · Bucle visual

Chrome vía `playwright-core` en el scratchpad (**no entra en el repo**) contra la pantalla del
admin **de verdad**, con la API interceptada en la capa de red (`page.route`) — así no hay
fixtures de admin que mantener. A **1280×800, 390 y 320**, DPR 1. Capturas en
`docs/blocks/catalogo-local-shots/`.

| Captura | Qué enseña |
|---|---|
| `catalogo-local-listado-1280 · -390 · -320` | El comercio del bloque: cinco fichas locales con SKU, IVA, etiquetas y precio en `tabular-nums`; el inactivo dice **por qué** no aparece en el TPV. Ni una palabra de Holded en toda la pantalla, ni en el sidebar |
| `catalogo-local-vacio-1280 · -390 · -320` | El estado vacío: "Tu catálogo todavía está vacío" con **un** solo "Nuevo producto" |
| `catalogo-local-error-1280 · -390` | La carga que falla: el aviso, y **nada más** girando debajo |
| `catalogo-local-alta-1280 · -390 · -320` | El formulario, que no es un modal y convive con la lista: SKU propuesto y editable, los cuatro tramos de IVA con "Otro…", precio con coma |
| `catalogo-holded-solo-lectura-1280 · -390 · -320` | El tenant CON Holded: sin botón de alta, el motivo escrito en la pantalla ("se edita allí y se sincroniza aquí cada 15 minutos"), y los dos productos que el TPV no vende con la razón en rojo — que es para lo que existe esta pantalla (addendum 1) |

**Lo que el bucle cambió, y que ningún test habría cogido:**

1. **"Sync Holded" seguía en el sidebar del comercio sin Holded.** Es una sección cuyo único
   botón fuerza una sincronización que no existe, en una pantalla que le habla de un ERP que no
   ha comprado. Su capability pasa de `caja` a `holded`.
2. **El listado pintaba "Editar" en productos locales que el servidor rechaza con 403.** Pasa
   en un comercio que arrastra locales de antes y al que luego se le enciende Holded. `editable`
   pasa a mirar **las dos** condiciones que mira el PATCH: que la ficha sea local **y** que la
   puerta esté abierta. El botón es cortesía y el 403 es la puerta, pero una cortesía que miente
   es peor que no tenerla.
3. **Al fallar la carga se veían el aviso rojo Y un "Cargando catálogo…" girando, para
   siempre.** `data` seguía en `null` y las dos ramas del render no se excluían. Quien lo viera
   entendería que todavía está intentándolo.
4. **El catálogo vacío enseñaba dos "Nuevo producto"**, el de la barra y el de la tarjeta, uno
   encima del otro en una pantalla donde no hay nada más.
5. **A 320 px el código de barras se partía por la mitad** (`8 412345678905`). Un EAN partido
   no se puede leer ni teclear. La línea se parte **entre** campos, no dentro.

Los cinco tienen su arreglo en el tercer commit; 2 y 4 llevan test propio, 1/3/5 son de
presentación y viven en las capturas.

---

## 10 · Estado de la suite

```
pnpm test            (desde la raíz)   203 ficheros · 1991 tests · 3 skipped · verde
pnpm test:e2e        (Postgres real)     8 ficheros ·  110 tests · verde
tsc --noEmit         api y admin        limpio
```

El e2e necesita `E2E_DATABASE_URL` y **hace DROP SCHEMA**: base desechable y propia, nunca la
de desarrollo de nadie.

---

## 11 · Frontera (no se ha cruzado)

- **Nada fiscal.** Este bloque no acerca ni aleja a mipiacetpv de ser SIF.
- **El renombrado a `ErpAdapter` / `externalProductId` / `externalSource`** — escalón 1, su
  propio bloque. Aquí se **añade** `source`; no se renombra nada.
- **Catálogo mixto** con alta local abierta en un tenant con Holded.
- **Subir productos locales a Holded** y el casamiento por SKU al conectarlo.
- **Un sweeper que suba lo cobrado antes de conectar Holded**: bloque aparte, y tendría que
  resolver primero la pregunta fiscal de las fechas pasadas.
- `ProductVariant` sigue huérfano. Los comodines `TPV-OTROS-*` siguen igual. La bandeja de
  revisión de SKU no se ha tocado por dentro.

---

## 12 · Lo que falta para el siguiente escalón

1. **El casamiento por SKU** el día que un tenant local conecte Holded. Hoy es forward-only y
   está garantizado por la **ausencia de datos** (no se crean filas `HoldedUpload` para lo que
   no sube), no por acordarse.
2. **El `taxRate` local no se casa** con ningún `holdedTaxId`. Anotado en ADR-017 §3.2, con el
   aviso de que convertir `Product.taxRate` en una relación rompería este bloque entero.
3. **El catálogo mixto** y su conversación de producto.
4. **Que el TPV pinte bien un catálogo local** — el e2e llega hasta el cobro; la grid no la
   mira nadie automáticamente.
