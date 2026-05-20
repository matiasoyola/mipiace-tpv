# Roadmap Master · Mipiacetpv

Documento único con todo el roadmap actual del producto, ordenado
cronológicamente. Se actualiza cada vez que se cierra un bloque o
se incorpora feedback nuevo.

Última actualización: **2026-05-20** (cierre sesión Matías + Thalía).

---

## 🟢 En producción (ya desplegado y validado)

### Plataforma base
- Multi-tenant con aislamiento estricto + Holded API key cifrada
  AES-GCM por cuenta.
- Stack productivo: postgres + redis + api + worker + caddy +
  static-publish.
- Dominio canónico `mipiacetpv.com` con SSL Let's Encrypt + 301
  desde `.tech`.
- CSP defensiva + Permissions-Policy + 6 headers de seguridad.

### Catálogo
- Sync inicial e incremental desde Holded.
- Auto-SKU con bandeja de revisión.
- Imágenes de producto cacheadas vía worker.
- Modificadores B-Bar.

### TPV
- Pantalla de venta con grid, búsqueda fuzzy, contactos.
- Modo prueba con cajero técnico (purga al activar).
- Tickets digitales con PDF + QR + email.
- Cierre de turno + arqueo + corte manager con PIN.
- Devoluciones (refunds) endpoint + UI listado.
- Pago mixto (cash + card + bizum).
- Mapa de mesas (TableMapScreen) para HOSPITALITY.

### Super-admin
- Panel `/superadmin` con listado cuentas + audit log.
- CRUD multi super-admin + selector global de cuentas.
- Onboarding supervisado: DRAFT → ACTIVE con purga.
- Impersonación + Modo prueba con tokens efímeros.
- Tipo de negocio (HOSPITALITY / RETAIL / SERVICES) configurable.

### Bugfixes y hardening reciente (2026-05-20)
- Bug-05 fiscalProfile tolerante a objetos Holded.
- Bug-CSP-embed: modal "Ver ticket" funcional tras CSP.
- Bug-RehidratarSuperAdmin: recrear email soft-deleted.
- SMTP Hostinger configurado: invitaciones llegan.
- Cabeceras CSP + Permissions-Policy ampliadas.

### Documentación
- Manual de implantadores v1 (.docx, 20 páginas).
- Guía rápida v1 (.docx, 1 hoja A4).
- Auditoría seguridad + usabilidad.

---

## 🟡 v1.1 · Feedback Thalía + Bar + Peluquería (en curso)

**Estado**: Claude Code trabajando en branch
`v1-1-thalia-feedback`. Cuatro lotes encadenados.

### Lote 1 · Investigación previa
- **Inv-1** Diagnóstico fotos no se ven en TPV (worker logs + sync).
- **Inv-2** Verificación end-to-end de devoluciones.
- **Inv-3** Verificación TableMapScreen visible para HOSPITALITY.

### Lote 2 · Quick wins UI + API ✅ (Code ya lo terminó)
- **T-3** Cliente visible en lista "Pendientes" sin abrir carrito.
- **T-6** Preservar taxId / legalName del DRAFT al sincronizar warehouse.
- **T-6a** Editar datos fiscales del tenant desde super-admin.
- **T-7** Dirección al crear contacto desde TPV.
- **P-1** Toggle Servicios / Productos en TPV para vertical SERVICES.

### Lote 3 · Seguridad — Root super-admin
- Nuevo flag `isRoot Boolean` en `SuperAdminUser`.
- Solo root puede crear / eliminar / editar otros super-admins.
- Super-admins regulares ven solo su propia ficha.
- Migration `b16_super_admin_root` con backfill automático
  (marca el super-admin más antiguo como root).

### Lote 4 · Realtime entre pantallas (B-Realtime)
- WebSocket server con Fastify + plugin.
- Suscripción por canal `tenant:store:register`.
- Eventos: cart.line_added / removed / modified, suspended /
  resumed, ticket.paid, ticket.refunded, shift.opened / closed.
- Fallback offline + reconexión con backoff.
- Throttling 5 eventos/s por canal.

