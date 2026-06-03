# Bloque v1.4-Bugs-Operativos · 3 lotes

Bugs detectados en operativa real con Peluquería Sole 2026-06-02/03. Crea rama `v1-4-bugs-operativos` desde master, un commit por lote, sin merge.

## Contexto

Tras una semana de uso real del TPV con Sole hemos detectado 3 bugs que rompen la experiencia. No son críticos (la operativa NO se detiene) pero erosionan la confianza y la auditoría:

1. **Cierre de caja exige PIN del OWNER**, no acepta el PIN del CASHIER que opera.
2. **Super-admin con impersonate full no accede a todas las vistas** del admin del tenant.
3. **Dispositivos vinculados se "desvinculan" silenciosamente** al abrir nueva sesión del navegador.

Los 3 lotes son independientes. Pueden ir en cualquier orden.

---

## Lote 1 · PIN del cajero válido para cerrar caja

**Motivo**: el flujo de cierre de caja debe usar el PIN del cajero que opera, no el del OWNER. Si Sole tiene una empleada (`maoysa@gmail.com`) que cobra todo el día, esa empleada debe poder cerrar su caja con su propio PIN. Hoy el endpoint exige PIN del OWNER, lo cual obliga a Sole a hacer la maniobra final ella misma.

**Investigar y arreglar**:

(1) En `apps/api/src/shift/routes.ts`, buscar el endpoint `POST /shift/close` (o similar). Verificar si hay una comprobación que exige `role === "OWNER"` o que valida el PIN contra el OWNER del tenant en vez de contra el cajero de la sesión actual.

(2) La regla correcta: el PIN debe ser el del USER que está autenticado en la `cashierSession` (`request.cashier.sub`). Si el cajero CASHIER cierra su turno, validar su PIN. Si OWNER cierra, su PIN. Si MANAGER, su PIN.

(3) Excepción: si quieres mantener una capa de control para tenants pequeños, puedes añadir un setting opcional `tenant.requireOwnerPinForCashClose: boolean` con default `false`. Pero NO por defecto — la operativa normal es que cada cajero cierra su propia caja.

(4) Tests: añadir caso vitest "CASHIER cierra su propio turno con su PIN" en `apps/api/test/shift.test.ts`.

**Why**: cierra task #13. Desbloquea operativa diaria de la empleada de Sole y de futuros pilotos con personal.

---

## Lote 2 · Super-admin con impersonate full accede a todas las vistas del admin

**Motivo**: el feature de impersonate full (`v1.3-SuperAdmin-Hub` Lote 1) permite al super-admin entrar al admin del tenant en modo escritura. Pero hay vistas del admin que siguen filtrando por role original del super-admin (no del impersonado) y muestran "Acceso denegado" o no aparecen en el menú.

**Investigar y arreglar**:

(1) **Auditar todas las páginas del admin** (`apps/admin/src/pages/*` y subcarpetas) que tengan `if (role !== "OWNER")` o `if (!isOwnerOrManager)` o similar. Cada una debería aceptar también `impersonationMode === "full"` como si fuera escritura.

(2) **Auditar el menú lateral** (`AdminShell.tsx` líneas ~58-78 con `NAV_ITEMS`). Items con `ownerOnly: true` deben mostrarse cuando hay impersonación full activa (aunque el super-admin sea técnicamente `role=SUPER_ADMIN`, no `OWNER`).

(3) **Backend**: el middleware `requireAuth` ya expone `request.auth.impersonatedBy` y `impersonationMode`. Verificar que las rutas que hoy hacen `if (request.auth.role !== "OWNER")` añadan un OR: `|| (impersonatedBy && impersonationMode === "full")`.

(4) **Sigue manteniendo el comportamiento read-only**: si `impersonationMode === "readonly"`, las páginas se ven pero las acciones de escritura están bloqueadas con un tooltip "Modo solo lectura — usa Configurar para editar".

(5) Tests: añadir un test vitest "super-admin impersonando full accede a `/admin/printers` y puede crear PrinterConfig".

**Why**: cierra task #15. Sin esto, Matías no puede usar impersonate full para configurar a sus clientes desde super-admin sin pedirles credenciales, que era el objetivo del v1.3-SuperAdmin-Hub.

---

## Lote 3 · Dispositivos vinculados no se "desvinculan" al cerrar el navegador

**Motivo**: Matías reporta que tras emparejar un dispositivo (pairing code → device token), si cierra el navegador o abre nueva sesión, el TPV pide reemparejar. Pero en `/admin/devices` el dispositivo sigue marcado como "vinculado". Inconsistencia → confusión.

**Investigar**:

(1) Dónde se persiste el `deviceToken` (JWT que identifica al device) en el TPV:
   - Probable: `localStorage` con clave tipo `mipiacetpv:deviceToken`.
   - Si está en `sessionStorage`, ese es el bug: sessionStorage se borra al cerrar pestaña.
   - Si está en `localStorage` pero Chrome lo está borrando por config "clear on close", documentarlo.

(2) **Si está en localStorage y aún así se borra**:
   - Verificar si hay algún `localStorage.removeItem("deviceToken")` accidental.
   - Verificar el flujo del Service Worker — algunos handlers de logout limpian todo localStorage indiscriminadamente.

(3) Hacer auditoría de **dónde se borra el deviceToken**. Solo debería borrarse:
   - Cuando el admin revoca el dispositivo (POST /admin/devices/:id/revoke).
   - Cuando el cajero pulsa "Olvidar dispositivo" explícitamente desde la PinScreen.
   - Cuando el JWT del device caduca (verificar `exp`).

**Arreglar**:

(4) Garantizar persistencia en localStorage con clave estable. NO sessionStorage. NO se borra en logout del cajero (solo se borra al revocar el dispositivo desde admin).

(5) Si el JWT del device tiene TTL corto (días), refrescarlo automáticamente: cuando el TPV recibe un 401 con código `DEVICE_TOKEN_EXPIRED`, llamar a `POST /devices/refresh` con el token expirado y guardar el nuevo. Esto evita reemparejar a mano.

(6) **Endpoint admin**: que `/admin/devices` muestre `lastSeenAt` real (timestamp del último heartbeat del dispositivo) y un badge "Inactivo > 7 días" para que el OWNER sepa cuáles ya no se usan.

(7) Tests: simulación de "cierre y reapertura del TPV" — el localStorage persiste, el token se reutiliza, no se pide reemparejar.

**Why**: cierra task #17. Es el bug que más fricciona para pilotos: si cada vez que Sole o Natalia abren el TPV tienen que reemparejar, la PWA no es viable.

---

## Convenciones

- Un commit por lote, mensaje `Lote X · v1.4-Bugs-Operativos · ...`.
- NO mergear. Espero `git merge --ff-only` desde master.
- Tests obligatorios en Lote 1 (auth) y Lote 3 (persistencia). Lote 2 es UI principalmente; tests opcionales.
- Si encuentras side effects al arreglar uno (ej. el Lote 3 toca el helper de auth que el Lote 1 también usa), documéntalo en el commit y resuelve coherente.
