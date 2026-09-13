# Bloque · el catálogo nace en la BD (escalón 2 de la independencia de Holded)

## Por qué existe este bloque

El 2026-09-05 se decidió que **Mi Piace no entra en ERP y no será SIF**. Esa decisión tuvo una
consecuencia que se descubrió al tomarla: hoy Holded hace **dos** trabajos a la vez, el sistema
fiscal y **la autoridad del catálogo**. Al renunciar a lo fiscal, el TPV tiene que quedarse con
lo otro. No es opcional: cualquier sustituto barato de Holded cubre la mitad fiscal, no la del
catálogo.

Traducido a lo que se ve hoy: **un cliente con caja no puede vender nada que no esté en Holded.**
`Product.holded_product_id` es NOT NULL, el schema titula el bloque *"Catálogo (cache local de
Holded)"*, y en el admin no existe ni una ruta de escritura de producto. La única pantalla bajo
"Productos" (`/admin/products`) es la bandeja de SKUs silenciados, no un CRUD.

H1 abrió la puerta a la empresa **sin caja**. Este bloque abre la de la empresa **con caja y sin
Holded**.

## Contexto (leer antes)

- `docs/design/adr-016-la-caja-es-un-modulo.md` — el patrón de capability que este bloque reutiliza.
- `docs/blocks/h1-done.md` §3 y §7 — cómo se hizo la puerta de 403 y cómo se migró con `DEFAULT`.
- `docs/04-stack-y-decisiones.md` §ADR-010 — "verificar siempre con GET tras escritura". Es el
  fundamento del patrón silent-reject y hay que respetarlo en todo lo que siga hablando con Holded.
- `docs/07-nucleo-comun.md` §2.5 (auto-SKU) y §2.6 (comodines `TPV-OTROS-*`).
- `apps/api/src/onboarding/auto-sku.ts` — de dónde sale el patrón `AUTO-<8>` y por qué los SERVICE
  nunca se mandan a Holded.

## El hallazgo que define el alcance

El inventario del acoplamiento (13-09) dejó tres puntos de fricción, y sólo tres:

1. **La clave de identidad.** `@@unique([tenantId, holdedProductId])` es hoy la clave del sync.
   **Buena noticia**: en Postgres un índice único trata los NULL como distintos entre sí, así que
   varios productos locales con `holded_product_id = NULL` conviven sin romper la constraint. No
   hace falta rediseñar la clave: hace falta dejar de usarla como *identidad* y usarla sólo como
   *enlace*.
2. **`apps/api/src/agenda/checkout.ts:158,188`** tipa `holdedProductId: string` **no-nullable** y lo
   puebla directo. Es un error de compilación en cuanto el campo admita null. Hay que resolverlo, no
   silenciarlo con un `!`.
3. **La rama SERVICE de `apps/api/src/tickets/upload-ticket.ts:309-316`**: si un servicio llega sin
   `holdedProductId`, la línea se manda a Holded sin `serviceId` ni `sku`, Holded la pone a `price=0`
   y el ticket entero cae por mismatch de total — **en silencio**. Ya pasó con Peluquería Sole y está
   documentado en el propio código. Un producto local que llegue a esa rama es dinero perdido sin
   aviso.

El punto 3 es el que fija la frontera del bloque: **un producto LOCAL nunca debe llegar al payload
de Holded**. Por eso el alcance es "catálogo local para el tenant que no tiene Holded", y no
"catálogo mixto".

## Alcance

### 1 · Datos

- `Product.holdedProductId` pasa a **nullable**.
- Columna nueva `source ProductSource` (enum `HOLDED | LOCAL`), `NOT NULL DEFAULT HOLDED`.
  El DEFAULT es lo que hace la migración aditiva y segura: todo lo que ya existe nace como HOLDED
  y se comporta exactamente igual que hoy. Mismo patrón que `caja_enabled` en H1.
- Unicidad nueva: **`@@unique([tenantId, sku])` parcial, sólo donde `source = LOCAL`** (índice
  único parcial de Postgres, no constraint de Prisma a secas). Un SKU local no se repite dentro del
  tenant; los SKU que vienen de Holded no se tocan, que ya llegan como llegan.
- La migración **no debe tomar bloqueo largo sobre `products`**: añadir columna con DEFAULT y
  relajar un NOT NULL son operaciones de metadatos en PG ≥ 11, pero **verifícalo y dilo en el done**.

### 2 · El CRUD que hoy no existe

Pantalla de catálogo en el admin (`apps/admin/src/pages/`), con listado, alta y edición:

- Campos: nombre, **SKU (obligatorio)**, precio base, tipo de IVA, `kind` (PRODUCT | SERVICE),
  código de barras, tags, activo.
- **El SKU es obligatorio desde el minuto uno y esto no es negociable.** Es la llave del casamiento
  el día que ese cliente encienda Holded. Gratis ahora; carísimo después, cliente a cliente y a mano.
- Sugerencia de SKU al crear, reutilizando el criterio que ya existe (`buildAutoSku`), pero
  **editable**: el propietario manda.
- Validación de SKU: no vacío, sin espacios en los extremos, único dentro del tenant entre los
  locales, y aviso claro (no un 500) si choca.
