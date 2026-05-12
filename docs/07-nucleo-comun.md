# 07 · Núcleo común (vertical-agnóstico)

Este documento define el **contrato funcional del núcleo del TPV**: lo que es
igual para todos los verticales (bar, retail, peluquería, …). Es el documento
que Claude Code usa como referencia para implementar Fase 1.

Las funcionalidades **específicas de cada vertical** (mesas, comandas,
modificadores en bar; agenda y comisión en peluquería; tallas/colores y
ticket-regalo masivo en retail; etc.) viven en `docs/verticals/*.md` y se
montan **encima** de este núcleo, no dentro.

> Convención: a lo largo del documento, "Holded" significa "la cuenta Holded
> del tenant", y "tenant" significa "el negocio que ha contratado el TPV".

---

## 1. Premisa de entrada

El TPV **no funciona sin una cuenta activa en Holded**. El tenant aporta:

- Una cuenta Holded operativa (suscripción al día).
- En MVP: una **API Key** generada desde Holded.
- En v2: OAuth (ver ADR-004).

Si Holded responde `402 Payment Required` u otro 4xx persistente al
arrancar el TPV, el sistema entra en **modo degradado** (§5).

---

## 2. Onboarding del propietario

Una sola vez por tenant.

1. Alta del propietario en `mipiacetpv.tech` con email + contraseña + nombre
   del negocio.
2. Pantalla **"Conecta tu Holded"** → pega API Key → backend valida la key
   contra `GET /products` con `limit=1`.
3. Si la key es válida, se cifra (AES-GCM) y se persiste en `tenant`.
4. **Sync inicial** desde Holded (puede tardar minutos):
   - Datos fiscales del negocio (NIF, razón social, dirección).
   - Tipos de IVA en uso.
   - Almacenes (`warehouses`).
   - Series de facturación (`numSerieId`).
   - **Catálogo (productos Y servicios) + variantes + precios + stock**,
     filtrando `forSale != 0`. La distinción producto/servicio de Holded
     es interna suya (sirve para que ellos gestionen stock); para el TPV
     es un único catálogo unificado con un campo `kind ∈ {PRODUCT,
     SERVICE}`. **El sync de servicios es estándar para todos los
     tenants**, no opcional — cualquier comercio (librería con
     envoltorio de regalo, retail con envío a domicilio, peluquería con
     corte, bar con recargo de terraza) puede vender conceptos sin
     almacén.
   - Contactos (clientes) — opcional, lazy on-demand.
5. **Auto-asignación de SKU** (silenciosa, en background):
   - Detecta productos con `sku` vacío o nulo.
   - Asigna `AUTO-{primeros-8-chars-del-holded-id}` y lo sube a Holded vía
     `PUT /products/{id}`.
   - GET-back para verificar (ADR-010). Si Holded descarta el cambio, el
     producto queda en una bandeja de revisión manual en el admin.
   - Throttle a ~5 req/s para no comernos el rate limit.
   - Idempotente: re-ejecutarla no produce duplicados.
   - El propietario no necesita confirmar — el onboarding sigue sin
     fricción.
6. **Creación de productos comodín para línea libre** (uno por tipo de IVA
   que use el tenant):
   - `TPV-OTROS-21`, `TPV-OTROS-10`, `TPV-OTROS-4`, `TPV-OTROS-0`.
   - Vía `POST /products`. Sólo se crean los tipos de IVA que tenga
     activos el tenant.
   - Si ya existen con ese SKU en la cuenta, se reutilizan.
7. El propietario crea **al menos una tienda** y le asigna un almacén Holded.
8. Dentro de cada tienda da de alta las **cajas lógicas** (registers).
9. Crea cuentas de **cajero** (email + PIN de 4 dígitos) y los asigna a
   tiendas.

---

## 3. Emparejamiento de dispositivo

Una vez por cada navegador físico que va a actuar como caja.

1. Propietario/encargado genera código de 6 dígitos válido 1 h para una caja.
2. El dispositivo abre `mipiacetpv.tech` → "Empareja este dispositivo" → mete
   el código.
