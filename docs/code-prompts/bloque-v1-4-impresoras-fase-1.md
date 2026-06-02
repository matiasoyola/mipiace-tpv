# Bloque v1.4-Impresoras-Fase-1 · 4 lotes

Integración nativa con impresoras térmicas ESC/POS. Crea rama `v1-4-impresoras-fase-1` desde master, un commit por lote, sin merge.

## Contexto

Tras spike 2026-06-02 con Peluquería Sole + impresora OEM POS-80 V6.16F (cuerpo blanco, marca china genérica, USB + WiFi, ancho 80mm, soporte ESC/POS):

- **Confirmado**: la impresora funciona bien con ESC/POS plano corto (test print de RawBT pasa).
- **Confirmado**: usar RawBT como puente "PDF → ESC/POS rasterizado" NO funciona — la impresora pierde ACK porque el bitmap satura su buffer interno.
- **Conclusión**: necesitamos generar **ESC/POS plano** directamente desde el backend (no rasterizar PDF) y mandarlo a la impresora:
  - **Vertical SERVICES** (Peluquería Sole, peluquerías, clínicas, talleres) → 1 tablet + 1 impresora USB. Usamos **WebUSB API** de Chrome Android.
  - **Vertical HOSPITALITY** (bares) → varias impresoras en LAN (BARRA + COCINA + caja). Usamos **TCP socket directo** desde el backend a IP:9100.

Hoy `apps/api/src/tickets/send-to-kitchen.ts` (Lote 2 v1.4-Bar-Operativa-MVP) ya genera PDFs por sección que se abren en pestaña nueva. Lo sustituiremos por impresión real.

Documentación maestra: `docs/impresoras/README.md`. Guía de despliegue USB: `docs/impresoras/despliegue-usb.md`. Ampliar tras este bloque.

Los 4 lotes son independientes. Recomiendo el orden listado.

---

## Lote 1 · Modelo PrinterConfig + UI admin

**Motivo**: el implantador necesita configurar las impresoras del cliente desde el panel sin tocar código.

**Cambios BD (`packages/db/prisma/schema.prisma`)**:

(1) Nuevo modelo `PrinterConfig` por register:

```prisma
model PrinterConfig {
  id           String        @id @default(uuid()) @db.Uuid
  registerId   String        @map("register_id") @db.Uuid
  name         String        // Etiqueta para el implantador: "Ticket caja", "Comanda BARRA", "Comanda COCINA"
  mode         PrinterMode   // USB | WIFI
  // WIFI only:
  ipAddress    String?       @map("ip_address")
  port         Int?          @default(9100)
  // Si WIFI: timeout TCP en ms. Default 5s.
  timeoutMs    Int           @default(5000) @map("timeout_ms")
  // Sección lógica para comanderas. NULL = impresora de ticket de cobro (no sección).
  section      KitchenSection?
  // Activa: si false, no se intenta imprimir (para mantenimiento sin borrar config).
  active       Boolean       @default(true)
  // Última vez que imprimió OK. Útil para "alerta: impresora silenciosa hace 3 días".
  lastPrintOkAt DateTime?    @map("last_print_ok_at") @db.Timestamptz()
  // Último error registrado (motivo del fallo). NULL si último intento OK.
  lastErrorAt   DateTime?    @map("last_error_at") @db.Timestamptz()
  lastErrorMsg  String?      @map("last_error_msg")
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz()

  register Register @relation(fields: [registerId], references: [id], onDelete: Cascade)

  @@index([registerId])
  @@index([section])
  @@map("printer_configs")
}

enum PrinterMode {
  USB
  WIFI
}
```

Reutiliza `KitchenSection` ya existente (SALON | BARRA | COCINA) del Lote 2 v1.4-Bar-Operativa-MVP.

Migración: `b27_printer_configs` (b25 y b26 ya están usados; usa el siguiente).

(2) **Endpoints admin** en `apps/api/src/admin/printer-configs.ts` (nuevo):

