# holded-pat · el 400 "Invalid key" se lee como lo que es — DONE

**Rama:** `holded-pat` (sale de `master` en `de4f915`) · **Estado:** PR abierto contra `master`, sin
merge y sin desplegar. **Fecha:** 03-10-2026.

El bloque se escribió para que el TPV hablase «API Keys v1 y tokens `pat_` a la vez». El paso 0
cerró esa puerta con medidas contra Holded real: **un `pat_` no autentica contra `/invoicing/v1/…`
con ninguna cabecera**, y v2 no es v1 con otra cabecera (rutas renombradas, envoltorio
`{items, cursor, has_more}`, paginación por cursor). Todo en
[`holded-pat-spike.md`](holded-pat-spike.md).

Dirección redujo el alcance el 03-10: **sin v2**, y sólo tres cosas sobre v1. Es lo que hay aquí.

---

## 0 · Lo primero: qué sigue pendiente, y qué NO arregla esto

- **Las cajas siguen dependiendo de que v1 siga viva.** Esto no migra nada: cuando Holded apague v1,
  ninguna caja conectada sube un ticket ni baja catálogo. La migración es el bloque de cola 8.
- **No está comprobado que una clave v1 válida siga funcionando hoy.** Haría falta la v1 de PRUEBAS y
  no se pidió. Es la hipótesis sobre la que descansa todo lo demás y está sin medir (spike §4).
- **No se toca `getReceiptPdf`.** Monta su propio `fetch` con `headers: { key: apiKey }`
  (`packages/holded-client/src/salesreceipt.ts:287-300`): es un **tercer** sitio donde se fija la
  cabecera, y el prompt original sólo contaba dos. Queda anotado para el bloque de v2, por decisión
  de Dirección.
- **Las ~40 cuentas en v1 siguen sin inventario.** El alcance 4 del prompt original (ver por tenant
  qué tipo de clave tiene, y cuántos siguen en v1) **no** se ha hecho: no entró en el alcance
  reducido.

---

## 1 · Qué se ha construido

### 1.1 · Una sola función decide «clave rechazada»

`apps/api/src/holded/clave-rechazada.ts` (nuevo). Es el único sitio que sabe qué respuesta de Holded
significa qué:

| Respuesta de Holded | Código | HTTP |
|---|---|---|
| 401 | `INVALID_HOLDED_KEY` | 401 en el probe · 400 en el super-admin |
| 403 | `INVALID_HOLDED_KEY` | idem |
| **400 con `info: "Invalid key"`** | `INVALID_HOLDED_KEY` | idem |
| 402 (cuenta suspendida) | `HOLDED_SUSPENDED` | 402 / 400 |
| 200 + HTML | `HOLDED_INVALID_RESPONSE` | 502 |
| otro 4xx (404, 429…) | `HOLDED_UNEXPECTED_STATUS` | 502 |
| 5xx, red, DNS, timeout, abort | `HOLDED_UNREACHABLE` | 502 |

El `info` se compara normalizado (`trim` + minúsculas), así que `"  invalid KEY "` también cuenta.

**`HOLDED_UNREACHABLE` queda sólo para red, timeout y 5xx**, como pidió Dirección. Por eso aparece
`HOLDED_UNEXPECTED_STATUS`: antes un 429 o un 404 se devolvían como «no hemos podido contactar con
Holded», que es mentira y manda a mirar la red. Mismo 502 para el caller, distinto texto.

**Por qué un módulo nuevo y no `probe.ts`.** El primer intento puso el traductor en `probe.ts` y la
suite se puso roja en 6 tests de `h1-holded-mas-tarde.test.ts`: ese fichero sustituye **todo**
`probe.js` por un stub de dos funciones, así que el `esTokenPat` que importaba el alta llegaba
`undefined` y la ruta contestaba 500. La regla de negocio no puede colgar del helper que la usa
primero. `probe.ts` ahora importa de `clave-rechazada.ts` y mantiene su API pública intacta
(`ProbeFailureCode` es un alias del tipo nuevo).

### 1.2 · Los tres puntos pasan por ella

| Punto | Fichero | Qué cambió |
|---|---|---|
| Alta (super-admin) | `apps/api/src/superadmin/tenants.ts:~690` | Las cuatro ramas `if (err instanceof …)` se van; queda `superAdminHoldedKeyFailure(err)` |
| Rotación (super-admin) | `apps/api/src/superadmin/tenants.ts:~1640` | Igual |
| Probe (onboarding B1, rotación del propietario B2, H1) | `apps/api/src/holded/probe.ts` | Delega en `classifyHoldedKeyFailure` |

