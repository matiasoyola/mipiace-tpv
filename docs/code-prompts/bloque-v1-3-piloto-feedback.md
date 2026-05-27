# Bloque v1.3-Piloto-Feedback · 4 lotes

Feedback caliente del primer piloto en producción real (Peluquería Sole, activada 2026-05-25). Master tras el merge de `v1-3-operativa-extra` (commit 48e112e). Crea rama `v1-3-piloto-feedback` desde master, un commit por lote, sin merge.

## Contexto

Tras activar la primera cuenta SERVICES en producción real, salieron varios friction points que NO bloquean cobrar pero erosionan la confianza del cliente: pasos manuales innecesarios en el onboarding, un nudge en el cobro que ralentiza, no se puede cambiar el OWNER de un tenant, y al fallar el PIN no se sabe cuántos intentos quedan. Los 4 lotes son independientes; se pueden commitear por separado en cualquier orden.

---

## Lote 1 · Auto-onboarding + menú Dispositivos visible al OWNER

**Motivo**: hoy, tras pulsar "Activar cuenta" en super-admin, el OWNER tiene que (a) cambiar password, (b) crear cajero a mano, (c) navegar a `/admin/devices` a mano porque no está en el menú, (d) generar pairing code. Demasiados pasos antes de la primera venta.

**Cambios**:

(1) En `apps/admin/src/AdminShell.tsx` línea ~59, el item `{ to: "/admin/devices", label: "Dispositivos", icon: Calculator, superAdminOnly: true }` tiene `superAdminOnly: true` por error histórico. **El backend YA permite OWNER y MANAGER en `/admin/registers/:registerId/pairing-codes`** (`requireOwnerOrManager`). Cambiar a `superAdminOnly: false` o quitar la flag.

(2) En el endpoint `POST /super-admin/tenants/:id/activate` (`apps/api/src/superadmin/tenants.ts`), tras crear el OWNER, **crear también un cajero "OWNER" en la tabla `users` que comparta el email del OWNER**. Ahora mismo el activate solo crea User OWNER. Necesitamos también crear un cajero adicional con role=CASHIER, mismo email, PIN auto-generado de 4 dígitos.

Atención al unique index de `users.email`: el OWNER y el cajero del mismo tenant comparten email pero son User distintos (uno con role=OWNER, otro con role=CASHIER). Si el unique constraint global no lo permite, opciones: (a) cambiar el unique a compuesto `(tenantId, email, role)`, (b) hacer que el cajero "default" sea el mismo User OWNER que se loguea también con PIN en el TPV (recomendado — un solo registro). Para (b) hace falta añadir `pinHash` también al User OWNER y permitir que `requireCashierSession` lo acepte. Documenta cuál eliges.

(3) Devolver el PIN del cajero junto a la tempPassword en la respuesta del activate, para que aparezca en pantalla del super-admin como fallback (igual que la tempPassword hoy). El email de bienvenida al OWNER lo incluye también.

(4) Tests vitest del activate verificando que tras activar existe un cajero válido para login PIN.

**Why**: cierra 2 friction points de la demo en Peluquería Sole (2026-05-25). Reduce el onboarding de 7 pasos a 4. Cierra el bug del menú escondido sin más vueltas.

---

## Lote 2 · Transferir OWNER de un tenant

**Motivo**: el modelo de implantación correcto es que el equipo activa la cuenta con un email controlado (p.ej. `m.oyola+thalia@mipiace.es`), configura todo, hace pruebas, y al entregar al cliente cambia el OWNER al email real. Hoy NO se puede.

**Endpoint nuevo**: `POST /super-admin/tenants/:id/transfer-owner` en `apps/api/src/superadmin/tenants.ts`.

Body:
```ts
{
  newOwnerEmail: string;  // email format, max 320
  newOwnerName: string;   // min 1, max 200
  resetPassword?: boolean;  // default true
}
```

Lógica:
1. Verificar `tenant.onboardingState === "ACTIVE"`. Si DRAFT, 409 — basta con activar con el email correcto.
2. Verificar que `newOwnerEmail` no está en uso por otro User activo (mismo check que activate).
3. Buscar el User OWNER actual del tenant.
4. Update: email = lowerEmail, name = newOwnerName, mustChangePasswordAt = now si resetPassword, tokenVersion: { increment: 1 } para invalidar JWTs.
5. Si resetPassword: generar nueva tempPassword, hashearla, actualizar passwordHash, mandar email de bienvenida al nuevo email.
6. Audit log: action `transfer_owner` con `{ before: oldEmail, after: newEmail }` + signals.
7. Response: `{ ownerId, ownerEmail, tempPassword?: string }` (tempPassword solo si resetPassword).

