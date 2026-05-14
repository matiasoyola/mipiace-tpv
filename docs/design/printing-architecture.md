# Arquitectura de impresión · catálogo completo de opciones

Diseño del bloque de impresión real (B-Print). Cubre todas las
arquitecturas técnicamente viables dadas las restricciones del
proyecto, con pros/cons claros, para que la decisión sea informada.

## TL;DR

**B-Print fase 1** soporta **tres arquitecturas en paralelo** porque
comparten el mismo serializer ESC/POS y sólo cambia el transporte:

1. **A · Agente local en Docker** (primaria, multi-puesto): default
   para bares con varias cajas, restaurantes, retail con varias
   tiendas. Hardware: AP12 + Epson TM-T20III LAN + cajón APG + RPi
   pre-configurada. Coste piloto: ~530€/tienda.
2. **H · Bluetooth directo** (secundaria, single-puesto): default
   para Thalia, peluquería, food truck, catering, mercadillo y
   cualquier escenario 1 AP12 + 1 impresora sin LAN. Coste piloto:
   ~290€/tienda. **Sin host extra.**
3. **D · WebUSB directo** (terciaria): para cliente que quiere
   impresora cableada USB sin host extra y acepta Chrome como
   navegador único.

**Variantes futuras** (NO en B-Print fase 1):
- **A1 · Agente Android empotrado** para TPVs all-in-one con
  impresora integrada (Sunmi/Imin/PAX). Se activa cuando entre el
  primer cliente con ese hardware o cuando v2 venda un SKU
  integrado.
- **F · Print bridge appliance** (Pi pre-flasheada como producto):
  v2 con volumen suficiente para stockear hardware.

Descartadas con motivo en §2: B (app Android nativa, viola
ADR-011), C (IPP directo, sin formato ticket), E (WS reverso, scope
v2), G (cloud print, coste recurrente y dependencia).

**Coste dev total B-Print fase 1**: ~7-10 días (1 sem agente Docker
+ 3-4 días BT + 2-3 días WebUSB).


## 1. Restricciones del proyecto

Antes de cualquier arquitectura, los condicionantes fijos:

### 1.1 Hardware del cajero (AP12-1506)

- **Tablet Android all-in-one 15.6"**, sólo pantalla (no
  impresora integrada).
- Importador SADA SL (Irún). Marca Smart-tpv, modelo AP12-1506.
- 3 unidades adquiridas.
- USB-C OTG (con limitaciones de alimentación: la tablet también
  carga por USB-C, conectar periféricos puede competir por
  energía).
- WiFi + Bluetooth + 3G (según ficha de la caja).
- Corre **Chrome Android**. La PWA del TPV está pensada para
  navegador, no para app nativa (ADR-011).

### 1.2 Limitaciones del navegador

- **No puede abrir sockets TCP arbitrarios**. Las impresoras
  ESC/POS escuchan en puerto 9100 con bytes raw — el navegador
  sólo habla HTTP(S) y WebSocket.
- **WebUSB sólo en Chrome (Android/desktop)**, no en iOS Safari
  (Apple no lo implementa).
- **WebBluetooth idem**: Chrome sí, Safari no.
- **CORS**: si la PWA intenta `fetch` a una IP local arbitraria
  sin headers CORS, el browser rechaza la respuesta (puede enviar
  pero no leer status).

### 1.3 Topología de red

- **Backend en VPS Hostinger** (IP pública, fuera de la LAN del
  cliente).
- **Cliente en LAN privada** (`192.168.x.x` típicamente, detrás
  de router NAT).
- **El backend no puede iniciar conexiones al rango privado del
  cliente** (no hay ruta). La comunicación tiene que ser:
  - PWA del cliente → backend (HTTPS estándar): OK.
  - PWA del cliente → algo en la LAN del cliente (HTTP local):
    OK si CORS no estorba.
  - Backend → cliente: **NO directo**, sólo a través de
    conexión persistente (WS reverso) o webhooks salientes.

### 1.4 Principios del proyecto (no negociables)

- **ADR-011**: PWA pura, sin SDK propietario, sin atarse a un
  fabricante. ESC/POS estándar.
- **Servicio plug-and-play** para el cliente: idealmente conecta
  hardware, escribe IP, listo.
- **Cajón portamonedas**: estándar industria, se conecta a la
  impresora vía RJ11. La impresora abre el cajón con comando
  ESC/POS `ESC p m t1 t2`. Sin necesidad de driver separado.
- **Soporte mínimo**: cuantas menos piezas que mantener, mejor.

## 2. Catálogo de arquitecturas viables

Las 8 opciones que técnicamente funcionan, en orden de evaluación:

---

### Arquitectura A · Agente local (Docker container en LAN del cliente)

