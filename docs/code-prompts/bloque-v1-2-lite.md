# Prompt para Claude Code — v1.2-Lite

Lote derivado de la **auditoría post-deploy v1.1 con Thalía**
(sesión 2026-05-20, segunda mitad). 5 sub-tareas encadenadas en una
sola branch `v1-2-lite`, commits separados.

## Estado actual de master

- HEAD: `6ddf5f7 Merge v1.1 Thalía feedback · 4 lotes + roadmap`.
- v1.1 desplegado y validado en producción (Inv-1 defensivo, T-3,
  T-6, T-6a, T-7, P-1, Root super-admin, Realtime toast).
- Migrations aplicadas: b15_product_tags + b16_super_admin_root.

## Findings de la auditoría que justifican este lote

1. **Imágenes vacías**: 0/966 productos de Thalía con `imageUrl`. El
   raw de Holded `/invoicing/v1/products` NO devuelve ningún campo
   de imagen (verificado: 26 campos en raw, ninguno
   image/picture/photo/thumb/attach). El endpoint correcto para
   imágenes vive en otra ruta de la API.
2. **Categorías nativas son del Pro**: Holded `categoryId` solo
   funciona con el Inventario Pro (25€/mes). Thalía paga el Pro
   pero solo 2/966 productos tienen categoryId. Decisión:
   **mantenemos chips por tags** (plan básico) y NO migramos a
   categoryId nativo. El campo `tags` ya funciona (874/966).
3. **Tags con casing inconsistente**: Holded entrega los tags tal
   cual el cliente los introduce. En Thalía aparecen "Papelería" y
   "papeleria" como chips distintos en el TPV. Hay que normalizar.
4. **Cache invalidation no es agresiva**: tras un deploy con bump
   de IDB version, el TPV abierto en navegador del cajero seguía
   sirviendo el bundle viejo. Hubo que limpiar manualmente
   `caches`, `indexedDB` y `serviceWorker`. Inviable pedir a cada
   cajero hacerlo manual.
5. **Reenviar invitación super-admin**: cuando un super-admin
   reciente no encuentra el email (spam, bloqueo, etc.) no hay
   forma de reenviar sin borrar y recrear. Doloroso para
   onboarding del equipo.

---

# Lote 1 · Bug-Imagenes-Holded (el más grande)

## Objetivo

Conseguir que las imágenes de producto sí lleguen al TPV. Como
Holded NO las entrega en `/invoicing/v1/products`, identificar el
endpoint correcto y modificar nuestro sync para usarlo.

## Investigación previa (sin código)

1. Lee la documentación de Holded API en
   https://developers.holded.com (sección Products).
2. Identifica el endpoint que devuelve URL de imagen / attachments
   de un producto. Candidatos típicos:
   - `GET /invoicing/v1/products/{id}` (individual; puede incluir
     `mainImageUrl` aunque la lista no lo haga)
   - `GET /invoicing/v1/products/{id}/attachments`
   - `GET /invoicing/v1/products/{id}/files`
3. Confirma con una llamada de prueba contra la API de Thalía
   (Matías te puede dar la API key cifrada en BD, descifrar con
   `decryptSecret` desde un script de spike).

## Estrategia

Dos opciones según lo que descubras:

### Opción A — endpoint individual `/products/{id}`

Si el endpoint individual devuelve `mainImageUrl` (común en muchas
APIs aunque no lo declare la doc):

1. En `holded-client/src/products.ts`, añadir
   `getProductDetail(client, productId)` que pega al individual y
   devuelve el campo extra.
2. En `initial-sync.ts`, **NO** llamar al individual por cada
   producto (sería 966 llamadas × 200ms = 3 minutos extra).
   Llamarlo SOLO cuando un producto tenga el flag indicativo (a
   verificar: ¿`hasStock`? ¿algún campo específico?).
3. En `incremental-sync.ts`, si se detecta que `imageCachedAt es
   null` Y `imageUrl es null`, llamar al individual como reintento
   (rate-limited a ~5/s para no saturar Holded).

### Opción B — endpoint `/files` o `/attachments`

Si la imagen vive en `/products/{id}/files`:

1. En `holded-client/src/products.ts`, añadir
   `listProductAttachments(client, productId)`.
