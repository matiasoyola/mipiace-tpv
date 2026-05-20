# Auditoría v1.1 · Feedback Thalia + Bar + Peluquería
**Fecha:** 20 de mayo de 2026
**Branch:** `v1-1-thalia-feedback`
**Estado de master en producción:** `335a92b Bug-RehidratarSuperAdmin`
**HEAD local al iniciar:** `4956e51 B-Categorias-via-Tags`
**Auditor:** Claude

---

## Resumen

Lote 1 (investigación) hecho sobre el código local. **No tengo acceso al
VPS productivo desde esta sesión**, así que las verificaciones que
exigen logs/BD live quedan documentadas como hipótesis con fix
defensivo a aplicar y un punto de verificación que Matías ejecutará
tras el deploy.

---

## Inv-1 · Fotos de producto no se ven en TPV

### Hipótesis priorizadas

1. **Campo de imagen no reconocido (más probable).** `extractImageUrl`
   buscaba en 5 campos (`mainImage`, `image`, `thumbnail`, `pictures`,
   `images`). El prompt explícitamente menciona que Holded podría
   exponer la foto como `attachment` para fotos subidas vía móvil.
2. **HEIC desde iPhone.** El whitelist MIME del worker
   (`apps/api/src/workers/image-cache-worker.ts`) acepta sólo
   `image/jpeg`, `image/png`, `image/webp`. Una foto HEIC subida desde
   iPhone llegaría con `Content-Type: image/heic` y el worker la
   descartaría con `status: skipped, reason: bad-content-type:image/heic`.
3. **Sync incremental no disparado tras editar foto en Holded.** El
   sync incremental se ejecuta en cron; entre edición en Holded y
   próximo tick puede pasar tiempo. La invalidación del cache (`imageCachedAt = null`)
   ya está implementada en `incremental-sync.ts:422` cuando la URL
   cambia, así que un resync manual basta.
4. **Bug-genérico de cache.** Descartado en review de código:
   `incremental-sync` compara `existing.imageUrl !== newImageUrl` y
   pone `imageMime: null, imageCachedAt: null` correctamente.

### Cambios aplicados (defensivos, sin saber aún la causa real)

- `packages/holded-client/src/products.ts` — `extractImageUrl` ahora
  también prueba `attachment` y `attachments` antes de devolver `null`.
- `packages/holded-client/src/products.ts` — nueva función
  `listUnrecognizedImageKeys(raw)` que devuelve las claves del raw
  que parecen imagen pero no están declaradas (regex sobre el nombre:
  `image`, `picture`, `photo`, `thumb`, `attach`, `media`, `foto`).
- `apps/api/src/onboarding/initial-sync.ts` y
  `apps/api/src/catalog/incremental-sync.ts` — al detectar
  `imageUrl === null` Y `listUnrecognizedImageKeys.length > 0`, se
  emite warning con la lista. Así, tras el siguiente sync, Matías
  puede grepear logs y descubrir el campo que falta declarar.

### Pendiente / acción del cliente

- **Tras el deploy**, forzar resync de Thalia (botón "Resincronizar"
  en el panel de tenant) y revisar `docker logs mipiacetpv-api --since
  10m | grep "image-like"`. Si aparecen claves nuevas, añadirlas a
  `extractImageUrl` y enviar otro commit (sin migración).
- **HEIC**: si tras el resync defensivo siguen viéndose `bad-content-type`
  para algunos productos, decidir entre:
  - **Opción A** (recomendada si HEIC es <5% de los productos):
    documentar a Thalia que use JPG/PNG. El móvil de iPhone tiene
    setting "Más compatible" que ya entrega JPG.
  - **Opción B**: añadir `sharp` al worker para convertir HEIC →
    JPEG al vuelo. Coste: +60MB de imagen Docker, código extra,
    edge cases (HEIC con orientación EXIF, animaciones).

  Decisión: **dejar como Opción A** hasta confirmar que es un
  problema recurrente — Bug-05 y B-Multi-Vertical ya hicieron la
  imagen Docker más pesada.

### Estado

Commit `Inv-1 · Defensivo attachment + diag logs` aplicado. Verificación
post-deploy pendiente.

---

## Inv-2 · Devoluciones

### Estado del código

Revisado:

- `apps/api/src/tickets/routes.ts` — endpoint POST de devoluciones
  presente.
- `apps/api/src/tickets/upload-refund.ts` — sube la nota de abono a
  Holded.
- `apps/api/src/workers/refund-upload-worker.ts` — worker async.
- `apps/api/src/queues/refund-upload.ts` — queue BullMQ.
- `apps/tpv-web/src/pages/TicketsHistoryPage.tsx` — UI de historial
  con `refunding` state y botón.
- `apps/tpv-web/src/pages/RefundPage.tsx` — flujo de devolución.

**El flujo end-to-end está implementado.** El reporte de Thalia
"gestionar devoluciones" probablemente se refería a una funcionalidad
que existe pero no han descubierto / no la encuentran en la UI.

### Pendiente / acción del cliente

- **Manual del cliente**: añadir una sección en
  `docs/manuales/` (si existe doc para Thalia) explicando paso a paso
  cómo devolver un ticket: Tickets → buscar el ticket → "Devolver" →
  seleccionar líneas → confirmar.
- **Pase manual con cuenta Thalia**: cobrar un ticket de prueba y
  devolverlo, validando que llega la nota de abono a Holded. Matías
  ejecuta tras deploy.

### Estado

Sin cambio de código en este lote. Documentación al manual queda como
TODO de v1.1 documental (no entra en branch de código).

---

## Inv-3 · TableMapScreen para HOSPITALITY

### Estado del código

- `apps/tpv-web/src/pages/TableMapScreen.tsx` existe.
- Render condicional por `businessType=HOSPITALITY` desde SB3.

### Necesita verificación visual

No puedo confirmar desde aquí si la pantalla se renderiza
correctamente al entrar en una cuenta HOSPITALITY ni si existe UI de
admin para crear/editar salas y mesas. **Esto requiere una sesión de
prueba con cuenta Bar real.**

### Hipótesis

- Si la pantalla **sí renderiza pero está vacía** (no hay salas
  configuradas), falta UI de admin → sub-bloque `B-Tables-Admin` que
  se sale del scope de v1.1 (Matías decide si entra como mini-lote).
- Si la pantalla **no renderiza**, es un bug del render condicional
  → fix puntual.

### Pendiente / acción del cliente

Matías: tras deploy, entrar al tenant Bar (o crear uno test con
`businessType=HOSPITALITY`) y reportar:

1. ¿Aparece TableMapScreen antes de iniciar venta?
2. ¿Hay UI para crear salas/mesas, o solo la lista?

Según resultado, abrir issue concreto. Si exige UI de admin,
proponer al cliente que lo dejemos para v1.2.

### Estado

Sin cambio de código en este lote. Verificación pendiente.

---

## Próximos lotes

- Lote 2 (Quick wins) — T-3, T-6, T-6a, T-7, P-1.
- Lote 3 (Root super-admin).
- Lote 4 (Realtime WS).