**Descripción:** un proceso ligero corre en algún equipo de la
red del cliente (Mac mini, mini PC Windows, Raspberry Pi).
Expone HTTP en un puerto local (`:8080`). La PWA del cajero
(misma LAN) le envía bytes ESC/POS vía `fetch`. El agente abre
el socket TCP al puerto 9100 de la impresora y reenvía.

**Comunicación:**
```
PWA AP12  ──HTTP POST /print──►  Agente local  ──TCP 9100──►  Impresora
                                       │
                                       └──TCP 9100──►  Comando abrir cajón
```

**Pros:**
- Funciona con CUALQUIER impresora ESC/POS (USB o red).
- Cliente PWA se mantiene como navegador estándar, sin extensiones.
- Sin atarse al AP12 (mismo agente sirve para iPad, mini-PC,
  cualquier dispositivo en la LAN).
- Updates por `docker pull` desde nuestro registry.
- Auditable: logs en el agente local.

**Cons:**
- El cliente necesita un equipo donde correr Docker (o equivalente).
- Setup inicial: instalar Docker + nuestro container. ~15 min
  para usuario técnico, soporte remoto para no técnico.
- Coste hardware: 0€ si el cliente ya tiene un Mac/PC en el local;
  ~30€ si compramos Raspberry Pi para ellos.

**Coste para nosotros:**
- Construir el agente: ~1 semana.
- Mantener imagen Docker en registry público.
- Soporte de instalación inicial.

**Encaje con AP12-1506:** perfecto. El AP12 puede correr el
agente (Android no es ideal para Docker pero acepta apps tipo
Termux), o usamos un Raspberry Pi separado.

---

### Arquitectura B · App Android nativa envolviendo la PWA

**Descripción:** construimos una app Android nativa minimal que
incrusta la PWA en un WebView. La app expone un JS bridge a
`window.MipiacePrinter` que la PWA llama directamente. La app
maneja USB nativo (Android USB Host API) o Bluetooth para hablar
con la impresora.

**Comunicación:**
```
PWA (dentro de WebView) ──JS bridge──► Android native code ──USB/BT──► Impresora
```

**Pros:**
- Cero infraestructura extra. AP12 hace todo.
- Impresora USB conectada directamente al AP12 (USB-C OTG).
- Sin agente, sin servidor local.
- Setup más simple: instalas APK en el AP12 y listo.

**Cons:**
- **Viola ADR-011** (atarse a Android nativo, código propietario).
- Limita a Android. Si mañana cambias a iPad, no funciona.
- Construir y mantener APK. Firma Android, distribución.
- Limitación de USB-C OTG: la AP12 carga por USB-C, conectar
  impresora puede requerir hub OTG con alimentación.
- El AP12 tiene Bluetooth: alternativa OK pero alcance limitado.

**Coste para nosotros:**
- Construir APK Android Kotlin/Java: ~1-2 semanas.
- Mantener canal de actualización (Play Store es complicado para
  apps internas, alternativa: APK descargable + script de update).

**Encaje con AP12-1506:** específico de esta hardware. Otra
tablet → otra app.

---

### Arquitectura C · Impresora de red + PWA fetch directo (IPP)

**Descripción:** impresora térmica con interfaz Ethernet/WiFi
que soporta IPP (Internet Printing Protocol, RFC 8011). PWA
envía trabajo de impresión vía HTTP al puerto IPP de la impresora
(631 estándar).

**Comunicación:**
```
PWA AP12  ──HTTP IPP─►  Impresora red (puerto 631)
```

**Pros:**
- Cero piezas en medio. PWA → impresora directo.
- Sin agente.

**Cons:**
- **IPP es complejo** y no todas las impresoras térmicas lo
  implementan completo. Muchas Epson de gama media (TM-T20III)
  soportan ESC/POS pero NO IPP.
- **CORS**: la impresora no devuelve headers CORS, así que el
  navegador NO puede leer la respuesta (puede enviar trabajos
  pero no ver status). Esto rompe el feedback al cajero.
- **Cajón portamonedas via IPP** no está estandarizado. ESC/POS
  sí tiene `ESC p m t1 t2`.
- Limita a impresoras de gama alta caras (~300-400€).
- Funciona sólo con impresoras de red, no USB.

**Coste:** mínimo dev, pero hardware caro para el cliente.

**Encaje con AP12-1506:** AP12 en WiFi + impresora en WiFi: OK.

**Veredicto:** **descartar** por incompatibilidad con impresoras
económicas y problemas de CORS para feedback.

---

### Arquitectura D · WebUSB directo desde PWA

**Descripción:** PWA usa WebUSB API para abrir conexión USB con
la impresora conectada al AP12 por OTG.

**Comunicación:**
```
PWA AP12 ──WebUSB──► USB-OTG ──cable USB──► Impresora
```

**Pros:**
- Sin agente, sin app nativa, sin hardware extra.
- USB-OTG en AP12 ya disponible.
- Funciona con impresoras USB baratas.