**UI super-admin** en `TenantDetailPage.tsx`: añadir panel `TransferOwnerPanel` (siguiendo el patrón de `ReceiptFooterPanel`/`IconPresetPanel`). Muestra `tenant.ownerEmail` actual + botón "Cambiar propietario" que abre un modal con campos newOwnerEmail + newOwnerName + checkbox "Enviar email con nueva contraseña" (default ON) + confirmación "Esto invalida la sesión actual del propietario". Tras confirmar, muestra la tempPassword como fallback igual que el flow de activación.

**Tests vitest** del endpoint: happy path, email taken, tenant DRAFT (409), invalidación de tokenVersion.

**Why**: desbloquea el modelo "pre-activar y entregar" del equipo de implantación.

---

## Lote 3 · Quitar el nudge "Servicio sin cliente" en SERVICES

**Motivo**: el Lote 4 de Servicios-Pinta añadió un aviso ámbar al cobrar en SERVICES si el ticket no tiene cliente asignado, con botones "Continuar" / "Asignar cliente". Detectado en piloto: ralentiza la operativa porque cobrar sin cliente es 100% válido (walk-ins, sin email, peluquería rotativa). Un click extra por venta.

**Cambios**:

(1) En `apps/tpv-web/src/pages/CheckoutPage.tsx`, quitar el modal de "Servicio sin cliente" en el flow de cobro. Buscar el bloque que renderiza el aviso (probablemente comprueba `businessType === "SERVICES" && !contact`). Eliminar el bloque, mantener el resto.

(2) Mantener la propiedad `onRequestAssignContact` en la firma del overlay para no romper callers, pero ya no se usa para nudge. Si quieres, deprecar el campo y dejar comentario `// v1.3-piloto-feedback · nudge eliminado, propiedad obsoleta`.

(3) NO eliminar la integración del campo "Atendido por" — ese sí aporta valor.

(4) Test: añadir un test que verifique que el cobro en SERVICES sin contact NO renderiza el aviso ámbar y va directo a la pantalla de cobro como en RETAIL.

**Why**: feedback directo de Matías post-demo. La fricción del nudge no compensa el supuesto recordatorio.

---

## Lote 4 · Intentos restantes en login del cajero

**Motivo**: tras varios fallos de email+PIN durante la demo, el TPV solo dice "Email o PIN incorrecto" hasta que de repente el cajero queda bloqueado por rate limit unos minutos. El cajero no sabe cuándo va a ocurrir.

**Backend**: en `POST /shift/cashier-login` (`apps/api/src/shift/routes.ts` o equivalente), tras un intento fallido, devolver además de `{ error: "INVALID_CREDENTIALS", message }` el campo `attemptsRemaining: number`. Asumiendo límite de 5 intentos: tras 1er fallo `attemptsRemaining: 4`, etc. Cuando llegue a 0, devolver 429 con `{ error: "RATE_LIMITED", retryAfterSeconds: number }`.

Si tu rate limiter actual es Redis-based con clave por email o IP, lee el TTL del key para calcular `retryAfterSeconds`.

**Frontend** `apps/tpv-web/src/pages/PinScreen.tsx`: capturar el `attemptsRemaining` del error response y mostrar mensaje `"Email o PIN incorrecto · Te quedan X intentos antes del bloqueo"` cuando X ≤ 3 (para no asustar al primer fallo). Al recibir 429, mostrar `"Cuenta bloqueada · vuelve en Y segundos"` y deshabilitar el botón Entrar hasta que pase el countdown. Mantener color suave (slate-500 + icono CircleAlert ámbar), no rojo.

**Tests vitest** del endpoint verificando que después del 1er fallo `attemptsRemaining: 4`, del 5º fallo 429 con `retryAfterSeconds > 0`.

**Why**: micro-UX que evita pánico. El cajero ve venir el bloqueo en lugar de sufrirlo.

---

## Constraints generales

- TypeScript estricto, `pnpm -r build` debe pasar.
- Vitest para los endpoints/comportamientos nuevos (happy path como mínimo).
- No deshabilitar lint, no usar `any`.
- Migración Prisma SOLO en Lote 1 si decides la opción (a) del unique constraint compuesto. Si vas con (b) (User OWNER también es cajero), no hace falta migración.
- Conservar el patrón de los Lotes anteriores (paneles inline en TenantDetailPage, comentarios `// v1.3-piloto-feedback · Lote N` en cabeceras de funciones nuevas, audit log para acciones de super-admin).
- NO tocar `tickets/`, `catalog/sync*`, `worker/` salvo lo imprescindible.

## Orden si tienes que cortar

3 > 4 > 1 > 2. El Lote 3 es 1 click menos por venta, lo notará el cajero al instante. El 4 es UX visible. El 1 es la pieza más grande pero crítica para el modelo de despliegue. El 2 puede esperar si necesitas.

Commits separados por lote. Branch `v1-3-piloto-feedback` desde master (commit 48e112e o posterior). NO mergees — yo reviso y hago `git merge --ff-only`.
