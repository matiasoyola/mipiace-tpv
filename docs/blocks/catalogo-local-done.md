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

Cuatro commits en la rama:

| Commit | Qué cierra |
|---|---|
| `0f5a113` | El prompt + addenda 1 y 2: datos, CRUD, las cuatro puertas, y el arreglo del encolado |
| `614d9bd` | El addendum 3: `Tenant.holdedEnabled`, el muro, el predicado de tres estados, el toggle del super-admin |
| `d8799ab` | ADR-017, done-doc, capturas del admin y los cinco arreglos de su bucle visual |
| (este) | El bucle visual de la **rejilla del TPV** y sus dos arreglos (§9.2) |

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
| **(§13)** Quitar el gate de `getCachedHoldedEnabled()` del selector de clientes | `client-picker-holded.test.tsx` · "NI UNA petición a /contacts/search" + "no aparece NADA de Holded" |
| **(§14)** Devolver la entrada "Cliente" al menú del ticket sin su puerta | `catalogo-local-contact-sheet.test.tsx` · "la entrada «Cliente» no está en el menú" |
| **(§14)** Quitar las DOS puertas (la entrada Y el render del `ContactSheet`) | el de arriba **+** "se pulsa TODO el menú y el sheet no aparece por ninguna" |
| **(§14)** Devolver el botón "Fiado" sin mirar el interruptor | `catalogo-local-contact-sheet.test.tsx` · "el botón «Fiado» se va con él" |

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
- **La rejilla del TPV como test de regresión.** Ya está mirada — el bucle visual del §9.2
  cubre la rejilla local, la mixta, los dos catálogos vacíos y el ticket con una línea local —
  pero son capturas de un momento: nadie las compara automáticamente en el siguiente commit.
  Lo que sí tiene test es el flag del que depende la frase (`catalogo-local-tpv.test.ts` y
  `h1-caja-al-tpv.test.ts`).
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

### 9.2 · Segundo bucle: la REJILLA DEL TPV con catálogo local

Decisión de Matías: era la mitad visual del criterio 1 y estaba sin mirar. Misma receta, contra
el TPV de verdad (`:5174`), entrando por el **modo prueba** — el único camino que no pide
emparejar un dispositivo ni teclear un PIN.

⚠️ **Detalle de la receta que costó media hora**: el TPV registra un **service worker** en dev
(`VitePWA.devOptions.enabled`), y un SW se salta `page.route`. Las peticiones del catálogo
salían a la red real y volvían 401, así que la rejilla aparecía vacía de forma intermitente. El
contexto se abre con `serviceWorkers: "block"`.

| Captura | Qué enseña |
|---|---|
| `tpv-local-rejilla-1280 · -390 · -320` | La rejilla del comercio del bloque: ocho fichas locales, **ninguna con imagen** —que es el caso normal, el alta local no pide foto— con su banda de color por categoría, el nombre a dos líneas con elipsis y el precio en `tabular-nums` pesando más que el nombre |
| `tpv-mixto-rejilla-1280 · -390 · -320` | Locales y de Holded en la MISMA rejilla. Se ven **exactamente iguales**, y es lo correcto: al cajero el origen de la ficha no le sirve para nada. El TPV no filtra ni distingue por `source` |
| `tpv-vacio-local-1280 · -390` | El catálogo vacío del comercio local: *"Todavía no hay servicios. Se dan de alta desde el panel, en Catálogo, y aparecen aquí al momento"* |
| `tpv-vacio-holded-1280` | **La captura de control**: el mismo vacío en un comercio con Holded sigue diciendo *"Configúralos en Holded o sincroniza"*, palabra por palabra como antes del bloque |
| `tpv-local-ticket-1280 · -390 · -320` | El ticket con una línea local dentro: 18,50 + 3,89 de IVA = 22,39 €, y el botón de cobrar activo |

**Lo que este bucle cambió:**

1. **El catálogo vacío mandaba al comercio de catálogo local a configurar sus productos en
   Holded.** *"Aún no has cargado productos. Configúralos en Holded o sincroniza para verlos
   aquí."* Es un ERP que no ha comprado y un sync que no va a correr nunca. Para poder acertar
   la frase, el TPV necesitaba el dato: `holdedEnabled` viaja ahora en la primera página de
   `/tpv/catalog/products` y se cachea como sus hermanos. **Con test en los dos lados**, y con
   la captura de control que demuestra que al de Holded no le cambia la frase.