**Cierre esperado**: cuando Code termine, merge a master + deploy
en VPS (~1 día yo). Post-deploy: validación end-to-end con cajero
real antes de implantación a Thalía.

---

## 🔵 v1.2 · Post v1.1 (~2-3 semanas tras cierre)

### Bloque Inventory A — Cierre brecha Holded Inventario Pro
- **Ajustes de stock vía escáner BC en TPV** (recepción de
  mercancía con lectura de código de barras).
- **Variantes seleccionables al añadir al carrito** (modelo
  ProductVariant ya existe, falta UI).
- **Imprimir etiquetas con código de barras** (driver impresora
  térmica + plantilla).

### Diferidos del feedback Thalía
- **T-5** Modificar precio en línea de venta.
- **T-8** Búsqueda fuzzy mejorada (requiere ejemplo concreto de
  Thalía para diagnosticar).
- **T-9** Productos favoritos / atajos (fotocopias).

### Seguridad
- **Mejora-UX #49** Reenviar invitación super-admin + mostrar
  tempPassword como fallback cuando SMTP falla.
- **B-Hardening B** Pre-equipo Holded (varias mejoras menores
  identificadas en auditoría).

### Operativa
- **Conversación con Thalía** sobre Inventario Pro: validar qué
  usa cada semana para decidir si puede prescindir.

---

## 🟣 v1.3 · Mid-term (~3-4 semanas tras v1.2)

### Bloque Inventory B
- **Albaranes manuales** (recepción multi-producto en una sesión
  con escáner BC consecutivo).
- **Informes básicos** (dashboard con top vendidos, stock bajo,
  ventas por día / categoría / cajero, valor de inventario).

### Hostelería
- **B-3** Ticket de dieta (split bill — dividir cuenta por
  comensal en mesa).

### Hardening
- **B-Hardening C** Mejoras mayores (S3 password policy, S6
  throttling tickets, U4 metadata humana auditoría, U8 paginación).

---

## 🔴 v1.4 / v2.0 · Diferidos a post-15-clientes

Ver `docs/roadmap-post-15-clientes.md` para spec completo.

### Bloque Inventory C
- **C.1** OCR de albaranes (foto / PDF → desglose automático con
  fuzzy match contra catálogo).
- **C.2** Múltiples tarifas + precios de compra por proveedor.
- **C.3** Múltiples idiomas del catálogo.
- **C.4** Transferir stock entre almacenes.

### Servicios profesionales
- **P-2** Agendas peluquería con tiempos por servicio y
  asignación por empleado.

### Criterio de activación
- 15 clientes activos sobre mipiacetpv con tickets diarios.
- Al menos 5 lo han pedido explícitamente.
- Margen estable y v1.x productivo sin apagar fuegos.

---

## ⚪ Sin priorizar (parking lot)

Apuntes que llegarán de futuras conversaciones y aún no tienen
posición clara en el roadmap. Se reordenan al planificar cada
versión.

- Reenvío de invitación super-admin desde la UI (botón en lista).
- Notificaciones push / mobile companion para propietarios.
- Modo cocina (KDS — Kitchen Display System) para hostelería.
- Soporte multi-divisa si aparece cliente fuera de eurozona.
- App móvil nativa para cajero (hoy es PWA, suficiente para piloto).

---

## Principio rector

> **Para Thalía no son features, es estabilidad.**
>
> Antes de añadir una feature nueva en una versión, verificar que
> ningún cliente piloto tiene un bug operativo abierto. La
> credibilidad se gana en la consistencia del día a día, no en la
> longitud del changelog.

---

## Cómo se actualiza este documento

Al cerrar un bloque:
1. Mover lo cerrado a "🟢 En producción".
2. Si surgen nuevos items, anotar en "⚪ Sin priorizar" y luego
   reasignar en el siguiente planning.
3. Si una versión se retrasa o se reordena, actualizar las fechas
   estimadas con honestidad — el roadmap no se vende, se planifica.

Sesiones de planning recomendadas: tras cada deploy mayor (cierre
de v1.x), 1h de revisión del Roadmap con Matías para reordenar.
