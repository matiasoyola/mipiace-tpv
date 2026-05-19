# Auditoría de seguridad y usabilidad · mipiacetpv
**Fecha:** 19 de mayo de 2026
**Versión analizada:** master @ `7474438` (B-Multi-Vertical SB1+SB2) + B-UX-Pulido v1 desplegado
**Auditor:** Claude (Cowork)
**Alcance:** code review backend/frontend + revisión Caddyfile e infra. Usabilidad pendiente de pase visual con sesión abierta.

---

## Resumen ejecutivo

mipiacetpv presenta **una postura de seguridad muy por encima del estándar de un piloto temprano**. La gran mayoría de los controles que esperarías en un SaaS multi-tenant maduro están bien implementados: cifrado AES-256-GCM de la API key de Holded, argon2id para contraseñas, JWT con `token-version` para revocación masiva, rate-limit con backoff y candado, password reset con respuesta neutra, impersonation read-only forzada por middleware, y separación estricta de secretos super-admin vs per-tenant.

**No se ha detectado ningún hallazgo crítico (🔴).**

| Bloque | 🟡 Medio | 🟢 Menor | Total |
|---|---|---|---|
| Seguridad | 3 | 5 | 8 |
| Usabilidad | 4 | 9 | 13 |

**Esfuerzo total estimado** para cerrar todo lo accionable: **~8 h** (4 h seguridad + 5 h usabilidad, descontando solapamientos y temas ya en backlog).

**Lo más prioritario** (cerrar antes de invitar al equipo Holded como segundos super-admins):

1. 🟡 **S2** — Forzar 2FA en super-admin (30 min)
2. 🟡 **S1** — Añadir CSP en Caddyfile (15 min)
3. 🟡 **U2** — Modal de confirmación al "Activar cuenta" (30 min)
4. 🟡 **U1** — Reformular el error de sync Holded para implantadores (30 min)
5. **Operativo** — Verificar backups Backblaze activos (20 min)

Total bloque crítico ≈ **2 horas**. Una sesión corta de hardening cierra los 4 más relevantes.

---

## Hallazgos · Seguridad

### 🟡 S1 · Falta Content-Security-Policy en Caddy
**Severidad:** Media · **Ubicación:** `infra/Caddyfile`

El Caddyfile incluye `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` y `Permissions-Policy`, pero **no define `Content-Security-Policy`**. Sin CSP, una vulnerabilidad XSS en la PWA (improbable con React, pero no descartable si una librería de terceros se compromete) podría exfiltrar tokens JWT o llamar al backend desde scripts inyectados.

**Riesgo:** defensa en profundidad. No es una vulnerabilidad directa, pero la ausencia de CSP elimina una capa de mitigación.

**Fix sugerido:** añadir en los tres bloques HTTPS del Caddyfile (`mipiacetpv.com`, `admin.mipiacetpv.com`, `api.mipiacetpv.com`):

```caddyfile
header {
  # ... headers actuales ...
  Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.mipiacetpv.com wss://api.mipiacetpv.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
}
```

`'unsafe-inline'` solo en `style-src` para que Tailwind funcione. Si más adelante se mueve a Vite con hash, puede caer también ese.

### 🟡 S2 · 2FA no es obligatorio para super-admin
**Severidad:** Media · **Ubicación:** `apps/api/src/superadmin/auth.ts`, `apps/admin/src/superadmin/SuperAdminMePage.tsx`

El super-admin actual (`m.oyola@mipiace.es`) tiene 2FA **opcional**. Como la pantalla `/superadmin/me` confirma, el último login del super-admin se hizo con `2FA: No activado`. El super-admin es el actor más poderoso del sistema: puede crear cuentas, impersonar OWNERs, ver auditoría completa, rotar API keys de Holded.

**Riesgo:** si la contraseña de un super-admin se compromete (phishing, reúso de password), un atacante toma control de toda la plataforma sin segundo factor.