2. **`CatalogProduct.holdedProductId` estaba tipado como `string`** y el dato llegaba `null`
   desde que la columna pasó a nullable. No reventaba nada —`cart.ts` sí lo tenía bien y el
   checkout manda `?? undefined`— pero el tipo mentía, y el siguiente que escriba
   `p.holdedProductId!` se lo cree. Tipo corregido, con test.

⚠️ **El default del flag nuevo es TRUE, y ésa es la parte peligrosa.** Igual que `cajaEnabled`
(H1) y al revés que `crmEnabled`/`agendaEnabled`: un TPV que aún no haya refrescado el catálogo
tiene que comportarse como antes del bloque. Si alguien lo invierte, los cinco TPV de
producción pasarían a decirle al cajero que sus productos se dan de alta en el panel — donde no
puede crearlos, porque su alta local está cerrada. Hay test del default y de que sólo un `"0"`
lo apaga.

**Lo que se vio y NO se ha tocado, a propósito:** en el panel del ticket, el nombre de la línea
se trunca pronto (`Corte de p…` con la columna a 360 px), porque el paso de unidades y el
importe se llevan el ancho. Es **anterior a este bloque y común a todos los verticales** —no
tiene nada que ver con el catálogo local, que llega con nombres igual de largos que Holded—, y
tocar el layout de la línea del ticket para todo el mundo no cabe en este frente. Queda dicho
aquí con su captura para que sea una decisión y no un descuido.

---

## 10 · Estado de la suite

Al cerrar el bloque, el 13-09:

```
pnpm test            (desde la raíz)   204 ficheros · 2000 tests · 3 skipped · verde
pnpm test:e2e        (Postgres real)     8 ficheros ·  110 tests · verde
tsc --noEmit         api, admin y tpv-web           limpio
```

**Después del merge de master** (18-09, ver §13). Crecen los dos lados porque master trae sus
propios tests, no porque aquí se haya añadido casi nada:

```
pnpm test            (desde la raíz)   216 ficheros · 2273 tests · 3 skipped · verde
pnpm test:e2e        (Postgres real)    11 ficheros ·  145 tests · verde
tsc --noEmit         api, admin y tpv-web           limpio
```

**Y después del frente del §14** (el ContactSheet de la venta):

```
pnpm test            (desde la raíz)   217 ficheros · 2281 tests · 3 skipped · verde
pnpm test:e2e        (Postgres real)    11 ficheros ·  145 tests · verde
tsc --noEmit         api, admin y tpv-web           limpio
```

Los 3 saltados son los mismos de siempre. El e2e no se mueve: el frente es
de pantalla y no toca ninguna ruta.

**Los 3 SALTADOS, dichos por su nombre** porque un recuento sin nombre no se puede auditar: son
el `describe.skip("super-admin · crear tenant (legacy flow B-SuperAdmin)")` de
`apps/api/test/super-admin.test.ts`. Los dejó **B-OnboardingV2** al partir
`POST /super-admin/tenants` en DRAFT + activate, y su cobertura se trasladó a
`onboarding-v2.test.ts`. Son los mismos 3 de antes del bloque y los mismos de después del
merge: **este bloque no salta ni un test**.

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
4. **El ancho del nombre en la línea del ticket** (§9.2). Anterior a este bloque y común a
   todos los verticales; se mira cuando toque el checkout, no aquí.

---

## 13 · La integración en master (18-09-2026)

La rama iba **5 commits por delante y 22 por detrás**, y master se había movido mucho: el panel
de salud de la agenda (B-9), la carrera de dos altas `500 → 409` con su testigo, y el bloque
**reservas-mostrador** (merge `3e254b8`, que es lo que hay en producción, con la APK 1.17.0).
Aquí no se abre nada nuevo: se pone esta rama en condiciones de entrar.

`git merge master` y no rebase: son 22 commits y el historial de la rama ya llevaba un merge de
master previo (`434bf36`).

### 13.1 Los conflictos: NO HUBO NINGUNO, y eso hay que explicarlo

Cero conflictos textuales. No es suerte ni es que se resolvieran por comodidad — **es que los
dos lados no comparten ni un solo fichero**:

```
comm -12 <(git diff --name-only $BASE HEAD | sort) \
         <(git diff --name-only $BASE master | sort)
→ (vacío)
```

Los choques que se esperaban **no existieron**, y merece la pena dejar dicho dónde no estaban,
porque es la prueba de que la separación entre los dos frentes era real:

| Dónde se esperaba el choque | Qué pasó |
|---|---|
| `apps/admin` · `CatalogoPage`, `TenantDetailPage`, `CreateTenantPage`, `AdminShell`, `App.tsx`, `superadmin/types.ts` | master no tocó **ninguno**. Lo suyo en el admin fue `StaffPage` y su color propuesto, que esta rama no mira |
| `apps/api/src/catalog/**` | master no entró ahí. Lo suyo fue `crm/`, `agenda/store.ts` y `lib/error-handler.ts` |
| `apps/api/src/server.ts` | tampoco: master registra sus rutas nuevas desde `crm/routes.ts`, no desde el server |

`tsc --noEmit` limpio en api, admin y tpv-web sobre el árbol fusionado antes de commitear el
merge (`a6be679`).

### 13.2 Las dos comprobaciones que se pidieron a mano, no a suponer

**(a) El corte a nivel de tenant antes de encolar sigue cubriendo el camino de cobro.**

Los **cuatro** caminos que encolan siguen pasando por el gate, y master **no añadió un quinto**:

| Camino | Dónde | Gate |
|---|---|---|
| Venta rápida (el camino de B-5) | `tickets/routes.ts:444` | `holdedDestination` → `shouldEnqueueHoldedUpload` (`:669`) |
| Mesa | `tickets/routes.ts:944` | ídem (`:1230`) |
| Devolución | `tickets/routes.ts:1688` | `shouldEnqueueHoldedRefundUpload` (`:1893`) |
| Saldo de un fiado | `credit-routes.ts:271` | `shouldEnqueueHoldedUpload` (`:346`) |

Se comprobó además que el diff entero de master sobre `apps/api/src` **no contiene ni una línea
añadida** que mencione `Ticket`, `HoldedUpload` o `enqueue`: lo suyo es agenda y CRM, y ninguna
de las dos cobra.

⚠️ **Lo que sí apareció al mirar, y no es una regresión:** `admin/tickets-errors.ts` tiene
cuatro `enqueueTicketUpload`/`enqueueRefundUpload` **sin gate**. Es la bandeja de "reintentar" y
sólo actúa sobre filas `HoldedUpload` que ya existen. En un tenant `NONE` o
`NOT_CONNECTED_YET` esas filas **no se crean**, así que la bandeja está vacía por construcción.
Es el mismo argumento de "garantizado por la ausencia de datos" del §12.1, y es anterior al
merge.

**Y la frase del §2.9 ("no hay sweeper que recoja `PENDING_SYNC`") se volvió a comprobar,
porque `workers/upload-sweeper.ts` existe y el nombre asusta.** Sigue siendo cierta: el sweeper
busca `holdedUpload.status = 'PENDING'`, **no** `ticket.status = 'PENDING_SYNC'`. Son dos cosas
distintas, y el gate impide que la fila `HoldedUpload` llegue a existir — así que el sweeper no
tiene nada que barrer hacia arriba. El forward-only se sostiene.

**El roce real con la carrera 409, que no estaba en el guion:** master cambió
`lib/error-handler.ts`, y esta rama depende de que un `P2002` del índice parcial del SKU se
traduzca a 409 (§4, "concurrencia sobre el índice parcial"). No se pisan: el cambio de master es
**aditivo** —añade el `SQLSTATE` al log y al cuerpo del 500, vía el `sqlstate.ts` nuevo— y no
toca el tratamiento del `P2002`; y además `catalog/local-products.ts` **captura el `P2002` en la
propia ruta** (`:446` y `:542`) y devuelve el 409 con su frase, así que nunca llega al manejador
genérico. Comprobado leyendo los dos, no deducido.

**(b) La sección "De Holded" del selector de clientes con `holdedEnabled = false`.**

El done de reservas-mostrador lo dejó anotado para esta rama (§8 de aquel documento): la sección
ya **no aparecía** por el camino natural —un tenant sin contactos sincronizados devuelve cero
resultados y la sección sólo existe si hay alguno—, pero se gastaba un `GET /contacts/search`
por cada búsqueda que en ese comercio siempre iba a volver vacío. *"Es desperdicio, no un
fallo."*

Hacía falta gatear la petición, y se ha hecho aquí (`47a9fa5`). El flag ya viajaba en el payload
del catálogo desde el §9.2, así que el TPV ya lo tenía cacheado:

- `useClientPicker.tsx` corta **antes de salir a la red** si `getCachedHoldedEnabled()` es falso.
- Se apaga además `sinRed`. Sin eso, el comercio sin Holded vería *"Sin conexión: no se buscan
  contactos de Holded"* — un ERP que no ha comprado, que es **la misma mentira** que el bloque le
  quita en la rejilla del TPV (§9.2) y en el sidebar del panel (§9).
- El default sigue siendo el **asimétrico** de todo el caché del catálogo: `true` salvo un `"0"`
  explícito. Un TPV que aún no haya refrescado busca como antes del bloque; nunca deja de buscar
  por no saberlo.

Siete tests nuevos, con los tres casos del default (ausente, valor raro, encendido explícito).
El `beforeEach` del fichero limpia la clave, porque jsdom no tira `localStorage` entre tests del
mismo fichero y el resto de aquel fichero asume el comercio CON Holded.

### 13.3 Qué cambió respecto a lo que el done decía

| El done decía | Ahora |
|---|---|
| §10 · `204 ficheros · 2000 tests · 3 skipped` | `216 · 2273 · 3`. Los 12 ficheros y 273 tests de más **son de master**; de esta rama sólo entran los 7 del selector |
| §10 · e2e `8 ficheros · 110 tests` | `11 · 145`. Los tres nuevos son de master: `agenda-carrera`, `crm-contacto` y el suyo propio |
| §3 · tabla de sabotaje de 15 filas | 16. La fila nueva es la del §13.2(b) |
| §12 · "queda pendiente" no mencionaba el selector de clientes | Cerrado. La deuda que reservas-mostrador dejó apuntada a esta rama está pagada |

**Lo que NO cambió:** ni una decisión del §2, ni la forma del dato del §1.1, ni la migración.
Master no tocó `packages/db/prisma/`, así que la migración `20260913000000_catalogo_local` sigue
siendo la única del bloque y se aplicó limpia sobre una base vacía en el e2e.

### 13.4 La tabla de sabotaje, revalidada entera

Se volvió a pasar **fila por fila** sobre el árbol ya fusionado, y con el paso que hace que la
tabla signifique algo: **antes de romper nada se comprueba que el test está VERDE con el código
intacto**. Si no, un rojo no prueba nada.

**16 de 16 confirmadas.** Ninguna garantía se ha vuelto irrompible: **master no tocó ninguna**,
que es el hallazgo — y es un hallazgo aburrido, que es el que uno quiere.

Dos filas se comprobaron por sus **dos** mitades, porque la tabla nombraba dos tests:

- **Fila 2 (el índice parcial)** tiene dos sabotajes distintos y cada uno cae por un lado:
  quitar el `WHERE` (dejarlo global) revienta *"…y a la vez DEJA convivir dos SKU iguales de
  HOLDED"* —que es justo el sync de Holded rompiéndose—, y **borrar el índice entero** —lo que
  de verdad ofrece `migrate dev`— revienta *"el índice PARCIAL rechaza dos SKU locales iguales
  en el mismo tenant"*. Las dos contra Postgres real.
- **Fila 9 (`!holdedEnabled` en vez de `=== false`)** vive en dos sitios: el gate del encolado
  (rojo en `catalogo-local-encolado.test.ts` · *"un tenant sin la columna se comporta como el de
  siempre"*) y el muro de `App.tsx` (rojo en `catalogo-local-muro-onboarding.test.tsx` ·
  *"sin el campo se comporta como master"*). Se rompieron por separado.

Las tres filas de e2e (2, 12 y 15) se corrieron contra Postgres de verdad. La 12 —contar los
cobros huérfanos con `status = 'PAID'` a secas, sin el `NOT EXISTS`— pone rojo *"el falso
positivo que el NOT EXISTS evita: un PAID CON fila de upload"*, exactamente como decía.

### 13.5 Cómo se corrió, y la base que se usó

Los e2e **como los corre el CI**, no como se corren en local: `pnpm --filter @mipiacetpv/db run
generate` primero y luego `pnpm test:e2e` con **`E2E_DATABASE_URL` como única variable** (es lo
único que el job `e2e` de `ci.yml` inyecta), contra `postgres:16-alpine`, sin Redis. La suite
aplica ella misma `DROP SCHEMA` + las migraciones de verdad, así que la migración se prueba
desde cero en cada pasada.

