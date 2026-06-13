---
title: Checklist de implantación por tenant — mipiacetpv
estado: v1.0 — operativo
fecha: 2026-06-13
aplica a: OnboardingV2 (estados DRAFT → ACTIVE, modo prueba, OWNER reducido)
---

# Checklist de implantación de un cliente (tenant)

Guía operativa de principio a fin para dar de alta un comercio. El principio rector: **el equipo mipiacetpv prueba el TPV completo del cliente en modo test ANTES de que el cliente toque nada**, con Holded como única fuente de verdad fiscal. El email al OWNER **no sale** hasta que validamos todo.

Leyenda: ☐ tarea · 🔑 lo hace Matías/super-admin · 🤖 automático del sistema · ⚠️ punto de atención.

---

## Fase 0 — Preparación (antes de tocar nada)

- ☐ Confirmar **vertical** del cliente: retail / hostelería / servicios. Determina la configuración (mesas, modificadores, importador).
- ☐ Confirmar que el cliente tiene **cuenta de Holded** activa y operativa.
- ☐ 🔑 Obtener la **API key de Holded** del cliente (la genera él en su Holded; nosotros no la creamos).
- ☐ Tener a mano el **NIF/CIF** del cliente (opcional en alta, pero recomendable para el check de unicidad).
- ☐ Firmar / tener listos los **documentos legales** antes de la activación real: contrato piloto + DPA (`docs/legal/`). ⚠️ No activar para uso real sin ellos.
- ☐ Verificar **catálogo en Holded** del cliente razonablemente limpio: productos con IVA correcto, precios, y SKU/código de barras si va a usar escáner.

## Fase 1 — Alta DRAFT (super-admin)

- ☐ 🔑 En `admin.mipiacetpv.com/superadmin` → **Crear tenant** con: `holdedApiKey` (+ `taxId` y `legalName` opcionales).
- ☐ 🤖 El sistema valida la API key contra Holded (`listWarehouses`), extrae razón social y dirección del almacén por defecto, y crea el tenant en estado **DRAFT** (sin usuario OWNER todavía).
- ☐ 🤖 Se encola el **sync inicial** automáticamente.
- ⚠️ Si la creación falla: `HOLDED_API_KEY_INVALID` (key mal/permiso), `HOLDED_SUSPENDED` (cuenta Holded impagada), `TENANT_NIF_TAKEN` (NIF ya dado de alta), `HOLDED_INVALID_RESPONSE` (Holded devolvió HTML → reintentar).

## Fase 2 — Verificar salud del onboarding (readinessChecks)

Abrir el detalle del tenant DRAFT y revisar el panel **onboardingHealth**. Todos los `readinessChecks` deben quedar en verde (`ready: true`):

- ☐ **Sync inicial completado** (`initialSync.status = DONE`).
- ☐ **≥80% de taxes con rate** — si está bajo, el catálogo del cliente tiene IVAs sin tipo en Holded (que los revise). Si tras limpiar sigue mal, ejecutar `resync-catalog`.
- ☐ **≥50% de productos sellable** — productos no vendibles suelen ser por SKU faltante o tax sin resolver.
- ☐ **Sin tickets SYNC_FAILED**.
- ☐ **Cajero técnico provisionado** (🤖 se auto-crea tras el sync OK).
- ⚠️ Revisar también: nº de productos sin SKU (`products.withoutSku`) y servicios sellable (si el cliente vende servicios, recordar que las líneas SERVICE van con `serviceId`, no SKU).

## Fase 3 — Prueba completa en modo test (equipo mipiacetpv)

> Las ventas en modo test **NO suben a Holded** (quedan SKIPPED) y **NO mandan email**. Es seguro probar a fondo.

- ☐ 🔑 Generar **token de cajero técnico** desde el detalle del tenant y abrir el TPV en modo prueba (salta emparejamiento + PIN; banner amarillo con countdown visible).
- ☐ Probar **venta básica**: añadir productos, cobrar (efectivo y tarjeta), ver ticket digital (PDF/QR/email simulado).
- ☐ Probar **búsqueda de producto** y, si aplica, **escáner** (pistola USB-HID y/o cámara).
- ☐ Probar **devolución** parcial y total.
- ☐ Probar **apertura y cierre de turno** + **arqueo Z** (verificar desglose).
- ☐ **Según vertical** (ver Fase 3-bis).
- ☐ Verificar que las ventas test aparecen como **TEST/SKIPPED** y **no** han llegado a Holded.
- ☐ Probar en el **hardware real** que usará el cliente (AP12 / handheld / móvil) y a su **resolución** (catálogo alcanzable, sin rebose lateral).