Los nombres que ve el front **no cambian**: el super-admin sigue devolviendo
`HOLDED_API_KEY_INVALID` con 400 (`superAdminHoldedKeyFailure` hace ese renombrado, y sólo ése). El
`request.log.error` sólo se emite cuando de verdad es `HOLDED_UNREACHABLE`.

### 1.3 · El `pat_` se rechaza antes de llamar a Holded

`esTokenPat(clave)` → prefijo `pat_`, con `trim` y sin distinguir mayúsculas. Se comprueba en los
tres puntos **antes de instanciar el cliente**. Mensaje, idéntico en los tres:

> Esa clave es un API Token nuevo de Holded (empieza por «pat_») y esta versión del TPV necesita una
> API Key v1. Genérala en Holded, en Configuración → Más → Desarrolladores, y pega esa.

Código nuevo: `HOLDED_KEY_V1_REQUIRED` (probe, HTTP **400**) y `HOLDED_API_KEY_V1_REQUIRED`
(super-admin, HTTP 400). **400 y no 502** a propósito: es un error de lo que se ha teclado, y un 502
invita a reintentar con la misma clave.

Por qué antes de la red y no después: Holded contesta `400 {"status":0,"info":"Invalid key"}` (spike
§1), que ya sabemos traducir — pero gastar la llamada no aporta nada y, sobre todo, el mensaje
genérico de clave rechazada no dice **qué** clave hace falta. El implantador lo lee delante del
cliente.

### 1.4 · Mensajes del super-admin

`apps/admin/src/superadmin/error-messages.ts`: etiquetas para `HOLDED_API_KEY_V1_REQUIRED` y
`HOLDED_UNEXPECTED_STATUS`, y la ruta del panel corregida a **Configuración → Más → Desarrolladores**
en `HOLDED_API_KEY_INVALID` (decía «Configuración → Desarrolladores», que no es donde está).

### 1.5 · Implantadores

`docs/implantadores/checklist-implantacion-tenant.md`: en Fase 0, que la clave **tiene que ser una
API Key v1**, que los `pat_` no funcionan, dónde se genera la buena, y que si sale
`HOLDED_API_KEY_V1_REQUIRED` **no es un fallo de red**. En Fase 1, la lista de errores del alta
completa, con qué hacer en cada uno y con `HOLDED_UNREACHABLE` marcado como «sólo red, timeout o
caída de Holded».

---

## 2 · Lo que NO se ha tocado

- `packages/holded-client` entero: `request`, `fetchBinary`, `getReceiptPdf`, `fetchWithRetry` y el
  backoff, el 402 de suspensión, el GET-back del salesreceipt, la tolerancia de 5 céntimos, el
  `/pay` idempotente. Cero cambios.
- Los 12 sitios que instancian `ApiKeyClient`.
- H1 (sin clave no se instancia el cliente ni se toca la red), ADR-020 (la rotación rechaza un tenant
  desconectado: su 409 sigue **antes** de la guarda del `pat_`), `upload-refund.ts`,
  `holded/silencio.ts`.
- El formulario de alta y su etiqueta «API Key»: sin v2 no hay dos tipos de clave que aceptar, así
  que decir «API Key» sigue siendo verdad.
- No hay migración de BD ni script de relleno. No hacía falta ninguno.

---

## 3 · Tabla de sabotajes

Cada fila se ha ejecutado de verdad: se rompe la línea de producción, se corre
`pnpm vitest run apps/api/test/holded-pat.test.ts`, se anota el rojo y se revierte.

| # | Qué se rompe | Línea de producción | Test que se pone rojo | Mensaje real |
|---|---|---|---|---|
| 1 | Borrar la rama del `400` + `info:"Invalid key"` | `clave-rechazada.ts` · `classifyHoldedKeyFailure` | 5 rojos: «el 400 con info 'Invalid key' es clave rechazada, no Holded caído», «acepta el info con otra caja y espacios», «con una clave v1 sí llama, y traduce el 400 'Invalid key'», «el 400 'Invalid key' de Holded se ve como clave rechazada, no como caída» (alta), el mismo en rotación | `expected 'HOLDED_UNEXPECTED_STATUS' to be 'INVALID_HOLDED_KEY'` |
| 2 | Devolver `HOLDED_UNREACHABLE` para un 4xx que no es rechazo | `clave-rechazada.ts` · rama final de `HoldedApiError` | 3 rojos: «un 400 con otro motivo NO es clave rechazada ni Holded caído», «un 429 no se lee como "no hemos podido contactar con Holded"», «un 429 no miente diciendo que Holded no responde» (rotación) | `expected 'HOLDED_UNREACHABLE' to be 'HOLDED_UNEXPECTED_STATUS'` |
| 3 | Quitar la guarda de `pat_` del probe | `probe.ts` · `probeHoldedKey` | «no hace ni una petición y dice qué clave hace falta y dónde» | `Test timed out in 5000ms.` — el espía de `fetch` lanza y el cliente **reintenta** antes de rendirse, así que el rojo llega por timeout, no por aserción |
| 4 | `esTokenPat` mira `"pat"` en vez de `"pat_"` | `clave-rechazada.ts` · `esTokenPat` | «no confunde una clave v1 ni una que empiece por 'pat'» | `expected true to be false` |
| 5 | Quitar la guarda de `pat_` del alta | `tenants.ts` · alta | «rechaza el pat_ con 400 y SIN llamar a Holded» | `expected 201 to be 400` — y el tenant se habría creado con el token malo guardado |
| 6 | Quitar la guarda de `pat_` de la rotación | `tenants.ts` · rotación | «rechaza el pat_ con 400, sin llamar a Holded y sin pisar la clave vieja» | `expected 200 to be 400` |
| 7 | Volver a mapear a mano en el alta (401 sí, 400 no), que es el bug del 13-09 | `tenants.ts` · alta | «el 400 'Invalid key' de Holded se ve como clave rechazada, no como caída» | `expected 502 to be 400` |

