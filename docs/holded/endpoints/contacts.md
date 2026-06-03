# Endpoint · `contacts`

Contactos cliente del tenant. Cada `salesreceipt` referencia un
`contactId`. Para mipiacetpv mantenemos una réplica local de contactos y
sincronizamos con Holded en eventos puntuales. El endpoint de search no
está documentado oficialmente — lo hacemos por GET con filtros sueltos
que sí responde la API.

## Qué documentado vs qué real

| Aspecto | Docs oficial | Realidad |
|---|---|---|
| `id` vs `code` | Ambos válidos | `id` asignado por Holded; `code` opcional para tu propio identificador |
| Fiscal data | "Editable" | `taxId` y `legalName` se preservan al sync de warehouse (T-6 v1.1) |
| Search | No documentado | Funciona como GET con filtros — pero usar BD local primero |

## POST `/invoicing/v1/contacts`

```json
{
  "name": "Cliente Acme S.L.",
  "code": "ACME-001",
  "taxId": "B12345678",
  "legalName": "Acme Sociedad Limitada",
  "email": "facturacion@example.com",
  "phone": "+34900000000",
  "isperson": false
}
```

- **`code`** — opcional, identificador del tenant. NO es único en
  Holded; se puede duplicar.
- **`id`** — MongoId asignado por Holded. Es la única referencia fiable.
- **`isperson: false`** para empresa, `true` para persona física.

Respuesta:

```json
{ "status": 1, "id": "65a3b4c5d6e7f89012345678" }
```

## Fiscal data — preservación

Hallazgo T-6 v1.1: al sync de warehouse Holded **preserva** `taxId` y
`legalName` aunque tú no los mandes en el PUT. Es decir: una actualización
parcial de contacto no rompe la fiscal data previa.

## Search — patrón no documentado

Holded no expone un endpoint search formal. Lo que funciona:

```
GET /invoicing/v1/contacts?name=Acme
GET /invoicing/v1/contacts?taxId=B12345678
GET /invoicing/v1/contacts?email=facturacion@example.com
```

- Devuelve array con coincidencias.
- **Política mipiacetpv**: buscar en BD local primero (decisión explícita
  B2). Sólo si no se encuentra, ir a Holded. Razones:
  - Latencia: la API de Holded es ~300-800ms; la BD local <10ms.
  - Cuota de la API tiene límite.
  - El espejo local se actualiza con webhooks (documentados pero no
    consumidos automáticamente — ver decisiones B2).

## Referencias

- Decisiones B2 (contactos search BD local primero).
- T-6 v1.1 (preservación fiscal data en sync warehouse).
- [endpoints/salesreceipt](salesreceipt.md) — uso de `contactId`.

Last-updated: 2026-06-03