2. Filtra attachments por MIME image/* y elige el primero como
   "main".
3. Persistir la URL del attachment en `Product.imageUrl`. El
   worker image-cache-worker la descarga como ya hace.

### Punto común

- Mantener `extractImageUrl` actual como primer intento (defensivo).
- Si devuelve null, llamar al endpoint nuevo.
- Logging: warn cuando un producto sigue sin imagen tras intentar
  ambos caminos.

## Tareas

1. Spike investigación + decisión Opción A/B (entrega notas en
   `docs/auditorias/bug-imagenes-holded.md`).
2. Implementar la opción decidida en `holded-client`.
3. Adaptar `initial-sync.ts` y `incremental-sync.ts`.
4. Test contra fixture (o test integración con cuenta dev).
5. Documentar en el spike doc cómo se invalida el cache cuando una
   foto cambia en Holded.

## Criterios de aceptación

- Tras un resync de Thalía, al menos el 80% de productos con foto
  en Holded tienen `image_url IS NOT NULL` en BD.
- El TPV pinta imágenes en lugar de placeholders en esos productos.
- Coste en tiempo del sync inicial < 2× lo actual (no degradación
  catastrófica).
- Si Holded API rate-limita, el sync se completa de forma robusta
  (con backoff, no falla todo).

---

# Lote 2 · Mejora-UX-Invitacion · Reenviar + fallback

## Backend

Endpoint nuevo `POST /super-admin/admins/:id/resend-invite`:

- Requiere super-admin autenticado.
- Sólo `isRoot=true` puede reenviar invitación de otros. Un no-root
  no debería poder llegar a este endpoint porque no ve la lista
  (Lote 3 v1.1), pero defensivo: 403 si no es root.
- Si el target tiene `deletedAt != null`: 404
  `SUPER_ADMIN_NOT_FOUND`.
- Si el target ya tiene 2FA activado (`totpEnabledAt != null`):
  devolver 409 `ALREADY_ONBOARDED` — sería raro reinvitar a alguien
  que ya completó setup.
- Comportamiento normal:
  - Genera nueva tempPassword.
  - Actualiza `passwordHash`, `mustChangePassword=true`,
    `tokenVersion++` (invalida tokens previos del target).
  - Envía email vía `sendInviteEmail` igual que en alta.
  - Audit: acción `resend_super_admin_invite`.
  - Response: `{ admin: serialize(updated), tempPassword }` (sigue
    devolviéndola plana por si SMTP falla).

## UI admin

- En la fila de cada super-admin en `AdminsListPage`, añadir botón
  "Reenviar invitación" (icono Mail). Visible solo para root.
- Click abre modal de confirmación: "¿Reenviar invitación a
  {nombre}? Su contraseña actual quedará invalidada."
- Al confirmar, llamada al endpoint. Si éxito: toast "Invitación
  reenviada". Si SMTP falla (log.warn en backend pero response 201
  igual): mostrar la `tempPassword` en pantalla con botón Copiar.

## Fallback tempPassword en alta también

- El alta actual (`POST /super-admin/admins`) ya devuelve
  `tempPassword`, pero la UI no la enseña.
- En `AdminsListPage`, tras crear un super-admin nuevo, mostrar la
  tempPassword en un modal post-éxito con botón Copiar. Texto:
  "Si {email} no recibe el email en unos minutos, entrégale
  manualmente esta contraseña por canal seguro."

## Criterios de aceptación

- Root puede reenviar invitación con un click.
- Si SMTP cae, la tempPassword es siempre visible al super-admin
  que invitó.
- Auditoría refleja el `resend_super_admin_invite`.

---

# Lote 3 · Normalizar tags lowercase + invalidación SW agresiva

Dos sub-tareas pequeñas agrupadas.

## 3.A · Normalizar tags lowercase

Holded entrega los tags tal cual el cliente los introduce. Para
evitar duplicados visuales ("Papelería" / "papeleria"), normalizar
a lowercase + trim en el sync.

### Tareas

1. En `initial-sync.ts` e `incremental-sync.ts`, donde ya filtramos
   strings vacíos, añadir `.toLowerCase()` antes del Set:
   ```ts
   const tags = Array.isArray(tagsRaw)
     ? Array.from(new Set(
         tagsRaw
           .filter((t): t is string => typeof t === "string")
           .map((t) => t.trim().toLowerCase())
           .filter((t) => t.length > 0),
       ))
     : [];
   ```
2. Migration aditiva `b17_tags_lowercase`:
   ```sql
   UPDATE products
   SET tags = ARRAY(SELECT DISTINCT lower(unnest(tags)))
   WHERE cardinality(tags) > 0;
   ```
3. En el TPV (`SalePage.tsx`), aplicar capitalización al renderizar
   chip para que se vea bonito:
   ```ts
   {tag.charAt(0).toUpperCase() + tag.slice(1)}
   ```
4. Documentar en manual del implantador: "los tags en Holded se
   pueden poner en cualquier caso; el TPV los normaliza".

### Criterios

- Tras deploy y resync de Thalía, en el TPV no quedan tags
  duplicados por casing.

## 3.B · Invalidación agresiva del Service Worker

Hoy el SW (workbox) hace `StaleWhileRevalidate` para el index. Tras
un deploy con bundle nuevo + bump de IDB version, el primer load
del cajero sirve el bundle viejo. Forzar invalidación.

### Tareas

1. Investigar el setup actual del SW en `apps/tpv-web/vite.config.ts`
   (probablemente plugin `vite-plugin-pwa`).
2. Cambiar el `index.html` y `manifest` a estrategia `NetworkFirst`
   con fallback al cache (mantiene offline pero prioriza nuevo).
3. **O alternativamente**: añadir un mecanismo de "version-check"
   en el JS principal del TPV:
   - Al cargar, hacer `fetch('/version.json', { cache: 'no-store' })`
     con el hash del build actual.
   - Si la versión del servidor difiere de la cacheada en
     localStorage, llamar a `caches.keys()` + `caches.delete()` +
     `indexedDB.deleteDatabase('mipiacetpv-catalog')` + reload.
   - Persistir la versión nueva tras la limpieza.
4. Generar `version.json` en build time (`apps/tpv-web/public/`).

### Criterios

- Tras un deploy, la siguiente vez que un cajero abre el TPV, ve la
  versión nueva sin tener que limpiar caché manualmente.
- Offline sigue funcionando (no perdemos PWA).

---

# Lote 4 · T-9 Favoritos + T-5 Modificar precio

Dos features pequeñas para v1.2 que Matías diferió en v1.1.

## 4.A · T-9 Productos favoritos / atajos

**Síntoma**: Thalía y otros clientes querrían tener una sección de
"acceso rápido" para productos que vende todos los días (fotocopias,
etiquetas, etc.).

### Diseño

- **Reusa los tags**: tag especial reservado `favoritos`. Cualquier
  producto con ese tag aparece duplicado en una sección "Atajos" en
  la parte superior del grid, antes incluso del chip "Todos".
- Alternativa rechazada: tabla nueva `tenant_favorites` (más
  complejo, más sync). Decisión: usar tags.

### Tareas

1. En `SalePage.tsx`, antes de renderizar la grid principal, mirar
   si hay productos con tag `favoritos` (case-insensitive tras
   normalización del Lote 3.A).
2. Si los hay, renderizar una sub-grid arriba con título "Atajos",
   máximo 8 productos, mismo componente de tile.
3. Si no hay productos con ese tag, no renderizar la sección.

### Criterios

- El cliente añade tag `favoritos` a 5 productos en Holded → tras
  resync, esos 5 aparecen como atajos arriba.

## 4.B · T-5 Modificar precio en línea de venta

**Síntoma**: a veces el cliente quiere ajustar el precio de un
producto puntualmente (libro descatalogado, devolución parcial,
etc.).

### Diseño

- Long-tap (o icono lápiz) sobre una línea del ticket abre input
  para editar el precio unitario de esa línea.
- El cambio queda como `unitPriceOverride` en la línea (campo
  nuevo). El audit del ticket registra el original y el override.
- Se envía a Holded como precio de la línea (Holded acepta precios
  unitarios distintos del producto base).
- **Sin permisos extra**: cualquier cajero puede tocar precio. El
  propietario lo ve en la auditoría (Holded muestra el precio que
  se cobró).

### Tareas

1. Migration aditiva `b18_line_price_override` en
   `ticket_lines.unit_price_override Decimal(10,2) NULL`.
2. Schema Prisma + endpoint POST /tickets (o el que crea líneas)
   acepta `unitPriceOverride` opcional.
3. UI en `SalePage.lineSheet.tsx` o equivalente: icono lápiz junto
   al precio. Click abre input numérico. Confirmación con Enter.
4. Renderizado en la línea: si override != null, mostrar precio en
   amarillo/destacado con tooltip "precio modificado, original X €".

### Criterios

- El cajero modifica el precio de una línea, cobra el ticket, y en
  Holded llega el precio modificado.
- En el historial de tickets, las líneas modificadas se ven
  marcadas.

---

# Lote 5 (opcional, si queda tiempo) · B-Hardening B

Pendientes menores de la auditoría del 2026-05-19, lote intermedio
de seguridad. Sólo si hay tiempo tras los 4 anteriores. **No
empezar este lote si el Lote 1 (imágenes) consume más tiempo del
estimado** — mejor entregar 4 lotes pulidos que 5 a medias.

Items sin abrir aquí (consultar `docs/auditorias/Auditoria-2026-05-
19.md` si lo necesitas).

---

# Convenciones del repo

- Comentarios y commits en español.
- Migrations aditivas con prefijo bNN_ (siguiente: b17, b18).
- Push lo hace Matías.
- Deploy lo hago yo (Claude) en sesión posterior, sobre VPS
  Hostinger via Web Terminal.
- Sin tests nuevos salvo que ya haya test del archivo tocado.

# Orden recomendado

1. Lote 1 (Bug-Imagenes-Holded) — el más grande, **empieza por
   aquí**. Si exige decisión arquitectónica grande, pausa y
   documenta como hiciste con Realtime.
2. Lote 2 (Reenviar invitación) — independiente, M.
3. Lote 3 (Tags lowercase + SW agresivo) — pequeño, ideal para
   intercalar entre lotes grandes.
4. Lote 4 (Favoritos + Modificar precio) — features de producto.
5. Lote 5 (B-Hardening B) — solo si queda tiempo.

# Cuando termines

Push a `v1-2-lite`. PR a master con resumen por lote. Avísame con
mensaje del estilo:

```
v1.2-Lite listo en branch v1-2-lite.
Lote 1: <hallazgos endpoint imágenes>
Lote 2: <commits>
Lote 3: <commits>
Lote 4: <commits>
Lote 5: <commits o "no entró por tiempo">
Pendiente merge + deploy.
```
