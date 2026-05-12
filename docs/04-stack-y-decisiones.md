# 04 · Stack y decisiones

Cada sección es una mini-ADR (Architecture Decision Record): contexto,
decisión, alternativas, consecuencias.

## ADR-001 · Frontend: React + Vite (PWA)

**Contexto:** TPV web táctil que debe operar offline.

**Decisión:** React 18 + Vite + TypeScript, con `vite-plugin-pwa` para
generar manifest y Service Worker, y Dexie sobre IndexedDB para
persistencia.

**Alternativas:**
- *Electron / Tauri (escritorio nativo):* mejor acceso a hardware, pero más
  fricción de despliegue y actualización; revisable en v2.
- *Next.js:* añade SSR que no necesitamos para un TPV puro.

**Consecuencias:**
- Pro: instalable como app, autoupdate vía SW, mismo código en cualquier OS.
- Contra: hardware (impresora, cajón) no accesible directo desde el navegador
  → requiere agente local.

---

## ADR-002 · Backend: Node 20 + Fastify

**Contexto:** API REST con multi-tenant, integración HTTP intensiva con
Holded, websockets opcionales para empujar cambios de catálogo al TPV.

**Decisión:** Node 20 + Fastify + TypeScript + Prisma + PostgreSQL.

**Alternativas:**
- *NestJS:* más opinionado, decoradores, DI; mejor para equipos grandes,
  excesivo para esto.
- *Go / Rust:* rendimiento brutal pero curva de equipo más alta y la lógica
  está dominada por I/O a Holded, no por CPU.
- *PHP / Laravel:* tradicional en stacks Hostinger; viable pero JavaScript
  compartido con el front baja coste cognitivo.

**Consecuencias:**
- Pro: un solo lenguaje en todo el repo, ecosistema maduro, hosting Docker
  trivial.
- Contra: hay que disciplinar el tipado y los esquemas (JSON Schema en
  Fastify ayuda).

---

## ADR-003 · Persistencia: PostgreSQL + Redis

**Decisión:** PostgreSQL para datos relacionales, Redis para BullMQ y
sesiones.

**Por qué no MySQL/MariaDB (que Hostinger sirve por defecto):** PostgreSQL
con `JSONB` nos da campos flexibles para guardar respuestas crudas de
Holded sin migraciones, y trabaja muchísimo mejor con esquemas multi-tenant
y *row-level security* si en el futuro queremos endurecer aislamiento.
Hostinger VPS permite instalar PostgreSQL sin problema (lo levantamos en
Docker).

---

## ADR-004 · Autenticación con Holded: OAuth2 con fallback a API Key

**Decisión:** OAuth2 como modo principal. Si por restricciones de Holded la
app no se puede registrar a tiempo, modo "pegar API Key" como puente.

**Consecuencias:**
- Hay que abstraer el cliente Holded detrás de una interfaz
  `HoldedClient` con dos implementaciones (OAuthClient, ApiKeyClient).
- El front debe enseñar dos UIs de onboarding según modo activo.

---

## ADR-005 · Cola de sync: BullMQ

**Decisión:** BullMQ sobre Redis. Reintentos exponenciales, jobs idempotentes
con `externalId` UUIDv4 generado al cobrar.

**Alternativa descartada:** *tabla outbox + cron propio.* Funcional pero
reinventa la rueda. BullMQ trae reintentos, prioridad, métricas y dashboard.

---

## ADR-006 · Impresión: agente local en lugar de WebUSB

**Contexto:** WebUSB tiene soporte irregular, exige HTTPS + permiso por
dispositivo, no permite IP. Imprimir desde el back vía red sólo sirve si
todas las cajas tienen impresora con IP fija.

**Decisión:** *Print agent local* (binario Node empaquetado con `pkg`),
escucha en `localhost:9100`, soporta USB y IP, compone ESC/POS y abre el
cajón.

**Consecuencias:**
- Pro: funciona en cualquier OS de caja, soporta toda impresora con
  driver del SO o IP directa, abstrae la PWA del hardware.
- Contra: hay que mantener un instalador y un canal de actualización para
  el agente (firma de código en Windows recomendable).

---

## ADR-007 · Cierres de caja y formas de pago **fuera** de Holded

**Contexto:** El usuario explicitó que cierres y formas de pago detalladas
viven en el TPV.