**Cons:**
- **WebUSB sólo funciona en Chrome (Android, desktop)**. iOS
  Safari NO. Si el cliente quiere iPad, no funciona.
- **Permiso por dispositivo por origen**. El cajero tiene que
  conceder permiso una vez al primer uso. Si limpia caché del
  navegador, vuelve a pedirlo.
- USB-OTG en AP12 puede no alimentar la impresora suficientemente
  (térmicas requieren ~5V 2A). Hub OTG con alimentación auxiliar
  necesario en ese caso.
- **Cajón portamonedas**: cuando la impresora está bien conectada,
  el cajón abre con comando ESC/POS estándar. OK.

**Coste:** mínimo dev. Limita futuro deployment.

**Encaje con AP12-1506:** funciona con Chrome Android. Atado a
Android.

**Veredicto:** **viable como fallback** para clientes
cost-sensitive, no como default. Mejor que B porque sigue siendo
PWA, no app nativa.

---

### Arquitectura E · Túnel reverso WS desde agente local al backend

**Descripción:** agente local (similar a A) pero en vez de
exponer HTTP local, abre WebSocket persistente al backend
Hostinger. El backend manda trabajos de impresión por ese WS.
Agente imprime y reporta resultado por WS.

**Comunicación:**
```
PWA AP12 → backend Hostinger (POST /tickets/:id/print)
                ↓
        backend → WS → agente local → impresora
```

**Pros:**
- Backend tiene control total del flujo de impresión.
- Auditable centralmente.
- Outbound-only en LAN del cliente: nada que abrir en firewall.
- Reintentos centralizados en el backend.

**Cons:**
- Más complejo que A. WS reverso requiere mantener conexión
  estable, reconexión, autenticación.
- Si el backend cae, no se imprime aunque la impresora esté ahí.
- Latencia: PWA → backend → agente → impresora vs A donde es
  PWA → agente → impresora (red local).

**Coste:** más dev que A (~1.5 semanas).

**Encaje con AP12-1506:** igual que A.

**Veredicto:** **opción interesante para v2** cuando queramos
gestión flotas con muchos clientes y centralización. Para piloto
inicial, A es más simple y suficiente.

---

### Arquitectura F · Print bridge appliance pre-configurado

**Descripción:** vendemos al cliente un dispositivo pequeño
(Raspberry Pi Zero W, ~30€) pre-configurado con nuestra imagen,
listo para enchufar. Plug-and-play real: cliente enchufa Raspberry
al router (Ethernet), enchufa la impresora USB a la Raspberry, y
ya está. El bridge ejecuta el agente automáticamente, se anuncia
en la red (mDNS), y la PWA lo encuentra solo.

**Comunicación:**
```
PWA AP12 ──HTTP──► Raspberry "print bridge" ──USB──► Impresora
                          │
                          └──RJ11 (a través impresora)──► Cajón
```

**Pros:**
- Plug-and-play 100% real. Cliente no necesita Docker ni saber
  qué es.
- Hardware controlado por nosotros → soporte fácil.
- Auto-discovery mDNS: PWA encuentra `mipiace-bridge.local`
  automáticamente.
- Auto-update via OTA: subimos imagen nueva, las Raspberry se
  actualizan solas.

**Cons:**
- **Coste hardware**: ~30-40€ por unidad. Si lo vendemos al
  cliente: incluido en el kit por ~50€ con margen.
- **Logística**: tenemos que stockear, configurar, enviar.
- **Mantenimiento de flota**: cada Raspberry es un nodo que
  podemos perder de vista (router del cliente cambia, alguien
  desenchufa).
- **Construir y mantener imagen Raspberry OS personalizada**.

**Coste para nosotros:**
- Setup inicial: ~1-2 semanas (imagen + scripts + auto-update).
- Stock: capital inicial en hardware.
- Soporte de RMA (devoluciones, sustituciones).

**Encaje con AP12-1506:** complementa perfectamente. Cliente
recibe kit "AP12 + Raspberry bridge + impresora + cajón", todo
preconfigurado.

**Veredicto:** **excelente para premium / no-tech customers**.
Costoso para empezar pero diferenciador serio. Valdría la pena
en v2 cuando tengamos 20+ clientes.

---

### Arquitectura G · Cloud print via servicio externo

**Descripción:** delegamos a un servicio cloud que ya tiene
agentes instalados en clientes (Star CloudPRNT, PrintNode,
similar).

**Pros:**
- Cero infraestructura propia.
- Servicios maduros con SLA.

**Cons:**
- **Coste recurrente** (~$10-30/mes por impresora).
- Dependencia externa.
- No soporta todos los modelos de impresora.
- Privacidad de datos (los tickets pasan por el servicio).

**Veredicto:** **descartar** por coste recurrente y dependencia.

---