- `GET /admin/printer-configs?registerId=...` → lista las del register.
- `POST /admin/printer-configs` → crea (con validación: si mode=WIFI, ipAddress e port required).
- `PATCH /admin/printer-configs/:id` → edita.
- `DELETE /admin/printer-configs/:id` → soft delete (`active=false`).
- `POST /admin/printer-configs/:id/test` → genera ESC/POS de prueba y lo manda; devuelve OK o error. Útil para validar config tras editar.

Auth: `requireOwnerOrManager` (no es solo super-admin).

**Cambios admin frontend (`apps/admin/src/pages/PrintersPage.tsx`)**:

(3) Nueva ruta `/admin/printers`. Visible en menú lateral del OWNER/MANAGER tras "Dispositivos".

Vista:
- Por cada register, una sección con sus impresoras.
- Por cada impresora: tarjeta con name, mode (badge USB|WIFI), ip:port si WIFI, section, estado (verde si `lastPrintOkAt` < 24h, ámbar si lastError, gris si nunca usada).
- Botones: **"Probar"** (llama endpoint test), **"Editar"**, **"Eliminar"**.
- Botón "**Añadir impresora**" abre modal:
  - Name (text).
  - Mode (radio USB | WIFI).
  - Si WIFI: IP (input con validación regex IPv4) + Port (default 9100).
  - Section (select SALON | BARRA | COCINA | Ticket).
  - Active checkbox.

Tests vitest del endpoint POST + PATCH.

**Why**: cierra la dependencia. Sin esto, las impresoras son hardcoded en `.env` y no escalan a multi-cliente.

---

## Lote 2 · Generador ESC/POS + endpoint print

**Motivo**: el corazón técnico. Generar el binario ESC/POS plano que la impresora ENTIENDE directamente, sin rasterizar.

**Cambios `packages/ticket-pdf/`** o package nuevo `packages/escpos-builder/`:

(1) Nuevo módulo `packages/escpos-builder/src/index.ts` con funciones puras:

```ts
// Construye comandos ESC/POS para un ticket de cobro.
// Devuelve Uint8Array listo para mandar a impresora (USB o TCP).
export function buildTicketReceipt(ticket: TicketEscposInput): Uint8Array;

// Construye comandos ESC/POS para una comanda de cocina/barra.
// Diseñado para tipografía grande, sin precios (la cocina no necesita verlos).
export function buildKitchenComanda(ticket: TicketEscposInput, section: KitchenSection): Uint8Array;
```

Implementación de bajo nivel con helpers:
- `escInit()` → `\x1B@` reset.
- `escAlign(left | center | right)` → `\x1Ba0`, `\x1Ba1`, `\x1Ba2`.
- `escBold(on | off)` → `\x1BE1`, `\x1BE0`.
- `escSize(width, height)` → `\x1D!` + byte (para títulos grandes).
- `escCut()` → `\x1Bi` o `\x1DV0` (corte completo).
- `escCodePage(pc850)` → `\x1Bt2` para PC850 (multilingüe español).
- `escQrCode(data)` → secuencia QR estándar GS k.
- `escText(s, encoding="cp850")` → encoding correcto para acentos.

Estructura del ticket de cobro:
1. Init + code page PC850.
2. Centro + bold + tamaño grande: nombre del comercio.
3. Centro + size normal: dirección (si la hay en `tenant.taxAddress`).
4. Línea separadora `--------`.
5. Bold: "TICKET #{internalNumber} · {fechaHora}".
6. Bold off: cajero, mesa si aplica.
7. Líneas del ticket: nombre + units x precio + total a la derecha.
8. Línea separadora.
9. Bold + alineado derecha: TOTAL {total} €.
10. Métodos de pago (efectivo, tarjeta) si aplica.
11. Notas si las hay.
12. QR con la URL pública del ticket (`PUBLIC_TICKET_URL/tickets/<slug>/pdf`).
13. Texto pequeño: "Ver ticket: {url}".
14. Feed 3 líneas + cut.