3. Backend valida, marca el `device` como emparejado al `register` y emite un
   **device token** largo que la PWA guarda en `localStorage`.
4. A partir de ahí, ese navegador entra siempre directo a la pantalla de PIN.
5. El propietario puede **revocar** el emparejamiento desde admin (robo,
   pérdida). La PWA detecta `401` y vuelve a la pantalla de emparejamiento.

> El emparejamiento es por navegador. Para producción se recomienda instalar
> la PWA como app (Chrome → Instalar) para que el storage sea más estable.

---

## 4. Apertura de turno

Al meter el PIN, el cajero entra **directo a la caja física emparejada** (no
elige caja). Antes de poder vender, el TPV evalúa el estado del último
turno de esa caja:

| Estado del último turno | Acción del TPV |
|---|---|
| No hay turno o el último ya está cerrado | Pide **fondo de caja inicial** y crea turno nuevo |
| Último turno **abierto** y la última actividad fue **hoy** | Permite reanudarlo (probablemente cambio de cajero o refresh del navegador) |
| Último turno **abierto** y la última actividad fue **anterior a hoy** | **Bloquea** y obliga a cerrar el turno colgado primero |

**Cierre forzado de turno colgado:** el sistema muestra el arqueo teórico
del turno colgado, exige introducir el conteo real de efectivo, calcula
descuadre y genera el informe Z. Sólo entonces deja abrir un turno nuevo.

> Razón: un turno abierto indefinidamente arrastra tickets sin cierre, lo
> que descuadra la contabilidad y genera POSTs a Holded sin contexto de
> cierre. No se permite.

---

## 5. Modo degradado (Holded caído o cuenta suspendida)

Distinguimos tres niveles:

| Nivel | Síntoma | Comportamiento del TPV |
|---|---|---|
| **Latencia alta** | Holded tarda >2 s en responder | Imprime ticket con numeración interna, encola el `salesreceipt` y lo sube en background |
| **Holded inaccesible** (red caída, 5xx) | El worker recibe errores transitorios | Sigue vendiendo, todos los tickets quedan `PENDING_SYNC`. Banner naranja "Sincronizando con Holded…" |
| **Cuenta suspendida** (401/403/402 persistente) | Holded rechaza autenticación | Sigue vendiendo offline acumulando tickets, **bloquea cierre de caja** hasta que se restablezca, banner rojo "Holded no accesible — contacta soporte" |

**Umbral temporal:** el sistema exige al menos **una sync correcta cada 24
h**. Si pasan 24 h sin sincronización exitosa con Holded:

- Banner naranja permanente al cajero.
- **El cierre de turno queda bloqueado** hasta que la cola se vacíe (o el
  encargado autorice cierre con `SYNC_FAILED` aceptado, ver §13).
- Si pasan 48 h sin sync, se bloquea también la apertura de turnos nuevos.

En los tres niveles, **la venta al cliente nunca se interrumpe**. Lo que se
posterga es la sincronización con Holded.

---

## 6. Venta

> **Productos vs servicios:** se comportan **idénticamente** en el carrito,
> el cobro, el ticket impreso, el envío a Holded y la devolución. La
> única diferencia es que los servicios **no muestran stock ni semáforo**
> y **no se descuentan de almacén**. Por todo lo demás, el cajero ni
> distingue.

### 6.1 Añadir líneas

- **Código de barras** (lector USB-HID): el input principal de la pantalla
  de venta tiene foco permanente; el lector dispara la búsqueda por
  `barcode` en el catálogo local.
- **Búsqueda manual** por nombre o SKU (autocompletado).
- **Botones rápidos** configurables (top vendidos / favoritos).
- **Línea libre** (concepto + precio + IVA), si el rol del cajero lo
  permite. Va contra un producto comodín de Holded (p.ej. `TPV-OTROS-21`)
  con SKU canónico.

### 6.2 Editar carrito (antes de cobrar)

