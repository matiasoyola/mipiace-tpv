# catalogo-en-alta · done

Rama `catalogo-en-alta`, desde `master` = `1ddde34`. Escrito el 04-10-2026.

**Qué deja hecho:** un comercio nuevo **sin Holded y con caja** se da de alta, se le carga su
catálogo real de un fichero, se ensaya en modo prueba sin un solo registro fiscal, se activa con el
dueño delante y cobra su primera venta con la cadena en `C1/1`. El camino está recorrido de verdad
—a mano primero y en un e2e después— y no en teoría.

---

## 1 · El paso 0, y lo que apareció al recorrerlo

El recorrido completo está en `catalogo-en-alta-plan.md` (commit `3699e3b`, antes de tocar código).
Resumen de lo que se encontró al dar de alta un bar de verdad contra la API y el admin locales:

**La activación fallaba por DOS cosas, no por una.** El §0 del checklist de La Maestranza sólo había
visto el catálogo:

```
POST /super-admin/tenants/<id>/activate
→ 400 {"error":"ONBOARDING_NOT_READY",
       "failing":["≥50% de productos sellable","Cajero técnico provisionado"]}
```

El segundo bloqueo es el que no estaba previsto y entró al bloque por la puerta del paso 0:

- `test-cashier-provisioned` se enciende cuando existe el usuario técnico, y lo creaba **sólo el
  worker del sync inicial** (`workers/initial-sync-worker.ts:53`). Sin Holded el sync está en
  `NOT_APPLICABLE` y ese worker no corre jamás.
- El endpoint **sí** sabía provisionarlo a demanda (`issueTestCashierSession` llama a
  `provisionTestCashier` en su primera línea), pero el botón que lo llama estaba `disabled` con
  `!h.testCashierProvisioned` y debajo ponía «Esperando a que el sync inicial termine».
- La salida que sugiere el propio comentario del worker —«que el super-admin reaprovisione con un
  re-sync»— responde `409 HOLDED_NO_HABILITADO` en este comercio.

O sea: **el botón que fabrica la llave estaba cerrado con esa misma llave.**

Y una tercera, que no bloqueaba la activación pero la encontró el e2e: la **venta de ensayo se
quedaba `PAID`** en un comercio sin Holded (ver §3).

Lo que se apuntó y **no** entró, por la regla del prompt (estorba, no bloquea): la sala —zonas y
mesas—, los cajeros reales y la impresora. Los tres se hacen tras activar, desde el panel del
propietario. El ensayo se puede hacer sin mesas: `POST /tickets` no exige `tableId`.

---

## 2 · Lo que se ha construido

### 2.1 · Una sola regla del producto local

`apps/api/src/catalog/local-product-rules.ts`. Salen de `local-products.ts` el SKU, el nombre, el
IVA, las etiquetas, el código de barras, los límites y la construcción del `create`. Las usan las
**dos** puertas del catálogo: el alta de una ficha desde el panel del propietario y la carga de
fichero del super-admin. No reglas parecidas: la misma función.

### 2.2 · El precio, que estaba mal desde el bloque anterior

`Product.basePrice` es **neto** en toda la cadena: el TPV pinta `neto · (1 + IVA)`
(`tpv-catalog/routes.ts`) y el ticket agrega netos por bucket de IVA antes de redondear una sola vez
(`tickets/totals.ts`, v1.4-b30). Pero el formulario del panel decía «Precio con IVA» y mandaba lo
tecleado tal cual.

Medido contra la API local antes de escribir nada:

```
producto con basePrice = 1.60, IVA 10  →  GET /tpv/catalog/products  →  priceGross: 1.76
```

El café de 1,60 € de la carta de La Maestranza, cobrado a 1,76 €, en los 128 productos y desde la
primera venta real. Con el fichero guardado «tal cual», como pedía el prompt, habría pasado eso.

Lo que hay ahora:

- `netoDesdeBruto` / `brutoDesdeNeto` en el módulo de reglas, y **tres** sitios que las usan: el
  importador, el serializador del panel (`priceGross` en la respuesta) y la rejilla del TPV, donde la
  multiplicación estaba escrita a mano.
- `POST`/`PATCH /catalog/products` aceptan `priceGross` **o** `basePrice`, exactamente uno. Mandar
  los dos es 400: si no coinciden, cualquiera de las dos elecciones cobra mal.