Para comandas:
1. Init + code page.
2. Bold + tamaño grande centrado: nombre de la sección (BARRA / COCINA).
3. Bold: Mesa {tableName} · {hora}.
4. Líneas con tamaño grande (size 2x): nombre + units (sin precios).
5. Modifiers si los hay (tamaño normal, debajo de cada línea).
6. Si hay nota del camarero: bold "NOTA: {nota}".
7. Feed 3 líneas + cut.

Tests vitest: snapshot del binary generado para casos típicos (ticket simple, ticket con modifiers, comanda con 3 líneas, comanda con modifiers).

(2) **Endpoint backend** `apps/api/src/tickets/print.ts`:

- `POST /tickets/:id/print/escpos?target=usb|wifi[&printerConfigId=...]`:
  - Si `target=usb` → devuelve el binary ESC/POS en el body (Content-Type: `application/octet-stream`). El cliente lo mete en WebUSB.
  - Si `target=wifi` → carga el PrinterConfig por `printerConfigId` (o busca el activo del register), abre socket TCP a `ip:port`, manda el binary, espera ACK (lectura del socket con timeout), cierra. Devuelve `{ok: true, printedAt}` o `{ok: false, error}`.
- Auth: `requireCashierSession`.
- Logs estructurados con tenantId, registerId, printerConfigId, ticketId, ok, errorMsg.
- Si OK actualiza `printerConfig.lastPrintOkAt`. Si error → `lastErrorAt`+`lastErrorMsg`.
- Reintento exponencial NO se hace en el endpoint (el TPV decide).

(3) **Endpoint comandas** equivalente: `POST /tickets/:id/send-to-kitchen/escpos`:
- Sustituye el actual `send-to-kitchen.ts` que genera PDFs.
- Para cada sección con líneas, busca el PrinterConfig de esa sección en el register, y manda comanda.
- Si una sección no tiene PrinterConfig configurada → 409 con mensaje "Falta configurar impresora para BARRA en el admin".
- Devuelve resumen por sección: `{barra: {ok, lines}, cocina: {ok, lines}}`.

**Tests**:
- Snapshot del binary de cada caso.
- Mock socket TCP para test del endpoint WIFI.
- Test del fallback a USB (devuelve binary).

**Why**: lo hace todo lo demás posible. Cierra el problema de raíz que descubrimos con RawBT.

---

## Lote 3 · TPV · WebUSB + flow de impresión real

**Motivo**: que el cajero pulse "Imprimir" y la impresora arranque sin intervención manual.

**Cambios frontend (`apps/tpv-web/`)**:

(1) Nuevo helper `apps/tpv-web/src/lib/escposPrint.ts`:

```ts
// Pide al usuario que seleccione la impresora USB una vez.
// Guarda el deviceId en localStorage para reusarla.
export async function pairUsbPrinter(): Promise<USBDevice>;

// Envía un binary ESC/POS a la impresora USB ya emparejada.
// Si no hay emparejada, lanza error.
export async function printEscposUsb(bytes: Uint8Array): Promise<void>;

// Helper para impresión WIFI: llama al endpoint backend que manda TCP.
export async function printEscposWifi(ticketId: string, printerConfigId: string): Promise<void>;
```

Usa WebUSB API (`navigator.usb`). El device se pide con filtro (claseCode 7 = printer class) y se persiste en `localStorage` con su vendor/product/serial.

(2) **Botón "Imprimir ticket"** en TPV tras cobro completado (`SalePage.tsx` o `TicketSummary.tsx`):

- Lee `tenant.printerConfig` (o config del register).
- Si la config es USB y NO hay impresora emparejada → muestra modal "Empareja la impresora" con botón "Conectar impresora" que llama `pairUsbPrinter()`.
- Si la config es USB y hay impresora emparejada → llama `printEscposUsb(bytes)`. Antes pide el binary al backend con `POST /tickets/:id/print/escpos?target=usb`.
- Si la config es WIFI → llama `printEscposWifi(...)` que delega en backend.
- Estados visuales: idle / printing / done (verde 2s) / error (toast rojo con motivo).
- Reintento: botón "Reintentar" en caso de error.

