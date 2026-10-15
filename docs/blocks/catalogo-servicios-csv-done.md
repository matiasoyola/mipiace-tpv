# Bloque catalogo-servicios-csv · hecho

Rama `catalogo-servicios-csv`, worktree
`~/Developer/Claude/Projects/mipiacetpv-catalogo-servicios-csv`, desde `origin/master` = `5e9da4d`.
Escrito el 15-10-2026.

**El implantador carga el catálogo de una clínica en una sola pasada, con la dueña delante, y cada
servicio sale ya exento, reservable y con su duración.** Sin repasar 17 fichas a mano, y sin
necesitar un OWNER que en DRAFT no existe.

---

## 1 · Lo que cambia

### 1.1 · Tres columnas nuevas en el fichero, todas OPCIONALES

`apps/api/src/catalog/csv-catalogo.ts`.

```
sku,nombre,precio_con_iva,iva,categoria,tipo,exencion,duracion_min
POD-002,Quiropodia básica,25.00,0,quiropodia,SERVICE,E1,30
CRE-001,Crema urea 20%,12.00,21,mostrador,PRODUCT,,
```

| Columna | Valores | Qué pasa si falta |
|---|---|---|
| `tipo` | `PRODUCT` \| `SERVICE` (en cualquier caja) | Vacía o ausente = `PRODUCT` |
| `exencion` | vacío \| un código de la lista L10 | Vacía o ausente = operación **sujeta** |
| `duracion_min` | minutos enteros, 1–1440 | **Obligatoria si `tipo = SERVICE`**; **prohibida si `tipo = PRODUCT`** |

Las tres decisiones que no son obvias, y por qué:

- **Un `tipo` que no es ninguno de los dos RECHAZA la fila**, no cae a `PRODUCT`. `SERVICIO`
  escrito a mano sería un servicio que entra como producto y que la agenda no ve, callado y en
  todas las filas del fichero.
- **Un `PRODUCT` con duración RECHAZA la fila.** Una crema no se reserva: la duración ahí es una
  columna mal puesta, e ignorarla dejaría al implantador creyendo que ha cargado un servicio. El
  motivo nombra la causa probable («si es un servicio, pon SERVICE en la columna tipo»).
- **La exención NO se valida aquí.** Se pasa tal cual a `validateLocalProduct`, que es la misma
  función que usa el alta de una ficha desde el panel y que ya sabe tres cosas: que la lista es
  L10, que `E2` y `E3` no se pueden declarar en régimen general (validaciones AEAT §15.5) y que una
  causa exige `taxRate = 0`. Dos sitios que decidan qué exenciones valen acaban discrepando, y el
  que discrepe emite un registro **rechazado** con la factura ya entregada.

**El fichero de La Maestranza, que no trae ninguna de las tres, se carga exactamente igual que
antes del bloque.** No es una promesa: es un test sobre el CSV real de los 128 productos, que se
pone rojo si alguien hace obligatoria cualquiera de las columnas nuevas (sabotaje 13).

### 1.2 · Una sola regla de la agenda, para las dos puertas

`apps/api/src/services/scheduling-rules.ts`. Salen del `PUT /services/:productId/scheduling`:

- el **rango de la duración** (`DURATION_MIN = 1`, `DURATION_MAX = 1440`) y
  `normalizeDurationMin`, que además exige entero —la columna es `Int` y un `30,5` lo redondearía
  Postgres en silencio, con la cita descolocada respecto a lo que la dueña escribió—;
- la forma de los **canales** (`Channels`, `DEFAULT_CHANNELS`, `toChannels`);
- los **valores por defecto** (`SCHEDULING_DEFAULTS`: buffers 0, un profesional, no reservable
  online, `online` apagado);
- `buildSchedulingCreateData`, la hermana de `buildLocalProductCreateData`.

El `PUT` del panel ya no lleva sus propios literales: usa `SCHEDULING_DEFAULTS` y el rango de la
constante en su esquema JSON. **Un servicio configurado desde el panel y otro cargado del fichero
ocupan lo mismo en la agenda porque es la misma función, no porque coincidan.** Y el e2e lo recorre
en las dos direcciones: el `PUT` encuentra la fila que creó el fichero y la actualiza (no crea una
segunda), y rechaza una duración de 1.441 minutos que el fichero tampoco aceptaría.