- El `PATCH` convierte con el IVA de la ficha si la petición no lo trae. Un café al 10 % reinterpretado
  como 21 se cobraría mal el resto de su vida.
- El formulario del panel habla en precios de carta de principio a fin: abre con el precio con IVA,
  lo manda como `priceGross` y la lista lo pinta (**condición 2 de Matías**, con test de ida y vuelta).

**Decisión declarada:** los productos locales que YA existen en producción **no se han tocado**. Ver
§6.

### 2.3 · «Cargar catálogo» en la ficha del tenant

`POST /super-admin/tenants/:id/catalog/import` + el panel del admin. Sólo para comercios **sin Holded
y con caja**, en DRAFT y en ACTIVE.

- **Vista previa primero.** `confirmar` es `false` por defecto: parsea, pregunta a la base qué SKUs ya
  existen y contesta. Ni transacción, ni auditoría, ni rastro. Cancelar no deja nada que limpiar.
- **Un SKU que ya existe no se pisa.** Se informa y se salta: cargar el mismo fichero dos veces no
  duplica ni cambia precios a escondidas, que es lo que haría un `upsert` en silencio.
- **Todo o nada**, la auditoría dentro de la transacción.
- **409 para un tenant con Holded** (ADR-017), también en la vista previa, y el panel no se le pinta.
- Auditoría `catalog_import` con cuántas entraron y cuántas se saltaron. Del contenido del fichero,
  nada: son los precios del comercio.
- Tope de 2.000 filas por carga, **rechazando** y diciendo cuántas trae. Un recorte en silencio sería
  peor: el implantador creería que ha cargado el catálogo entero.

**El parser lleva comillas** porque el catálogo real las necesita
(`CAF-007,"Infusión (manzanilla, poleo, tila…)",1.60,10,cafés`) y **comprueba el número de columnas**,
que lo descubrió su propio test: `A-1,Caña,2,50,10,cervezas` —una coma decimal sin comillas, que es lo
que escribe un Excel español— tiene seis campos y, leído por posición, entra como un producto
perfectamente válido de 2 € **al 50 % de IVA**. Callado y en todas las filas del fichero.

### 2.4 · «Probar TPV» deja de esperar a nadie

Una condición de `disabled` y el texto que la acompaña. El endpoint ya provisionaba a demanda. La
nota de abajo ya no habla de un sync que en este comercio no existe.

### 2.5 · La venta de ensayo nace TEST

`TicketStatus.TEST` lo ponía **sólo** el worker de subida (`upload-ticket.ts:114`), que mira
`User.isTestCashier`. En un comercio sin Holded ese job no se encola —es la razón de ser del
`holded-upload-gate`—, así que la venta de ensayo se quedaba `PAID` para siempre. Y `purgeTestData`,
que corre al activar, borra los tickets `status = TEST`: **la venta de ensayo del implantador
sobrevivía a la activación** y se quedaba en el comercio del cliente como una venta cobrada de
verdad, en su arqueo y en su panel, sin registro fiscal detrás.

Ahora el estado de prueba se decide al cobrar (`nuevoTicketStatus`), con la señal que ya viajaba en la
sesión (`cashier.isTest`), en los dos caminos de cobro: venta rápida y mesa. El worker sigue marcando
TEST por su cuenta — es la red de debajo para los comercios con Holded.

---

## 3 · Tabla de sabotajes

Cada garantía, qué línea de producción hay que romper, qué test se pone rojo y **con qué mensaje
real** (ejecutados, no imaginados).

