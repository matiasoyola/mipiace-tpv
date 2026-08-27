# Bloque · Soporte: ver los cajeros de un tenant desde el superadmin — DONE

**Rama:** `soporte-cajeros-superadmin`
**Origen:** hallazgo de la validación del 2026-08-20 — el superadmin no lista los cajeros de un tenant, y la llamada de soporte más frecuente de un TPV ("no puedo entrar") se resolvía impersonando al OWNER: una sesión de escritura auditada de 30 minutos para contestar una pregunta de lectura.
**Estado:** cerrado. `pnpm exec vitest run` verde (1137 passing + 3 skipped legacy), `pnpm -r exec tsc --noEmit` limpio. Sin push, sin merge, sin deploy (los hace Matías). **Sin migración** — no toca `schema.prisma`.

---

## Resumen de números

- **Tests:** 1137 passing + 3 skipped, antes 1124 passing. **+13 tests**, todos en un fichero nuevo.
- **Fichero de test nuevo:** `apps/api/test/super-admin-tenant-cashiers.test.ts` (13).
- **Ficheros nuevos de producción:** `apps/api/src/superadmin/tenant-cashiers.ts`, `apps/admin/src/superadmin/CashiersPanel.tsx`.
- **Migración:** ninguna. El dato ya estaba en `users`; lo que faltaba era la ventana para mirarlo.

---

## Dos premisas del bloque que no se cumplían

Verificadas contra el código antes de diseñar. Las dos cambian el resultado, así que van primero.

### 1. No existe una tabla `Cashier`, y un cajero no cuelga de una tienda ni de una caja

El bloque pedía "los cajeros de sus tiendas y cajas". En el modelo real **un cajero es un `User` del tenant** con rol `OWNER`/`MANAGER`/`CASHIER` y `pinHash != null`. No hay relación con `Store` ni con `Register`: el PIN vale para **cualquier caja del tenant** — `POST /shift/cashier-login` sólo filtra por `tenantId` (que viene del device token) y por email.

Consecuencia: la lista es **del tenant**, no "por tienda y caja". Agrupar por caja habría exigido derivarlo del último `Shift`, que es actividad del cajero — explícitamente fuera de alcance ("Es una lista"). Se deja como está y se anota abajo como carryover si algún día hace falta.

El `OWNER` entra en la lista a propósito: `activate` le pone `pinHash` y usa el TPV como uno más. La pregunta del criterio de "funciona" es *quién puede entrar en esa caja*, y el propietario puede.

### 2. No había ningún rate-limit sobre las lecturas del superadmin

El bloque decía "pasa por el rate-limit que ya existe". El único que existía en `superadmin/rate-limit.ts` es el del **login** (5 intentos / 15 min por email+IP). Las rutas de lectura del superadmin — incluidas `GET /super-admin/tenants` y `GET /super-admin/tenants/:id`, que ya devolvían emails y `lastLoginAt` de usuarios reales — no tenían ninguno.

Se añade uno propio para este endpoint, montado sobre el helper `throttle` que sí existía en `auth/rate-limit.ts`:

- **60 lecturas / 5 min, por super-admin** (no por tenant). La clave es por super-admin a propósito: lo que se quiere topar es que un token válido barra la base de cajeros de **todos** los clientes, no que soporte refresque la ficha de uno mientras habla por teléfono.
- Al superarlo: `429 RATE_LIMITED` con `retryAfterSeconds`, **antes de tocar la BD y antes de auditar** (hay test).

---

## Frente 1 — API

**`GET /super-admin/tenants/:id/cashiers`** (`apps/api/src/superadmin/tenant-cashiers.ts`), `preHandler: requireSuperAdmin`.

Orden del handler, que importa: throttle → 404 si el tenant no existe → query → map → audit → respuesta.

Respuesta:

```jsonc
{
  "tenantId": "…", "tenantName": "Sirope",
  "cashiers": [{
    "id": "…", "alias": "María", "email": "maria@sirope.es", "role": "CASHIER",
    "status": "ACTIVE",           // ACTIVE | NO_PIN | REVOKED
    "canOpenTpv": true,
    "isTestCashier": false,
    "lastLoginAt": "2026-08-26T07:04:00.000Z",
    "lastLoginSource": "TPV",     // TPV | TPV_O_ADMIN
    "createdAt": "2026-02-01T00:00:00.000Z"
  }]
}
```

