# Bloque v1.3-SuperAdmin-Hub · 3 lotes

Tras los fixes UX, el siguiente bloque para reducir fricción operativa del equipo (Matías + Natalia + futuros implantadores). Master tras el merge de `v1-3-ux-iteracion-fixes`. Crea rama `v1-3-superadmin-hub` desde master, un commit por lote, sin merge.

## Contexto

Hoy para configurar la cuenta de un cliente nuevo el implantador tiene que:
1. Recordar las URLs (admin.mipiacetpv.com, tpv.mipiacetpv.com).
2. Pedirle al cliente sus credenciales para hacer login (o entrar en modo "Impersonar sólo lectura", que NO permite editar nada).
3. Cambiar de pestaña a Holded constantemente.

Queremos un **hub super-admin** con accesos rápidos a cada tenant y un **modo impersonate full** que permita configurar la cuenta del cliente sin pedirle credenciales. El audit ya está montado — solo hay que extender el flag de modo.

Los 3 lotes son independientes; se pueden commitear por separado.

---

## Lote 1 · Impersonate modo "full" (configuración)

**Motivo**: el modo readonly actual permite ver pero no tocar. Para onboarding, soporte y "ajustar antes de entregar al cliente" hace falta poder escribir.

**Cambios backend (`apps/api/src/superadmin/tenants.ts`)**:

(1) En el endpoint `POST /super-admin/tenants/:id/impersonate`, añadir parámetro `mode` al body (default `"readonly"` para compatibilidad):

```ts
body: { mode?: "readonly" | "full" }
```

(2) En `signImpersonationToken`, añadir `mode` al payload del JWT. Ejemplo de payload:

```ts
{ sub, tid, tv, by, mode: "readonly" | "full" }
```

(3) Audit log: cuando `mode === "full"`, incluir en metadata `mode: "full"` para que se distinga en AuditLogPage.

**Cambios backend (`apps/api/src/auth/middleware.ts` o equivalente con `requireAuth`)**:

(4) Decodificar `mode` del JWT y exponerlo en `request.auth.impersonationMode`. Si no hay impersonate, dejar `null`.

(5) En las rutas de **escritura** (POST/PUT/DELETE/PATCH) del admin del tenant, añadir un guard antes del handler:

```ts
if (request.auth.impersonatedBy && request.auth.impersonationMode === "readonly") {
  return reply.code(403).send({ error: "IMPERSONATION_READONLY", message: "Esta acción requiere impersonate en modo escritura." });
}
```

Centralizarlo en un helper `requireImpersonationWrite(reply, auth)` y aplicarlo a las rutas que escriben tenants/products/users/registers/etc. NO aplicar a rutas internas del cajero (TPV) ni de super-admin (porque el super-admin sigue siendo super-admin, no impersonado).

(6) En modo `"full"`, escribir un audit **por cada acción de escritura** ejecutada en modo impersonado:

```ts
{ event: "impersonate.write", superAdminId: by, tenantId, route, method, payload_summary }
```

Esto deja trazabilidad de qué tocó el super-admin en nombre del cliente.

**Cambios frontend (`apps/admin/src/superadmin/TenantDetailPage.tsx`)**:

(7) El botón actual "Impersonar (sólo lectura)" se mantiene, pero al lado añadir un segundo botón "Configurar como OWNER" en color de advertencia (ámbar / `bg-amber-600`). Modal de confirmación: "Vas a entrar al panel del cliente con permisos de escritura. Todo lo que hagas quedará registrado en el log de auditoría. ¿Continuar?".

(8) Al confirmar, POST con `{ mode: "full" }`, guardar el token devuelto en localStorage y redirigir a `/admin`.

**Cambios frontend (`apps/admin/src/components/ImpersonationBanner.tsx`)**:

(9) Mostrar el modo en el banner: "Modo super-admin · viendo como [email] · **sólo lectura**" o "Modo super-admin · configurando como [email] · **modo escritura**" (este último en fondo ámbar para subrayar). Botón "Salir" en ambos casos.

**Tests vitest**:

(10) `impersonate.test.ts`: 3 casos — readonly+escritura→403, full+escritura→200+audit, full+lectura→200.

**Why**: cierra task #95. Desbloquea onboarding asistido del cliente.

---

## Lote 2 · Hub super-admin (`/super-admin/hub`)

**Motivo**: pantalla con todos los accesos del día a día del implantador, una sola vista, todo a un click.

**Cambios frontend (`apps/admin/src/superadmin/`):**

(1) Nueva página `HubPage.tsx` en `/super-admin/hub`. Ruta accesible desde el menú lateral del super-admin (primera entrada, con icono `LayoutDashboard` de lucide).

(2) Estructura visual:

```
┌─────────────────────────────────────────────────────┐
│  Hub                                                │
│                                                     │
│  Cuentas activas                                    │
│  ┌────────────────┐  ┌────────────────┐            │
│  │ Peluquería Sole│  │ ...            │            │
│  │ SERVICES · OK  │  │                │            │
│  │ 4 tickets / 7d │  │                │            │
│  │ [Ver] [Config.] │  │                │            │
│  │ [TPV] [Holded] │  │                │            │
│  └────────────────┘  └────────────────┘            │
│                                                     │
│  Tareas comunes                                     │
│  [Activar cuenta] [Crear super-admin]               │
│  [Banco pruebas] [Guía implantadores]               │
│                                                     │
│  Estado del sistema                                 │
│  API: ✓ healthy  Worker: ✓ healthy                  │
│  Última sync: hace 12 min · Peluquería Sole         │
└─────────────────────────────────────────────────────┘
```

(3) Por cada tenant en estado `ACTIVE`, una tarjeta:

- **Nombre + businessType + estado**: con badge de color (verde activo, ámbar pruebas).
- **Métricas**: tickets últimos 7 días, errores de sync activos (de la cola Holded).
- **Botón "Ver"** (color slate): impersonate `mode=readonly` → redirige a `/admin`.
- **Botón "Configurar"** (color ámbar): impersonate `mode=full` con modal de confirmación → redirige a `/admin`.
- **Botón "TPV"** (color slate): genera token de cajero TEST y abre `tpv.mipiacetpv.com` en pestaña nueva.
- **Botón "Holded"**: abre `https://app.holded.com/accounts/<tenant.holdedAccountId>` en pestaña nueva. Si no tenemos `holdedAccountId` por tenant, dejar el botón deshabilitado con tooltip "Falta accountId — añadir en super-admin".

(4) Endpoint nuevo `GET /super-admin/hub` que devuelve un payload compacto:

```ts
{
  tenants: Array<{ id, name, businessType, status, ticketsLast7d, syncErrors, holdedAccountId }>;
  system: { apiHealth, workerHealth, lastSyncAt, lastSyncTenant };
}
```

(5) Sección "Tareas comunes" con 4 botones:
- "Activar cuenta" → `/super-admin/cuentas/nueva`.
- "Crear super-admin" → `/super-admin/admins/nuevo`.
- "Banco de pruebas" → descarga `docs/qa/banco-pruebas-v1-3.pdf` (vía endpoint que sirva el PDF).
- "Guía implantadores" → descarga `docs/Manual_implantadores_v1.docx`.

(6) Sección "Estado del sistema" — usa `GET /healthz` (api) y un nuevo `GET /super-admin/worker-health` que consulta BullMQ por la última job procesada.

**Tests**: no obligatorios para la UI; añadir uno para el endpoint `GET /super-admin/hub` (validar shape y filtros).

**Why**: cierra la mayor fricción operativa del equipo. Reduce el "¿cuál era la URL?" / "¿qué credenciales me dió este cliente?".

---

## Lote 3 · Holded account-id por tenant

**Motivo**: el botón "Holded" del hub necesita saber el accountId del cliente en Holded para construir la URL directa. Hoy no lo almacenamos.

**Cambios**:

(1) **Schema Prisma**: añadir campo `holdedAccountId: String?` al modelo `Tenant`. Migración `b25_tenant_holded_account_id`.

(2) **Activate**: cuando activamos una cuenta nueva, el super-admin DEBE introducir el `holdedAccountId` (lo encuentra en la URL de Holded del cliente). Validación en el form `CreateTenantPage.tsx` (campo nuevo, required).

(3) **TenantDetailPage**: añadir el campo `holdedAccountId` como editable.

(4) **Endpoint** del hub (Lote 2) lo devuelve. La tarjeta del hub deshabilita el botón "Holded" si está null y muestra tooltip pidiendo rellenarlo.

(5) **Backfill** para tenants existentes: script CLI `apps/api/src/scripts/backfill-holded-account-id.ts` que pide al super-admin introducir el accountId de cada tenant activo manualmente, o lee desde un JSON. Para Peluquería Sole, ya conocemos el accountId — añadirlo en el script y ejecutarlo.

**Why**: pre-requisito para el "Holded" del hub. Sin esto, falta un botón importante.

---

## Convenciones

- Un commit por lote, mensaje `Lote X · v1.3-SuperAdmin-Hub · ...`.
- NO mergear. Espero `git merge --ff-only` desde master.
- El Lote 1 es de alta criticidad (toca middleware de auth). Tests obligatorios.
- El Lote 3 es bloqueante del botón Holded del Lote 2 — implementar en este orden si vas en serie.