### Arquitectura H · Bluetooth printer via WebBluetooth

**Descripción:** impresora térmica con Bluetooth. PWA (Chrome
Android en el AP12) usa WebBluetooth API para emparejar la
impresora una vez y enviar bytes ESC/POS directamente.

**Pros:**
- **Cero infraestructura de red**: no requiere LAN configurada,
  no requiere wifi estable, no requiere agente extra. Plug-and-play
  literal: encender impresora + emparejar + listo.
- **Coste cero adicional**: sin Raspberry Pi, sin equipo host. La
  PWA habla directamente con la impresora desde el AP12.
- **Hardware barato**: impresoras térmicas BT desde ~40-90€
  (genéricas) hasta ~150-200€ (Epson TM-P20 portátil, Star SM-L200).
- **Movilidad real**: la impresora puede acompañar al cajero (food
  truck, terraza, catering, mercadillo, pop-up). LAN no aplica.
- **Backup natural cuando wifi cae**: BT punto a punto sigue
  imprimiendo aunque el router del local muera.
- **Casos pequeños donde 1 AP12 + 1 impresora basta**: tienda
  unipersonal (Thalia tipo), bar muy pequeño, peluquería.
- **Impresora secundaria de comanda**: en bar/restaurante, tablet
  del camarero puede llevar BT para comanda en cocina mientras la
  caja principal usa LAN.

**Cons:**
- **WebBluetooth sólo en Chrome / Edge** (no iOS Safari, no
  Firefox). En AP12 (Chrome Android) funciona; iPad queda fuera.
- **User gesture obligatorio por sesión**: la primera conexión BT
  tras abrir Chrome requiere un click del usuario (no se reconecta
  silenciosamente). Mitigable con UX: bottón "Conectar impresora"
  visible al abrir la app si no hay sesión BT activa.
- **Multi-puesto NO es su escenario**: una impresora BT sólo
  empareja con 1-3 devices simultáneos y mal. Si hay 3 cajas en un
  bar queriendo la misma impresora, no es BT, es LAN + agente.
- **Alcance ~10m con paredes**: cubre el típico local pequeño, no
  cubre layouts grandes ni cocina en otra planta.
- **Sleep del Android**: si la tablet entra en standby, hay que
  re-emparejar (UX: mostrar estado de conexión + botón reconectar).
  Mitigado si el AP12 está enchufado y configurado sin sleep.

**Veredicto:** **opción legítima y default para escenarios
específicos**, no fallback de segunda. Es la arquitectura **más
simple** cuando se cumplen las tres condiciones:

1. Un solo puesto de cobro (1 AP12).
2. Una sola impresora dentro del alcance BT.
3. Cliente no tiene LAN estable o no quiere gastar en Pi/equipo
   host.

Concretamente, **Thalia (librería unipersonal)**, peluquería
piloto, food truck o catering son candidatos directos a BT por
encima de A. Vale la pena soportarla en B-Print fase 1 como
modo paralelo a A — el código que serializa ESC/POS es el mismo,
sólo cambia el transporte (WebBluetooth API en vez de WS al
agente).

---

## 3. Recomendación de arquitectura

### 3.1 Arquitectura primaria: A (agente local Docker)

Es la única que cumple TODOS los criterios:

- ✓ Funciona con cualquier impresora ESC/POS (USB o red).
- ✓ Funciona con cualquier hardware del cajero (AP12, iPad,
  mini-PC).
- ✓ Cero atadura a SDK propietario (ADR-011).
- ✓ Auditable y mantenible.
- ✓ Bajo coste hardware al cliente.
- ✓ Coste dev moderado (~1 semana).

**Cómo se implementa:**

#### 3.1.1 Componentes

1. **`@mipiacetpv/print-agent`** (nuevo workspace package). Node 20
   + TypeScript. Servidor HTTP minimal (Fastify o native http).
2. **Imagen Docker** `mipiacetpv/print-agent:latest` publicada en
   Docker Hub (o GitHub Container Registry).
3. **Script de instalación**:
   ```bash
   curl -sSL https://install.mipiacetpv.tech/print-agent.sh | bash
   ```
   Detecta el OS, instala Docker si falta, baja la imagen, configura
   systemd/launchd para auto-start, registra el agente con su
   tenant.
4. **Endpoints del agente**:
   - `GET /health` — alive check.
   - `POST /print` — body con bytes ESC/POS o (mejor) con
     payload estructurado del ticket que el agente compone.
   - `POST /cash-drawer/open` — abrir cajón sin imprimir.
   - `GET /printer/status` — estado de la impresora.
5. **Discovery mDNS**: el agente se anuncia como
   `_mipiacetpv-print._tcp.local`. La PWA del AP12 puede
   detectarlo o usar IP fija configurada en admin.

#### 3.1.2 Comunicación PWA ↔ agente