### El PIN no viaja

- `pinHash` se selecciona **sólo** para derivar `canOpenTpv` y se descarta en el mismo `map`.
- El objeto de respuesta se construye **campo a campo**, nunca por spread de la fila de Prisma. Es la parte que hace que el test siga sirviendo dentro de un año: si alguien añade una columna sensible al `select`, no se filtra sola.
- No hay endpoint de reset ni de escritura. El test comprueba que `POST`/`PATCH`/`DELETE` sobre la misma ruta dan 404 — no existen.

### `status`, y por qué es la columna que contesta la llamada

| Estado | Qué significa | Qué se le dice al cliente |
|---|---|---|
| `ACTIVE` | tiene PIN y no está de baja | puede entrar; si dice que no, el problema es el PIN que teclea o la caja |
| `NO_PIN` | existe pero `pinHash == null` | no puede entrar; se lo pone el propietario desde su sesión |
| `REVOKED` | `deletedAt != null` o email `@revoked.local` | lo dieron de baja; no puede entrar y no debe |

`REVOKED` cubre los dos borrados que hay en el modelo: el sentinel `revoked-<ts>-<id>@revoked.local` que escribe `DELETE /cashiers/:id`, y el `deletedAt` del cajero técnico purgado al activar la cuenta. Los revocados **se listan** (grises, al final): "lo dimos de baja en mayo" es una respuesta completa a "no puedo entrar", y ocultarlos dejaría al de soporte sin ella.

Orden de la tabla: `ACTIVE` → `NO_PIN` → `REVOKED`, y dentro de cada grupo por `createdAt`. Lo que contesta la llamada va arriba.

### `lastLoginSource` — la parte honesta

`User.lastLoginAt` lo escriben **dos** logins distintos: `POST /shift/cashier-login` (TPV, con PIN) y `POST /auth/login` (admin web, con contraseña). El modelo no distingue cuál fue.

- Un `CASHIER` **no puede entrar al admin** — el login le devuelve `403 CASHIER_NOT_ALLOWED_IN_ADMIN`. Su fecha es del TPV con seguridad → `"TPV"`.
- Un `OWNER` o un `MANAGER` entra por los dos sitios → `"TPV_O_ADMIN"`, y la pantalla lo dice en pequeño debajo de la fecha.

Se decidió **decirlo** en vez de aparentar una precisión que no tenemos. Para el caso que motiva el bloque (el cajero que llama) la fecha es inequívoca; para el propietario, matizarla cuesta una línea y evita afirmar por teléfono algo que no consta.

### Auditoría

Acción nueva `view_tenant_cashiers` en `superadmin/audit.ts`, con metadata `{ ipAddress, userAgent, cashiersReturned }`. Se escribe **después** de la query y **antes** de responder: si el audit falla, la lectura no se entrega. `cashiersReturned` distingue de un vistazo la consulta de soporte del barrido masivo.

No hace falta tocar `AuditLogPage` — pinta la acción cruda y el filtro `action` del endpoint de auditoría acepta cualquier string de ≤40 chars.

## Frente 2 — Admin (`CashiersPanel.tsx`)

Panel nuevo en la ficha de tenant, **justo encima de "Usuarios"**: "Usuarios" es la ficha administrativa (2FA, contraseña pendiente); esto es quién puede abrir una caja. Columnas: Alias · Email (con el que entra) · Rol · Estado · Último acceso.

- **La frase, arriba del todo:** *"El PIN no se muestra ni se cambia desde aquí — si un cajero lo ha perdido, se lo cambia el propietario desde su sesión. Cada consulta queda registrada en la auditoría."* Está para que el de soporte no se quede buscando el botón que no existe, que era medio hallazgo del bloque.
- **Las fechas se dicen enteras:** `toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" })` → *"26 de agosto de 2026 a las 9:04"*. Nada de "hace 3 días". Se lee por teléfono tal cual.
- Sin fecha → **"No ha entrado nunca"**, no un guion.
- Sin cajeros → *"Esta cuenta no tiene ningún cajero dado de alta todavía. Los crea el propietario desde su panel."*
- Alias y email largos: `truncate` con el valor completo en `title`.
- Botón "Actualizar" (refetch). Cada pulsación audita y consume throttle, que es lo correcto.