**Decisión:** Los `salesreceipt` que enviamos a Holded llevan el **total**
y opcionalmente un `paymentMethodId` agregado, pero **el desglose por
método de pago, el conteo, los descuadres y los Z se quedan en el TPV** y
se exportan a PDF/CSV bajo demanda.

**Consecuencias:**
- Más responsabilidad nuestra en informes contables locales.
- Holded ve "se cobró 47,80 €" pero no "30 € tarjeta + 17,80 € efectivo".
  Si el cliente quiere ese detalle en Holded, se le exporta CSV manual.

---

## ADR-008 · Fiscalidad: Holded es el emisor

**Decisión:** El TPV **no firma**, **no envía a AEAT/foral**, **no lleva
huella Veri*factu**. Únicamente manda el documento a Holded vía API y
Holded hace el registro fiscal correspondiente.

**Consecuencias:**
- Un ticket no es "fiscalmente válido" hasta que Holded confirma el alta.
  Por eso el ticket impreso al cliente lleva una *marca de control interna*
  pero la numeración oficial se anota encima (sello posterior) o se reimprime
  factura desde Holded si el cliente la pide.
- Dependemos de la disponibilidad de la API de Holded para validez fiscal a
  fin de día → el health-check del cierre es **crítico**.
- Si Holded acepta el documento con retraso, el cliente final podría haberse
  llevado un ticket con número provisional. Esto es **legalmente aceptable**
  como "ticket de cortesía / nota de venta" siempre que el documento fiscal
  exista en plazo, pero hay que dejarlo claro al propietario en el alta.

> ⚠️ Esta decisión hay que **confirmarla con el asesor fiscal del cliente o
> con el equipo legal de Holded** antes de salir a producción. La AEAT
> permite "punto de venta no-emisor" si el sistema de facturación
> (Holded) sí cumple Veri*factu, pero la implementación concreta tiene
> matices.

---

## ADR-009 · Despliegue: Docker Compose en VPS Hostinger

**Decisión:** Un único `docker-compose.yml` con `api`, `worker`, `postgres`,
`redis`, `caddy`. Backups automatizados de Postgres.

**Alternativa:** Kubernetes (overkill para MVP), PaaS tipo Render/Railway
(más caro y menos control), bare-metal sin Docker (peor reproducibilidad).

---

## ADR-011 · Portabilidad de hardware y sistema operativo

**Contexto:** el TPV se desplegará inicialmente en terminales Android
todo-en-uno (Smart-tpv AP12-1506) con impresora externa. El negocio no
debe quedar atado a esa decisión: mañana puede aparecer un cliente con
iPad, otro con Sunmi T2 de printer embebido, otro con mini-PC + monitor
táctil. Si la base de código asume "Android + impresora red Epson", cada
vertical nuevo cuesta semanas de adaptación.

**Decisión:** el TPV es una **PWA web pura** y los periféricos hablan
**protocolos estándar**, no SDKs propietarios.

1. **El núcleo (`apps/tpv-web`, `apps/admin`, `apps/api`) NUNCA depende
   de Android, iOS, Windows, macOS, ChromeOS, ni de un fabricante
   concreto.** Cualquier navegador moderno (Chrome 100+, Safari 16+,
   Edge) con HTTPS + Service Worker debe ejecutarlo idénticamente.

2. **Periféricos por estándares industriales abiertos:**
   - **Impresora**: ESC/POS sobre TCP (puerto 9100) o ESC/POS sobre
     Bluetooth — ambos estándares de Epson de facto. Cualquier impresora
     térmica que los implemente correctamente sirve.
   - **Cajón portamonedas**: comando ESC/POS estándar `ESC p m t1 t2`.
     Se conecta a la impresora por RJ11 (también estándar). Cualquier
     cajón APG-compatible vale.
   - **Lector de código de barras**: USB-HID. El escáner emula teclado.
     Plug-and-play en cualquier OS sin driver.
   - **Almacenamiento offline**: IndexedDB + Service Worker (W3C).
     Nunca APIs propietarias de plataforma.

3. **Cero SDK propietario en la base.** Ni Sunmi, ni iMin, ni Smart-tpv,
   ni Epson Java SDK, ni Android Printer SDK. Si en el futuro un cliente
   necesita hardware exótico (printer embebido, lector NFC propietario,
   báscula de marca X), se construye un **adaptador opcional** en
   `packages/*-adapters/` que implemente una interfaz abstracta. El
   núcleo nunca aprende de ese hardware.

