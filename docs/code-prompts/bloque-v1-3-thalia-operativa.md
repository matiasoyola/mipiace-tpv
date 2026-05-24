# Prompt para Claude Code — v1.3-Thalia-Operativa

Iteración tras `v1.2-Lite-fix2` (2026-05-24, fix de imágenes Holded
desplegado y verificado: 177 con foto + 787 sentinel sin-foto + 0
pendientes en tenant Thalía).

Esta tanda son **6 lotes pulido-cliente** para que Thalía esté
contenta operativamente: UX de cobro, cobro mixto rápido, reimprimir
tickets, cierre Z con denominaciones, lector cámara y pie de ticket
configurable. Branch `v1-3-thalia-operativa`, **un commit por lote**,
PR ff-only contra master (NO mergear vos — yo hago el merge tras
revisión).

## Estado de la branch al recibir este prompt

- HEAD: `3785ce5 Lote 1.A · auto-select input cobro al focus`
  (cambio mío en `apps/tpv-web/src/pages/CheckoutPage.tsx` línea 608:
  añadido `onFocus={(e) => e.target.select()}` al input
  `payment.amount` del PaymentRow). Ese sub-lote ya está hecho.
- master: `5bebe21 fix2 · Bug-Imagenes-Holded` desplegado.
- Migrations aplicadas hasta `b18_line_price_override`.

## Estilo de código

Respetar lo de siempre del repo: TS estricto, sin `any` salvo cast
explicado, comentarios en castellano con el porqué del trade-off (no
qué hace, sino por qué), sin emojis en código, sin overformatting,
imports relativos con `.js` suffix. Cuando una decisión sea no obvia
(p. ej. elegir entre listener global vs por-input para atajos),
dejar nota corta inline. Tests donde tenga sentido (helpers puros,
endpoints nuevos); UI no es prioridad de cobertura.

---

# Lote 1 · UX cobro pulido (resto de 1.A ya hecho)

**Contexto:** Matías acaba de probar el flujo de cobro real en el
TPV. El modal de checkout es funcional pero le faltan 3 detalles para
ser rápido en mostrador:

1. **1.A · onFocus select del input recibido** — ✅ ya hecho en
   `3785ce5`. NO duplicar.
