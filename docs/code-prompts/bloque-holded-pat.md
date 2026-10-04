# Bloque holded-pat · el TPV habla API Keys v1 y tokens `pat_` a la vez

Rama `holded-pat`, worktree `~/Developer/Claude/Projects/mipiacetpv-holded-pat`, desde `master` = `de4f915`.
Frente C del tablero de dirección. Peldaño 1. Escrito por Dirección el 03-10-2026.

## Por qué existe

El 13-09, al dar de alta el tenant PRUEBAS MIPIACE con un **API Token nuevo de Holded (`pat_…`)**,
el alta falló: Holded respondió `400 {"status":0,"info":"Invalid key"}` a `GET /invoicing/v1/warehouses`.
El panel de Holded dice, en las dos pantallas: *"La versión anterior de API Keys v1 ha quedado
obsoleta, puedes seguir accediendo temporalmente"* y *"Las API Keys v1 dejarán de funcionar"*.
Sin fecha publicada.

**Todo tenant con Holded guarda una clave v1** (`Tenant.holdedApiKeyCiphertext`). El día que Holded
apague v1, ninguna caja conectada sube un ticket ni baja catálogo. No hay día D posible: se migra
cuenta a cuenta, y para eso el TPV tiene que aceptar las dos claves a la vez.

¿Y qué?, para quien lo usa:
1. El día del apagado las cajas siguen cobrando y sincronizando.
2. El implantador sabe **en el alta** si el token vale y **qué permiso le falta**, en vez de
   descubrirlo en el bar cuando un ticket no sube (un token `pat_` lleva permisos por ámbito: a uno
   mal hecho le puede faltar sólo la escritura de documentos y funcionar «a medias»).
3. Un "Invalid key" se lee como «clave rechazada», no como «No hemos podido contactar con Holded.
   Reintenta en unos minutos», que hoy le manda a buscar un fallo de red que no existe.

## Lo que hay hoy (comprobado por Dirección el 03-10 sobre `de4f915`)

- `packages/holded-client/src/client.ts:82` (`request`) y `:185` (`fetchBinary`) mandan
  `key: <clave>`. Nada de `pat_` ni `Bearer`. `client.test.ts:18` fija ese comportamiento.
- `new ApiKeyClient` se instancia en 12 sitios de `apps/api/src` (tickets, abonos, conciliación,
  catálogo, contactos, onboarding, super-admin, worker de contactos, script de auto-SKU).
- La clave se valida en **tres sitios con el mismo hueco** (sólo 401/403 → clave inválida; el 400
  cae a `HOLDED_UNREACHABLE`): `apps/api/src/superadmin/tenants.ts:~678` (alta, contra
  `/warehouses`), `:~1639` (rotación de clave, contra `/warehouses`) y
  `apps/api/src/holded/probe.ts:60` (`probeHoldedKey`, contra `/products`; lo usan el onboarding y
  la conexión posterior del H1 en `auth/routes.ts`).
- No existe ninguna comprobación de permisos.
- Mensajes del super-admin en `apps/admin/src/superadmin/error-messages.ts`; formulario de alta en
  `apps/admin/src/superadmin/CreateTenantPage.tsx`.

## Paso 0 · spike contra Holded de verdad (PUERTA: no escribas código de producción antes)

Necesitas un token `pat_` real. **Pídeselo a Matías como variable de entorno** (que lo exporte él en
tu terminal, p. ej. `HOLDED_PAT_PRUEBAS`); **nunca** lo pegues en el chat, un fichero, un commit, un
test ni el done. Lo mismo para la clave v1 de PRUEBAS si la necesitas para comparar.

Responde, con la petición y la respuesta reales (sin la clave):

1. ¿Funciona un `pat_` contra las rutas **v1** que usamos (`/invoicing/v1/...`) con
   `Authorization: Bearer <pat>`? ¿Y con `key: <pat>`? ¿Responden con la misma forma y la misma
   paginación que con la clave v1?
2. Inventario de **todas** las rutas de Holded que llama el código (grep, no memoria): por cada una,
   ¿responde con `pat_`? Incluye las de escritura (crear salesreceipt, `/pay`, abonos, `PUT
   /products/{id}`, imagen) **sin escribir nada en ninguna cuenta**: para éstas basta con la
   documentación (`holded.com/es/desarrolladores`) o con una cuenta de pruebas que Matías confirme
   que se puede ensuciar.
3. ¿Qué responde Holded cuando al token **le falta un ámbito** (status, body)? ¿Existe algún
   endpoint que diga qué ámbitos tiene un token? ¿Cómo se llaman los ámbitos **tal como los ve el
   cliente en el panel** (Configuración → Desarrolladores → Credenciales)?
4. ¿Qué responde Holded a un `pat_` inválido o revocado? ¿Y a una v1 inválida (confirmar el 400
   "Invalid key")?
5. ¿Hay fecha de apagado de v1 publicada en la documentación?

**Puerta.** Si un `pat_` **sólo** funciona contra rutas v2 (otra forma de respuesta, paginación por
cursor), **para aquí**: escribe el hallazgo en `docs/blocks/holded-pat-spike.md`, haz commit y push,
y no sigas. Migrar el cliente a v2 es otro bloque (cola 8) y lo decide Dirección. Si funciona contra
v1 con otra cabecera, sigue.

## Alcance

### 1 · Un cliente, dos claves

- El esquema de autenticación se decide **en un único sitio** del paquete `holded-client` a partir
  de la clave (prefijo `pat_` → el esquema que haya confirmado el spike; si no → `key:`), y lo usan
  `request` y `fetchBinary`. Los 12 sitios que instancian el cliente **no cambian**.
