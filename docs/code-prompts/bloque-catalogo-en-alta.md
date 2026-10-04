# Bloque catalogo-en-alta · un bar nuevo sin Holded se puede dar de alta, ensayar y activar

Rama `catalogo-en-alta`, worktree `~/Developer/Claude/Projects/mipiacetpv-catalogo-en-alta`, desde
`master` = `a2941f8`. Escrito el 04-10-2026 preparando el despliegue de La Maestranza.

## Ficha (§5 del tablero)

```
Vertical:          Catálogo en el alta · un comercio nuevo sin Holded y con caja llega a activarse
Familia:           Plataforma (onboarding)
¿Qué cliente lo pide? Bar La Maestranza (sin Holded, decidido el 04-10). Y cualquier alta nueva
                   con caja: desde el 27-09 todo cliente nuevo empieza sin Holded
¿Y qué?:           1) La Maestranza se da de alta, se ensaya con su carta real en modo prueba
                   (cero facturas) y se activa con el dueño delante.
                   2) Sus 128 productos entran de un fichero, no a mano uno a uno.
                   3) El siguiente bar o tienda sin Holded sigue el mismo camino, sin rodeos
Peldaño:           2 (cliente esperando) y 3 (bloquea toda alta nueva con caja y sin Holded)
Primer daño:       ya: La Maestranza tiene catálogo y plan, y no se puede activar
¿Qué desplaza?:    Lo decide Dirección. Propuesta: el hueco del frente C mientras holded-v2
                   espera su paso 0 (tarea humana 5); holded-v2 conserva la prioridad en
                   cuanto el pat_ de PRUEBAS esté listo
Dueño:             bloque catalogo-en-alta (rama propia desde master a2941f8)
```

## Por qué existe

Leído en `master` (`b629a31`) al preparar `docs/implantaciones/checklist-maestranza.md` §0:

1. `POST /super-admin/tenants/:id/activate` exige la salud en verde, y `products-sellable`
   (`superadmin/onboarding-health.ts:365`) **aplica a todo tenant con caja**: con 0 productos es rojo.
2. Sin Holded no hay sync inicial: los productos sólo entran por `POST /catalog/products`
   (`catalog/local-products.ts:378`), con `requireOwnerOrManager`.
3. En DRAFT no hay OWNER (nace al activar), y la impersonación del super-admin necesita uno
   (`superadmin/tenants.ts:1507`, 409 `NO_OWNER`). No hay ninguna ruta de catálogo en el super-admin.

**DRAFT sin productos → no se activa → sin OWNER no entran productos.** Los e2e que activan un alta
sin Holded (`h1-empresa-sin-caja`, `f8-colegio`) son todos sin caja. Sole cortó Holded con el
catálogo ya dentro. Nadie ha recorrido el camino de un comercio nuevo sin Holded y con caja.

Lo que SÍ funciona en DRAFT: «Probar TPV» (`test-cashier-token`) llama a `provisionTestCashier`, que
crea tienda, caja y cajero técnico, y el cajero técnico no emite registros fiscales (verifactu-1b).

## Paso 0 · recorrer el camino entero (PUERTA: no escribas código de producción antes)

Contra la base local y con la API y el admin levantados, haz como super-admin el alta de un bar
**sin Holded y con caja** (hostelería) y empújalo hasta ACTIVE. Apunta en
`docs/blocks/catalogo-en-alta-plan.md` **cada cosa que en DRAFT no se puede hacer** y si bloquea la
activación o sólo la implantación: catálogo, sala (zonas y mesas), cajeros, impresora, datos
fiscales del ticket, y lo que encuentres.

**Puerta.** Si aparece algo, aparte del catálogo, que **bloquee la activación**, entra en este
bloque. Si sólo estorba (se puede hacer después de activar, sin facturas de prueba), se apunta y
no entra. Si el arreglo cambia de tamaño (más de un día), para, haz commit del plan y push, y
dilo: lo redimensiona Dirección.

## Alcance

### 1 · Cargar el catálogo local desde el super-admin

- En la ficha del tenant del super-admin: **«Cargar catálogo»**, sólo para tenants **sin Holded y con
  caja** (DRAFT o ACTIVE). Sube un CSV con las columnas de
  `docs/implantaciones/maestranza/catalogo-tpv.csv`: `sku,nombre,precio_con_iva,iva,categoria`.
