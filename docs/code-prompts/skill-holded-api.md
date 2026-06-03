# Skill · Holded API · Conocimiento operativo del proyecto mipiacetpv

Documento de exploración para crear un skill / runbook con TODO lo aprendido sobre la API de Holded a lo largo del proyecto. NO toca código de producción. Crea rama `docs-holded-api-skill` desde master, un commit, sin merge.

## Contexto

A lo largo del desarrollo de mipiacetpv hemos descubierto comportamientos no documentados o mal documentados de la API de Holded. Cada descubrimiento está disperso por commits, comentarios en código, hotfixes y memoria de sesiones. Para futuros desarrollos (SDK abierto, integraciones de terceros, nuevos verticales, evolutivos) necesitamos consolidar ese saber en UN único documento maestro.

El objetivo es que un desarrollador nuevo pueda leer este skill y entender:
- Qué endpoints existen y cómo se comportan REALMENTE (vs lo que dice la docs oficial).
- Los "silent rejects" y patrones de fallo que descubrimos.
- Los workarounds aplicados y por qué.
- Las idempotencias, retries, tolerancias.

## Cambios

(1) Crear `docs/holded/README.md` como punto de entrada con índice.

(2) Crear sub-documentos por área. Mínimo:

### `docs/holded/endpoints/salesreceipt.md`

- `POST /invoicing/v1/documents/salesreceipt` — payload mínimo definitivo (spike §05.A).
- `approveDoc: true` obligatorio para nacer con docNumber.
- Items: `name`, `units`, `price`, `tax`, `discount?`, `sku?`, `serviceId?`, `desc?`.
- **Cómo distinguir PRODUCT vs SERVICE** (hotfix8): productos → `sku` canónico; servicios → `serviceId` con el MongoId del servicio. Excluyentes.
- "Silent reject" pattern: 200 OK + JSON con `id`, pero el documento sale con `total=0`, `subtotal=0`, `products[*].price=0`, `products[*].sku=0`. Hay que hacer GET-back y validar invariantes.
- `notes` con `TPV-uuid: <externalId>` como única vía confiable de idempotencia (Holded no respeta headers `Idempotency-Key`).
- `numSerieId` opcional; si omites usa la serie default.
- `GET /invoicing/v1/documents/salesreceipt?starttmp=X&endtmp=Y` requiere AMBOS extremos del rango.
- `GET /invoicing/v1/documents/salesreceipt/:id` puede devolver `Content-Type: text/html` pese a que el cuerpo es JSON válido (bug Holded).
- `GET /invoicing/v1/documents/salesreceipt/:id/pdf` devuelve JSON con `{status, data: base64}` y Content-Type mentiroso (spike §06.B).

### `docs/holded/endpoints/services.md`

- `GET /invoicing/v1/services?page=N` paginado.
- Los servicios NO tienen `sku` real, solo `id` (MongoId) + opcional `code`.
- El campo `forSale` se ignora para servicios en mipiacetpv (hotfix3) porque es flag del TPV propio de Holded irrelevante para nosotros.
- `POST/PUT /invoicing/v1/services/{id}` — NO implementado en nuestro cliente todavía. Documentar shape.

### `docs/holded/endpoints/products.md`

- `GET /invoicing/v1/products?page=N` paginado.
- Productos sí tienen `sku` canónico asignable. `runAutoSku` los genera para mipiacetpv.
- `PUT /invoicing/v1/products/{id}` con `sku` asignable.
- `forSale` aquí sí indica "disponible para venta". Lo respetamos.
- Imágenes: el `/products` lista NO incluye `imageUrl`. Hay que pegar a `/invoicing/v1/products/{id}/image` separado.

### `docs/holded/endpoints/pay.md`

- `POST /invoicing/v1/documents/salesreceipt/{id}/pay` registra cobro.
- `date` obligatorio (epoch seconds — spike §04.E).
- `amount` numérico con precisión float64 → tolerancia 5 céntimos (hotfix9).
- `paymentsPending` tras pay debe ser ≈ 0; si no, silent reject (lanza HoldedSilentRejectError).
- **Idempotencia** (hotfix10): pre-check GET-back; si ya está pagado, no postear de nuevo (evita doble cobro).