2. **1.B · Atajos de teclado en el modal de checkout.** Con `Enter`
   se confirma el cobro (equivalente a pulsar "Confirmar cobro
   X,XX €"). Con `Esc` se cancela y vuelve a la vista de venta.
   `Enter` SÓLO dispara si el botón Confirmar está habilitado (no
   en estados intermedios: cargando, sin método elegido, recibido
   < total y método CASH). Hook a nivel del componente modal, no
   global; ya el listener debe limpiarse al desmontar.
3. **1.C · Flash rojo + texto auxiliar cuando recibido < total**
   en pagos en CASH. Hoy el input `payment.amount` acepta cualquier
   número sin avisar visualmente. Cuando `parseAmount(payment.amount)
   < remainingForThisPayment` y método es CASH, marcar el borde
   del input en rojo coral (clases existentes
   `mipiace-coral-dark` ya en paleta) + mostrar debajo
   "Falta X,XX €". Cuando el importe iguala o supera, vuelve al
   estilo normal. **No bloquear** el confirmar — el cajero puede
   querer aceptar fiado (el guard fuerte lo hace ya el backend).
4. **1.D · Botón "Justo" más visible.** Ya existe en `CashQuickKeys`
   (`apps/tpv-web/src/pages/CheckoutPage.tsx` línea 632) pero queda
   abajo en la fila de atajos +5/+10/+20/+50. Subirlo a una posición
   destacada (botón ancho debajo del input recibido, "Importe
   exacto · 21,96 €") — 1 tap mete el total exacto, change=0. Mantener
   los otros atajos donde están.

**Criterios de aceptación:**
- En modal checkout, foco implícito en el input cash al abrir; un
  Enter sin más cierra el cobro si está completo.
- Probar en navegador: introducir 15 sobre total 21.96 muestra rojo
  + "Falta 6,96 €". Introducir 30 vuelve a normal y muestra cambio
  8,04 € como ya hace.
- Botón "Importe exacto" pone el total del cobro restante en el
  input cash con un solo tap.

---

# Lote 2 · Cobro mixto en 1 tap

**Contexto:** Hoy "Cobro mixto" en checkout abre dos PaymentRow
(efectivo + tarjeta) ambos con valor inicial `total / 2`. El cajero
tiene que editar manualmente uno de los dos. Caso típico real:
"Tengo 10 € sueltos, el resto con tarjeta" → 4 taps hoy.

**Implementación:**
- Cuando se activa "Cobro mixto (partir entre métodos)", presentar
  un step rápido: dropdown de método primario + input "Importe en
  ese método" + 4 atajos `+5/+10/+20/+50`. Al confirmar, se crean
  los dos PaymentRow con el importe primario fijo y el resto al
  método secundario (el otro, por defecto CARD si primario es CASH y
  viceversa). El usuario puede después tocar cualquier fila para
  ajustar.
- UI: reutilizar componentes. NO añadir librería de modales — usar
  el mismo card del modal de checkout, sólo un view-switch interno
  (estado `mixedSplitMode: "input" | "rows"`).
- Edge case: si suma de los dos PaymentRow no cuadra con total (por
  ej. el cajero edita en rows después), seguir comportándose como
  hoy: el botón Confirmar dispara `paymentsSum >= total`.

**Criterios:**
- "Tengo 10 efectivo, resto tarjeta" sobre total 21,96 €: 3 taps
  (mixto → input 10 → atajo aplicar). Las dos filas quedan 10,00 +
  11,96.
- En el step de input, atajo +20 sobre 0 deja 20; +20 sobre 20 deja
  40 (capeado al total para no pedirle al cliente más del importe).

---

# Lote 3 · Reimprimir ticket desde historial

**Contexto:** `apps/tpv-web/src/pages/TicketsHistoryPage.tsx`
comentario actual menciona "reimprimir (B5)" pero NO está
implementado. Cliente real lo pide cuando un cliente vuelve y
quiere copia.

**Implementación:**
- Endpoint backend `POST /tickets/:id/reprint` en
  `apps/api/src/tpv-tickets/routes.ts` (o donde estén las rutas de
  tickets). El endpoint:
  - Verifica que el ticket pertenece al tenant del cajero.
  - Crea un nuevo `print_intent` con `kind: "REPRINT"` y
    `ticketId` referenciado. NO genera un nuevo ticket fiscal — sólo
    una orden de impresión que el bridge B5 captura. El PDF
    re-renderizado usa el mismo contenido + un sello visible
    "COPIA — no fiscal" en cabecera del ticket impreso (no del
    ticket fiscal Holded; eso ya está cerrado).
  - Devuelve `202` con el `printIntentId`.
- Si NO existe la tabla `print_intent`, mirar cómo se gestionan
  hoy los `intent` de impresión en B5 — el modelo existe y se usa
  para tickets nuevos / regalo. Reusarlo con `kind: REPRINT` (añadir
  el enum value en Prisma si no está, migración tipo `b19_*`).
- Renderer del ticket: pasar bandera `isReprint` al template,
  añadir línea visible en cabecera ("REIMPRESIÓN · {fecha original}
  · operario {nick original}"). Footer mantiene QR y datos
  fiscales originales.
- Frontend: en `TicketsHistoryPage`, añadir botón "Reimprimir" en
  cada row y en el detalle. POST al endpoint, mostrar toast
  "Enviado a impresora" / error.

**Criterios:**
- Llamar al endpoint con un ticketId válido genera un printIntent
  visible en la cola del bridge B5.
- Reimpresión no aparece como ticket nuevo en `/tickets` listado.
- El impreso lleva "COPIA — no fiscal" arriba.

---

# Lote 4 · Cierre Z con denominaciones

**Contexto:** Hoy `CloseShiftModal.tsx` pide un sólo número
"efectivo contado". Cliente real cuenta por denominaciones
(€500/€200/€100/€50/€20/€10/€5/€2/€1/€0.50/€0.20/€0.10/€0.05
/€0.02/€0.01). Falta también el X intermedio (consulta en mitad
del turno sin cerrarlo).

**Implementación:**

### Backend
- Tabla nueva `ShiftCashCount` (Prisma model, migración
  `b19_shift_cash_count` o el siguiente número libre):
  ```
  model ShiftCashCount {
    id          String   @id @default(uuid()) @db.Uuid
    shiftId     String   @map("shift_id") @db.Uuid
    shift       Shift    @relation(fields: [shiftId], references: [id])
    kind        ShiftCashCountKind   // "X" | "Z"
    denominations Json   // {"500":0,"200":0,...,"0.01":5}
    cashTotal   Decimal  @db.Decimal(12,2)
    createdAt   DateTime @default(now()) @map("created_at")
    @@index([shiftId, createdAt])
  }
  enum ShiftCashCountKind { X Z }
  ```
- Endpoint `POST /shift/:id/cash-count` body `{ kind: "X" | "Z",
  denominations: Record<string, number> }`. Calcula `cashTotal` en
  backend (no fiar del cliente), persiste. Si `kind=Z` y ya existe
  un Z para ese shift → 409. Si `kind=Z`, internamente llama al
  flujo de cierre existente (`POST /shift/:id/close`) pasando
  `cashCounted: cashTotal`.
- Endpoint `GET /shift/:id/cash-counts` → lista para mostrar
  histórico de X+Z del turno (útil cuando hay varios X).

### Frontend
- `CloseShiftModal`: extender con tabla denominaciones (15 filas,
  input numérico por unidad + subtotal autocalculado por fila +
  total al pie). El campo `cashCounted` actual queda como
  `total auto-calculado` (read-only) en el body — el cajero ya no
  lo edita directo.
- Nuevo botón "Arqueo X" en la pantalla de venta (sidebar) —
  abre modal con la misma tabla pero llama a `POST /shift/:id/cash-count`
  con `kind:"X"` y NO cierra turno. Muestra después la diferencia
  vs `cash esperado` (ventas en cash del turno + opening float si
  hubiera). Resultado mostrado: "Cash esperado 145,30 € · Cash
  contado 144,80 € · Descuadre −0,50 €".
- Z al cerrar: la misma diferencia se muestra en el modal de
  confirmación final con énfasis visual si > 5 € en valor absoluto.

**Criterios:**
- X en mitad de turno crea registro `kind=X`, NO cierra turno.
- Z al final crea registro `kind=Z` Y cierra turno (un único POST
  del frontend, atómico en backend).
- Tabla denominaciones con un solo input por denominación. Subtotal
  por fila visible. Total al pie del modal coincide con
  `methodTotals` que se manda.

---

# Lote 5 · Lector cámara código de barras

**Contexto:** USB scanner ya funciona (en `SalePage.tsx` línea
341-374, detecta `paste + Enter` y resuelve barcode). Para iPad sin
USB, falta integrar la cámara como input alternativo.

**Implementación:**
- Botón "Escanear" en `SalePage` (sidebar al lado del buscador, o
  como icono ⊕ junto al input search) → abre modal full-screen con
  `<video>` que muestra preview de cámara trasera + cuadro guía.
- Librería: `@zxing/browser` (15kb gzipped, mantenido,
  decodificación EAN-13/UPC-A/EAN-8/Code-128 que es lo que tiene
  Thalía). NO `quagga` (abandonado).
- Al detectar barcode válido (>= 8 dígitos, checksum correcto),
  cerrar modal + llamar a la MISMA función que el USB scan
  (extraer a `addByBarcode(code: string)` si no está ya
  factorizada). Confirmación háptica si está disponible
  (`navigator.vibrate(40)`).
- Manejo de permisos cámara: si denegado → toast explicando que
  Settings > Safari > Camera. Si no hay cámara → ocultar botón.
- Performance: parar el stream al cerrar modal (sin esto el LED
  de cámara del iPad queda encendido y consume batería).

**Criterios:**
- Pulsando "Escanear" se abre la cámara y se escanea un EAN-13 real
  en < 2 s en iPad (probado por Matías).
- Producto añadido a la línea con la misma ruta que USB.
- Cerrar modal apaga la cámara (verificar con LED off).

---

# Lote 6 · Pie de ticket configurable

**Contexto:** Hoy todos los tickets impresos llevan el mismo
contenido al pie (datos fiscales). Cliente quiere personalizar un
mensaje ("Gracias por su compra. Cambios hasta 14 días con ticket.").

**Implementación:**

### Backend
- Campo nuevo en `Tenant`: `receiptFooter String? @db.Text`
  (nullable, max ~200 caracteres aplicado por Zod en el endpoint
  admin). Migración `b20_tenant_receipt_footer` (o el siguiente
  libre). Default `null` (sin pie custom).
- Endpoint admin `PATCH /super-admin/tenants/:id` debe aceptar el
  campo. Schema Zod con `.max(200)`.
- Renderer del ticket (PDF + intent) debe incluir el
  `receiptFooter` si no es null, posicionado **encima del QR/CIF**
  (o donde tenga sentido visual). Mantener el resto del layout
  igual.

### Frontend (admin)
- En `apps/admin/src/pages/SuperAdminTenantDetailPage.tsx` (o donde
  esté la edición fiscal), añadir un campo textarea "Pie de ticket"
  con contador de caracteres y vista previa pequeña (puede ser un
  `<pre>` con el texto que se imprimirá).
- Sin cambios en TPV web.

**Criterios:**
- Editar receiptFooter en admin actualiza el tenant.
- Próximo ticket impreso (o reimpresión del Lote 3) muestra el
  texto añadido.
- Si está vacío, el ticket sigue como hoy sin layout roto.

---

# Cómo entregar

- **Una branch única `v1-3-thalia-operativa`** (ya creada desde
  master, ya tiene el commit `3785ce5` con el 1.A).
- **Un commit por lote** con título `Lote N · <descripción corta>`.
  El 1.B+1.C+1.D pueden ir como un solo commit "Lote 1 · resto UX
  cobro" o tres commits si lo prefieres separado — tu criterio.
- **NO mergear en master**. Cuando termines, dejas la branch en
  origin y avisas. Yo reviso, mergeo ff-only y despliego.
- **Migrations**: si Lote 4 o 6 añaden migración, generar con
  `pnpm prisma migrate dev --name b<NN>_<nombre>` desde el paquete
  db. Verificar que el SQL generado es consistente con el resto
  de migraciones del repo (estilo snake_case, índices nombrados).
- **Lint + typecheck** deben pasar limpios. Tests existentes no
  deben romperse. Tests nuevos donde sumen (helpers de
  cash-counting, endpoint reprint, parser denominaciones).
- **Deploy guidance**: incluir al final del PR description un
  bloque "Notas deploy" con cualquier paso manual (p. ej. "este
  PR añade migración, hace falta `pnpm migrate:deploy` antes del
  rebuild en VPS").

# Cómo probar localmente (orientativo)

- `pnpm dev` levanta api+worker+tpv-web+admin.
- Cuenta de prueba: cualquiera con cajero técnico (modo prueba).
- Para Lote 5 cámara: navegador local sólo da cámara en
  https://localhost (no en file://); usar `pnpm dev` y abrir en
  `https://localhost:5173` con cert dev existente. En iPad real
  por LAN: usar mDNS o IP local.

# Fuera de scope

- B-Hardening B y C (#36, #37): para otra iteración v1.4.
- Onboarding self-service, dashboard tenant, plan/billing: v2.
- Cambios al sync con Holded: ya está estable, no tocar.
- Service worker / PWA: igual.

Cualquier duda de prioridad: el orden de importancia para Thalía
hoy es 1 > 4 > 3 > 2 > 6 > 5. Si tienes que recortar, recorta de
abajo hacia arriba — pero el plan razonable es que entren los 6.