- Modificar **cantidad** de una línea.
- Aplicar **descuento por línea** (% o importe).
- Aplicar **descuento global** al ticket.
- **Eliminar línea**.
- **Notas** de venta (texto libre, se imprimen en el ticket).
- **Cancelar venta** con motivo registrado en log.
- **Suspender venta** (parking): el carrito se guarda con etiqueta libre
  para retomarlo después. Útil cuando entra otro cliente.

### 6.3 Permisos sobre descuentos

| Rol | Descuento por línea | Descuento global |
|---|---|---|
| Cajero | hasta umbral configurable (p.ej. 10 %) | hasta umbral |
| Encargado | sin límite | sin límite |
| Propietario | sin límite | sin límite |

Si el cajero intenta superar su umbral, el TPV pide PIN del encargado para
autorizar.

### 6.4 Cliente del ticket

- **Anónimo** (por defecto).
- **Asociar contacto Holded existente** (búsqueda por nombre / NIF / email).
- **Crear contacto nuevo on-the-fly**: nombre + NIF + email + teléfono.
  Antes de crear, búsqueda previa por NIF/email para evitar duplicados. Se
  envía a Holded vía `POST /contacts` y se cachea localmente.

---

## 7. Cobro

### 7.1 Métodos de pago

MVP: **Efectivo**, **Tarjeta** (registro manual del importe), **Bizum**
(registro manual), **Vale / crédito interno**, **Mixto** (combinación de
los anteriores en el mismo ticket).

> Datáfono integrado va a Fase 2.

### 7.2 Cálculo de cambio

Al introducir efectivo recibido superior al total, el TPV calcula y muestra
el cambio. El cajón se abre automáticamente si hay efectivo en el cobro.

### 7.3 Confirmación del cobro

Al confirmar:

1. El ticket se cierra localmente con estado `PAID` y se le asigna
   `external_id` UUIDv4 (clave de idempotencia).
2. Se imprime el ticket por ESC/POS (ver §8).
3. Se encola el envío a Holded como `salesreceipt` con
   `approveDoc: true`.
4. El worker procesa la cola:
   - **Éxito** → `SYNCED`, se guardan `holded_document_id`, `docNumber`,
     `holded_pdf_url`.
   - **Error transitorio** → reintento exponencial.
   - **Error permanente** (4xx validación) → `SYNC_FAILED`, alerta en
     bandeja de errores del encargado.

> Recordatorio: ADR-010 exige **GET-back tras toda escritura**. El worker
> verifica `docNumber`, `total ≈ Σ(price × units × IVA)`, `notes` contiene
> `external_id`, `paymentsPending == 0` tras `/pay`. Si fallan, el ticket
> queda `SYNC_FAILED` aunque Holded devuelva HTTP 200.

---

## 8. Impresión de ticket

**Decisión:** ticket híbrido.

| Canal | Formato | Contenido |
|---|---|---|
| **Impresora térmica en caja** | ESC/POS generado por el TPV | NIF + dirección + número fiscal de Holded (o interno si offline) + fecha/hora + líneas + desglose IVA + total + métodos de pago + **QR Veri*factu si Holded lo expone** + numeración interna |
| **Email al cliente** | PDF de Holded (`/documents/salesreceipt/{id}/pdf`, base64 decodificado del envelope) | Documento fiscal sellado por Holded |
| **WhatsApp** (Fase 2) | Mismo PDF | Idem |

**Flujo cuando el cliente quiere ticket fiscal y Holded responde rápido:**

1. Cajero confirma cobro.
2. TPV envía a Holded en paralelo.
3. Si Holded responde antes de 2 s, el ticket impreso lleva el número
   fiscal definitivo.
4. Si no, el ticket impreso lleva **numeración interna** + nota "Documento
   fiscal pendiente". El número fiscal se le puede enviar por email cuando
   llegue.

**Impresión técnica:** ver ADR-006. La PWA envía a un **agente local**
escuchando en `localhost:9100`, que compone ESC/POS y abre el cajón. El
agente soporta USB e IP, instalable en Windows/macOS/Linux.

