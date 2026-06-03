# Libro de errores · Mipiacetpv

Registro vivo de errores vistos en producción, su causa raíz y la solución (o el workaround). Sirve como runbook para Natalia, futuros implantadores y nosotros mismos cuando volvamos a tocar la zona meses después.

## Convenciones

- Una entrada por error con: **síntoma exacto**, **dónde se ve**, **causa raíz**, **fix definitivo**, **fecha** y **referencias** (PR, task, código).
- Todos los mensajes de error visibles al usuario deben estar en **español natural** (política aprobada 2026-06-02). Si ves un mensaje en inglés en producción, es bug.
- Ordenados por área (Auth, Cobro, Holded, Impresoras, Red/Infra, etc.).
- Errores cerrados se marcan ✅. Errores abiertos quedan ⚠️.

---

## Índice por área

- [Auth y sesiones](#auth-y-sesiones)
- [Cobro y tickets](#cobro-y-tickets)
- [Holded · sync y silent rejects](#holded--sync-y-silent-rejects)
- [Impresoras](#impresoras)
- [Red e infra](#red-e-infra)
- [Service Worker y caché TPV](#service-worker-y-cache-tpv)
- [Mensajes en inglés que hay que traducir](#mensajes-en-inglés-que-hay-que-traducir)

---

## Auth y sesiones

### ⚠️ "Email o contraseña incorrectos" con credenciales correctas

**Síntoma**: el OWNER intenta loguear con su password real y el endpoint devuelve 401 INVALID_CREDENTIALS.

**Donde se ve**: `admin.mipiacetpv.com/login` (formulario de OWNER).

**Causa raíz típica**:
- El usuario estaba en `/login` (OWNER del tenant) pero su cuenta era de super-admin (que loguea en `/superadmin/login`). Cada endpoint busca en una tabla distinta (`users` vs `super_admin_users`).
- O la password real no es la que cree recordar y los caracteres especiales se han confundido.

**Fix**:
1. Confirmar que es el endpoint correcto (`/login` vs `/superadmin/login`).
2. Si confirma que sí: reset de password vía script `setpwd.ts` desde el VPS.
3. Avisar de [task #10](https://...) para traducir el mensaje a "Email o contraseña no son correctos" (consistente).

**Visto el**: 2026-06-02 con `m.oyola@mipiace.es` intentando en `/login` (era super-admin, debía ir a `/superadmin/login`).

---

### ⚠️ "Demasiados intentos, vuelve en 15 minutos"

**Síntoma**: tras varios intentos fallidos de login el usuario queda bloqueado.

**Donde se ve**: login OWNER y super-admin.

**Causa raíz**: rate limit en Redis (key `login:*` o similar). Diseño correcto, evita fuerza bruta.

**Fix manual** (solo cuando se sabe que el usuario es legítimo):

```bash
docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec -T redis redis-cli --scan --pattern '*login*' | xargs -I {} docker compose ... exec -T redis redis-cli DEL {}
```

**Visto el**: 2026-06-02 con `solepelos@gmail.com` durante incidente Pedro+UFW.

---

## Cobro y tickets

### ⚠️ "body cannot be empty when content type is sent to application/json"

**Síntoma**: pulsar "Reimprimir" en el historial de tickets devuelve este error literal en inglés.

**Donde se ve**: TPV → Historial → ticket → botón Reimprimir.

**Causa raíz**: el TPV manda POST a `/tickets/:id/reprint` con `Content-Type: application/json` pero sin body. Fastify rechaza por defecto.

**Fix definitivo**: [task #9](#) — quitar Content-Type del fetch o pasar `{}` como body.

**Workaround mientras tanto**: cobrar el ticket nuevo en vez de reimprimir.

**Visto el**: 2026-06-02 en TPV de Sole.

---

## Holded · sync y silent rejects

### ✅ Ticket de servicio aparece en Holded con total=0 €

**Síntoma**: en Holded aparece el documento con docNumber asignado pero total=0 y línea sin precio. En BD el ticket queda `SYNC_FAILED` con mismatches.

**Causa raíz**: Holded NO acepta líneas "libres" en `salesreceipt`. Para servicios necesita el campo **`serviceId`** (no `sku` ni `productId`).

**Fix**: aplicado en `v1.3-hotfix8` (commit 09432fb). Backend distingue PRODUCT vs SERVICE y manda el campo correcto.

**Visto el**: 2026-05-27 con 4 tickets de Peluquería Sole (149,69 € recuperados).

---

### ✅ Doble cobro al reintentar ticket fantasma

**Síntoma**: tras un primer silent_reject, reintentar el upload del ticket genera un segundo `pay` en Holded → `paymentsPending = -total`.

**Causa raíz**: `registerPaymentWithGetBack` no era idempotente. Cualquier reintento tras pay parcial duplicaba el cobro.

**Fix**: `v1.3-hotfix10` (commit eda911b). Pre-check del doc; si `paymentsTotal>0` y `paymentsPending≤tolerancia`, no postear.

**Visto el**: 2026-05-27 con ticket #000006 de Sole (68,99 €).

---

### ✅ paymentsPending=0.01 da silent_reject

**Síntoma**: el ticket fue cobrado correctamente pero el GET-back reporta `paymentsPending=0.0100000000000005` por aritmética float64 con IVA 21%.

**Causa raíz**: tolerancia estricta `> 0.01` en `registerPaymentWithGetBack`.

**Fix**: `v1.3-hotfix9` (commit eede623). Tolerancia subida a 0.05 (igual que TOTAL_TOLERANCE_EUR).

**Visto el**: 2026-05-27.

---

## Impresoras

### ⚠️ "Failed to execute 'requestDevice' on 'USB': No device selected"

**Síntoma**: el cajero pulsa "Imprimir ticket" y aparece el toast de error con este mensaje en inglés.

**Donde se ve**: TPV → SuccessOverlay tras cobrar, al pulsar "Imprimir ticket" la primera vez.

**Causa raíz**: WebUSB de Chrome abre un popup "Seleccionar dispositivo USB" la primera vez que el TPV intenta acceder a la impresora. Si el cajero cierra el popup sin seleccionar dispositivo, devuelve esa excepción.

**Fix**:
1. Volver a pulsar "Imprimir ticket" o "Conectar impresora".
2. Cuando salga el popup, seleccionar la impresora (puede aparecer como "Unknown device") y pulsar Conectar.
3. Tras emparejar una vez, el TPV recuerda el dispositivo y los siguientes prints van directos.

**Si el popup sale vacío** (sin dispositivos): el cable USB es de solo carga sin pines de datos, o el adaptador OTG (USB-C → USB-A) tampoco transmite datos. Cambiar cable/adaptador.

**Pendiente traducir el mensaje** (política #10) a algo tipo "Conexión cancelada. Vuelve a pulsar Imprimir y elige la impresora en la ventana que aparece."

**Visto el**: 2026-06-02 en TPV de Peluquería Sole.

---

### ✅ RawBT — "no ACK" en impresiones largas (las cortas sí)

**Síntoma**: el test print de RawBT (texto plano corto) imprime. Pero al mandar un PDF de ticket entero vía "Compartir → RawBT", la impresora pierde ACK y no imprime.

**Causa raíz**: RawBT rasteriza el PDF a bitmap pesado, satura el buffer interno de las impresoras OEM POS-80 V6.16F.

**Fix**: NO usar RawBT como puente PDF→impresora. Integración nativa con ESC/POS plano (bloque `v1.4-impresoras-fase-1`, deploy 2026-06-02). El TPV manda ESC/POS directo vía WebUSB; ya no pasa por PDF.

**Visto el**: 2026-06-02 con Peluquería Sole.

---

## Red e infra

### ⚠️ ERR_CONNECTION_TIMED_OUT a admin.mipiacetpv.com / mipiacetpv.com

**Síntoma**: el navegador del cajero no puede conectar al servidor; timeout TCP sin respuesta. Caddy y containers están sanos internamente.

**Donde se ve**: cualquier usuario externo.

**Causa raíz típica**:
- UFW (firewall del VPS) activo bloqueando puertos 80/443.
- Pedro instaló su proyecto Farmaticcloud en el mismo VPS y ese paquete activó UFW automáticamente.
- O Hostinger Cloud Firewall del panel bloqueando.

**Fix**:
1. Verificar con `ufw status` y `iptables -L INPUT -n -v`.
2. Si UFW está activo bloqueando: `apt purge -y ufw && iptables -F && systemctl restart docker`.
3. Verificar puertos: `ss -tlnp | grep -E ':(80|443)'`.
4. Test externo: `https://check-host.net/check-tcp?host=admin.mipiacetpv.com%3A443`.

**Visto el**: 2026-06-02. Causado por unattended-upgrades activando UFW + Pedro corriendo Farmaticcloud en el mismo VPS.

**Prevención**: [task #4](#) — desinstalar UFW permanente. [task #5](#) — mover Farmaticcloud a otro VPS.

---

### ⚠️ "No se puede acceder al sitio" al `wss://mipiacetpv.com/ws/store/...`

**Síntoma**: consola del TPV muestra error al conectar al WebSocket de realtime. El TPV funciona pero no sincroniza entre dispositivos.

**Donde se ve**: pestaña Console de DevTools del TPV.

**Causa raíz**: Caddy no tenía regla `handle /ws/*` y el WebSocket caía al handler de estáticos del PWA.

**Fix**: bloque `v1.4-Bar-Operativa-MVP Lote 1` (commit f6e0321). Añadido `handle /ws/* { reverse_proxy api:3001 }` en Caddyfile.

**Visto el**: 2026-05-27.

---

## Service Worker y caché TPV

### ✅ Catálogo TPV muestra solo X productos (los primeros alfabéticos)

**Síntoma**: el cajero ve 20 productos de Sole pero en BD hay 86. Filtros por categoría muestran subset alfabético (todo lo posterior a la M oculto).

**Causa raíz**: en `SalePage.tsx` había `catalog.slice(0, 40)` cuando no había query de búsqueda — limitaba arbitrariamente.

**Fix**: `v1.3-hotfix12` (commit 85466ca). Devolver catálogo completo. Si en el futuro hay >500 productos, virtualizar el grid.

**Visto el**: 2026-05-27 con Peluquería Sole.

---

## Mensajes en inglés que hay que traducir

Lista viva de mensajes en inglés vistos en producción que deben traducirse (política #10):

- "body cannot be empty when content type is sent to application/json" → "El cuerpo de la petición no puede estar vacío."
- "INVALID_CREDENTIALS · Email o contraseña incorrectos" — el código es OK, el message ya está en español; pero algunos endpoints aún devuelven `Invalid credentials`. Auditar.
- "no ACK" (RawBT) — fuera de nuestro control, pero el mensaje al cajero debe ser "La impresora no respondió. Comprueba el cable y vuelve a intentar."

(Se sigue ampliando.)

---

## Cómo añadir una entrada

1. Síntoma EXACTO (literal, copy-paste si lo tienes).
2. ¿Dónde se ve? (URL, pantalla, log).
3. Causa raíz tras investigación.
4. Fix (con referencia a commit/PR/task si aplica).
5. Fecha y persona que reportó.
6. Si está cerrado → ✅. Si está abierto → ⚠️.