**Fix sugerido:** forzar 2FA tras N días de gracia (p.ej. 7 días) o, más conservador, bloquear acciones sensibles (`POST /super-admin/tenants`, `impersonate`, `rotate-key`) hasta que `twoFactorEnabledAt != null`. La UI ya pinta el panel "Activar 2FA · Empezar configuración" — basta con hacer el check server-side en los endpoints sensibles.

### 🟡 S3 · Sin política explícita de longitud de password ni rotación
**Severidad:** Media · **Ubicación:** `apps/api/src/auth/routes.ts:60`

`signup` exige password de **mínimo 10 caracteres, máximo 256**. No hay requerimiento de mayúscula/número/símbolo, ni chequeo contra diccionarios o haveibeenpwned. No hay caducidad ni recordatorio de cambio.

**Riesgo:** un OWNER puede usar `aaaaaaaaaa` (10 caracteres pero todo igual) y pasar la validación. Para un super-admin con acceso transversal es especialmente crítico.

**Fix sugerido:** integrar `zxcvbn` (~200 KB, en el frontend) para forzar score ≥ 3 en la UI, y validar server-side con una versión ligera. Considerar también rotación anual obligatoria para super-admins.

---

### 🟢 S4 · PDF público con slug de 64 bits (comentario dice 96)
**Severidad:** Menor · **Ubicación:** `apps/api/src/tickets/public-pdf-route.ts:5`

```
// Sin auth — la URL es una capability ~96 bits que viaja en el QR /
// email. Si el slug no existe o el ticket está DRAFT (no emitido
// todavía) devolvemos 404 — la misma respuesta para los dos casos
// evita filtrar la existencia del slug a un escáner.
```

El regex `SLUG_PATTERN = /^[0-9a-f]{16}$/` define **16 caracteres hex = 64 bits**, no 96. Sigue siendo seguro (2⁶⁴ combinaciones, inviable de adivinar), pero el comentario está inexacto y puede inducir a un futuro desarrollador a confiar en una protección que no es la declarada.

**Fix sugerido:** corregir el comentario a "~64 bits" o subir el slug a 24 caracteres (96 bits reales). Subir el slug requiere migración de los slugs ya emitidos — probablemente no merece la pena, mejor solo corregir el comentario.

### 🟢 S5 · `EXTERNAL_ID_CONFLICT` revela existencia de externalId en otro tenant
**Severidad:** Menor · **Ubicación:** `apps/api/src/tickets/routes.ts:181-186`

Cuando el cajero envía un `externalId` que ya existe en otro tenant, el backend responde 409 con `EXTERNAL_ID_CONFLICT`. Esto técnicamente filtra que ese externalId existe en *algún* otro tenant. El riesgo real es bajísimo porque el externalId es un UUID v4 que el cliente genera — un atacante no tendría motivo ni capacidad razonable para adivinar UUIDs ajenos. Pero el principio "no informar de cross-tenant" debería respetarse.

**Fix sugerido:** devolver un 409 genérico `EXTERNAL_ID_TAKEN` sin distinguir si es del mismo tenant o de otro. La idempotencia ya funciona porque ese caso solo se da en otro tenant.

### 🟢 S6 · Sin throttling explícito en POST /tickets
**Severidad:** Menor · **Ubicación:** `apps/api/src/tickets/routes.ts:89`

El endpoint que crea tickets está protegido por `requireCashierSession` (autenticación) pero no por rate-limit por cajero. Un cajero comprometido o un bot con su PIN podría hacer flood de tickets. Improbable porque cada ticket genera trabajo en BullMQ y se ve en métricas, pero defensivo.

**Fix sugerido:** rate-limit "30 tickets / minuto / registerId" usando el patrón ya existente en `auth/rate-limit.ts`. Suficiente para operación real (un bar cobra 2-3 tickets/min en pico), bloquea floods.

### 🟢 S7 · `Permissions-Policy` no incluye `interest-cohort`
**Severidad:** Menor · **Ubicación:** `infra/Caddyfile`

La política actual desactiva geolocalización, micrófono y cámara. No desactiva explícitamente `interest-cohort` (FLoC) ni `payment` ni `usb` ni `bluetooth` — todas relevantes en un TPV cuando se quiera integrar lector USB-HID o pago contactless.