**Opción "no imprimir":** algunos comercios sólo quieren ticket digital.
Configurable por tienda. En ese caso, el TPV **ofrece** introducir email
del cliente para enviarle el PDF, pero **no lo exige** — el cobro se
completa igualmente, y el ticket queda almacenado en Holded (descargable
desde el admin si el cliente lo pide más tarde).

---

## 9. Email del ticket

- Si el contacto del ticket tiene email registrado, el TPV ofrece "Enviar
  por email" tras el cobro (preselección activa).
- También se puede pedir email al vuelo (ticket anónimo → "Enviar a…").
- El email se envía desde el backend (no desde el navegador) con el PDF
  oficial de Holded adjunto.
- Cola con reintento exponencial. Si falla persistente, el cajero ve aviso
  en bandeja.

---

## 10. Devoluciones

1. Cajero/encargado pulsa "Devolución" → busca ticket original (número,
   fecha, importe, últimos 50 del turno).
2. Selecciona líneas a devolver (cantidad parcial permitida).
3. Elige método de reembolso (por defecto, el mismo del cobro original).
4. Confirma → se genera **ticket de abono**:
   - Localmente, ligado al ticket original.
   - En Holded como `salesreceipt` con importes en negativo, referenciando
     el original en `notes`.
5. Se imprime el ticket de abono.
6. Stock se repone en el almacén configurado.

**Anulación total de un ticket reciente** (mismo día, sin cierre de turno
posterior): equivale a una devolución del 100 % iniciada por el encargado.
Se exige PIN de encargado.

---

## 11. Ticket regalo

Funcionalidad opcional por ticket. Al confirmar el cobro o más tarde:

- Botón **"Imprimir ticket regalo"** → segundo ticket ESC/POS:
  - Mismo número que el original.
  - Líneas con descripción **sin precios**.
  - Texto "Ticket regalo · válido para cambio durante N días"
    (configurable por tienda).
- **No se envía a Holded**: es papel, no es documento fiscal.

---

## 12. Conversión ticket → factura

Si después de un ticket el cliente pide factura formal (con sus datos):

- **MVP:** botón "Convertir a factura" → abre Holded en pestaña nueva sobre
  el `salesreceipt` correspondiente, donde el propietario emite la factura
  desde la UI de Holded. (Más simple, menos casos raros que cubrir.)
- **v2:** el TPV pide los datos del contacto (con búsqueda/creación en
  Holded) y llama directamente a `POST /documents/invoice` referenciando el
  `salesreceipt` original. La factura se descarga y se ofrece al cliente
  por email.

---

## 13. Cierre de turno

> **Decisión cerrada:** **turno = sesión de un cajero**, no día entero de
> la caja. Esto permite rotación: cajero A cierra turno con su arqueo,
> cajero B abre turno nuevo en la misma caja sin reiniciar nada.

1. Cajero/encargado pulsa "Cerrar turno".
2. TPV muestra **arqueo teórico** por método de pago (cash, card, bizum,
   vale).
3. Cajero introduce **conteo real** de efectivo.
4. Sistema calcula **descuadre** = real − teórico.
5. **Health-check de sync:** si hay tickets `PENDING_SYNC` o `SYNC_FAILED`,
   se advierte y se exige decisión:
   - Esperar a que se vacíe la cola.
   - Marcar como aceptado (con PIN de encargado) y dejar la responsabilidad
     en la bandeja de errores.
6. Se genera **informe Z** (PDF) con:
   - Cajero, caja, apertura, cierre.
   - Recuento de tickets, devoluciones, ticket promedio.
   - Totales por método de pago.
   - Descuadre.
   - Lista de tickets con sync pendiente o fallida.
7. Z se imprime opcionalmente y se archiva en el TPV.
8. **El cierre no se manda a Holded** (ADR-007). Es interno del TPV.

---

## 14. Buscar tickets pasados

Pantalla de búsqueda accesible al cajero (sus tickets del turno) y al
encargado (todos los tickets de la tienda):