Dos opciones técnicas:

**a) PWA → agente directo HTTP (en misma LAN)**

```
PWA AP12 (Chrome) → fetch('http://print-agent.local:8080/print', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticketBytes: ... })
})
```

Problema: CORS si el agente no devuelve `Access-Control-Allow-Origin`.
Solución: el agente devuelve `Access-Control-Allow-Origin: *` (la
PWA en local, no preocupación grave).

**b) Backend → agente vía WebSocket reverso**

El agente abre WS persistente al backend (Hostinger). Backend
manda jobs. Agente imprime, reporta status. PWA → backend → WS →
agente.

Mejor para escala futura. Para piloto inicial, opción (a) es más
simple y suficiente.

#### 3.1.3 Autenticación

El agente al instalarse recibe un `agentToken` único del backend
(via endpoint admin `/admin/print-agents/register`). El backend
firma tokens con tenant + agent ID. La PWA al hacer fetch al
agente local incluye una huella del cashier-session que el agente
valida contra el backend (o cache local).

#### 3.1.4 Auto-update

El container Docker incluye un script que cada 24h hace
`docker pull` de la imagen y reinicia si hay versión nueva.
Alternativa: el cliente ejecuta `docker pull && docker restart`
periódicamente (cron).

### 3.2 Arquitectura secundaria: H (Bluetooth directo)

Para clientes pequeños donde A es overkill:

- **1 AP12 + 1 impresora dentro de 10m** (Thalia, peluquería piloto,
  food truck, catering, mercadillo).
- Sin LAN estable o sin querer instalar host/Pi.
- Impresora de comanda secundaria en cocina sin tirar cable.

Se implementa **en paralelo a A** en B-Print fase 1, no como fase
posterior, porque comparte 100% del serializer ESC/POS (sólo cambia
el transporte: `WebBluetooth` en vez de `fetch` al agente). La PWA
detecta qué transporte tiene configurado el cashier-session y
enruta el job.

**Coste extra dev:** ~3-4 días (incluye UX de pairing y manejo de
reconexión tras sleep). Hardware cliente: 40-200€, sin host extra.

### 3.3 Arquitectura terciaria: D (WebUSB directo)

Para clientes que quieren impresora cableada USB pero sin host
extra y aceptan Chrome como único navegador. Útil si el AP12 tiene
puerto USB libre y la impresora está pegada a la pantalla.

**Coste extra dev:** ~2-3 días para añadir el cliente WebUSB en
PWA con detección automática.

### 3.4 Variante futura: A1 (agente Android empotrado en TPV all-in-one)

Para TPVs con **impresora integrada en el chasis** (Sunmi T2/V2 Pro/D2,
Imin Falcon/Crane, PAX A920 Pro, Verifone X990, genéricos chinos).
No aplica al AP12-1506 actual (sólo pantalla).

**Descripción:** APK pequeño y aislado instalado UNA VEZ en el TPV
all-in-one, expone el mismo API HTTP local
(`http://127.0.0.1:7878/print`) que el agente Docker de A, y por
dentro traduce a SDK del fabricante (`sunmi.printerservice`,
`IminPrintUtils`, etc.). La PWA habla con el agente local igual que
en A — no sabe ni le importa que sea un APK en vez de un container.

**Por qué respeta ADR-011:**
La PWA sigue siendo 100% web pura. La dependencia del SDK
propietario queda encapsulada en un módulo APK **intercambiable por
modelo de hardware**. Si mañana cambiamos de fabricante, sustituimos
el APK; el código de la PWA no cambia.

**Transporte real al hardware (3 vías posibles según fabricante):**
1. **SDK propietario** (lo más común, ~90% modelos): Intent
   broadcasts a `sunmi.printerservice` o equivalente. Es lo que el
   APK encapsula.
2. **USB-class genérico interno** (raro): la impresora aparece como
   USB estándar y Chrome puede hablarla con WebUSB. Reutiliza
   código D. No requiere APK.
3. **Servicio HTTP local pre-instalado por el fabricante** (caso
   ideal, algunos Sunmi): expone su propio endpoint local. La PWA
   habla HTTP plano sin APK nuestra.

**Pros del hardware con impresora integrada:**
- Plug-and-play absoluto: enciendes el TPV y vende.
- Un único equipo a soportar, cargar y reponer.
- Cero cables visibles entre pantalla e impresora.
- Coste total típico parecido o ligeramente menor (~500€
  todo-en-uno vs ~530€ AP12+Epson LAN+cajón+Pi).
- Mejor presentación al cliente final.

**Cons:**
- **Pieza única**: si rompe la impresora, el TPV entero queda fuera
  de servicio hasta repuesto. AP12+Epson externa permite seguir
  vendiendo con BT/móvil mientras llega recambio.
