# De Raquel Torres al TPV · qué se trae, adónde va y qué se tira

> **Qué es esto.** El plan para que todo lo construido en el proyecto Raquel Torres (`rt-booking`,
> `rt-gift-cards`, `rt-panel`) entre en mipiacetpv sin duplicar nada. Lo aprendido está en
> `05-lo-aprendido-en-rt-del-2-sep-al-6-oct.md`; aquí está **dónde aterriza cada pieza**.
>
> **Regla de fondo.** En Raquel Torres el código es PHP sobre WordPress y la agenda real es Koibox.
> Del TPV se trae **el contrato** (qué se pide, qué se devuelve, estados y errores), **los casos de
> prueba medidos** y **las pantallas como diseño**. El código se reescribe en TypeScript sobre
> Postgres. Todo lo que existía solo para hablar con Koibox se tira.
>
> Inventario hecho el 7-oct-2026 contra `raqueltorres@fc459da` y `mipiacetpv@2e1a19e`.

---

## 1 · Una sola capa común; la clínica la consume

Para no duplicar, el TPV tiene **dos capas** y lo de Raquel Torres va **solo a la común**:

| Capa | Qué tiene | Quién la usa |
|---|---|---|
| **Común** (agenda) | Cliente, cita, servicio, profesional, turno, recurso (sala, camilla, aparato), bono/programa, reserva online, recepción, caja | Peluquería, spa, clínica… cualquiera con citas |
| **Clínica** | Acceso a la historia, registro de accesos, valoración, historia, anotaciones, consentimientos clínicos, informe | Solo tenants con el módulo clínico |

El diagrama de `docs/clinica/entidad-relacion.mermaid` ya lo hace así: la clínica cuelga de `CLIENT`,
`APPOINTMENT`, `RESOURCE`… comunes, y solo añade las tablas `CLINICAL_*`. **Se mantiene.**

**Tres puntos donde la clínica podría duplicar, y cómo se evita:**

1. **Bonos de sesiones.** La clínica los necesita (está en su ficha). **No hay «bono clínico»**: es
   `B-reservas-8`, común. La clínica lo usa igual que la peluquería o el spa. Ver §4.
2. **Camillas y salas.** Son `Resource` común con su tramo dentro del servicio (§3). La clínica no
   modela salas propias.
3. **Consentimientos.** Hay dos cosas distintas que no se mezclan: `ClientConsent` (RGPD y
   comunicaciones, común) y el consentimiento clínico por tratamiento (`clinica-4`, firma → PDF).
   Este último cuelga del mismo `Client`; no crea otro paciente.

---

## 2 · Inventario: cada pieza de Raquel Torres frente al TPV

Leyenda: ✅ ya está en el TPV · 🔁 traducir (contrato y tests de RT, código nuevo) · 🗑️ se tira
(solo existía por Koibox, WordPress o Stripe).

### 2.1 `rt-booking` (reserva)

| Pieza RT | TPV hoy | Qué hacer | Destino |
|---|---|---|---|
| `GET /availability`, `/availability-range` | ✅ `GET /agenda/availability` | Añadir motivo de rechazo por hueco y recursos (§3) | B-recursos |
| `POST /book` + `class-reserva-pago` + `class-precio` | Alta desde mostrador sí; **pública no** | 🔁 Reserva pública con cita pendiente de pago, TTL, CAS y precio solo en servidor | B-11 |
| `POST /code-check` | ❌ | 🔁 `consultar` de bono/cheque (§4) | B-8 |
| `GET /reserva-estado` | ❌ | 🔁 Estado público sin caché, referencia con sufijo aleatorio | B-11 |
| `POST /stripe` (webhook) | ❌ | 🔁 Webhook de la pasarela que se elija (B-13); el contrato de estados es el mismo | B-13 |
| `POST /mi-cita/` + `class-mi-cita` | ❌ | 🔁 Enlace de autogestión con token, política en servidor, mover la misma cita | B-11 |
| `/jacuzzi`, `/reserva-jacuzzi`, `class-jacuzzi` | ❌ | 🔁 Generalizar: **extra con recurso** = cita hija con posición antes/después | B-recursos |
| `class-cabinas` (reparto con vuelta atrás) | `EXCLUDE` por recurso, sin reparto | 🔁 Reparto de salas + tramo relativo + propuesta/confirmada | B-recursos |
| `class-policy` (yield, ADR-001) | ✅ B-6a (suelo) | Lo que falta ya está en B-6b | B-6b |
| `/capacidades` (quién hace qué, por token) | ✅ `skill-matrix` (binario) | 🔁 Tres estados + captura desde el móvil de la profesional | B-3b |
| `class-cliente-repository`, `class-vinculo-repository`, `class-nombre`, `class-phone` | ✅ `Client` (teléfono no único) | 🔁 Resolución (móvil, nombre) con `match_mode` y cola «revisar ficha» | B-1b |
| `class-justificante`, `class-avisos` | ❌ | 🔁 Justificante y avisos: marcar y luego enviar, botón de prueba | B-11 / B-12 |
| `class-panel-api` (avisos, reservas, cabinas, ajustes) | ✅ `agenda/health`, `cobros-pendientes` | 🔁 Bandeja de descuadres + plano de salas | B-recepción / B-recursos |
| `class-koibox-*`, `class-volcado`, `class-occupancy-probe`, `class-service-matcher`, `class-memory-store`, `class-mock-adapter` | — | 🗑️ Solo existían por Koibox. **Se aprovecha en B-10** (importación) lo medido sobre la API de Koibox | B-10 |
| `class-stripe-client`, `class-wpdb-store`, `class-installer`, `class-cli` | — | 🗑️ WordPress / Stripe | — |