- Nada de lo que hay alrededor se toca: `fetchWithRetry` y el backoff (sólo GET), el 402 de
  suspensión, el GET-back del salesreceipt, la tolerancia de 5 céntimos, el `/pay` idempotente.
- Ningún log, error ni evento lleva la clave, ni entera ni truncada más allá del prefijo.

### 2 · Comprobar los permisos al conectar

- Una **lista canónica** de los ámbitos que el TPV necesita, sacada del inventario del paso 0 (no a
  ojo), en un solo módulo, con el nombre que ve el cliente en Holded y para qué lo usa el TPV.
  **Incluye la escritura de productos** aunque hoy sólo la use la bandeja de SKU: el espejo
  TPV→Holded del catálogo viene en un bloque aparte y no queremos volver a tocar ~40 tokens.
- La comprobación corre en **los tres puntos de conexión** (alta, rotación, probe del onboarding/H1)
  y sólo para `pat_`: una v1 no tiene ámbitos.
- Cómo se comprueba, por orden de preferencia: (a) introspección, si Holded la tiene; (b) una sonda
  de lectura barata por recurso (403 = falta). **Nunca se escribe en el Holded de un cliente para
  probar un permiso.** Si un ámbito de escritura no se puede comprobar sin escribir, la respuesta lo
  dice como «no comprobable: revísalo en Holded», no lo da por bueno en silencio.
- Si falta un ámbito imprescindible: se rechaza con un código nuevo (p. ej.
  `HOLDED_TOKEN_MISSING_SCOPES`) y **la lista de los que faltan, con su nombre de Holded**. El
  implantador tiene que poder ir al panel y marcarlos sin preguntar a nadie.
- Las sondas cuentan contra la cuota de Holded: que sean las mínimas y sólo al conectar.

### 3 · El 400 "Invalid key", y una sola traducción

- Los tres puntos de validación pasan por **una sola función** (la de `holded/probe.ts` o la que la
  sustituya), que es la única que sabe qué respuestas de Holded significan «clave rechazada»: 401,
  403 de una v1, `400` con `info === "Invalid key"` y lo que el spike encuentre para `pat_`.
  Duplicar el mapeo en tres sitios es exactamente lo que produjo este bug.
- El mensaje en el super-admin y en el onboarding dice qué hacer, no sólo qué pasó: que la clave
  está rechazada y dónde se genera un token en Holded. Distingue «clave rechazada» de «faltan
  permisos» de «Holded no responde».
- `HOLDED_UNREACHABLE` queda **sólo** para red, timeout y 5xx.

### 4 · Ver la migración

- El super-admin ve, por tenant, **qué tipo de clave tiene** (v1 / `pat_` / sin Holded), y en el
  listado cuántos siguen en v1. Es la herramienta con la que se van a migrar las ~40 cuentas: sin
  ella nadie sabe cuántas quedan. Si para eso hace falta guardar el tipo en BD, que la migración sea
  aditiva y que el relleno de los tenants existentes sea un script idempotente documentado para
  correrlo en producción (descifra con la misma variable que ya usa la API; no vuelca claves).
- El formulario de alta y el de rotación aceptan las dos; la etiqueta deja de decir sólo «API Key».

### 5 · Implantadores

- `docs/implantadores/checklist-implantacion-tenant.md`: cómo se genera el token `pat_` en Holded,
  qué permisos se marcan (la lista canónica) y qué hacer con cada error del alta.

## Respeta lo que se movió desde el 13-09

- **H1**: sin clave no se instancia el cliente ni se toca la red; un 502 de Holded no impide dar de
  alta a una empresa que no usa Holded.
- **ADR-020 (Dejar Holded)**: la rotación de clave rechaza un tenant desconectado. Eso no cambia.
- **Abonos** (`upload-refund.ts`) y `holded/silencio.ts`: no cambian de comportamiento.

## Fuera de alcance (declarado)

- El **espejo TPV→Holded del catálogo**: bloque aparte (decisión de Matías, 03-10). Aquí sólo se
  pide su permiso.
- Migrar el cliente a la API v2 (cursor, cuotas, webhooks): cola 8.
- Rotar las claves de los clientes: es trabajo humano posterior, cuenta a cuenta.
- El backoff y la política de reintentos.

## Cómo se cierra

- Tests unitarios y e2e del flujo de alta, rotación y probe con Holded simulado (claves falsas tipo
  `pat_test_…`), y la suite entera en verde **en CI** (no te fíes de la local; recuerda el mock
  literal de `catalog.js` y las variables que tapa el `.env` de desarrollo).
- **Tabla de sabotajes**: por cada garantía (cabecera según prefijo, en `request` y en
  `fetchBinary`; 400 "Invalid key" → clave rechazada en los tres puntos; ámbito que falta → rechazo
  con su nombre; ninguna escritura en Holded durante la comprobación; la clave nunca en un log),
  qué línea de producción rompes, qué test se pone rojo y con qué mensaje real.
- **Qué NO cubre la suite**, dicho por escrito (p. ej. que Holded real responda igual que el
  simulado: eso lo cubre sólo el spike).
- Una prueba manual final contra Holded de verdad con el token de PRUEBAS: alta o rotación con
  `pat_` correcto, con `pat_` sin un permiso y con una clave basura. Respuesta y mensaje que ve el
  implantador en cada caso.
- `docs/blocks/holded-pat-done.md` con: hallazgos del spike, decisiones (si alguna cambia la
  arquitectura del cliente, ADR-021 en `docs/design/`), la lista canónica de ámbitos, la tabla de
  sabotajes, lo que no cubre, el script de relleno (si existe) y cómo se despliega (¿migración?
  ¿script en producción?). El done dice si la rama está pusheada y si hay PR.
- Commits pequeños y con mensaje en español, push de la rama y **PR abierto contra `master`**. No
  merges ni despliegues: eso lo hace Dirección.
