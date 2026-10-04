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
  **Tiene que ser una API Key v1**, no un «API Token» de los nuevos: los que empiezan por `pat_` **no**
  funcionan con esta versión del TPV (no autentican contra la API v1; medido contra Holded el 03-10-2026,
  `docs/blocks/holded-pat-spike.md`). Se genera en **Holded → Configuración → Más → Desarrolladores**. Si
  pegas un `pat_`, el alta lo rechaza al momento con `HOLDED_API_KEY_V1_REQUIRED` y te dice dónde sacar la
  buena — no es un fallo de red, no pierdas tiempo mirando la conexión.
- ☐ Tener a mano el **NIF/CIF** del cliente (opcional en alta, pero recomendable para el check de unicidad).
- ☐ Firmar / tener listos los **documentos legales** antes de la activación real: contrato piloto + DPA (`docs/legal/`). ⚠️ No activar para uso real sin ellos.
- ☐ Verificar **catálogo en Holded** del cliente razonablemente limpio: productos con IVA correcto, precios, y SKU/código de barras si va a usar escáner.

### Fase 0-bis — El cliente NO usa Holded (desde el 27-09-2026, el caso normal)

Todo cliente nuevo empieza **sin Holded** (regla del 27-09) y, con una cuenta nueva, hoy no hay otra
opción: a las cuentas nuevas Holded sólo les da tokens `pat_`, que esta versión del TPV no acepta.
Cuando sea el caso, **el camino cambia en cinco puntos** y el resto del checklist vale igual:

- ☐ En el alta, «¿La empresa tiene Holded?» → **«No lo usa»**. Razón social y NIF se teclean: sin
      Holded no hay de dónde derivarlos, y sin ellos no pasa `fiscal-minimum`.
- ☐ **El catálogo lo cargas tú**, desde «Cargar catálogo» en la ficha del tenant (ver Fase 2-bis). El
      cliente no tiene panel todavía: en DRAFT no hay OWNER.
- ☐ **El TPV es el SIF del comercio.** Cada caja tiene su serie (`C1`, `C2`…) y cada venta lleva
      número correlativo, QR y leyenda. Hace falta la declaración responsable firmada antes de que
      cobre de verdad.
- ☐ En la Fase 2, **`sync-done` y `≥80% de taxes con rate` salen como «No aplica · sin Holded»**, y no
      bloquean. Los que sí aplican siguen igual de duros.
- ☐ En la Fase 6, **no hay bandeja de errores de Holded que mirar**: nada se sube a ningún sitio.

## Fase 1 — Alta DRAFT (super-admin)

- ☐ 🔑 En `admin.mipiacetpv.com/superadmin` → **Crear tenant** con: `holdedApiKey` (+ `taxId` y `legalName` opcionales).
- ☐ 🤖 El sistema valida la API key contra Holded (`listWarehouses`), extrae razón social y dirección del almacén por defecto, y crea el tenant en estado **DRAFT** (sin usuario OWNER todavía).
- ☐ 🤖 Se encola el **sync inicial** automáticamente.
- ⚠️ Si la creación falla: `HOLDED_API_KEY_V1_REQUIRED` (han pegado un token `pat_`; pide la API Key v1 de
  **Configuración → Más → Desarrolladores**), `HOLDED_API_KEY_INVALID` (Holded la rechaza: mal copiada,
  revocada o de otra cuenta), `HOLDED_SUSPENDED` (cuenta Holded impagada), `TENANT_NIF_TAKEN` (NIF ya dado
  de alta), `HOLDED_INVALID_RESPONSE` (Holded devolvió HTML → reintentar), `HOLDED_UNEXPECTED_STATUS`
  (Holded contestó algo raro → reintenta y avisa), `HOLDED_UNREACHABLE` (**sólo** red, timeout o caída de
  Holded → reintentar en unos minutos).

## Fase 2 — Verificar salud del onboarding (readinessChecks)

Abrir el detalle del tenant DRAFT y revisar el panel **onboardingHealth**. Todos los `readinessChecks` deben quedar en verde (`ready: true`):