| Garantía | Sabotaje | Rojo | Mensaje real |
|---|---|---|---|
| El precio se guarda convertido | `netoDesdeBruto` devuelve su argumento | `catalogo-en-alta-precio` · 7 tests | `CAF-001: carta 1.6 € → TPV 1.76 €` · `expected 1.6 to be 1.4545` · `expected 596.31 to be 542.1` |
| La vista previa no escribe | quitar el `if (!confirmar) return` | `catalogo-en-alta-import` · 2 tests | `expected true to be false` (`escrito`) y `expected 3 to be +0` (productos en la base) |
| Un SKU que ya existe no se pisa | quitar el `.filter((f) => !yaEstan.has(...))` | `catalogo-en-alta-import` · 1 test | `expected 4 to be 3` |
| Todo o nada (la escritura) | — (cubierto por el fake que revierte) | `catalogo-en-alta-import` | `expected 3 to be +0` con `createMany` reventando |
| Todo o nada (**la auditoría**) | sacar `writeAudit` de la transacción | `catalogo-en-alta-import` · 1 test | `expected 3 to be +0` — los productos sobreviven a una auditoría que falla |
| Un tenant con Holded recibe 409 | quitar la puerta `holdedEnabled !== false` | `catalogo-en-alta-import` · 2 tests | `expected 200 to be 409` (y también en la vista previa) |
| Una sola función de reglas | el importador manda `basePrice` en vez de `priceGross` | `catalogo-en-alta-import` · 3 tests | `expected 1.6 to be 1.4545`, `expected 10.7 to be 10` (IGIC) |
| «Probar TPV» no espera al flag | devolver `|| !h.testCashierProvisioned` al `disabled` | `catalogo-en-alta-modo-prueba` · 1 test | `expected true to be false` |
| La venta de ensayo nace TEST | quitar `esPrueba` de `nuevoTicketStatus` | `catalogo-en-alta.e2e` · 1 test | `expected 'PAID' to be 'TEST'` — **así se encontró el fallo** |
| El camino completo | cualquiera de los anteriores | `catalogo-en-alta.e2e` · 19 tests | el recorrido entero contra Postgres |

El fichero de precios usa **los 128 precios reales** de `catalogo-tpv.csv`, no una muestra que
redondee bonito: carta → neto de 4 decimales → lo que pinta el TPV y lo que cobra un ticket de 1 y
de 10 unidades, más una ronda entera de la carta en un solo ticket.

### Verde en CI

| Suite | Resultado |
|---|---|
| `pnpm test` (workspace) | 270 ficheros · 2.969 tests · 3 saltados |
| `pnpm test:e2e` (Postgres real) | 22 ficheros · 350 tests |
| `tsc --noEmit` api · `tsc -b` admin | limpio |

---

## 4 · Lo que la suite NO cubre

- **El fichero de verdad subido por un navegador de verdad.** El test del panel le pone un `text()`
  encima al `File` porque el `Blob` de jsdom no lo implementa. El camino real (elegir fichero → leer →
  enviar) se probó a mano en el bucle visual, no en la suite.
- **El super-admin a 390 y 320 px.** Las capturas están, y lo que enseñan es que la consola entera es
  inusable a esos anchos: el shell tiene una barra lateral fija de 240 px sin variante móvil
  (`SuperAdminShell.tsx`, ya declarado en H1), así que a 320 queda una columna de 34 px de contenido.
  **Mi panel no añade desbordamiento horizontal** —medido con `scrollWidth > clientWidth`: `false` en
  los tres anchos— pero tampoco arregla el shell. Es una herramienta de escritorio y el implantador la
  usa desde su Mac.
- **Un catálogo grande de verdad.** El tope es 2.000 filas y el e2e carga 128. Nadie ha medido una
  carga de 2.000 contra Postgres.
- **El precio neto que siguen enseñando dos pantallas de Holded**: la bandeja de SKU (`App.tsx:1497`) y
  el catálogo de agenda (`AgendaCatalogPage`). Son productos de Holded, van etiquetados con su IVA al
  lado y quedan fuera del catálogo local; no se han tocado.
- **`tpv-web` tiene su propia aritmética bruto↔neto** para el precio sobre total (v1.6,
  `price-override-gross.test.ts`, 143 tests en verde). No comparte código con la del servidor —son
  procesos distintos— y este bloque no la ha unificado.
- **El cobro con Holded conectado no se ha vuelto a probar a mano** tras tocar `nuevoTicketStatus`. Lo
  cubren la suite de unidad y los e2e de ciclo de caja y verifactu, todos en verde.

---

## 5 · El bucle visual

`docs/blocks/catalogo-en-alta-shots/`, contra la API y la base de verdad, con el tenant de La
Maestranza (128 productos cargados).