Esto apareció al medirlo, no de palabra: el primer sabotaje de los defaults salió **verde** porque
el test los comparaba contra la propia constante. Ahora el test pone los cuatro números literales y
hay un segundo test que ata la constante a lo que el panel aplica.

### 1.3 · La fila de agenda nace en la MISMA transacción que el producto

`apps/api/src/superadmin/tenant-catalog.ts`. Dentro del `$transaction` que ya existía:

1. `product.createMany` con las filas que entran;
2. `product.findMany` por SKU **dentro de la transacción** para recuperar los ids (`createMany` no
   los devuelve);
3. `serviceScheduling.createMany` con `family` = **la primera categoría de la fila**.

Un servicio sin su `service_scheduling` no tiene duración y la agenda lo ignora
(`GET /services/scheduling` devuelve `scheduling: null`). En un comercio en DRAFT **no hay OWNER que
pueda abrir el panel y ponérsela**, así que un producto a medias aquí es un servicio que no se puede
reservar y que nadie puede reparar. O entran los 17 con su duración, o no entra ninguno.

Y las cuatro promesas de `catalogo-en-alta` siguen valiendo tal cual: la vista previa no escribe
(ninguna de las dos tablas), un SKU que ya existe no se pisa (ni se le crea una agenda nueva), todo
o nada con la auditoría dentro, y un tenant con Holded recibe 409.

### 1.4 · Un exento sólo entra en un comercio con la clínica encendida

La capability es del comercio y el parser no habla con la base, así que la puerta está en la ruta:
una fila con `exemptionCause` en un tenant sin `clinicalRecordsEnabled` se **salta con su motivo**.

```
Este comercio no tiene la clínica encendida, así que no puede tener productos exentos (E1).
La exención de un servicio sanitario la ampara el art. 20.Uno.3º: enciende la clínica primero
o quita la columna exencion.
```

Se salta y **no entra «como se pueda»**: un 0 % sujeto y un exento valen los mismos cero euros de
cuota y son dos operaciones distintas ante la AEAT (`iva-exento-sanitario-done.md` §1). Entrar
sujeto sería emitir mal y que nadie se enterara, porque los importes cuadran.

Lo que se gatea es **la exención, no el tipo de producto**: una peluquería sin clínica sigue
pudiendo cargar `SERVICE` con IVA y su duración. Hay test.

### 1.5 · La vista previa enseña lo nuevo

`apps/admin/src/superadmin/CatalogImportPanel.tsx`. Dos columnas nuevas —**Tipo** y **Duración**,
delante del precio porque es lo primero que la dueña comprueba de una línea de su hoja— y, en la
columna del IVA, el chip **«Exento · sanitario»** en vez de «0 %». Si pintara «0 %» la dueña no
podría distinguir un exento de un 0 % sujeto, que es justo lo que este bloque viene a arreglar.

La frase la redacta el **servidor** (`PRESENTACION` de `@mipiacetpv/ticket-model`): es la misma que
sale luego en el chip del catálogo y en la leyenda del ticket. Y las cuatro claves nuevas
(`tipo`, `duracionMin`, `exencion`, `exencionEtiqueta`) viajan **siempre**, también en el fichero de
un bar —`PRODUCT` y tres `null`—: un campo que aparece y desaparece obliga a la pantalla a
distinguir «no» de «no me lo han dicho».

### 1.6 · El precio de un exento es lo que paga el paciente

Decisión 6 del prompt, comprobada y no de palabra: con `iva = 0` la conversión bruto→neto divide
por 1, así que los 25 € de la hoja de Rosario son los 25 € de la columna `basePrice` y los 25 € que
el TPV pinta. Hay test en el parser, en la ruta y en el e2e contra Postgres.

### 1.7 · Y un bloqueo que apareció al recorrer el camino

**`products-sellable` contaba sólo `kind = PRODUCT`.** Con los 17 servicios ya cargados y el TPV
enseñándolos, la activación seguía contestando:

```
POST /super-admin/tenants/<id>/activate
→ 400 {"error":"ONBOARDING_NOT_READY","failing":["≥50% de productos sellable"]}
```

Una clínica cuyo catálogo entero son servicios tiene `productsTotal = 0`, y con cero el check está
en rojo **por definición**: no se podía activar nunca. Y en DRAFT no hay OWNER, así que tampoco
había forma de añadirle un producto a mano. Es el mismo tipo de bloqueo que `catalogo-en-alta`
encontró con el cajero técnico, y lo encontró lo mismo: recorrer el camino entero en un e2e.

Lo que mide el check es «¿hay catálogo que el TPV pueda vender?», y un `SERVICE` con
`sellableViaTpv` **sí** se vende desde la rejilla (`tpv-catalog/routes.ts` no filtra por `kind`; el
e2e cobra una quiropodia de 25 € por ahí). Así que cuando no hay ni un producto, se mide el catálogo
de servicios.

**Fallback y no suma, a propósito:** así ningún tenant que hoy pasa el check puede empezar a
fallarlo. Con al menos un `kind = PRODUCT` la cuenta es exactamente la de siempre; sin ninguno, hoy
está en rojo seguro, así que sólo puede mejorar. Un total sumado cambiaría el porcentaje de los
quince tenants de hoy —los de agenda tienen productos **y** servicios— y podría poner en rojo a
alguien que está en verde, que es lo último que puede hacer un check de salud. Hay tres tests para
ese borde (sabotaje 15).

---

## 2 · Tabla de sabotajes

Cada garantía, qué línea de producción hay que romper, qué se pone rojo y **con qué mensaje real**
(ejecutados, no imaginados).

| Garantía | Sabotaje | Rojo | Mensaje real |
|---|---|---|---|
| Los servicios nacen con su duración | `if (false)` en la creación de `ServiceScheduling` | `…-import` · 8 tests | `expected +0 to be 17` · `Cannot read properties of undefined (reading 'durationMin')` |
| La columna `exencion` se lee | `exemptionCause: null` en el parser | `…-csv` + `…-import` · 12 tests | `expected null to be 'E1'` · `expected 200 to be 400` |
| La columna `tipo` se lee | forzar `kind = "PRODUCT"` | `…-csv` + `…-import` · 12 tests | `expected [ …(17) ] to deeply equal []` |
| `E1` con IVA 10 se RECHAZA | quitar la coherencia de `validateLocalProduct` | `…-csv` · 1 test | `expected [ { linea: 2, …(3) } ] to deeply equal []` |
| Un `SERVICE` sin duración se RECHAZA | dejarlo entrar con la duración en `null` | `…-csv` · 1 test | `expected [ { linea: 2, …(3) } ] to deeply equal []` |
| Un `PRODUCT` con duración se RECHAZA | ignorar la columna en los productos | `…-csv` · 1 test | `expected [ { linea: 2, …(3) } ] to deeply equal []` |
| `E1` sólo con la clínica encendida | `if (false)` en la puerta de `clinicalRecordsEnabled` | `…-import` · 3 tests | `expected [ { linea: 2, sku: 'POD-002', …(9) } ] to deeply equal []` · `expected 200 to be 400` |
| **La agenda, DENTRO de la transacción** | `prisma.serviceScheduling` en vez de `tx.` | `…-import` · 2 tests | `expected "spy" to not be called at all, but actually been called 1 times` · `expected 17 to be +0` |
| El producto, dentro de la transacción | `prisma.product` en vez de `tx.` | `…-import` · 3 tests | `expected 17 to be +0` |
| `family` = primera categoría | `family: null` | `…-import` · 1 test | `expected null to be 'quiropodia'` |
| Los defaults son los del panel | `staffRequired: 2`, `onlineBookable: true` | `…-import` · 2 tests | `expected 2 to be 1` |
| El rango de la duración es el del panel | `DURATION_MIN = 0`, `DURATION_MAX = 99999` | `…-csv` · 3 tests | `expected +0 to be 1` · `Cannot read properties of undefined (reading 'motivo')` |
| **El fichero de ayer entra igual** | añadir `tipo` a `COLUMNAS` (obligatoria) | `…-csv` + `catalogo-en-alta-precio` | `Test Files 1 failed` — `CsvInvalidoError` con el CSV real de La Maestranza |
| `products-sellable` cuenta servicios | volver a `productsTotal` a secas | `…-salud` · 2 tests | `expected { id: 'products-sellable', …(5) } to match object { applies: true, ok: true, …(1) }` |
| …y los tenants de hoy cuentan igual | sumar productos **y** servicios | `…-salud` · 3 tests | `expected '22/28 (79%)' to be '20/20 (100%)'` |
| Un catálogo vacío sigue en rojo | quitar el `catalogoTotal === 0 ? false` | `…-salud` + `h1-salud-modulos` · 2 tests | `expected { id: 'products-sellable', …(5) } to match object { ok: false, value: '0/0 (100%)' }` |