- ☐ **Sync inicial completado** (`initialSync.status = DONE`).
- ☐ **≥80% de taxes con rate** — si está bajo, el catálogo del cliente tiene IVAs sin tipo en Holded (que los revise). Si tras limpiar sigue mal, ejecutar `resync-catalog`.
- ☐ **≥50% de productos sellable** — productos no vendibles suelen ser por SKU faltante o tax sin resolver.
- ☐ **Sin tickets SYNC_FAILED**.
- ☐ **Cajero técnico provisionado**. Con Holded se auto-crea tras el sync OK. **Sin Holded no hay sync,
      así que se crea la primera vez que pulsas «Probar TPV»** — el botón está disponible desde el
      primer momento y el check se pone verde solo al volver a la ficha.
- ⚠️ Revisar también: nº de productos sin SKU (`products.withoutSku`) y servicios sellable (si el cliente vende servicios, recordar que las líneas SERVICE van con `serviceId`, no SKU).

### Fase 2-bis — Cargar el catálogo (sólo sin Holded)

Un comercio con caja y **0 productos** no pasa `products-sellable`, así que no se puede activar. Sin
Holded no hay sync que los traiga y en DRAFT no hay OWNER que los dé de alta: el catálogo entra por
aquí.

- ☐ Preparar el fichero CSV con estas columnas exactas:
      `sku,nombre,precio_con_iva,iva,categoria`. El de La Maestranza
      (`docs/implantaciones/maestranza/catalogo-tpv.csv`) sirve de plantilla.
- ☐ **El precio es el de la carta, con IVA.** El sistema guarda el neto y el TPV vuelve a pintar el de
      la carta. No restes el IVA a mano.
- ☐ El **SKU es obligatorio** y no puede llevar espacios: es la llave si algún día conectan Holded.
- ☐ La **categoría** es el chip del TPV (cafés, raciones, bocadillos…). Varias, separadas por `;`.
- ☐ Si el precio lleva **coma decimal**, entrecomíllalo (`"2,50"`) o usa el punto (`2.50`). Sin
      comillas, la coma parte la fila y la carga lo rechaza diciendo cuántas columnas ha encontrado.
- ☐ 🔑 Ficha del tenant → **«Cargar catálogo»** → elegir el fichero. Sale la **vista previa**: cuántas
      filas entran, cuáles no y por qué, con el número de línea. **Todavía no se ha escrito nada.**
- ☐ Revisar la vista previa y pulsar **«Cargar N productos»**. Entran todas o ninguna.
- ☐ Un **SKU que ya exista no se pisa**: se salta y se dice. Así se puede volver a cargar el fichero
      corregido sin duplicar nada.
- ⚠️ Un comercio **con** Holded no tiene este panel, y la ruta le responde 409: el catálogo mixto está
      prohibido (ADR-017).

## Fase 3 — Prueba completa en modo test (equipo mipiacetpv)

> Las ventas en modo test **NO suben a Holded** (quedan SKIPPED) y **NO mandan email**. Es seguro probar a fondo.

- ☐ 🔑 Generar **token de cajero técnico** desde el detalle del tenant y abrir el TPV en modo prueba (salta emparejamiento + PIN; banner amarillo con countdown visible).
- ☐ Probar **venta básica**: añadir productos, cobrar (efectivo y tarjeta), ver ticket digital (PDF/QR/email simulado).
- ☐ Probar **búsqueda de producto** y, si aplica, **escáner** (pistola USB-HID y/o cámara).
- ☐ Probar **devolución** parcial y total.
- ☐ Probar **apertura y cierre de turno** + **arqueo Z** (verificar desglose).
- ☐ **Según vertical** (ver Fase 3-bis).
- ☐ Verificar que las ventas test aparecen como **TEST/SKIPPED** y **no** han llegado a Holded. Sin
      Holded, además: **ni un registro fiscal** — el panel de Facturación (VERI*FACTU) tiene que seguir
      con la serie a cero. El cajero técnico no emite ni gasta número.
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
