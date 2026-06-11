# Bloque v1.4-Buscador-Contactos · 1 lote grande

Mejora del buscador de contactos del TPV para que muestre SOLO contactos de tipo cliente y minimice los datos visibles al cajero. Crea rama `v1-4-buscador-contactos` desde master, un único commit, sin merge.

## Contexto

En operativa real con Peluquería Sole hemos visto dos problemas en el flujo "Añadir cliente al ticket":

(1) **Aparecen proveedores y autónomos**: el sync de contactos desde Holded trae cualquier registro de `/invoicing/v1/contacts`, sin distinguir cliente vs proveedor. La cajera busca a una clienta histórica y entre los resultados aparecen el distribuidor de tintes, la asesoría fiscal, etc. Confunde y rompe la confianza.

(2) **Exposición innecesaria de datos personales**: el buscador del TPV hoy muestra nombre + NIF + email + teléfono completo. La cajera no necesita esos datos para cobrar y abrir la pantalla con DNIs y emails visibles delante de un cliente es mala práctica de privacidad. El cajero debería ver lo mínimo necesario para identificar a la persona.

Holded distingue `type` en cada contacto (`client`, `supplier`, `lead`, `debtor`, `creditor`). Hoy mipiacetpv guarda el `raw` JSON pero no lo lee. Hay que extraer el tipo y filtrar.

## Cambios

### 1 · Modelo de datos

Migración `b29_contact_type` añadiendo:

```prisma
model Contact {
  // ...
  type             ContactType?  @map("type")
  // ...
  @@index([tenantId, type])
}

enum ContactType {
  CLIENT
  SUPPLIER
  LEAD
  DEBTOR
  CREDITOR
  UNKNOWN
}
```

Nullable porque los contactos preexistentes no tienen el dato hasta el backfill.

### 2 · Sync upsert: extraer type del JSON de Holded

En `apps/api/src/contacts/routes.ts` función `upsertHoldedContact`, y en cualquier otro punto que upserte contactos (mirar `apps/api/src/onboarding/initial-sync.ts`):

```ts
function mapHoldedType(raw: unknown): ContactType {
  const t = typeof raw === "string" ? raw.toLowerCase() : "";
  switch (t) {
    case "client":   return "CLIENT";
    case "supplier": return "SUPPLIER";
    case "lead":     return "LEAD";
    case "debtor":   return "DEBTOR";
    case "creditor": return "CREDITOR";
    default:         return "UNKNOWN";
  }
}

// en el upsert:
const type = mapHoldedType((remote as { type?: unknown }).type);
```

Verifica el shape exacto de `type` en la respuesta de Holded antes de codificar el mapping; si tienen otros valores documenta y mapea a UNKNOWN como fallback seguro.

### 3 · Endpoint search filtrado

En `GET /contacts/search` (`apps/api/src/contacts/routes.ts`):

- Por defecto filtrar `where: { tenantId, active: true, type: { in: ["CLIENT", "UNKNOWN"] } }`.
- Incluir `UNKNOWN` porque los contactos preexistentes a la migración tendrán type=null → UNKNOWN tras el backfill. Solo se excluyen `SUPPLIER | LEAD | DEBTOR | CREDITOR`.
- Cuando el fallback a Holded por teléfono se dispare, también aplicar el filtro: si el contacto remoto NO es `client`, no upsertear ni devolverlo (solo registrar log).
- Opcional: query param `?includeAll=1` solo para admin/owner que quieran ver todo (no expuesto en TPV).

### 4 · Backfill de los Contact existentes

Script Node `apps/api/src/scripts/backfill-contact-type.ts`:

- Lee todos los Contact con `type IS NULL`.
- Mira `raw.type` y aplica `mapHoldedType`.
- Hace update en chunks de 200.
- Reporta totales por tipo al final.
- Si el `raw` no trae `type` (caso edge), marca `UNKNOWN` y lista los IDs.

Comando para ejecutar en VPS: `pnpm --filter @mipiacetpv/api tsx src/scripts/backfill-contact-type.ts`.

### 5 · TPV: minimizar datos visibles

En `apps/tpv-web/src/pages/SalePage.contact.tsx` (componente del buscador):

Mostrar solo:
- **Nombre completo** (visible).
- **Últimos 4 dígitos del teléfono** (`•••• 4567`). El campo `phone` completo sigue en el modelo, solo se renderiza enmascarado.

Ocultar del listado de resultados:
- NIF/DNI.
- Email.
- Dirección.

Cuando el cajero selecciona el contacto y lo asigna al ticket, se sigue enviando el `contactId` completo al backend. Los datos completos quedan disponibles para el ticket y la factura de Holded, pero NO se renderizan en la UI del cajero.

Si el cajero necesita ver el email/NIF (caso raro), añadir un botón "Ver datos completos" que pide PIN del OWNER/MANAGER. (Patrón "data on demand").

### 6 · Tests

- `apps/api/test/contacts-search.test.ts`:
  - SUPPLIER no aparece en search default.
  - CLIENT y UNKNOWN sí aparecen.
  - `?includeAll=1` con role=OWNER devuelve TODOS.
  - `?includeAll=1` con role=CASHIER es 403.
- `apps/api/test/contact-backfill.test.ts`: backfill rellena type correctamente desde raw.
- `apps/tpv-web/test/contact-search-list.test.ts` (si hay infra; si no, dejar TODO documentado): el componente NO renderiza NIF ni email.

### 7 · Docs

Actualiza `docs/holded/endpoints/contacts.md` con:
- El campo `type` y sus valores reales.
- La política mipiacetpv: el TPV solo ve `client + unknown`.

Y `docs/errores/README.md` añade entrada explicando el comportamiento previo y por qué se cambió, para que Natalia entienda si un futuro cliente pregunta "¿por qué no aparece mi proveedor en el TPV?".

## Convenciones

- Un único commit, mensaje `v1.4-Buscador-Contactos · filtra type=client + minimiza datos visibles al cajero`.
- NO mergear. Espero `git merge --ff-only`.
- Migración b29 backward-compatible (nullable + default UNKNOWN tras backfill).

## Out of scope

- Reescritura del flujo de creación de contacto desde el TPV (eso ya funciona, B2).
- Webhooks de Holded para sync push (sigue siendo pull).
- UI del admin para gestionar contactos (no la hay y no se abre aquí).
- Importación masiva desde Excel/CSV (es task #22, separada).
