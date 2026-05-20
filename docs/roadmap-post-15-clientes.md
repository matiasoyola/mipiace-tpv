# Roadmap Mipiacetpv · Evolutivos diferidos a post-15-clientes

Listado de features con coste alto / valor a escala que mantenemos
fuera del MVP y primeras iteraciones (v1.x). El criterio de
activación es **tener 15 clientes implantados y facturando** sobre
mipiacetpv. Antes de ese umbral, el ROI no compensa: el esfuerzo de
desarrollo es alto y solo lo amortizamos cuando ya hay base
suficiente para que cada feature toque a varios clientes a la vez.

Una vez cruzado ese umbral, retomar este documento, priorizar en
función del feedback acumulado de los clientes piloto, y planificar
sprints concretos.

---

## Bloque Inventory C — Post v1.3

Origen: sesión 2026-05-20 con Matías. Análisis comparativo vs. el
módulo Inventario Pro de Holded (25€/mes). Estas 4 features cierran
el 100% de equivalencia funcional con Holded Pro y permiten al
cliente prescindir totalmente del módulo de pago.

### C.1 — OCR de albaranes (foto/PDF → desglose automático)

**Promesa al cliente**: "haces foto al albarán que te trae el
repartidor y el TPV te identifica todos los productos con cantidades.
Confirmas con un toque y se actualiza tu stock."

**Pipeline técnico**:

1. Backend recibe PDF o imagen
2. OCR (Google Vision / Azure Document Intelligence o Tesseract)
3. LLM ligero (Haiku, GPT-4o-mini) con prompt estructurado para
   extraer líneas `{nombre, cantidad, precio}`
4. Fuzzy match contra el catálogo del tenant (nombre + precio,
   threshold ~85%)
5. UI muestra propuesta de match, cajero confirma/edita
6. Batch al endpoint de ajuste de stock

**Esfuerzo**: 2-3 semanas + iteración continua con albaranes reales
de cada vertical.

**Coste operacional**: 0,01–0,05€ por albarán (OCR + LLM).

**Riesgo**: muchos falsos positivos/negativos al principio. Cada
proveedor tiene formato distinto. Necesita feedback loop y
fine-tuning de prompt.

**Valor competitivo**: feature "wow" diferencial. Justifica un plan
superior (p.ej. plan "Pro" propio con +10€/mes que incluya OCR).

**Pre-requisitos antes de empezar**:
- v1.2 Bloque Inventory A desplegado (ajustes de stock manuales
  funcionando, sin OCR)
- v1.3 Bloque Inventory B desplegado (albaranes manuales — captura
  multi-producto sin OCR — para validar el flujo de recepción)
- Decidir proveedor OCR (Google vs Azure vs autohosted Tesseract +
  mejoras)
- Recolectar ~50 albaranes reales de distintos proveedores de los
  clientes piloto para training/eval del prompt

---

### C.2 — Múltiples tarifas + precios de compra por proveedor

**Promesa al cliente**: "puedes tener precio Particular y precio
Mayorista por producto. Y registrar a cuánto te costó comprar cada
producto a cada proveedor."

**Casos de uso**:
- Librería con descuento a profesores/colegios (precio profesor)
- Bar con happy hour (precio happy hour)
- Tienda con tarifa B2B distinta de B2C
- Visibilidad de margen real al propietario

**Modelo de datos**:
- Tabla `price_list` (tenant, nombre, default flag)
- Tabla `product_price` (productId, priceListId, price)
- Tabla `supplier` (tenant, nombre, contacto)
- Tabla `supplier_price` (supplierId, productId, costPrice,
  effectiveFrom, currency)

**UI**:
- Admin: gestor de price lists (CRUD)
- Admin: gestor de proveedores
- TPV: selector de tarifa al iniciar el ticket (o por cliente si
  el contacto Holded tiene una asociada)
- Bandeja: margen por producto / ticket

**Esfuerzo**: 1-2 semanas backend + 1 semana admin UI + 3 días TPV.
Total ~3 semanas.

