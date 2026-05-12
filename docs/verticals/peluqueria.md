# Vertical · Peluquería (parqueada — no avanzamos en MVP)

> **Estado:** vertical reconocido pero **no se desarrolla en MVP**.
>
> Los clientes de peluquería pueden usar el TPV en su versión retail sin
> ninguna modificación: el sync de servicios ya es estándar para todos
> los tenants (`07-nucleo-comun.md` §2.4), y vender un corte de pelo en
> el TPV funciona idéntico que vender un champú.
>
> El vertical "peluquería" sólo cobra sentido cuando se añade el rasgo
> definitorio: **conexión con agenda de citas**. Sin agenda, no hay
> diferenciador real respecto a retail. Cuando se aborde, se levanta este
> documento del estado parqueado.

---

## 1. Por qué se parquea

- El v0 "retail + servicios" ya está cubierto por el núcleo. No hay que
  programar nada específico para que una peluquería venda y cobre.
- Las features que **sí** son específicas (agenda, ficha histórica,
  comisión por estilista, duración del servicio, recordatorios) tienen un
  alcance grande y compiten en prioridad con verticales que sí tienen
  cliente firmado en MVP (retail = Thalia).
- Mejor lanzar retail, probar y aprender, y volver a peluquería con
  contexto real cuando haya un cliente piloto de peluquería que justifique
  el esfuerzo.

---

## 2. Rasgo definitorio del vertical (cuando se reactive)

**Agenda de citas integrada con el TPV.** Sin esto, peluquería no es
vertical. Con esto, sí.

Flujo objetivo:

1. Cliente reserva cita (online, teléfono, presencial) con estilista,
   servicios y duración estimada.
2. Sistema bloquea el slot del estilista.
3. Recordatorio automático al cliente 24 h y 1 h antes (email/SMS/
   WhatsApp).
4. Al llegar el cliente, **la cita "se cobra"** desde el TPV — el ticket
   sale pre-poblado con los servicios reservados, el estilista asignado y
   el cliente vinculado a su ficha.
5. El cajero puede añadir productos (champús, geles que el cliente se
   lleve) o servicios extra antes de cerrar.
6. Tras el cobro, el sistema actualiza la **ficha histórica del cliente**
   con lo que se le hizo (incluida fórmula de color si aplica) y dispara
   el **recordatorio post-servicio** según la cadencia configurada del
   servicio (corte cada 4 semanas, color cada 8, etc.).

---

## 3. Features pendientes (cuando se reactive, no en MVP)

### 3.1 Servicios con duración

- Campo `duration_minutes` en `product` (nullable, sólo aplica a
  servicios).
- En el ticket mostrar la duración estimada por línea.
- Base para la agenda.

### 3.2 Agenda / citas

- Calendario por estilista o por puesto.
- Reserva con servicio(s) → bloquea slot por la duración total.
- Cancelaciones, no-shows, lista de espera.
- Origen de la cita: online (web/app), teléfono manual, walk-in
  presencial.

### 3.3 Estilista por línea

- Cada línea de servicio lleva `stylist_user_id` (default: cajero actual,
  cambiable).
- Permite reporting por estilista (ventas, servicios, ticket medio).

### 3.4 Comisión por estilista

- % configurable por estilista, por categoría de servicio o por servicio
  concreto.
- Informe mensual de comisión a pagar.
- No se envía a Holded — vive en el TPV.

### 3.5 Tarifas variables por nivel del estilista

- Mismo servicio "Corte" puede tener precio distinto según junior, senior
  o master.
- Implementación: variantes del producto-servicio en Holded
  (`Corte/Junior`, `Corte/Senior`, `Corte/Master`) — encaja con el
  patrón de variantes de retail.

### 3.6 Ficha de cliente con historial de servicios

- Histórico de qué servicios se le hicieron, con qué productos, qué
  fórmula de color (texto estructurado), foto del resultado opcional.
- Crítico para fidelización en peluquería ("lo mismo de la otra vez").
- Va más allá de la "ficha mínima" de retail.

### 3.7 Encadenado de servicios / packs

- Pack "Color + corte + secado" como producto único de Holded con
  desglose visible.
- O paquetes en el TPV que se traducen a varias líneas en el ticket.

### 3.8 Cobro de propina

- Botón "Añadir propina" antes del cobro → línea separada para el
  estilista.
- Decisión fiscal pendiente: ¿se mete en el `salesreceipt` o se lleva
  fuera de Holded?

### 3.9 Recordatorio post-servicio

- Email/WhatsApp al cliente 3-6 semanas después según servicio.
- Configurable por servicio.

---

## 4. Cuenta de pruebas disponible

El propietario dispone de **una cuenta Holded de peluquería ya operativa**
como banco de pruebas para cuando se reactive el vertical. Antes de
empezar:

- Verificar que **Veri*factu está OFF**.
- Inventariar productos vs servicios, SKUs, almacenes.
- Datos de la cuenta van en `.env.peluqueria` del worktree de pruebas,
  **nunca commiteados**.

---

## 5. Cuándo desparquear

Reactivar este documento cuando se cumpla **alguno** de estos
disparadores:

- Aparece un cliente piloto de peluquería interesado en pagar por el TPV.
- Retail está estable en producción con al menos 2 clientes activos y
  hay capacidad para abrir un segundo vertical.
- Un cliente de retail (p.ej. Thalia) pide funcionalidades que sólo
  tienen sentido con agenda (improbable, pero posible).