**Base propia y desechable: `mipiacetpv_catalogo_e2e`**, creada para esta integración y
**borrada al terminar**. No se tocó `mipiacetpv_e2e`, la compartida: había otra sesión de Code
trabajando en paralelo en otra rama y esta suite hace `DROP SCHEMA`. Es la regla del §0 otra
vez, sólo que aplicada a las bases en vez de a los árboles.

Ningún test falló, así que no hizo falta decidir si un rojo venía de master o de la rama.

### 13.6 Lo que queda pendiente

1. **`SalePage.contact.tsx` también llama a `/contacts/search`** y **no se ha gateado**. Es otra
   pantalla y otro bloque: el sheet de "cliente del ticket" de B4, cuyo propósito es adjuntar un
   contacto **para la factura de Holded**. En un comercio con `holdedEnabled = false` no hay
   factura de Holded, así que la pregunta no es "¿gateo la petición?" sino "¿qué pinta ese sheet
   entero en ese comercio?" — y eso es una decisión de producto, no una optimización. Se deja
   dicho aquí con su fichero para que sea una decisión y no un descuido, igual que el ancho del
   nombre en la línea del ticket (§9.2).
2. Todo lo del §12 sigue en pie sin cambios: el casamiento por SKU, el `taxRate` local, el
   catálogo mixto.
3. **El repaso manual del §8.1 sigue pendiente de hacerse al desplegar.** El merge no lo toca.

### 13.7 Lo que esta sesión NO ha hecho

**Ni push ni merge a master: eso lo hace Matías.** La rama queda en `47a9fa5`, por delante de
master y con master dentro.

---

## 14 · El ContactSheet de la venta (18-09-2026)

El §13.6 dejó apuntado que `SalePage.contact.tsx` seguía llamando a
`/contacts/search` sin gatear, y que la pregunta no era de red sino de producto.
Matías la decidió: **ese panel no se muestra si el tenant no tiene Holded.**

### 14.1 La decisión y su predicado

El ContactSheet adjunta un contacto **de Holded** al ticket para la factura
(ADR-010). Sin Holded no hay factura, así que el botón que lo abre desaparece —
no se queda encendido buscando en una lista que siempre vuelve vacía.

Mismo predicado que el resto del frente, `getCachedHoldedEnabled()`, no uno
nuevo. Es el que ya usan la rejilla del TPV (§9.2) y el selector de clientes
del CRM (§13.2b).

### 14.2 Qué cuelga de ese panel · lo que se miró ANTES de tocarlo

Esto es lo que había que comprobar, y lo que más tiempo llevó. El dato que
viaja es `Ticket.contactHoldedId`, y lo lee más gente de la que parecía:

| Quién lo usa | Qué pasa en un tenant sin Holded |
|---|---|
| **El papel** — `tickets/print.ts:309` hidrata el nombre del deudor para la leyenda "PENDIENTE DE PAGO" | Sólo entra si el ticket trae contacto. Degrada a `null` |
| **El email automático** — `tickets/email-trigger.ts:50` | Corta en `if (!opts.contactHoldedId)`. No se encola |
| **El email manual** que teclea el cajero | **No depende del contacto.** Sigue funcionando |
| **El listado de deudas** — `credit-routes.ts:102` resuelve nombres por `contactHoldedId` | Sin fiados, lista vacía |
| **El fiado** — `CheckoutPage:453` y `tickets/routes.ts:456` lo EXIGEN | Ver §14.3 |

**Ninguno se rompe, y la razón es la misma para todos:** en ese comercio
`contactHoldedId` **no puede llegar a existir**. La tabla `Contact` se puebla
sólo desde Holded —el sync inicial (`onboarding/initial-sync.ts`), el cron de 15
min, el fallback por teléfono de `/contacts/search` y el import CSV
(`workers/contact-import-worker.ts`)— y **los cuatro exigen la API key**. Se
comprobó uno a uno; el del CSV es el que más engaña, porque suena a "local" y
no lo es: crea el contacto **en Holded** y lo espeja. Y `POST /contacts`
responde `409 NO_HOLDED_KEY` sin clave, así que "Crear contacto" tampoco era una
salida.

### 14.3 El fiado, que es el hallazgo de verdad

**El fiado exige deudor.** `POST /tickets` devuelve `400
CREDIT_SALE_REQUIRES_CONTACT` sin `contactHoldedId`, y el único sitio donde el
cajero podía ponerlo era este panel.

O sea que **el fiado ya era imposible** en un comercio sin Holded, desde antes
de este frente: se pulsaba "Fiado", se leía *"Un fiado necesita un cliente (el
deudor)"*, se abría el buscador, no había nadie, y no se podía crear a nadie.
Un callejón sin salida que nadie había visto porque `creditSalesEnabled` **nace
en `false`** y hace falta encenderlo a mano.