**El fake del `$transaction` hubo que reescribirlo para que el sabotaje importante se pudiera ver.**
El primer intento devolvía el MISMO cliente dentro de `$transaction`, así que no podía distinguir
`tx.serviceScheduling.createMany` de `prisma.serviceScheduling.createMany` —las dos escribían en el
mismo mapa y las dos se deshacían con el mismo snapshot— y **escribir la fila de agenda fuera de la
transacción pasaba en verde**. Ahora el `tx` acumula en una zona aparte que sólo se aplica si el
callback termina, y lo que se escriba con el cliente de fuera sobrevive a la vuelta atrás, igual que
en Postgres. El test que lo caza es «si la AUDITORÍA falla, tampoco queda la fila de agenda».

### Verde en local

| Suite | Resultado |
|---|---|
| `pnpm test` (workspace) | 374 ficheros · 5.199 tests · 3 saltados |
| `pnpm test:e2e` (Postgres real) | 38 ficheros · 741 tests |
| `tsc --noEmit` api · `tsc -b` admin | limpio |

El e2e del bloque (`test-e2e/catalogo-servicios-csv.e2e.ts`, 20 tests) recorre:

> alta de la clínica en DRAFT sin Holded (caja + CRM + agenda) → el super-admin le enciende la
> historia clínica → **vista previa del CSV REAL de Rosario** (17 filas, cero saltadas, sin escribir
> nada) → confirmar → 17 productos y 17 filas de `service_scheduling`, todos `kind = SERVICE` y
> `exemption_cause = 'E1'` → «Probar TPV» → el TPV de prueba ve los 17 a 25 € → **cobro de ensayo
> exento**: total 25,00 €, `total_tax = 0`, la línea con `exemption_cause = 'E1'`, `status = TEST` y
> **cero registros fiscales** → el CHECK de Postgres rechaza esa misma línea con un 21 % pegado a la
> causa → `products-sellable` pasa a `17/17 (100%)` → activar → y la dueña ve los 17 en
> `GET /services/scheduling`, cada uno con su duración y su familia, con las 17 duraciones de su hoja
> → y puede cambiar una desde su panel sin tocar el fichero.

---

## 3 · Lo que la suite NO cubre

- **El registro de facturación de un exento cargado por fichero.** El cobro de ensayo es `TEST` y
  por diseño no emite (trigger de verifactu-1b), así que lo que este e2e comprueba es el ticket y su
  línea, no el `DetalleDesglose`. Que un `E1` produzca `OperacionExenta: "E1"` sin `TipoImpositivo`
  lo cubre el bloque `iva-exento-sanitario` con sus dos tickets cobrados de verdad; lo que este
  bloque añade es que el producto nazca con la causa puesta, y eso sí está medido.
- **El fichero de Rosario subido por un navegador de verdad.** El panel se prueba con un `File`
  al que el test le pone `text()` encima (el `Blob` de jsdom no lo implementa, igual que en
  `catalogo-en-alta`). El camino real —elegir fichero → leer → enviar— no se ha vuelto a recorrer a
  mano en este bloque.