4. **Interfaces abstractas por familia de periférico.** Cuando llegue
   B5, la PWA recibirá un `PrinterClient` por inyección con una
   interfaz mínima:

   ```ts
   interface PrinterClient {
     printTicket(escpos: Uint8Array): Promise<PrintResult>
     openCashDrawer(): Promise<void>
     getStatus(): Promise<PrinterStatus>
   }
   ```

   Implementaciones iniciales: `NetworkEscPosClient` (HTTP a IP local),
   `BluetoothEscPosClient` (WebBluetooth), o ambas conviviendo. Si en
   v2/v3 aparece `EmbeddedAndroidPrinterClient` o `AirPrintClient`, se
   enchufa sin tocar el resto.

5. **El hardware actual (AP12-1506) es hardware probado y soportado, no
   contrato eterno.** El código NUNCA hace `if (deviceModel === 'AP12')`
   ni equivalentes. La configuración hardware-específica vive en
   `store` / `register` de cada tenant (IP de impresora, modo BT/red,
   etc.).

**Consecuencias:**

- Pro: cualquier cambio futuro de hardware no requiere reescribir el
  TPV.
- Pro: código más limpio y fácil de testear (mock del `PrinterClient`
  en lugar de emulador de Sunmi).
- Pro: producto vendible al mercado europeo entero, no sólo a clientes
  con hardware específico español.
- Contra: requiere disciplina al codear, especialmente en B5. Code y
  Pedro revisan este ADR antes de tocar hardware.
- Contra: perdemos la opción de aprovechar features "premium" de un
  fabricante concreto (p.ej. el customer-display embebido del Sunmi T2)
  en MVP. Se mitiga con los adaptadores opcionales del punto 3.

> **Nota sobre ADR-006:** la decisión concreta entre impresora de red
> (Epson LAN) vs impresora Bluetooth (más barata, ~50-90 €) se difiere
> hasta B5, cuando tengamos hardware real en mano del primer cliente
> piloto. La interfaz `PrinterClient` del punto 4 permite soportar
> ambas vías sin recodificar la PWA.

---

## ADR-010 · Verificar siempre con GET tras escritura (PUT/POST 2xx mentiroso)

**Contexto:** En el spike Fase 0 (`docs/spike-holded.md` §04.D, §03.D)
se confirmó empíricamente que la API de Holded acepta campos
desconocidos en operaciones de escritura y responde con
`HTTP 200 {"status": 1, "info": "Updated"}` aunque el campo se haya
descartado silenciosamente. Casos observados:

- `PUT /documents/salesreceipt/{id}` con `{draft: false}` → 200
  `"Updated"`, pero el GET-back devuelve `draft: true` igual.
- `POST /documents/salesreceipt` con `numSerie`, `warehouseId`,
  `items[].productId`, `items[].price` (sin sku que matchee) → 200
  con `id`, pero el GET-back muestra esos campos ausentes o reducidos
  a 0.

**Decisión:** El `packages/holded-client/` y el worker de sync **hacen
GET-back tras toda operación de escritura** y comparan las invariantes
que la operación pretendía aplicar. Las invariantes mínimas para un
`salesreceipt`:

- `docNumber != null` (documento aprobado).
- `total ≈ Σ(price × units × (1 + tax/100))` con tolerancia 0.05 €.
- `notes` contiene el `externalId` que enviamos.
- Tras `/pay`: `paymentsPending == 0`.

Si las invariantes no se cumplen, el cliente lanza
`HoldedSilentRejectError` y el ticket queda `SYNC_FAILED`. **No
marcamos `SYNCED` por el HTTP 2xx — sólo por la comprobación
empírica.**

**Alternativa descartada:** Confiar en el código HTTP. La práctica
demuestra que no es fiable contra esta API.

**Consecuencias:**

- Coste: duplicamos llamadas HTTP por escritura (1 POST + 1 GET, y lo
  mismo para `/pay`). Para un ticket con cobro mixto en dos métodos,
  serían 1 POST salesreceipt + 1 GET + 2 POST pay + 2 GET ≈ 6
  llamadas. Cabe holgadamente en el rate limit por tenant.
- Beneficio: detectamos descarte silencioso antes de marcar el ticket
  como `SYNCED`, evitando inconsistencias TPV ↔ Holded.
- El `HoldedClient` también valida `Content-Type` de la respuesta
  (lanza `HoldedInvalidResponseError` si llega HTML donde se esperaba
  JSON — endpoint inexistente disfrazado de 200).