Los tests 5 y 6 comprueban además `warehouseCalls.n === 0`: no es sólo que el status sea 400, es que
**no se llama a Holded**. Y el 6 comprueba que el ciphertext viejo sigue intacto.

## 4 · Qué NO cubre la suite

- **Que Holded real responda como el simulado.** Los tests fabrican `HoldedApiError(400, …, {status:
  0, info: "Invalid key"})` porque eso es lo que Holded devolvió el 03-10 en el spike. Si Holded
  cambia el cuerpo, la suite sigue verde y el bug vuelve. Lo cubre sólo el spike, y sólo el día que
  se corrió.
- **Que una clave v1 válida funcione.** Ningún test lo prueba y ninguna medida lo respalda (§0).
- **Las rutas de onboarding y de rotación del propietario**, de extremo a extremo. Se prueba
  `probeHoldedKey` directamente; que `POST /onboarding/connect-holded` y
  `POST /auth/me/rotate-holded-key` reenvíen el código y el mensaje lo cubre
  `auth-holded-rotation.test.ts`, que **dobla el probe**: si alguien dejara de llamar a
  `probeFailureToHttpStatus` ahí, esta suite no se enteraría.
- **Lo que ve el implantador en pantalla.** `error-messages.ts` no tiene test propio; se comprueba
  que la API manda `message`, y el front prefiere el `message` sobre la etiqueta.
- **Los e2e** no se han corrido en local (piden base propia). Los corre CI.
- **La prueba manual contra Holded real con un `pat_` por la UI del super-admin** no se ha hecho: el
  rechazo ocurre antes de la red, así que no hay nada que Holded pueda decir al respecto. Lo que sí
  está medido contra Holded real es la respuesta que motivó todo esto (spike §1).

## 5 · Cómo se comprueba, y cómo se despliega

```
pnpm install --frozen-lockfile
pnpm --filter @mipiacetpv/db run generate
pnpm --filter @mipiacetpv/api exec tsc --noEmit      # limpio
pnpm --filter @mipiacetpv/admin exec tsc -b          # limpio
pnpm --filter @mipiacetpv/tpv-web exec tsc -b        # limpio
pnpm test                                            # 265 ficheros, 2895 pasan, 3 skipped
```

Local en verde el 03-10 a las 12:55. **CI es la que manda**: el PR lo dirá.

**Despliegue:** sin migración de BD, sin script en producción, sin variables nuevas. Es código de API
y un literal del front: basta con desplegar `api` y `admin` como siempre. El checklist de
implantadores entra solo (es un `.md` del repo).

## 6 · Ficheros

| Fichero | Qué |
|---|---|
| `apps/api/src/holded/clave-rechazada.ts` | **nuevo** · el único traductor + `esTokenPat` + los adaptadores del super-admin |
| `apps/api/src/holded/probe.ts` | delega en el anterior; API pública intacta |
| `apps/api/src/superadmin/tenants.ts` | alta y rotación: fuera el mapeo duplicado, dentro la guarda del `pat_` |
| `apps/admin/src/superadmin/error-messages.ts` | dos etiquetas nuevas y la ruta del panel corregida |
| `apps/api/test/holded-pat.test.ts` | **nuevo** · 19 tests |
| `docs/implantadores/checklist-implantacion-tenant.md` | la clave v1, dónde se genera, y qué hacer con cada error |
| `docs/blocks/holded-pat-spike.md` | el paso 0 (ya commiteado en `900d862`) |