**Fix sugerido:** ampliar a `geolocation=(), microphone=(), camera=(), interest-cohort=(), payment=(self), usb=(self), bluetooth=(self)`.

### 🟢 S8 · `findUnique` sin tenantId en algunos paths (verificado seguros)
**Severidad:** Menor (informativo) · **Ubicación:** múltiples

He revisado los 20+ `findUnique` por `id` o `externalId` sin filtro `tenantId` explícito y **todos los críticos verifican el tenant después** (idempotencia tickets, send-ticket-email, upload-ticket por externalId que viene del job). Los que buscan por email (`auth/routes.ts`, `password-reset.ts`) no requieren tenantId porque el email es único global.

**No es un finding accionable**, pero conviene documentar la convención: cualquier `findUnique` por id de entidad per-tenant debe verificar tenant después o usarse en flujos donde el id solo viaja por canales firmados (JWT, jobs internos). Convertir en regla del CLAUDE.md sería buena idea.

---

## Cosas bien hechas (worth highlighting)

Como CTO te conviene saber qué tienes ya bien resuelto:

- **Cifrado AES-256-GCM** de la API key de Holded con IV aleatorio por cifrado, authentication tag, prefijo de versión `v1:` y validación de longitud de clave (`crypto.ts`).
- **argon2id** con parámetros conservadores (64 MB memoria, timeCost 3) para hash de contraseñas. Igual aplicación a PINs (`passwords.ts`).
- **JWT con `purpose` discriminado**: `super-admin` vs `impersonation` vs `2fa-pending` — distintos campos obligatorios, distinta validación. Tres secretos separados (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SUPER_ADMIN_JWT_SECRET`).
- **Token-version (`tv`)** en refresh tokens para revocación masiva sin tabla blacklist. Logout-everywhere increase el `tv` en BD; tokens antiguos quedan inválidos.
- **Impersonation read-only forzado**: el middleware bloquea cualquier `POST/PUT/PATCH/DELETE` cuando la sesión es de impersonación, con `IMPERSONATION_READONLY`. El JWT incluye `superAdminId` (`by`) para auditoría.
- **Rate limit con backoff**: 5 intentos en 5 min → candado 15 min. Sistema separado para password reset con throttle puro.
- **Password reset con respuesta neutra**: misma respuesta exista o no el email, incluso si se supera el rate limit (no devuelve 429). Token de 32 bytes random + argon2 hash en BD + TTL 1h.
- **Idempotencia con verificación tenant** en POST /tickets: si el externalId existe pero pertenece a otro tenant, devuelve 409 (no expone datos del otro).
- **Capability-based public URLs**: PDF público con slug random + 404 idéntico para slug inexistente y ticket DRAFT (no filtra existencia).
- **HSTS preload-ready**: `max-age=31536000; includeSubDomains`.
- **CORS estricto**: allowlist desde env, rechaza cualquier origen no listado.
- **Comentario explícito** en `auth/routes.ts:422` "NUNCA loguear la apiKey ni su longitud" — alguien pensó en este vector.
- **Caddy** con SSL Let's Encrypt automático, redirect 301 `.tech` → `.com` preservando path.
- **Migraciones Prisma idempotentes** con defaults y backfill defensivo.
- **2FA con TOTP + recovery codes** (cifrados en BD).

---

## Riesgos de configuración productiva (operativos)

No son vulnerabilidades del código pero conviene verificar en producción:

1. **`.env.production` en VPS** — ¿están todos los secretos generados con `openssl rand -base64 48`? Conviene auditarlos. Si alguno se quedó con un valor de ejemplo o demasiado corto, hay que rotar.
2. **Backups de Postgres** — la memoria dice "Backup BD productiva automatizado con Backblaze (script listo, falta crontab)". Verificar que está activo. Sin backup, un ransomware o error humano puede destruir Thalia entero.
3. **Logs de Caddy** — actualmente van a stdout con formato JSON. No hay rotación ni agregación. Si el VPS se llena de logs, Caddy se cae. Configurar `docker logs --max-size=50m --max-file=5` en el compose, o mejor llevarlos a Sentry / un log shipper.
4. **Monitoring** — la memoria menciona "Sentry para observabilidad" como pendiente. Sin Sentry, una excepción no manejada en BullMQ workers puede pasar desapercibida días.
5. **VPS firewall** — verificar que solo 80/443 están abiertos al mundo. `ufw status` en el VPS. Si Postgres 5432 está expuesto, urgente cerrarlo.

---

## Hallazgos · Usabilidad

Pase visual realizado sobre el super-admin con sesión activa más el login per-tenant. El TPV se inspeccionó en sesiones anteriores con catálogo real de Librería Thalia.

### 🟡 U1 · Error de sync de Holded se muestra como mensaje técnico crudo
**Severidad:** Media · **Ubicación:** `TenantDetailPage` panel "Validación de onboarding"

En la pantalla del tenant Thalia aparece un banner rojo permanente con:

> `Último error de sync: 68d66b3386a8efc7260acf3a (TALONARIO CAJA): Holded API 400 on https://api.holded.com/api/invoicing/v1/products/68d66b3386a8efc7260acf3a`

Esto es ruido para un implantador no técnico. Filtra una URL del API de Holded y un ObjectId crudo. Sugerido:

> "⚠ 1 producto no se pudo procesar — TALONARIO CAJA. Esto NO bloquea el alta. Aparecerá como no vendible en el TPV. Revisar en Holded si fuera necesario."

Y ocultar el ObjectId + URL detrás de un "Ver detalles técnicos".

### 🟡 U2 · `Activar cuenta` es irreversible y solo lo advierte en texto pequeño
**Severidad:** Media · **Ubicación:** `TenantDetailPage` panel "Activar cuenta"

El botón verde grande dice "Activar cuenta" y solo bajo el subtítulo aparece **"Irreversible"** en negrita pequeña. Es la acción más sensible del flujo (envía email al cliente, purga datos de prueba). Sugerido:

- Modal de confirmación obligatorio: "Esto enviará un email al propietario con sus credenciales y purgará todos los tickets de prueba. No se puede deshacer. ¿Continuar?"
- O al menos un checkbox "He revisado que todos los cajeros y dispositivos están configurados" que habilite el botón.

### 🟡 U3 · Editor inline de Tipo de negocio sin feedback al guardar
**Severidad:** Media · **Ubicación:** `TenantDetailPage` editor `BusinessTypeEditor`

Probé el cambio inline (click Hostelería → click Retail). Funciona, el PATCH se ejecuta y el chip cambia instantáneamente — pero **no hay toast, ni spinner, ni indicador de "guardado"**. Si el PATCH fallara silenciosamente, el chip se revertiría sin que el user supiera por qué. Sugerido:

- Toast verde "Tipo de negocio actualizado" durante 2s tras éxito.
- Toast rojo con el mensaje del error si falla (el componente ya captura `err` pero solo lo pinta debajo en pequeño).
- Indicador de "guardando…" entre click y respuesta.

### 🟡 U4 · Metadata de auditoría se muestra como JSON crudo minificado
**Severidad:** Media · **Ubicación:** `AuditLogPage`

En `/superadmin/audit` cada fila tiene una columna "Metadata" con el JSON entero pegado en una sola línea sin formatear:

> `{"changes":{"businessType":{"after":"RETAIL","before":"HOSPITALITY"}},"ipAddress":"77.230.128.231","userAgent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36..."}`

Un implantador no técnico no puede leerlo a primera vista. Sugerido:

- Renderizado humano para acciones conocidas: "Cambió Tipo de negocio: Hostelería → Retail"
- Botón "Ver detalles" que abre modal con JSON formateado bonito (pretty print) + userAgent parseado.
- Truncar userAgent a "Chrome 148 · macOS".

### 🟢 U5 · CreateTenantPage tiene título "Conectar Holded" pero el item de navegación es "Crear cuenta"
**Severidad:** Menor · **Ubicación:** `CreateTenantPage`

El user pulsa "+ Crear cuenta" en la lista y llega a una pantalla titulada "Conectar Holded". La inconsistencia es leve pero molesta. Sugerido:

- Título principal: "Crear cuenta" (consistente con la sidebar).
- Subtítulo o caption: "Conecta la cuenta Holded del cliente para empezar".

### 🟢 U6 · Help text del campo API Key Holded demasiado técnico
**Severidad:** Menor · **Ubicación:** `CreateTenantPage` campo API Key

Hoy:

> "Validamos contra Holded antes de guardar (GET /invoicing/v1/warehouses). La key se cifra con AES-GCM en BD."

Para un implantador Holded no-developer esto es jerga. Sugerido:

> "Comprobamos que la API key funciona antes de guardar. Se almacena cifrada en nuestra base de datos."

### 🟢 U7 · Mi cuenta: botón "Cambiar" contraseña aparece disabled sin explicación visible
**Severidad:** Menor · **Ubicación:** `SuperAdminMePage` formulario Cambiar contraseña

El botón "Cambiar" se ve gris-disabled antes de empezar a teclear. Está bien que valide antes de enviar, pero el user no entiende **por qué** está disabled. Sugerido:

- Texto debajo del botón: "Introduce contraseña actual y nueva (mín. 12 caracteres) para activar."
- O dejarlo habilitado y mostrar errores al submit.

### 🟢 U8 · Auditoría sin paginación ni filtros por fecha/tenant
**Severidad:** Menor · **Ubicación:** `AuditLogPage`

El listado solo tiene filtro por tipo de acción. Cuando haya 1000+ entradas (varios pilotos × semanas de uso), el listado será inmanejable. Hoy con 6 entradas todavía no se nota. Sugerido para B-SuperAdmin-V2 o B-Audit-V2:

- Filtros: fecha desde/hasta, super-admin, tenant.
- Paginación o scroll infinito.
- Link del Tenant ID truncado al detalle del tenant.

### 🟢 U9 · `test_cashier_session` y otros nombres de acción en jerga interna
**Severidad:** Menor · **Ubicación:** `AuditLogPage` columna "Acción"

Las acciones aparecen como su slug crudo: `update_tenant`, `test_cashier_session`, `resync`, `impersonate`. Un implantador no las entiende a primera vista. Sugerido tabla de traducción:

| Slug | Label visible |
|---|---|
| `create_tenant` | Crear cuenta |
| `update_tenant` | Editar cuenta |
| `block_tenant` | Bloquear |
| `unblock_tenant` | Desbloquear |
| `test_cashier_session` | Sesión cajero de prueba |
| `resync` | Re-sincronizar |
| `impersonate` | Impersonar OWNER |

### 🟢 U10 · El banner rojo de "Último error de sync" no tiene botón para descartarlo
**Severidad:** Menor · **Ubicación:** `TenantDetailPage`

Una vez que el implantador ha leído y entendido el error (el TALONARIO CAJA queda no-vendible, OK), no tiene manera de marcar el banner como "revisado" — se queda visible para siempre. Sugerido:

- Botón X para dismissar a nivel UI (no borra el log).
- O el banner desaparece tras el primer sync incremental exitoso siguiente.

### 🟢 U11 · Sin indicación visual del tipo de negocio en la lista de cuentas
**Severidad:** Menor · **Ubicación:** `TenantsListPage`

La tabla de cuentas tiene columnas `CUENTA · ONBOARDING · OWNER · HOLDED · 7D · ERRORES · ESTADO` pero **no muestra el tipo de negocio**. Con un piloto solo no se nota, con 5+ cuentas mezcladas el implantador necesita ver de un vistazo cuáles son hostelería vs retail. Sugerido:

- Añadir columna "Tipo" con chip pequeño (Coffee/Package/Briefcase + label).
- O fusionar con la columna "Cuenta": "Librería Thalia · Retail".

### 🟢 U12 · TPV: "Cobro mixto" como link discreto cuando el modo simple bloquea workflow real
**Severidad:** Menor · **Ubicación:** `CheckoutPage` (ya desplegado en B-UX-Pulido v1)

El botón "Cobro mixto" actual se ve como link secundario tras los chips de método. Para bares que sí cobran mixto habitualmente (vale + tarjeta, efectivo + bizum) puede ser muy frecuente. Sugerido revisar tras 1-2 semanas de uso real en Thalia: si lo activa más del 5% de los tickets, promoverlo a un botón visible junto a los 4 métodos.

### 🟢 U13 · TPV con catálogo grande: sin filtro por categoría todavía
**Severidad:** Menor (ya en backlog como B-Categorias) · **Ubicación:** `SalePage`

Thalia tiene 964 productos. El grid los muestra todos paginados visualmente con scroll vertical. Sin filtro por categoría el cajero tiene que buscar por nombre o scrollear. Ya está identificado como bloque B-Categorias pendiente.

---

## Resumen de findings de usabilidad

| ID | Sev | Título | Esfuerzo |
|----|-----|--------|----------|
| U1 | 🟡 | Error de sync Holded como mensaje técnico crudo | 30 min |
| U2 | 🟡 | "Activar cuenta" irreversible sin modal de confirmación | 30 min |
| U3 | 🟡 | Editor inline de Tipo de negocio sin feedback | 20 min |
| U4 | 🟡 | Metadata de auditoría como JSON crudo | 1 h |
| U5 | 🟢 | Título "Conectar Holded" inconsistente con sidebar | 5 min |
| U6 | 🟢 | Help text API Key demasiado técnico | 5 min |
| U7 | 🟢 | Botón "Cambiar" contraseña disabled sin explicación | 10 min |
| U8 | 🟢 | Auditoría sin paginación ni filtros por fecha/tenant | 2 h |
| U9 | 🟢 | Nombres de acción auditoría en jerga interna | 15 min |
| U10 | 🟢 | Banner de error de sync sin dismissar | 20 min |
| U11 | 🟢 | Lista de cuentas sin columna "Tipo de negocio" | 20 min |
| U12 | 🟢 | TPV "Cobro mixto" como link discreto (revisar en uso real) | revisar tras piloto |
| U13 | 🟢 | TPV sin filtro por categoría (ya en backlog B-Categorias) | bloque propio |

**Total estimado para cerrar todo (sin U12/U13):** ~5 h. Los 4 medios solos: ~2.5 h.

---

## Recomendaciones priorizadas

Si pudieras dedicar **1 sesión** a hardening esta semana, en este orden:

1. **CSP en Caddy** (S1) — 15 min, mucho ROI defensivo.
2. **Forzar 2FA en super-admin** antes de invitar al equipo Holded (S2) — 30 min con la check server-side.
3. **Verificar backups productivos** activos (riesgo operativo #2) — 20 min de verificación.
4. **`zxcvbn` en signup y change-password** (S3) — 1 h con UI feedback.

Las S4–S8 + Permissions-Policy ampliada pueden ir en un "B-Hardening v2" cuando toque.

---

## Resumen ejecutivo de findings

| ID | Sev | Título | Esfuerzo |
|----|-----|--------|----------|
| S1 | 🟡 | Falta Content-Security-Policy en Caddy | 15 min |
| S2 | 🟡 | 2FA no obligatorio para super-admin | 30 min |
| S3 | 🟡 | Sin política de longitud/complejidad de password | 1 h |
| S4 | 🟢 | Comentario inexacto en slug PDF público | 2 min |
| S5 | 🟢 | EXTERNAL_ID_CONFLICT informa cross-tenant | 10 min |
| S6 | 🟢 | Sin throttling en POST /tickets | 30 min |
| S7 | 🟢 | Permissions-Policy incompleta | 5 min |
| S8 | 🟢 | findUnique sin tenantId — verificados seguros, falta documentar regla | 10 min |

**Total estimado para cerrar todo:** ~3 h.

---

*Informe generado por Claude (Cowork) tras revisión de los módulos `apps/api/src/{auth,crypto,superadmin,tickets,catalog}/*`, `infra/Caddyfile`, `apps/admin/src/superadmin/*` y schema Prisma. Fecha de cierre: 2026-05-19.*