**Pre-requisitos**:
- v1.x con contactos integrados (ya lo tenemos)
- Decisión: ¿las tarifas se persisten en Holded también? Si Holded
  no soporta multi-tarifa en su plan básico, son solo nuestras —
  visión local.

---

### C.3 — Múltiples idiomas del catálogo

**Promesa al cliente**: "tu catálogo en español, inglés y francés.
El TPV muestra el nombre según el idioma del cajero o del cliente."

**Casos de uso**:
- Librería con libros en inglés/francés
- Tiendas en zona turística (cliente internacional)
- Restaurante con menú multilingüe (vinculado a B-Print futuro)

**Modelo de datos**:
- Columna `translations: Json` en `Product`: `{ "en": {...},
  "fr": {...} }`
- O tabla aparte `product_translation` (productId, locale, name,
  description)

**UI**:
- Admin: editor de traducciones por producto (modal con tabs ES/EN/FR)
- TPV: detección de locale del navegador → muestra el name de ese
  locale, fallback al base (ES)
- Tickets impresos: respetar el locale del cliente si se identifica
  uno (Contact con `locale` field)

**Esfuerzo**: 1 semana modelo + admin, 3 días TPV. Total ~2 semanas.

**Riesgo bajo**: feature aditiva, no rompe nada si nadie traduce
(name base sigue siendo verdad).

---

### C.4 — Transferir stock entre almacenes

**Promesa al cliente**: "muevo 10 unidades del Almacén Central a la
Tienda Norte sin tener que descargar Holded en el portátil."

**Casos de uso**:
- Cadena con almacén principal + N tiendas
- Restaurante con cocina central + barras
- Distribuidor que reparte entre puntos de venta

**Modelo de datos** (ya tenemos `Warehouse`):
- Tabla `stock_transfer` (tenantId, fromWarehouseId, toWarehouseId,
  initiatedBy, completedAt, notes)
- Tabla `stock_transfer_line` (transferId, productId, qty)

**Workflow**:
1. Admin/encargado crea una transferencia: selecciona productos +
   cantidades + almacén origen y destino
2. Se ejecutan dos ajustes en Holded (-qty origen, +qty destino)
3. Audit registra quién y cuándo

**Esfuerzo**: 1 semana backend + 1 semana admin UI. Total ~2 semanas.

**Pre-requisitos**:
- Multi-almacén ya tiene que estar usándose por algún cliente
  (no aplica si todos los clientes son monoprueba)

---

## Criterios para activar este Roadmap

1. **15 clientes activos** sobre mipiacetpv con tickets diarios.
2. **Al menos 5 de esos 15** han pedido al menos UNA feature de este
   bloque (priorizar por demanda real, no por especulación).
3. **Margen estable**: el modelo de cobro del TPV está validado y
   genera ingreso recurrente predecible.
4. **Equipo capaz de mantener v1.x estable** sin distracciones — si
   v1.x todavía está apagando fuegos, esto se difiere más.

## Cómo reactivar este documento

Cuando llegue el momento:

1. Revisar la lista con el equipo y eliminar features que el
   mercado haya invalidado (p.ej. si nadie pide OCR porque los
   proveedores ya envían albaranes electrónicos vía EDI).
2. Reordenar por demanda concreta (cuántos clientes lo pidieron).
3. Convertir cada feature en su propio bloque `bloque-inventory-c-XX.md`
   en `docs/code-prompts/` con spec detallado para Code.
4. Asignar a un sprint concreto.

## Notas de mercado

- Holded sigue facturando ~25€/mes a quien usa su Inventario Pro.
  Cualquier feature que cierre brecha con Pro es **arma comercial
  directa**: "deja de pagar Pro, te lo damos en mipiacetpv".
- El ROI para el cliente final del Bloque Inventory A+B+C completo
  es de ~3 meses (a 30€/mes nuestros vs 25€/mes Pro de Holded +
  base 15€/mes Holded básico que necesita igual).
- Diferenciador clave: nosotros lo entregamos **integrado en el
  flujo del TPV** (no como módulo aparte que el cliente tenga que
  abrir en otra pestaña). Eso es lo que justifica el upcharge.