- **Ancho de papel suele ser 58mm** en gama media (Sunmi V2 Pro,
  Imin Falcon 1) vs 80mm Epson externa. Peor para tickets largos.
  Gama alta (Sunmi T2, T3) sí trae 80mm.
- **Velocidad menor** que Epson dedicada (~120mm/s vs 250mm/s).
- **Cajón portamonedas RJ11**: no todos los modelos integrados
  tienen salida. Confirmar por SKU.
- **Atadura a fabricante**: si Sunmi sube precio o discontinúa
  modelo, migración dura. Mitigado porque el APK es módulo
  intercambiable, pero el coste de soporte multi-fabricante crece.
- **Coste dev por fabricante soportado**: ~4-5 días por familia
  (Sunmi primero por presencia en mercado español, Imin segundo,
  resto bajo demanda).

**Veredicto:** **NO entra en B-Print fase 1.** Se evalúa cuando:
- Llegue un cliente que ya tenga TPV all-in-one comprado y pida
  integración (escenario "el peluquero me trae su Sunmi T2").
- En v2 decidamos vender un SKU "TPV mipiacetpv integrado" con
  Sunmi como hardware estándar y dejemos el AP12+Epson como
  alternativa para clientes con presupuesto ajustado.

**Decisión de cuándo recomendar A1 vs A vs H** (cuando esté
implementado):
- 1 puesto + bar pequeño + cliente quiere presentación premium →
  Sunmi T2 con A1.
- 1 puesto + tienda pequeña sin necesidad de ancho 80mm → AP12
  con H (Bluetooth).
- Multi-puesto o restaurante con cocina remota → AP12 con A
  (agente Docker + Epson LAN).

### 3.5 Arquitectura premium futura: F (print bridge appliance)

Para v2 cuando tengamos volumen suficiente para justificar
stockear hardware. Diferenciador serio frente a competencia.

## 4. Matriz de comparación

| Arquitectura | Coste cliente | Coste dev | Soporta USB | Soporta red | Multi-puesto | iOS futuro | Plug-and-play |
|---|---|---|---|---|---|---|---|
| **A · Agente Docker** | Bajo (PC ya existente o RPi 30€) | 1 sem | ✓ | ✓ | ✓ | ✓ | Medio |
| **A1 · Agente Android empotrado** | Medio (TPV all-in-one ~500€) | 4-5d por fabricante | ✓ (interno) | ✓ (interno) | △ (1 puesto típicamente) | ✗ | Total |
| **B · App Android** | 0€ | 1-2 sem | ✓ | ✓ | △ | ✗ | Alto |
| **C · IPP directo** | Alto (impresora red 300€+) | 3-4d | ✗ | ✓ | ✓ | ✓ | Alto |
| **D · WebUSB Chrome** | Bajo | 2-3d | ✓ | ✗ | ✗ | ✗ | Medio |
| **E · WS reverso** | Bajo | 1.5 sem | ✓ | ✓ | ✓ | ✓ | Medio |
| **F · Bridge appliance** | Medio (kit 50€) | 1-2 sem | ✓ | ✓ | ✓ | ✓ | Total |
| **G · Cloud print** | Recurrente $10-30/mes | 3d | ✓ | ✓ | ✓ | ✓ | Alto |
| **H · Bluetooth** | Muy bajo (BT 40-150€, sin host) | 3-4d | △ (vía BT) | △ (vía BT) | ✗ | ✗ | Alto |

## 5. Decisión de hardware impresora

Independiente de la arquitectura, la matriz de impresoras
soportadas:

### 5.1 Recomendada para todos los clientes

**Epson TM-T20III** en sus dos variantes:

- **USB** (~150€) — para clientes con A (agente local) o D (WebUSB).
- **LAN/Ethernet** (~200€) — para clientes con A (agente local
  vía red) o cuando la impresora tiene que servir a múltiples
  cajas.

Ambas hablan ESC/POS de Epson auténtico. Codepage español
correcto de fábrica. Soporte impecable.

### 5.2 Alternativa premium

**Epson TM-m30III** (~280€): integra USB + Ethernet + WiFi +
Bluetooth en una unidad. Cliente puede empezar por USB y migrar
a red sin cambiar impresora. **La más versátil.**

### 5.3 Alternativa bajo coste

**Bixolon SRP-350plus** USB (~120€): ESC/POS estándar. Más
económica que Epson, mantenimiento ligeramente más fragil pero
viable.

### 5.4 NO recomendadas

- **Impresoras clónicas chinas** tipo MUNBYN, NETUM,
  genéricas-50€: ESC/POS incompleto, codepage español roto,
  pierden config al desenchufar. Coste real (incluyendo soporte
  nuestro) supera al de una Epson buena.

### 5.5 Cajón portamonedas

Cualquier **APG-compatible** con conector RJ11 al puerto DK de
la impresora. ~60-120€. Se abre con comando ESC/POS estándar,
sin driver propio.