(3) **Auto-print opcional**: setting en admin `tenant.autoPrintTicket: boolean`. Si true, tras cobro completado el ticket se imprime sin pulsar botón.

(4) **Comanderas en TableScreen**: reemplazar el flujo de PDFs por llamada al nuevo endpoint `/send-to-kitchen/escpos`. Botón "Enviar comanda" llama, toast verde con resumen "BARRA 3 líneas · COCINA 2 líneas impresas". En error: "Comanda no enviada: {sección} falló".

**Tests**:
- jsdom + mock `navigator.usb`: pair, transferOut, etc.
- Test que botón "Reintentar" reaparece en error.

**Why**: cierra el bucle. Sin esto, el backend genera ESC/POS pero el cajero no tiene cómo dispararlo.

---

## Lote 4 · Migrar comanderas Bar a impresión real + retirar PDFs

**Motivo**: el Lote 2 v1.4-Bar-Operativa-MVP generaba PDFs por sección abriendo pestañas. Era puente. Ahora reemplazamos por TCP a impresoras reales.

**Cambios**:

(1) En `apps/api/src/tickets/send-to-kitchen.ts`:
- Eliminar generación de PDF.
- Llamar al nuevo `buildKitchenComanda` + envío TCP por cada sección.
- Mantener la firma del endpoint para que el TPV no se rompa.
- Si NO hay PrinterConfig configurada para una sección, devolver 409 con detalle.

(2) En `packages/ticket-pdf/src/kitchen.ts`:
- Marcar como deprecated.
- Mantener temporalmente para fallback (`?fallback=pdf` query param) por si el implantador prefiere PDF en alguna cuenta sin impresora aún.

(3) Tests: actualizar `apps/api/test/send-to-kitchen.test.ts` para el flujo nuevo (mock socket TCP).

(4) Actualizar `docs/impresoras/README.md` añadiendo sección "Estado tras Fase 1: integración nativa LIVE".

(5) Actualizar `docs/impresoras/despliegue-usb.md`:
- Eliminar pasos del flujo manual con RawBT + Compartir.
- Sustituir por: "Tras configurar la impresora en /admin/printers, pulsar 'Conectar impresora' la primera vez en el TPV, y luego cada cobro imprime al instante".

(6) Crear `docs/impresoras/despliegue-wifi.md` con pasos para HOSPITALITY:
- Cómo dar IP fija a la impresora (manual de la impresora + screenshots router típico).
- Cómo configurar PrinterConfig en /admin/printers.
- Cómo testear con el botón "Probar" del admin.
- Errores comunes: IP cambió, puerto cerrado, impresora apagada.

**Why**: deja la integración completa. Comanderas reales para bares y tickets reales para todos los pilotos.

---

## Convenciones

- Un commit por lote, mensaje `Lote X · v1.4-Impresoras-Fase-1 · ...`.
- NO mergear. Espero `git merge --ff-only` desde master.
- Tests obligatorios en Lote 2 (corazón técnico) y Lote 4 (regresión).
- Si encuentras una limitación del modelo POS-80 que no encajaba con el spike (ej. necesita `escInit` doble, ancho real 504 en vez de 576, etc.), documéntalo en el commit + actualiza `docs/impresoras/despliegue-usb.md` sección "Configuración recomendada para Peluquería Sole".
- WebUSB requiere HTTPS (el TPV ya lo tiene en producción). En desarrollo local funciona con `localhost` también.

## Out of scope

- Múltiples impresoras USB simultáneas en una tablet (Fase 2).
- Agente local nativo para Windows/Mac/Linux (Fase 3, si algún cliente lo pide).
- Impresión vía Bluetooth (no priorizado).
- Soporte para idiomas que requieran fonts no-Latin (chino, árabe).