- **Vista previa antes de escribir nada**: cuántas filas entran, cuáles no y por qué (SKU vacío o
  repetido en el fichero, precio no válido, IVA fuera de los tramos, SKU que ya existe en el
  tenant). Confirmar escribe; cancelar no deja rastro.
- **Las mismas reglas que el alta local, en el mismo sitio.** Sacad la validación y la creación de
  `local-products.ts` (SKU obligatorio y único por tenant, `normalizeTaxRate`, `normalizeTags`,
  límites de nombre y precio) a una función que usen las dos rutas. Dos copias de la regla es como
  nacen los catálogos que el TPV cobra mal.
- **Un SKU que ya existe no se pisa**: se informa en la vista previa y se salta. Así, cargar el mismo
  fichero dos veces no duplica nada ni cambia precios a escondidas.
- El precio del fichero es **con IVA**, igual que en `CatalogoPage` («Precio con IVA»).
- Todo en una transacción: o entran todas las filas válidas, o ninguna.
- Auditoría: una entrada `catalog_import` con el tenant, cuántas filas entraron y cuántas se
  saltaron. Sin el contenido del fichero.
- Un tenant **con Holded** recibe 409 en la ruta y no ve el botón: es exactamente el catálogo mixto
  que ADR-017 prohíbe.

### 2 · El camino completo, en un e2e

`apps/api/test-e2e/` contra Postgres real, el recorrido de La Maestranza:

alta sin Holded con caja → cargar el CSV → la salud pasa `products-sellable` → «Probar TPV» → una
venta de prueba **sin registro fiscal** → activar → el OWNER ve el catálogo en su panel → primera
venta real con registro `C1/1`.

Y lo que haya salido del paso 0 y haya entrado al alcance.

### 3 · Implantadores

`docs/implantaciones/checklist-maestranza.md`: el §0 pasa a «resuelto por catalogo-en-alta», y el §3
dice cómo se carga el catálogo. Si existe `docs/implantadores/checklist-implantacion-tenant.md`,
añadidle el camino sin Holded.

## Fuera de alcance (declarado)

- Importar en tenants **con** Holded, editar en masa o exportar el catálogo.
- Modificadores, imágenes y estaciones de cocina en el CSV.
- El espejo TPV→Holded del catálogo (bloque aparte).
- Que el OWNER importe desde su panel. Si sale casi gratis reutilizando la misma función, se apunta
  en el done como siguiente paso, no se hace aquí.

## Respeta

- **ADR-017**: el catálogo local sólo existe con Holded apagado (`ensureLocalCatalogWritable`).
- **H1**: sin clave no se toca la red.
- **verifactu-1b**: el cajero técnico no emite ni gasta número; activar purga las pruebas.
- Estética y tokens: `docs/design/tokens.md` y la skill `sistema-visual-mipiace`. Importes con
  `tabular-nums`, sentence case, nada de modales en flujo crítico.

## Cómo se cierra

- Suite entera en verde **en CI** (recuerda el mock literal de `catalog.js` y las variables que tapa
  el `.env` de desarrollo).
- **Tabla de sabotajes.** Cubre estas garantías: la vista previa no escribe; un SKU existente no se
  pisa; la transacción es todo o nada; un tenant con Holded recibe 409; una sola función de reglas;
  el precio se guarda con IVA; y el e2e del camino completo. Para cada una: qué línea de producción
  rompes, qué test se pone rojo y con qué mensaje real.
- Qué NO cubre la suite, dicho por escrito.
- Prueba en el bucle visual: la ficha del tenant con el botón, la vista previa con filas buenas y
  malas a 1280, 390 y 320, y el TPV de prueba con el catálogo de La Maestranza cargado (chips de
  categoría, nombres a dos líneas, precios).
- `docs/blocks/catalogo-en-alta-done.md` con: el recorrido del paso 0, las decisiones, los
  sabotajes, lo que no cubre y cómo se despliega (¿migración?). Al final, actualiza la línea de
  **Bar La Maestranza** en `claude/tablero-direccion.md` si tienes acceso, o deja el texto listo en
  el done. El done dice si la rama está pusheada y si hay PR.
- Commits pequeños con mensaje en español, push de la rama y **PR contra `master`**. Sin merge ni
  despliegue: eso lo hace Dirección.