## 6. Propuesta concreta para piloto

### 6.1 Mapeo de los 5 pilotos a arquitecturas

| Piloto | Tipo | Arquitectura | Hardware | Coste aprox |
|---|---|---|---|---|
| **Librería Thalia** | Retail unipersonal | **H · Bluetooth** | AP12 + Epson TM-P20 BT 80mm (~150€) + cajón APG con cable Y a impresora BT | ~290€ |
| **Tienda 1** | Retail pequeño | **H · Bluetooth** (default) o A si pide multi-puesto | AP12 + Epson BT o LAN + cajón | 290-530€ |
| **Tienda 2** | Retail pequeño | **H · Bluetooth** (default) | igual que Tienda 1 | 290-530€ |
| **Bar 1** | Hostelería multi-puesto | **A · Agente Docker** | AP12s (uno por puesto) + Epson TM-T20III LAN + cajón + RPi5 | ~530€ por puesto + 280€ infra común |
| **Bar 2** | Hostelería multi-puesto | **A · Agente Docker** | igual que Bar 1 | igual |
| **Peluquería** | Servicios cita | **H · Bluetooth** | AP12 + Epson BT + cajón | ~290€ |

**Implicaciones operativas:**
- **4 de 5 pilotos arrancan con H** (sin host extra, sin Pi, sin LAN
  configurada). Solo los 2 bares requieren A completo con Pi.
- Sólo necesitamos **2 RPi5** para piloto (uno por bar), no 5.
- AP12 actuales (3 unidades) cubren Thalia + Bar 1 (1 puesto inicial)
  + 1 tienda. Comprar 2-3 más para Bar 2 (multi-puesto) y resto.

### 6.2 Setup recomendado tipo (arquitectura A · multi-puesto bar)

**Hardware:**
- 1 AP12-1506 por puesto.
- 1 Epson TM-T20III LAN por local (~200€).
- 1 cajón APG-compatible RJ11 (~70€).
- 1 Raspberry Pi 5 (~80€) ejecutando el agente local — o
  reutilizar Mac mini / mini-PC si el cliente ya tiene.

**Software:**
- PWA mipiacetpv en cada AP12.
- Print-agent Docker en el Raspberry Pi.
- Conectados a la WiFi del local + Ethernet para impresora.

### 6.3 Setup recomendado tipo (arquitectura H · single-puesto)

**Hardware:**
- 1 AP12-1506.
- 1 Epson TM-T20III Bluetooth (~150€) o **TM-m30III** premium
  (~280€, BT+LAN+USB en un solo equipo, recomendada si presupuesto
  lo permite porque facilita migración futura a A).
- 1 cajón APG-compatible con cable Y al puerto DK de la impresora
  (~70€).
- **Cero host extra. Cero cables LAN.**

**Software:**
- PWA mipiacetpv en el AP12. Pairing BT desde la PWA al instalar.

### 6.4 Roadmap de implementación B-Print

**B-Print fase 1 (~10 días Code):**

1. Workspace nuevo `packages/escpos/` con el serializer compartido
   (cabecera fiscal, líneas, IVA, cierre de cajón). Reutilizado por
   todas las arquitecturas.
2. Workspace `packages/print-agent/` (Node + TypeScript) para A.
3. Endpoints HTTP del agente: `/print`, `/cash-drawer/open`,
   `/printer/status`, `/health`.
4. Imagen Docker `mipiacetpv/print-agent` publicada en GHCR.
5. Cliente PWA con **transporte enchufable** (`AgentTransport`,
   `BluetoothTransport`, `WebUsbTransport`) seleccionable por
   tienda en admin.
6. Implementación H (WebBluetooth) con UX de pairing + estado de
   conexión + botón reconectar.
7. Implementación D (WebUSB) como tercer transporte.
8. Endpoint admin `/admin/print-agents` para registrar agentes por
   tienda + asignar transporte/IP/MAC BT.
9. Test de impresión desde admin con botón "Imprimir prueba".
10. Estado tiempo real en header TPV (icono impresora verde/
    ámbar/rojo) que conoce el transporte activo.

**B-Print fase 2 (~3-4 días Code, sólo si piloto lo pide):**

- Auto-discovery mDNS del agente para A (ahora mismo IP manual con
  DHCP reservation).
- Auto-update del container Docker.

**B-Print fase 3 (futura, v2):**

- F · Print bridge appliance Raspberry Pi pre-flasheada como SKU.
- A1 · Agente Android empotrado para TPVs all-in-one (Sunmi
  primero, Imin segundo).
- E · WebSocket reverso del agente al backend para gestión de
  flotas multi-tenant.

## 7. Decisiones cerradas (criterio CTO)

Cerradas con criterio propio sobre las preguntas que tenía abiertas.
Si en algún punto Matías prefiere otra cosa, lo cambiamos.