### Fase 3-bis — Específico por vertical

**Retail (p. ej. Thalía):**
- ☐ Probar el **importador Excel → Holded** con un fichero real del cliente.
- ☐ Probar la **pistola de código de barras** del cliente (USB) con productos reales.
- ☐ Verificar catálogo grande (cientos/miles de productos): búsqueda fluida, sin congelar.

**Hostelería (p. ej. Sirope):**
- ☐ Configurar **mesas y zonas** (salón/terraza/barra/reservado) — ver `configurar-mesas-bar.pdf`.
- ☐ ⚠️ Validar con **DOS dispositivos físicos** a la vez: abrir mesa en uno, ver el cambio en el otro (WebSockets), mover/agrupar líneas, cobrar.
- ☐ Probar **modificadores** si el cliente los usa.

**Servicios (peluquería, etc.):**
- ☐ Verificar líneas de **servicio** (`serviceId`) y que cobran/sincronizan bien.

## Fase 4 — Activación (DRAFT → ACTIVE)

- ☐ Confirmar que **todos los readinessChecks** están verdes y la prueba completa fue OK.
- ☐ Confirmar **documentos legales firmados** (contrato + DPA).
- ☐ 🔑 Pulsar **Activar tenant**. 🤖 El sistema purga el cajero técnico de prueba y pasa el tenant a **ACTIVE**.
- ☐ 🤖 A partir de aquí, las ventas **sí** suben a Holded y los emails de ticket **sí** se envían.
- ☐ 🔑 Enviar la **invitación al OWNER** (solo ahora; nunca antes — evita crear dependencia prematura del cliente).

## Fase 5 — Puesta en marcha con el cliente

- ☐ Acompañar el **primer login del OWNER** y la creación de su PIN.
- ☐ Crear con él sus **tiendas, cajas y cajeros** reales.
- ☐ Configurar **comunicación de ticket** por tienda (email/QR).
- ☐ Recordar al OWNER que **NO** verá complejidad técnica (API key, bandejas de error, SKU): eso lo gestiona el equipo mipiacetpv.
- ☐ Dejar claro el **canal de soporte** (soporte@mipiacetpv.tech) y el procedimiento ante incidencia de cobro.
- ☐ Entregar/repasar el **manual** del vertical correspondiente (`docs/manuales/`).

## Fase 6 — Seguimiento post-implantación (primera semana)

- ☐ Revisar a diario la **bandeja de tickets-errors** del tenant (SYNC_FAILED a cero).
- ☐ Comprobar la **conciliación diaria** TPV↔Holded (sin desfases).
- ☐ Verificar que el **primer cierre de turno** real del cliente cuadró.
- ☐ Recoger **feedback** y registrarlo.
- ⚠️ Atención especial a clientes que priorizan estabilidad (p. ej. Thalía): cero sorpresas, responder rápido.

---

## Apéndice — comandos útiles (super-admin / VPS)

> Ejecutar siempre con `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` para evitar el prompt Y/n.

- Re-sync de catálogo de un tenant (corrige taxes/decimales/sellable):
  `docker compose ... run --rm -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 --entrypoint sh api -c 'cd /repo && pnpm --filter @mipiacetpv/api exec tsx src/scripts/resync-catalog.ts --tenantId=<uuid>'`
- Backfill de decimales: mismo `resync-catalog` (ya cubre precios a 4 decimales).

## Notas de marco

- **Fiscalidad:** Holded es el SIF (Verifactu); mipiacetpv solo manda salesreceipts. Ver `docs/legal/posicion-verifactu.md`. No prometer al cliente garantías fiscales del TPV.
- **Modo piloto:** mientras un cliente sea piloto, sus ventas pueden no computar contablemente (confirmar con el cliente). Las discrepancias de céntimos históricas previas al fix de decimales se dejan como están.
