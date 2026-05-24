# Prompt para Claude Code — v1.3-Servicios-Pinta

Iteración pequeña paralela a `v1.3-Thalia-Operativa`. Objetivo
único: que el TPV se vea **coherente y completo visualmente para un
negocio de servicios** (peluquería, clínica, taller) cuando
`businessType === "SERVICES"`. Hay piloto de servicios esperando
para esta semana.

**Importante:** la agenda (citas, calendario, asignación de
profesional con horario) queda **fuera de scope**. Eso va en
evolutivos siguientes (v1.4 o v2). Aquí sólo tocamos vocabulario,
plantilla impresa, campo opcional "Atendido por" y refuerzo del
flow de cliente. Es un sprint corto: 1 commit por sub-lote, ~3-4
horas de Code.

Branch `v1-3-servicios-pinta` ya creada desde master en
`5bebe21 fix2 · Bug-Imagenes-Holded`. NO mergear vos: PR ff-only,
yo reviso y mergeo.

## Estado actual de la branch al recibir este prompt

- HEAD: `5bebe21 fix2 · Bug-Imagenes-Holded · 400 + JSON = producto sin foto`
- Sólo este prompt en el commit que verás encima.
- Migrations aplicadas hasta `b18_line_price_override`.

## Lo que YA existe para Servicios (no rehacer)

Audit ya hecho — esto vive en el repo:

- `BusinessType` enum en Prisma con valor `SERVICES`. `Tenant.businessType`
  por defecto RETAIL.
- `apps/tpv-web/src/App.tsx:268` — skip de la pantalla de mesas cuando
  businessType !== HOSPITALITY.
- `apps/tpv-web/src/lib/catalog.ts` — Product con `kind: "PRODUCT" | "SERVICE"`,
  type `BusinessType`, cache del businessType del tenant en sesión.
- `apps/tpv-web/src/pages/SalePage.tsx`:
  - L89: icono `Briefcase` como placeholder para SERVICES (mapa `placeholderIconFor`).
  - L970: toggle SERVICE/PRODUCT visible sólo si businessType=SERVICES.
  - L974: filtro inicial preferido SERVICE.
  - L986: tags se calculan sobre el `kind` filtrado en SERVICES (no
    se mezcla con productos).
- Endpoints admin para editar businessType ya están.

**No repetir lo de arriba.** Code debe partir de eso.

---

# Lote 1 · Vocabulario adaptado por vertical

Hoy varios textos hardcodean palabras de retail: "Venta", "Cobrar",
"Devolver", "Producto". Para `businessType=SERVICES` se ven raros.

**Implementación:**

Crear `apps/tpv-web/src/lib/vocab.ts` con un helper:

```ts
type BusinessType = "HOSPITALITY" | "RETAIL" | "SERVICES";
type VocabKey =
  | "saleAction"        // "Cobrar"     → SERVICES: "Cerrar servicio"
  | "saleNoun"          // "Venta"      → SERVICES: "Servicio"
  | "saleNounPlural"    // "Ventas"     → SERVICES: "Servicios prestados"
  | "itemNoun"          // "Producto"   → SERVICES: "Servicio"
  | "itemNounPlural"    // "Productos"  → SERVICES: "Servicios"
  | "refundAction"      // "Devolver"   → SERVICES: "Anular"
  | "refundNoun"        // "Devolución" → SERVICES: "Anulación"
  | "ticketNoun"        // "Ticket"     → SERVICES: "Comprobante"
  | "historyTitle";     // "Historial de tickets" → SERVICES: "Servicios anteriores"

export function vocab(key: VocabKey, bt: BusinessType): string { ... }
```

Reemplazar los strings hardcodeados en estos archivos por llamadas
a `vocab(key, businessType)`:

- `apps/tpv-web/src/pages/SalePage.tsx` (textos cabecera, botón
  cobrar, empty state)
- `apps/tpv-web/src/pages/CheckoutPage.tsx` (cabecera "A cobrar",
  botón "Confirmar cobro")
- `apps/tpv-web/src/pages/TicketsHistoryPage.tsx` (título, filtros,
  acciones)
- Cualquier otro componente que mencione "venta", "producto",
  "devolver", "ticket" en JSX visible al usuario (NO los identificadores
  internos como nombre de variable o ruta).

**Criterios:**
- Con businessType=SERVICES, ningún texto visible al usuario dice
  "venta", "producto" o "devolver".
- Con businessType=RETAIL: NO debe cambiar nada respecto a hoy
  (test visual con Thalía no debe verse afectado).
- Helper centralizado y exportado para que el Lote 2 (impresión)
  también lo use desde el renderer del ticket.

---

# Lote 2 · Plantilla impresa: cabecera + título

Hoy el ticket impreso lleva cabecera tipo "TICKET DE VENTA". En
servicios queda raro.

**Implementación:**

- Localizar el renderer del ticket (probablemente
  `apps/api/src/print/ticket-template.ts` o similar — buscar
  "TICKET" / "Ticket de venta" en el dir `apps/api/src/print/`).
- Pasar el `tenant.businessType` al renderer.
- Reemplazar el título por `vocab("ticketNoun", bt).toUpperCase()`
  → SERVICES imprime "COMPROBANTE" en cabecera.
- Si el renderer es servidor (Node) y no comparte código con
  `apps/tpv-web/src/lib/vocab.ts`, duplicar la tabla en
  `packages/print-shared/` o copiar el helper al api. NO importar
  cross-paquete sin pensarlo.
- Mantener el formato del resto (logo, NIF, fecha, líneas, totales,
  QR fiscal, pie).