- **El bucle visual.** No hay capturas nuevas del panel con las columnas de tipo y duración. La
  tabla scrollea en su propia caja (`overflow-x-auto`, decisión de pantalla de `catalogo-en-alta`) y
  las dos columnas nuevas caben ahí, pero **a 390 y 320 px nadie lo ha mirado en este bloque**; el
  shell del super-admin sigue siendo de escritorio (§4 del done anterior).
- **Las marcas de clínica.** `primeraValoracion`, `tratamientoSesion`, `nivelQuiropodia` y los
  consentimientos **no** entran por el fichero (decisión «lo que NO entra»): nacen en su default y
  se ponen en el panel. El e2e comprueba que nacen apagadas, no que se puedan poner luego — eso lo
  cubren los bloques de clínica.
- **Un fichero mixto de clínica cargado contra Postgres.** El caso «un servicio exento + una crema
  al 21 % en el mismo fichero» está en el banco de unidad y en el parser, no en el e2e: el CSV real
  de Rosario todavía no tiene mostrador.
- **Las dudas abiertas del catálogo de Rosario** (plantillas a medida, IVA de las órtesis de
  silicona, la revisión de niños a 0 €) siguen abiertas: son de ella y de la asesoría, no del
  cargador. Están en `docs/implantaciones/rosario/README.md`.

---

## 4 · Al desplegar

- **No hay migración.** Ni tablas nuevas ni columnas nuevas: `products` ya tiene `kind` y
  `exemption_cause` (de `catalogo-local` y de `iva-exento-sanitario`), y `service_scheduling` ya
  existe desde B-reservas-2. La ruta escribe en las columnas de siempre.
- Se despliega como cualquier otro cambio: `IMAGE_TAG=<sha> bash infra/deploy.sh`. Rollback, el sha
  anterior.
- **API y admin van juntos, pero el admin degrada sin romperse.** El panel lee las cuatro claves
  nuevas con `== null`, así que contra una API vieja pinta «—» en la duración y el tipo de IVA de
  siempre en vez de reventar. El despliegue del repo los sube a la vez de todas formas.
- **Un despliegue sólo de API es seguro:** las tres columnas del CSV son opcionales y la respuesta
  sólo añade claves. Ningún fichero que se cargue hoy cambia de comportamiento.
- Primera comprobación tras desplegar: abrir la ficha de un tenant sin Holded, subir el CSV de
  Rosario y ver la vista previa con las 17 filas, su duración y «Exento · sanitario». **La vista
  previa no escribe**, así que esta comprobación se puede hacer en producción sin consecuencias.
- **El `products-sellable` de la consola cambia de valor para un tenant sin productos.** Pasa de
  `0/0` a `N/N` si tiene servicios. Ningún tenant que hoy esté en verde cambia (§1.7).
- **Cargar el catálogo de Rosario en producción lo hace el implantador tras el despliegue**, no este
  bloque.

---

## 5 · Estado de la rama

- Rama `catalogo-servicios-csv` **pusheada**.
- **PR abierto contra `master`** (sin merge ni despliegue: eso es de Dirección).
- Commits: el prompt del bloque (`5e9da4d`), las tres columnas y la transacción compartida
  (`d9c1dfb`), el arreglo de `products-sellable` con su e2e (`376105f`), y este done.

### Línea para `claude/tablero-direccion.md` (no tengo acceso al fichero)

> **Clínica de Rosario** (podología, sin Holded) — el fichero de alta ya carga sus 17 servicios
> exentos con duración de agenda, en la rama `catalogo-servicios-csv`, con PR abierto y sin
> desplegar. Al recorrer el camino apareció un segundo bloqueo, como en La Maestranza:
> `products-sellable` contaba sólo productos, así que una clínica cuyo catálogo entero son servicios
> **no se podía activar nunca**. Arreglado y con tres tests en el borde para que ningún tenant de hoy
> cambie de color. El camino entero —alta en DRAFT, vista previa del CSV real, carga, cobro de
> ensayo exento sin registros fiscales, activación y los 17 en la agenda con su duración— está
> fijado en un e2e contra Postgres. Falta: desplegar, y que el implantador cargue el catálogo con
> Rosario delante. Las tres dudas de precios de su hoja siguen abiertas con ella.