- Filtros: nº, rango de fechas, importe, cajero, método de pago, estado de
  sync.
- Acciones por ticket: **reimprimir**, **reenviar por email**, **iniciar
  devolución**, **ver detalle**, **abrir en Holded** (deep link al PDF).

---

## 15. Roles y permisos resumidos

| Acción | Cajero | Encargado | Propietario |
|---|---|---|---|
| Vender | ✅ | ✅ | ✅ |
| Aplicar descuento | hasta umbral | sin límite | sin límite |
| Línea libre | configurable | ✅ | ✅ |
| Cerrar turno propio | ✅ | ✅ | ✅ |
| Cerrar turno ajeno (colgado) | ❌ | ✅ | ✅ |
| Anular ticket cobrado | ❌ | ✅ | ✅ |
| Aceptar `SYNC_FAILED` en cierre | ❌ | ✅ | ✅ |
| Crear/revocar dispositivos | ❌ | ✅ | ✅ |
| Crear cajeros | ❌ | ❌ | ✅ |
| Cambiar API Key Holded | ❌ | ❌ | ✅ |

---

## 16. Auditoría (log mínimo)

Eventos que el backend debe persistir con timestamp, `tenant_id`,
`user_id`, `register_id`:

- Login / logout cajero.
- Apertura / cierre de turno + descuadre.
- Cierre forzado de turno colgado.
- Cobro de ticket (con `external_id` e importe).
- Cancelación de venta en curso (con motivo).
- Anulación de ticket cobrado (con motivo).
- Devolución.
- Aplicación de descuento autorizado por encargado.
- Emparejamiento / revocación de dispositivo.
- Cambio de API Key Holded.

---

## 17. Seguridad

Capas de defensa adicionales al device pairing y al PIN. Aplican a todos
los tenants por defecto, excepto donde se indica "opcional". El device
pairing revocable sigue siendo la medida principal; esto es defensa en
profundidad.

### 17.1 Rate limiting de login

Login del propietario (email + contraseña) y PIN del cajero: **5 intentos
fallidos en una ventana de 5 minutos → bloqueo temporal durante 15
minutos**. Contador en Redis con TTL. Sólo bloquea la cuenta/dispositivo
concreto, no toda la IP (un dispositivo comprometido no puede tumbar el
servicio del resto). Mensaje claro al usuario indicando minutos
restantes.

### 17.2 Auto-logout del cajero por inactividad

Default **10 min** sin actividad de pantalla → vuelve a la pantalla de
PIN. Configurable por tienda entre 5 y 60 min desde el admin. "Actividad"
cuenta cualquier interacción (tap, scroll, lector barcode, cobro); el
timer se resetea con cada una. **La sesión del turno sigue abierta** —
el cajero entra de nuevo con su PIN sin pasar por arqueo. El turno sólo
se cierra explícitamente desde §13.

### 17.3 2FA del propietario (opcional)

TOTP estándar (RFC 6238) compatible con Google Authenticator, Authy,
1Password, Bitwarden. Activable desde el perfil del propietario en el
admin. Una vez activado: tras login con email+contraseña, pide código
TOTP de 6 dígitos. Códigos de recuperación generados al activar (10
códigos de un uso, descargables como txt para guardar en sitio seguro).
**No aplica al cajero** — el PIN del cajero no lleva 2FA porque
entorpece el servicio. Recomendación al propietario durante el
onboarding: actívalo si la cuenta tiene API Key de Holded productiva.

### 17.4 Alerta proactiva de nuevo dispositivo

Cada vez que un device hace su **primer login** tras emparejarse (o
tras N días sin actividad), el backend envía un email al propietario:

> Nuevo dispositivo activo · puesto Caja 2 · IP 88.x.x.x · ahora mismo.
> Si no has sido tú, revoca este dispositivo aquí: [link]

También se dispara si un device ya conocido se conecta desde una IP de
un rango geográfico distinto al habitual (cambio de provincia / país).
Es **detección a posteriori**, no preventiva — pero permite al
propietario reaccionar en minutos.