**Criterios:**
- Tenant SERVICES imprime "COMPROBANTE" arriba en vez de "TICKET DE
  VENTA".
- Tenant RETAIL: ningún cambio en el output.

---

# Lote 3 · Campo "Atendido por" en el ticket

En servicios, los clientes preguntan quién les atendió ("Pregunta
por María"). Sin agenda formal de profesionales, basta con un
**campo de texto libre opcional** que se introduce al cobrar.

**Implementación:**

### Backend
- Añadir campo `attendedBy String? @db.VarChar(60) @map("attended_by")`
  al modelo `Ticket` (o donde se persistan los datos del ticket
  cerrado). Migración Prisma `b19_ticket_attended_by` o el número
  libre que toque.
- Endpoint `POST /tickets` debe aceptar el campo opcional en el
  body. Validación Zod: `string().min(1).max(60).optional()`.
- Renderer del ticket (Lote 2): si `attendedBy` está set Y
  `businessType=SERVICES`, imprimir una línea entre cabecera y
  líneas: "Atendido por: María" (estilo discreto). Si vacío o
  RETAIL/HOSPITALITY: ocultar.

### Frontend
- En `CheckoutPage.tsx`, debajo de la línea de cliente y SÓLO si
  businessType=SERVICES, mostrar un input "Atendido por (opcional)"
  con maxlength 60. Persiste a un state local `attendedBy`. Se
  envía en el POST del ticket.
- No es obligatorio: ticket sin attendedBy es válido como hoy.
- En el historial (`TicketsHistoryPage`), mostrar el `attendedBy`
  en la fila si está, en columna nueva visible sólo para tenants
  SERVICES.

**Criterios:**
- Cajero introduce "Laura" en el campo → imprime "Atendido por:
  Laura" en el ticket.
- Cajero deja vacío → ticket impreso no muestra esa línea.
- En RETAIL, el campo no aparece en checkout (no estorba).

---

# Lote 4 · Refuerzo flow cliente para Servicios

En servicios casi siempre el ticket va a cliente identificado
(historial cliente = historial servicios). Hoy el cajero puede
cobrar sin cliente; en SERVICES merece un nudge visual.

**Implementación:**

- En `CheckoutPage.tsx`, cuando `businessType=SERVICES` y NO hay
  cliente seleccionado al confirmar cobro, mostrar un aviso suave
  encima del botón "Confirmar": "Servicio sin cliente asignado.
  ¿Continuar de todos modos?". Botón Continuar (igual al actual) +
  botón Asignar cliente (abre el modal de búsqueda de cliente que
  ya existe).
- No bloquear: el cajero puede continuar sin cliente con 1 tap
  más.
- En RETAIL/HOSPITALITY: comportamiento actual sin cambios.

**Criterios:**
- SERVICES sin cliente: muestra aviso al pulsar Confirmar.
- SERVICES con cliente: confirma directo.
- RETAIL sin cliente: confirma directo (como hoy).

---

# Lote 5 · Empty state grid + botones secundarios

Detalles de pulido visual que destacan en demo a un dueño de
servicios:

- **Empty state del grid de productos** cuando filtro vacío:
  en SERVICES debe decir "No hay servicios que coincidan con la
  búsqueda" o "Aún no has cargado servicios. Configúralos en Holded
  o sincroniza." En RETAIL: dice lo de hoy.
- **Botón "Devolución" en historial** (`TicketsHistoryPage`):
  texto pasa a "Anular" para SERVICES. Ícono también puede cambiar
  (e.g. `XCircle` en vez de `Undo2`) — opcional, sólo si queda
  visualmente coherente.
- **Placeholder de búsqueda en SalePage**: en SERVICES
  "Buscar servicio o cliente…" en lugar del placeholder genérico
  actual.
- **Toggle SERVICE/PRODUCT** (línea 1099 SalePage): si el catálogo
  del tenant SERVICES NO tiene productos (sólo servicios), ocultar
  el toggle entero — no tiene sentido enseñar "Productos" si no hay.
  Se detecta al cargar catálogo: `products.some(p => p.kind === "PRODUCT")`.

**Criterios:**
- Tenant SERVICES sin productos: NO se ve el toggle.
- Tenant SERVICES con productos: SÍ se ve.
- Textos arriba aplicados.

---

# Fuera de scope explícito

- **Agenda / citas / calendario** → próximo evolutivo (v1.4 o v2).
- **Modelo de profesional con horario** → no, sólo el texto libre.
- **Asignación de duración a servicio** → no.
- **Reserva online por el cliente** → no.
- **Notificaciones SMS / email al cliente** → no.

# Cómo entregar

- Branch única `v1-3-servicios-pinta`. Un commit por lote (o
  agrupados si son pequeños). Mensajes en castellano.
- NO mergear. Push y avisar. Yo reviso, mergeo ff-only en master y
  despliego junto con v1.3-Thalia-Operativa.
- Tests donde aporte (helper vocab puro, endpoint con attendedBy).
- Linter y typecheck limpios.
- Si conflictúa con v1.3-Thalia-Operativa al rebasear (porque
  ambas tocan CheckoutPage, schema.prisma, renderer ticket): pedir
  ayuda en la PR description en vez de inventar resolución; yo
  resuelvo durante el merge.

# Cómo probar localmente

- `pnpm dev` levanta todo.
- Cuenta de prueba SERVICES: crear una desde
  `/superadmin/tenants/new` con businessType=SERVICES, configurar
  cajero técnico, cargar al menos 2 servicios + 1 cliente (vía
  Holded o seed mock).
- Verificar el flow completo con esa cuenta y compararlo con la
  cuenta Thalía (RETAIL) para asegurar que RETAIL no se ha tocado.