El panel se extrajo a fichero propio en vez de dejarlo dentro de `TenantDetailPage.tsx` (que ya iba por 1911 líneas) — además permite renderizarlo aislado, que es lo que se usó en el bucle visual.

---

## Bucle visual

Docker no estaba levantado en la máquina, así que no había stack completo. Se renderizó el **componente real** (el mismo que se envía) en un harness Vite temporal con `fetch` interceptado, a **1280 px**, y el harness se borró antes de commitear.

Captura: [`soporte-cajeros-shots/1280-cajeros.png`](soporte-cajeros-shots/1280-cajeros.png)

Formas reales cubiertas, las tres que pedía el bloque y tres más:

| Caso | Resultado |
|---|---|
| alias largo (`matias.oyola.sanchez.gerencia`) | trunca a `matias.oyola.sanchez.geren…`, completo en el `title`. La tabla no se descuadra |
| tenant sin cajeros | frase de vacío, sin tabla ni cabeceras huérfanas |
| cajero que no ha entrado nunca | "No ha entrado nunca" en gris |
| email de revocado (`revoked-1755…@revoked.local`) | trunca; la fila entera en gris |
| cajero sin alias | "Sin alias" en gris; el email sigue siendo legible |
| propietario | fecha + "en el TPV o en el panel de administración" debajo |

Sin errores de consola (sólo un 404 de favicon del harness).

**Pendiente de mirar con datos de verdad:** el panel no se ha visto contra la BD del piloto. Lo que puede cambiar de forma es el alias de los cajeros técnicos (el backfill de v1.7 les puso la local-part del email, no "Cajero de pruebas"), que en la captura sale duplicado con la etiqueta violeta por cómo se eligió el fixture.

---

## Criterio de "funciona"

> Con Sirope delante, se ve en una pantalla quién puede entrar en esa caja y cuándo entró por última vez, **sin abrir una sesión de OWNER**.

Cumplido en la parte que se puede verificar en este entorno: la pantalla está en la ficha del tenant, se sirve de un endpoint propio con token de super-admin, y no hay ningún paso de impersonate en el camino. **Falta la pasada contra la BD del piloto**, que no se pudo hacer aquí (sin Docker).

---

## Fuera de alcance — respetado

- No se crea, edita, desactiva ni resetea ningún cajero desde el superadmin. Sólo hay un `GET`.
- No se toca el login del TPV, ni el modelo de PIN, ni los roles. `schema.prisma` sin cambios.
- Ni métricas, ni gráficas, ni actividad del cajero. Es una lista.
- Se respeta la regla dura del equipo: **nadie teclea PINs ni contraseñas de un cliente**. El bloque es de lectura y el PIN no sale ni en el JSON.

## Carryovers

1. **"En qué caja entró"** no se puede contestar hoy sin derivarlo de `Shift` (actividad, fuera de alcance). Si soporte lo acaba pidiendo, el sitio natural es una columna extra alimentada del último `Shift.openedAt`/`registerId` — decisión de producto, no técnica.
2. **El resto de lecturas del superadmin siguen sin throttle.** `GET /super-admin/tenants` y `GET /super-admin/tenants/:id` devuelven emails y `lastLoginAt` de usuarios reales sin límite ninguno. Este bloque no lo arregla porque no le tocaba, pero el agujero es el mismo y ahora hay una pieza (`superAdminCashierReadThrottleKey`) que se puede generalizar.
3. **`GET /super-admin/tenants/:id` ya devolvía `users`** con email, rol y `lastLoginAt` — pero filtrando los `isTestCashier` y los `deletedAt`, sin alias y sin decir quién tiene PIN. La tabla "Usuarios" de la ficha se ha dejado como estaba: son dos preguntas distintas y mezclarlas era pedir confusión. Si algún día molesta la duplicidad, la que sobra es "Usuarios", no esta.