### 17.5 Location lock — diferido a v2

Capa adicional opcional para activar a futuro: el propietario marca las
coordenadas de la tienda con un map picker (Leaflet + OpenStreetMap) y
un radio de tolerancia; al hacer login el cajero, el TPV pide
geolocation al navegador y bloquea si está fuera del radio. Caveats
conocidos que justifican diferirlo: spoofeable con DevTools, problemas
indoors (sótanos, centros comerciales), fricción de permisos, falsos
negativos en terrazas. Se reabre el debate cuando un tenant lo pida
explícitamente.

---

## 18. Fuera del núcleo (va a verticales o a fase 2)

**Por vertical:**
- **Bar:** mesas, comandas, divisiones de cuenta, modificadores, envío a
  cocina/barra, propinas.
- **Retail:** variantes (talla/color), ticket regalo masivo por temporada,
  apartado, comisión por vendedor.
- **Peluquería:** servicios con duración, agenda de citas, ficha cliente con
  histórico, comisión por estilista.

**Fase 2:**
- Datáfono integrado (Redsys, SumUp, Adyen).
- WhatsApp Business para envío de ticket.
- Fidelización / puntos / vales con saldo.
- Reportes propios del TPV (top productos, ranking horas, ranking cajero).
- App admin web separada para propietario.
- Báscula USB (frutería, carnicería).
- Sync con tienda online de Holded.
- OAuth Holded (sustituye a API Key).
- Multi-divisa, multi-idioma del ticket impreso.

---

## 19. Decisiones

### 19.1 Cerradas

1. **Turno = sesión de un cajero**, no día entero de caja (§13).
2. **SKU de productos pre-existentes sin SKU**: auto-asignación silenciosa
   en el onboarding con patrón `AUTO-{8-chars-holded-id}` (§2.5).
3. **Productos comodín** para línea libre: creados en el onboarding
   (`TPV-OTROS-{IVA}`), uno por tipo de IVA que use el tenant (§2.6).
4. **Modo degradado**: hasta 24 h sin sync correcta = aviso + bloqueo de
   cierre. Más de 48 h = bloqueo de apertura (§5).
5. **"No imprimir"** no exige email obligatorio. Ticket queda en Holded
   (§8).
6. **Conversión ticket → factura**: en MVP el TPV redirige a Holded; la
   integración nativa va a v2 (§12).

### 19.2 Pendientes (no bloqueantes — Code arranca con defaults)

1. **Umbral de descuento del cajero**. Default: 10 % por línea, 10 %
   global. Configurable por tienda en admin.
2. **Período de validez del ticket regalo**. Default: 30 días.
   Configurable por tienda.
3. **Formato del informe Z** (campos, orden, branding). Default: plantilla
   estándar que pulimos cuando veamos el primer Z real.
4. **Política de retención de tickets en local** (cuántos días los
   guardamos en IndexedDB antes de purgar). Default: 90 días.
5. **Número máximo de tickets en cola offline** antes de bloquear ventas
   nuevas. Default: sin límite (la cola crece, se purga al volver online).
6. **Idioma del ticket impreso**. Default: castellano. Multi-idioma en
   Fase 2.

---

## 20. Referencias internas

- `docs/ux-principles.md` — principios de UX transversales que toda
  pantalla del TPV cumple (tamaño de botones, latencia percibida cero,
  modo oscuro en venta, anti-patrones, etc.).

- `docs/01-spec-funcional.md` — Spec funcional general y reglas de negocio.
- `docs/03-integracion-holded.md` — Payload definitivo del `salesreceipt`,
  endpoints, autenticación.
- `docs/04-stack-y-decisiones.md` — ADRs (en especial ADR-004 OAuth/API
  Key, ADR-006 print agent, ADR-007 cierres fuera de Holded, ADR-010
  GET-back).
- `docs/06-modelo-datos.md` — Tablas Postgres del backend.
- `docs/spike-holded.md` — Resultados del spike Fase 0.
- `docs/verticals/*.md` — Especificaciones por vertical (a producir).