| Captura | Qué enseña |
|---|---|
| `ficha-cargar-catalogo-1280 · -390 · -320` | La ficha del tenant DRAFT con el panel. A 1280 se lee entero; a 390 y 320 manda el shell (ver §4) |
| `vista-previa-1280` | Un fichero sucio: entran 2, se saltan 6, cada una con su línea y su motivo —SKU repetido en el fichero, SKU vacío, precio con letras, IVA imposible, miles ambiguos, SKU que ya existe— y «Nada de esto se ha escrito todavía» |
| `vista-previa-390 · -320` | La misma, a los anchos estrechos |
| `vista-previa-carta-1280` | El fichero bueno: las 128 filas con el precio de la carta y el que se guarda |
| `tpv-prueba-1280` | El TPV de prueba con la carta cargada: banner de modo prueba, chips de categoría (Bocadillos, Cafés, Cervezas, Desayunos, Más (5)), nombres a dos líneas y **Café con leche 1,60 €** |
| `tpv-prueba-390` | Lo mismo a 390: los chips se pliegan en «Más (9)» y el ticket queda en la barra inferior |

Comprobado además contra la base, no sólo en la foto: la venta de ensayo del TPV de prueba queda en
`status = TEST`, `total = 1.6000`, y `fiscal_records` sigue a cero.

---

## 6 · PENDIENTE DE DIRECCIÓN · los productos locales que ya existen

La **condición 1** de Matías: antes de dar por bueno el arreglo del alta manual, mirar producción y no
corregir nada a escondidas.

No tengo acceso a producción (el VPS pide la password del hPanel, `docs/deploy/hostinger.md:9`), así
que **la lista no está hecha**. La consulta de solo lectura es ésta:

```sql
select t.name as comercio, p.sku, p.name,
       p.base_price                                as neto_guardado,
       p.tax_rate                                  as iva,
       round(p.base_price * (1 + p.tax_rate/100), 2) as cobra_hoy_el_tpv,
       p.created_at
  from products p
  join tenants t on t.id = p.tenant_id
 where p.source = 'LOCAL'
   and p.holded_product_id is null
 order by t.name, p.sku;
```

`holded_product_id is null` separa los dos casos: los convertidos por «Dejar Holded» **conservan** el
enlace (`dejar-holded.ts:1091` cambia `source`, no el id) y vienen netos de Holded, así que están
bien y no se tocan. Los que salgan en esa lista son los creados con el formulario, y su precio real
de cobro es la columna `cobra_hoy_el_tpv`.

**Lo que hace falta decidir:** si esas filas se corrigen (dividir `base_price` entre `1 + IVA`) o se
quedan como están porque el precio al que cobran es el que el comercio quería. **No se ha migrado
nada.** Los productos nuevos y los editados a partir del despliegue sí quedan bien.

---

## 7 · Despliegue

- **No hay migración.** Ni tablas nuevas ni columnas nuevas: la ruta escribe en `products` con las
  columnas de siempre y la auditoría usa `super_admin_audits`, que ya existe.
- Se despliega como cualquier otro cambio: `IMAGE_TAG=<sha> bash infra/deploy.sh`. Rollback, el sha
  anterior.
- **API y admin van juntos**: el panel manda `priceGross` y la API lo entiende; una API vieja con un
  admin nuevo rechazaría el alta de productos con `must have required property 'basePrice'`. El
  despliegue del repo los sube a la vez.
- Primera comprobación tras desplegar: abrir la ficha de un tenant sin Holded y ver el panel «Cargar
  catálogo».

---

## 8 · Estado de la rama

- Rama `catalogo-en-alta` **pusheada**.
- **PR abierto contra `master`** (sin merge: lo decide Dirección).
- Commits: paso 0 (`3699e3b`), reglas y precio (`018bdae`), la ruta de carga (`30b3357`), el panel y
  el precio en el panel (`fbfbe6b`), el e2e y la venta de ensayo (`4477e3e`), los checklists
  (`02d7388`), y este done.

### Línea para `claude/tablero-direccion.md` (no tengo acceso al fichero)

> **Bar La Maestranza** (Santa Olalla, sin Holded) — el bloqueo del §0 está resuelto en la rama
> `catalogo-en-alta`, con PR abierto y sin desplegar. Eran dos bloqueos, no uno: el catálogo vacío y
> el cajero técnico, que sin Holded no se podía provisionar desde la pantalla. El camino entero
> —alta, catálogo de 128 productos, ensayo sin registros fiscales, activación y primera venta `C1/1`—
> está recorrido a mano y fijado en un e2e. Falta: desplegar, y decidir qué se hace con los productos
> locales que ya existen en producción (§6 del done). Sin fecha de visita todavía.