1. **Host del agente para clientes A** → opción mixta. Para los 2
   bares piloto vendemos **Raspberry Pi 5 pre-configurada** como
   parte del kit (~80€, control total, sin depender de equipo del
   cliente). Para clientes futuros que ya tengan Mac mini / mini-PC,
   ofrecemos instalación remota como opción. **Razón:** los bares
   son escenario crítico (caer la impresora = caer el servicio),
   queremos control. Para retail solo H, no aplica.

2. **Kit completo vs cliente compra** → **kit completo "Mipiacetpv
   Starter"** con margen pequeño nuestro. **Razón:** simplifica
   comercial (un precio cerrado), reduce soporte (sabemos qué tiene
   cada cliente), y los 5 pilotos están esperando — fricción de
   "compra estas 4 cosas en estos 4 sitios" mata conversión.

3. **WebUSB en fase 1 o v2** → **en fase 1**, junto a H. **Razón:**
   el coste marginal es ~2-3 días Code porque el serializer ESC/POS
   ya está compartido, sólo cambia el transporte. Cubre el caso de
   "cliente con AP12 y Epson USB conectada directa" sin tener que
   comprar BT ni Pi.

4. **Agent por tenant o por tienda** → **por tienda**. Cada
   `Store` tiene un `printAgentId` opcional + transporte
   configurado. **Razón:** modelo más simple, escala mejor cuando
   un tenant tiene varias tiendas, alineado con el modelo Store/
   Register de B4.

5. **mDNS o IP manual** → **IP manual con DHCP reservation** en
   fase 1, mDNS en fase 2 si los pilotos se quejan. **Razón:**
   mDNS en Chrome Android es flaky, IP manual con DHCP
   reservation en el router del cliente es ~5 min de setup y
   100% fiable.

## 8. Próximos pasos

1. **B7.5 (taxes fix)** sigue en curso por Code — bloqueante
   anterior a B-Print.
2. Cuando B7.5 cierre, escribo el prompt **B-Print** (B8) con el
   alcance de arriba: serializer compartido + agente Docker + BT
   + WebUSB + admin de transportes.
3. Antes de empezar B-Print **comprar 1 Epson TM-T20III LAN + 1
   Epson TM-P20 BT + 1 cajón APG + 1 RPi5** para validación
   física. Coste validación: ~500€.
4. Code construye B-Print contra el hardware real. Validamos los
   3 transportes (A, H, D) E2E.
5. Script de instalación de cliente A en RPi5 + manual breve para
   pairing H + manual breve para WebUSB.
6. Desplegamos al primer piloto. Recomendado **Thalia primero**
   porque H es la arquitectura más simple y la valida sin depender
   del setup de bares.

---

## Anexo · ADR-006 actualizado tras este diseño

Reescritura propuesta de ADR-006 en `docs/04-stack-y-decisiones.md`:

```
ADR-006 · Impresión multi-transporte con serializer ESC/POS compartido

Decisión: implementamos B-Print con tres transportes en paralelo y
un único serializer ESC/POS compartido:

- A · Agente local Docker en LAN del cliente, vía HTTP local. Default
  para escenarios multi-puesto (bares, restaurantes, retail con
  varias cajas).
- H · WebBluetooth directo desde la PWA a impresora BT. Default para
  escenarios single-puesto sin LAN configurada (Thalia, peluquería,
  food truck, catering).
- D · WebUSB directo desde la PWA a impresora USB conectada al
  AP12. Caso minoritario, coste marginal por compartir serializer.

Cada Store tiene un `printTransport` configurable (A/H/D) + datos
del transporte (IP del agente, MAC de la BT, o vendor/product USB).

Razón: el backend en VPS Hostinger NO puede abrir TCP al rango
privado del cliente, así que cualquier solución requiere
ejecución en el lado cliente. Soportar A+H+D en paralelo cuesta
~10 días Code (vs ~7 días sólo A) y cubre el 100% de los escenarios
de los 5 pilotos esperando, evitando que clientes pequeños paguen
por hardware host (Pi) que no necesitan. Cumple ADR-011 (PWA pura,
ESC/POS estándar, cero SDK propietario).

Alternativas descartadas (con razón):
- App Android nativa wrapping PWA (viola ADR-011).
- IPP directo (sin formato ticket ESC/POS, descartado tras §03.B).
- Cloud print (coste recurrente, dependencia externa).
- WS reverso (más complejo, reservado para v2 con gestión flotas).

Variantes futuras (no en B-Print fase 1):
- A1 · Agente Android empotrado para TPVs all-in-one con impresora
  integrada (Sunmi/Imin/PAX). Activado cuando entre cliente con ese
  hardware o cuando v2 venda SKU integrado.
- F · Print bridge appliance: RPi pre-flasheada como SKU comercial
  cuando volumen lo justifique.
```