### 2.2 `rt-gift-cards` (cheques, programas, saldo, señales)

| Pieza RT | TPV hoy | Qué hacer | Destino |
|---|---|---|---|
| Puerta `consultar` / `aplicar` / `devolver` (`class-codigos`) | `GET /clients/:id/vouchers` vacío (contrato de B-1) | 🔁 **El núcleo de B-8**, contra Postgres real | B-8 |
| `class-movimientos` (libro) + deshacer 4 s | ❌ | 🔁 Libro solo-inserción, compensaciones enlazadas, saldo derivado | B-8 |
| `class-programa-*` (código y numeración) | ❌ | 🔁 Código con numeración atómica sin huecos | B-8 |
| Saldo `S-…` (de anulaciones) | ❌ | 🔁 Bono por importe sin número | B-8 |
| Señal `R-…` | ❌ | 🔁 **Pago a cuenta de una cita**, con tipo propio en el libro (no un cheque) | B-13 |
| Canje de un servicio por otro, canje por partes, caducados | ❌ | 🔁 Reglas de valor (doc 05 §4.3) | B-8 |
| `class-libro-importer` | ❌ | 🔁 Importar bonos/programas de otro sistema | B-10 |
| Compra pública de cheques regalo (`/compra`, `/giftable`, PDF, emails, cofres, preparación) | ❌ | Fuera de este plan. Es venta online de regalos, no agenda. Se valora aparte | — |
| `class-number-sequence`, `class-caducidad`, `class-pdf-generator` | ❌ | Patrón útil (numeración sin huecos, fechas en hora del centro) | B-8 |

### 2.3 `rt-panel` (recepción)

| Pieza RT | TPV hoy | Qué hacer | Destino |
|---|---|---|---|
| Inicio con buscador primero y avisos que no se cierran | Agenda del mostrador ✅ | Buscador de cliente/código antes que nada | B-recepción |
| Avisos de descuadre (ADR-10) | Parcial: `cobros-pendientes` | 🔁 Bandeja escrita en el `catch`, se vacía al resolver | B-recepción |
| Reservas web (informe por pago/cita) | ❌ | 🔁 Con la reserva online | B-11 |
| Caja 0.8.0 (cierre validado con foto y huella) | Norma de cierre diario + `bloque-cierre-caja-diario` | **Cruzar, no copiar.** El TPV ya tiene su norma; de RT se toman la foto con huella y «cambió después» | Cierre de caja |
| Cabinas (plano) | ❌ | 🔁 | B-recursos |
| Acceso, candado, cambio de contraseña | ✅ TPV tiene los suyos | 🗑️ | — |

---

## 3 · Bloques que salen, en una lista

Ninguno es nuevo de la nada: o ya existía su prompt y se **amplía**, o es la pieza de RT que no tenía
casa.

| Bloque | Estado del prompt | Qué recibe de RT | Lo pide |
|---|---|---|---|
| **B-reservas-8 · Programa y bonos** | Escrito; se amplía | Puerta `consultar`/`aplicar`/`devolver`, libro, saldo, canjes, numeración | **Clínica**, Sole, spa |
| **B-recursos · Salas, camillas y aparatos** | Nuevo | Reparto, tramo relativo, extra con recurso, plano, propuesta/confirmada | **Clínica** (camillas), spa |
| **B-reservas-1b · Identidad del cliente** | Nuevo, pequeño | Resolución (móvil, nombre), `match_mode`, revisar ficha, fusión | Todos; la web lo necesita |
| **B-reservas-3b · Competencias en tres estados** | Nuevo, pequeño | Tres estados y captura por la profesional | Spa; clínica con varias sanitarias |
| **B-reservas-6b / 7b** | Ya en cola | Ventana por mes natural; carrera pago-tarde | — |
| **B-reservas-11 · Reserva online** | Renumerado, sin prompt | `/book`, estado, autogestión `/mi-cita`, justificante, informe web | Todos |
| **B-reservas-12 · Recordatorios** | Sin prompt | Marcar y luego enviar | Todos |
| **B-reservas-13 · Señal y pasarela** | Sin prompt | Contrato de pago al reservar; señal como pago a cuenta | Todos |
| **B-recepción · Bandeja de descuadres** | Nuevo | Avisos escritos en el fallo, se resuelven con botón | Todos |
| **B-reservas-10 · Importación Koibox** | Escrito; se amplía | Ids reales, trampas de la API, 4 familias de servicio, sin paginar por offset | Un centro que venga de Koibox |

---

## 4 · El orden lo pide la clínica

La clínica es el frente C abierto, y su ficha dice «pacientes + agenda + cobro + **bonos** +
historia». De la lista de arriba, lo que la clínica **necesita para implantarse** es:

1. **B-reservas-8 · bonos de sesiones**: un paciente de podología o fisioterapia compra 5 o 10
   sesiones. Sin esto, la clínica cobra sesión a sesión.
2. **B-recursos**, solo si la clínica tiene más de una camilla o un aparato compartido.

El resto (reserva online, señal, recordatorios, identidad, competencias) no bloquea la clínica y
sigue en su sitio de la cola.

**Consecuencia para el tablero:** B-8 está hoy en el puesto 9 de la cola («agenda nivel 1
restante»). Si la clínica lo necesita, **entra en el frente C** como uno más de sus bloques, igual
que valoración, sesión o consentimientos. No abre un frente nuevo ni desplaza a nadie. Lo decide
Dirección.

*Mi Piace Internet Solutions · 7-oct-2026.*