Al dejar de montar el sheet, ese callejón se habría vuelto **mudo**: el aviso
mandaría a abrir un panel que ya no aparece. Así que **el botón "Fiado" se va
con él**, mismo predicado. No se rompe ningún fiado porque no había ninguno que
romper. **"Deudas" NO se toca**: lista lo ya fiado y en ese comercio sale vacía
sola.

### 14.4 Dos puertas, y una de ellas no se puede probar

La condición está en **dos** sitios: la entrada del menú (`TicketPanel`, la
cortesía) y el render del `ContactSheet` (`SalePage`, la puerta). Al sabotear
salió un detalle que merece quedar escrito:

**Quitar sólo la puerta interior no pone rojo ningún test, y no es un fallo del
test: es que la puerta no tiene llamador.** Sin la entrada del menú, nadie pone
`openSheet` en `"contact"` —el nudge "Servicio sin cliente" lo quitó v1.3 Lote
3, y el del fiado también se fue—, así que es inalcanzable por construcción.
Con las **dos** fuera, el test sí cae. Se mantiene como red para el próximo que
añada un disparador, y queda dicho aquí para que sea una decisión y no un
adorno.

### 14.5 Dos tests que pasaban sin probar nada

Merece la pena porque es el fallo que el método existe para cazar, y esta vez
lo cazó el propio sabotaje:

1. *"el sheet no se monta"* afirmaba que el panel no estaba **sin que nadie
   hubiera intentado abrirlo**. Verde garantizado. Ahora abre el menú y **pulsa
   todas sus acciones una a una**. (Y hay que fotografiar los botones del topbar
   antes de abrir el menú: "Deudas" y "Tickets" también tienen `title`, y
   pulsarlos se iba a otra pantalla.)
2. *"el botón Fiado se va"* nunca abría el overlay de cobro, que es donde vive
   el botón. Ahora mete una línea, pulsa "Cobrar" y **afirma primero que el
   overlay está abierto**.

Los dos se descubrieron porque el sabotaje correspondiente **no ponía nada en
rojo**. Un test que no se puede romper no es un test.

### 14.6 El bucle visual

Ocho capturas en `docs/blocks/catalogo-local-shots/`, cada una con su pareja de
control con Holded al lado — que es lo que demuestra que el único cambio es el
buscado. A **390×844 (DPR 1)** y a **1280×800 con `deviceScaleFactor` 1,5**, el
AP11 en horizontal según la medición del done de reservas-mostrador §6.

| Captura | Qué enseña |
|---|---|
| `venta-menu-sin-holded-390 · -ap11` | "Más acciones" con **Descuento** y **Observaciones** |
| `venta-menu-con-holded-390 · -ap11` | Las mismas **más "Cliente"**, como en master |
| `venta-cobro-sin-holded-390 · -ap11` | El cobro **sin "Fiado"**; "Cobrar" a lo ancho |
| `venta-cobro-con-holded-390 · -ap11` | El cobro **con "Fiado"** debajo de "Cobrar" |

**El hueco raro que había que buscar no existe.** La rejilla del menú es
`grid-cols-2 sm:grid-cols-3`: a 390 quedan dos acciones que llenan la fila
**exacta** —mejor repartidas que las tres de antes, que dejaban una huérfana— y
en el AP11 quedan dos de tres, sin agujero en medio. En el cobro, quitar
"Fiado" deja "Cobrar" a lo ancho y el pie cierra igual.

El banco visual (`apps/tpv-web/visual/`) gana `?sin-holded=1` y `?fiado=1`. Van
también en la respuesta del stub de `/tpv/catalog/products`, no sólo en
`localStorage`: `refreshCatalog()` corre después de `stubSession()` y volcaba el
valor del servidor encima, así que sembrar sólo la caché daba una captura con
"Fiado" en **las dos** columnas.

### 14.7 Lo que sigue pendiente

1. **La conversación de producto completa del comercio sin Holded.** Este frente
   quita el panel de contacto y el fiado. Quedan sin mirar, a propósito, las
   pantallas del panel de administración que hablan de contactos (el import CSV
   entre ellas): son otro bloque y otra pantalla.
2. Todo lo del §12 y del §13.6 sigue igual.

**Ni push ni merge a master: eso lo hace Matías.**