- Sólo se pueden crear/editar productos **LOCAL**. Un producto `source = HOLDED` se muestra en el
  listado pero **no se edita desde aquí**: su autoridad sigue siendo Holded y editarlo aquí lo
  pisaría el siguiente sync a los 15 minutos. Dilo en la pantalla, no lo dejes en un campo gris.

### 3 · Las puertas

- **El sync no toca lo local.** `initial-sync.ts:399`, `incremental-sync.ts:489` y
  `reconcile.ts:139` filtran por `source = HOLDED` en todo lo que escriben o archivan. Un producto
  local no puede ser archivado por la conciliación por "no estar en Holded": es que nunca estuvo.
  Esto es lo primero que hay que probar con sabotaje.
- **El upload a Holded nunca ve un producto local.** En `upload-ticket.ts`, un `Product` con
  `source = LOCAL` no puede entrar en la rama SERVICE ni en la de producto con `sku`. Decide y
  documenta qué pasa si ocurre — pero que **falle ruidosamente**, nunca en silencio con `price = 0`.
- **Alta local sólo donde tiene sentido**: si el tenant tiene Holded conectado, el alta local queda
  cerrada en esta versión (403 con mensaje que explique por qué, patrón de `caja-gate.ts`). El
  catálogo mixto es un bloque posterior y tiene su propia conversación de producto.
- **El TPV vende lo local igual que lo demás**: el filtro de `tpv-catalog/routes.ts:81-86`
  (`active`, `sellableViaTpv`, `sku` no nulo) ya vale tal cual para un producto local bien creado.
  Verifica que no hay ningún otro sitio que asuma Holded para pintar o cobrar.
- `agenda/checkout.ts` deja de tipar `holdedProductId` como no-nullable y trata el caso de verdad.

### 4 · Forward-only al conectar Holded

Si un tenant con catálogo local conecta Holded después: **no se suben los productos locales ni los
tickets del periodo local**. Generaría documentos fiscales con fecha pasada. El histórico local se
queda local y Holded arranca limpio. En este bloque basta con **dejarlo escrito y que el código no
lo intente**; el casamiento por SKU es trabajo de otro bloque.

## Restricciones

- Sigue la metodología de front de Mi Piace y el sistema visual (tokens, DM Sans, `tabular-nums`
  en importes, sentence case, sin modales en flujo crítico, estado vacío informativo).
- Puedes usar el MCP de 21st para buscar componentes (un listado con filtros, un formulario de
  alta); **normalízalos a los tokens del proyecto antes de cerrar el bloque**. Ninguno entra con su
  estilo original.
- Cuando la pantalla renderice, **hazte screenshots con Playwright**, revísalos críticamente contra
  los principios UX y el estándar de acabado, e itera hasta que cuadren. Matriz mínima: móvil
  320 px, móvil 390 px, escritorio, un estado de error y el listado vacío.
- Nada de `pnpm db:generate` olvidado: este worktree es nuevo.
- Commitea por frente cerrado en tu rama. **No hagas push ni merge**: eso lo hace Matías.

## Entregables

- La migración, aditiva, con su nota sobre el bloqueo.
- El CRUD completo en el admin, con su pantalla y sus rutas de API.
- Las cuatro puertas del §3, cada una con su test.
- Un ADR nuevo en `docs/design/` — el catálogo tiene autoridad local — siguiendo el formato de
  ADR-016.
- `docs/blocks/catalogo-local-done.md` con la plantilla de cierre del proyecto. En particular:
  **las decisiones tomadas sin preguntar, una a una y con su justificación**, y la tabla
  **sabotaje → test en rojo** (rompe cada guarda a mano y demuestra qué test la caza), más qué NO
  cubre la suite.

## Criterio de "funciona"

No es que la suite esté verde. Es que estas cinco frases sean ciertas y estén demostradas:

1. Un tenant **sin Holded y con caja** da de alta tres productos con SKU, los ve en el TPV y cobra
   un ticket con ellos.
2. Ese ticket **no intenta subir nada a Holded**, y se ve en los logs que no lo intenta.
3. El sync incremental corre contra un tenant con catálogo mixto de pruebas y **deja intactos** los
   productos locales: ni los pisa, ni los archiva.
4. Un tenant **con Holded** que ya existe hoy se comporta **exactamente igual que antes** del
   bloque. Esta es la que más importa: Sole, Cachitos, Thalía y La Maestranza están vivos.
5. Dar de alta un producto sin SKU es imposible por la interfaz y por la API.

## Fuera de alcance (explícito)

- El **renombrado a `ErpAdapter` / `externalProductId` / `externalSource`** — es el escalón 1 y va
  en su propio bloque. Aquí se añade `source`, no se renombra nada de lo existente.
- **Catálogo mixto** (local + Holded en el mismo tenant a la vez, con alta local abierta).
- **Subir productos locales a Holded** y el casamiento por SKU al conectarlo.
- `ProductVariant`: hoy está huérfano, no se escribe desde ningún sitio. Se deja como está.
- Los comodines `TPV-OTROS-*` y su flujo — siguen exactamente igual.
- La bandeja de revisión de SKU: es de productos de Holded, no la toques.
- Nada fiscal. Este bloque no acerca ni aleja a mipiacetpv de ser SIF.
