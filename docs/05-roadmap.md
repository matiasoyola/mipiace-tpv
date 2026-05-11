# 05 · Roadmap

Tres fases. Cada una termina con un criterio de salida verificable.

## Fase 0 · Spike de integración Holded (1 semana)

**Objetivo:** eliminar el mayor riesgo del proyecto antes de invertir en UI.

- [ ] Registrar app de Holded en developers.holded.com (o validar API Key).
- [ ] Script Node aislado que:
  - [ ] Hace OAuth dance (o usa API key) contra una cuenta sandbox.
  - [ ] Descarga 1 producto y 1 almacén.
  - [ ] Crea un `salesreceipt` con una línea.
  - [ ] Anula / crea abono.
  - [ ] Refresca token.
- [ ] Confirmar: numeración fiscal devuelta, IVA aplicado, PDF generado.

**Salida:** documento `docs/spike-holded.md` con los nombres de campo y
ejemplos reales de request/response. **Si algo no funciona como esperábamos,
revisar specs antes de seguir.**

---

## Fase 1 · MVP vendible (4–6 semanas)

**Objetivo:** un TPV usable en una tienda real con un cajero.

### Backend
- [ ] Estructura Node + Fastify + Prisma + Postgres.
- [ ] Auth multi-tenant (propietario, encargado, cajero).
- [ ] OAuth Holded + almacenamiento cifrado de tokens.
- [ ] Endpoints: tenants, tiendas, cajas, usuarios.
- [ ] Sync inicial de catálogo (productos, servicios, almacenes, IVA).
- [ ] Cola BullMQ + worker.
- [ ] Endpoint `POST /tickets` que persiste local y encola.
- [ ] Worker `holded.uploadTicket`.

### Frontend
- [ ] App React PWA, login propietario / cajero.
- [ ] Pantalla de venta táctil: búsqueda + barcode + botones rápidos.
- [ ] Carrito con cantidades, descuentos línea/global.
- [ ] Cobro: efectivo + tarjeta manual + Bizum manual + mixto.
- [ ] Ticket impreso vía agente local.
- [ ] Catálogo en IndexedDB. Offline básico (venta sin red).
- [ ] Cola local que sube tickets cuando vuelve red.
- [ ] Apertura/cierre de turno con arqueo y Z básico.

### Print agent
- [ ] Binario Node para Windows (instalador `.exe`).
- [ ] Soporte impresora USB y IP. Apertura de cajón.

**Salida:** se vende durante una jornada completa en una tienda piloto y
todos los tickets aparecen en Holded sin intervención manual al final del
día.

---

## Fase 2 · v1.0 producción (3–4 semanas)

- [ ] Devoluciones completas (parciales, por método original).
- [ ] Gestión de errores de sync (bandeja de tickets fallidos con acciones).
- [ ] Multi-tienda + multi-caja por tenant.
- [ ] Roles afinados (cajero/encargado).
- [ ] Informes locales: ventas por método, por producto, por cajero, por
      franja horaria.
- [ ] Exportación CSV de cierres.
- [ ] Sentry + métricas Prometheus + dashboard.
- [ ] Hardening: rate limit, CSP estricta, auditoría de seguridad básica.
- [ ] Documentación de usuario (manual del cajero, manual del encargado).
- [ ] Soporte Linux/macOS del print agent (si lo piden los clientes piloto).

**Salida:** dos o tres tiendas piloto operan en producción con SLA
razonable. Cero descuadres atribuibles al TPV en un mes.

---

## Fase 3 · v2.0 ampliación (a decidir)

- [ ] **Datáfono integrado** (Redsys SIS / Stripe Terminal / SumUp).
- [ ] Webhook bidireccional con Holded para empujar cambios al TPV.
- [ ] Fidelización básica (descuentos por cliente, vales).
- [ ] App móvil del cajero (Tauri o React Native) para tablet.
- [ ] Multi-idioma del ticket impreso.