### `docs/holded/endpoints/contacts.md`

- `POST /invoicing/v1/contacts` — crear contacto cliente.
- `code` vs `id` — `id` se asigna por Holded, `code` opcional para tu propio identificador.
- Fiscal data: `taxId`, `legalName` se preservan al sync de warehouse (T-6 v1.1).
- Endpoint de search no documentado oficialmente, lo hacemos por GET con filtros.

### `docs/holded/endpoints/taxes.md`

- `GET /invoicing/v1/taxes` lista todos los impuestos del tenant.
- Cada uno con `id`, `name` (ej. "s_iva_21"), `value` (21 = 21%).
- mipiacetpv los sincroniza y los aplica en `tax` de cada item.

### `docs/holded/patrones/silent-reject.md`

- Concepto: Holded responde 200 OK pero el GET-back muestra estado inconsistente. NO es excepción del cliente HTTP.
- Cómo detectarlo: comparar invariantes (`expectedTotal` vs `stored.total`, etc.).
- Cómo recuperarse: marcar ticket como SYNC_FAILED con detalle, dejar al worker reintentar.
- Casos reales: total=0 en servicios sin `serviceId`, paymentsPending fuera de tolerancia, docNumber=null en doc no aprobado.

### `docs/holded/patrones/idempotencia.md`

- Holded NO respeta `Idempotency-Key` headers.
- Solución: incluimos UUID v4 propio en `notes` ("TPV-uuid: <externalId>") y comprobamos antes de re-postear.
- Para `pay` no hay ese mecanismo — pre-check con GET-back.

### `docs/holded/patrones/tolerancias.md`

- TOTAL_TOLERANCE_EUR = 0.05 (5 céntimos). Aritmética float64 con IVA 21% genera epsilons de ~0.01.
- Aplicar al comparar `expectedTotal` con `stored.total` y `paymentsPending` con 0.

### `docs/holded/patrones/content-type.md`

- Holded devuelve a veces `Content-Type: text/html` cuando el cuerpo es JSON. Patrón en endpoints `/pdf` y algunos GET de detalle.
- Nuestro `ApiKeyClient` valida Content-Type estrictamente y lanza `HoldedInvalidResponseError`. Para esos casos hay que usar `fetch` directo bypass del cliente.

### `docs/holded/patrones/paginacion.md`

- Patrón estándar: `?page=N` con `page=1, 2, ...`.
- Detectar fin: cuando devuelve array vacío.
- NO hay `total_count` ni metadata.
- Algunos endpoints (rango temporal de documentos) exigen `starttmp` Y `endtmp` simultáneamente, no se puede omitir uno.

### `docs/holded/runbook.md`

Errores comunes y solución, formato similar a `docs/errores/README.md`:

- "Documento creado a 0€" → silent reject. Validar `serviceId` vs `sku`.
- "Doble cobro tras reintento" → falta idempotencia en pay.
- "404 sobre PUT /products/{id}" → es servicio, no producto. Mandar a `/services/{id}`.
- "ECONNREFUSED al pegarle a Holded" → rate limit o caída temporal; retry exponencial.

## Convenciones del skill

- Cada subdocumento empieza con un resumen de 5 líneas + tabla "qué documentado, qué real".
- Ejemplos de payload reales (anonimizados — sin emails ni IDs de clientes).
- Referencias a commits + hotfixes donde se aplicaron los workarounds.
- Last-updated al final.

## Out of scope

- Tutorial de "cómo dar de alta una API key de Holded" — eso es manual de implantadores, no skill técnico.
- Comparativa con otros ERPs (Quickbooks, Xero, etc.).

## Cómo se usará

- Onboarding de desarrolladores nuevos al proyecto mipiacetpv.
- Base de cualquier SDK público o integración de terceros.
- Si abrimos consultoría de integración con Holded para otros proyectos, este es el punto de partida.
