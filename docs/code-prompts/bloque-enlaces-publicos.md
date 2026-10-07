# Bloque enlaces-publicos · una sola puerta para todo lo que se abre sin cuenta

Rama `enlaces-publicos`, worktree `~/Developer/Claude/Projects/mipiacetpv-enlaces-publicos`, desde
`origin/master` (`cf0bd91` o el que haya). Frente C, en paralelo a `clinica-5` (no comparten
ficheros: ver «Con quién convive»). Escrito por la conversación de reservas el 07-10-2026 con la
decisión **S1** de `docs/clinica/solapes-clinica-agenda.md` (copia en el proyecto:
`claude/solapes-clinica-agenda.md`).

Lee antes, en este orden:
1. **`solapes-clinica-agenda.md` §S1 entero** (propuesta de clínica, lado agenda, respuesta de
   clínica y **Decisión**). Es la spec. Lo decidido no se re-debate.
2. `apps/api/src/clinica/enlace.ts` y `apps/api/src/clinica/valoracion-publica.ts` — el mecanismo que
   hoy tiene **sólo** la valoración. Está bien hecho (hash SHA-256, 256 bits, 404 única, rate-limit tras
   el proxy, un uso, caducidad por canal). **Se generaliza, no se reescribe**: sus comentarios
   explican cada decisión y se conservan donde vayan.
3. `apps/api/src/tickets/public-pdf-route.ts` — el slug del ticket. **Queda fuera** (decisión S1.5).
4. `docs/reservas/05-lo-aprendido-en-rt-del-2-sep-al-6-oct.md` §3 — cómo funcionó «mi cita» en Raquel
   Torres (cabeceras, topes, token por cita). Sólo como referencia del perfil «actuar sobre su cita».
5. `docs/blocks/clinica-2-done.md` — tests y e2e de la valoración pública, que tienen que seguir verdes.

## Por qué existe

Hoy hay un enlace público bien hecho (la valoración) y van a venir cuatro más: leer un
consentimiento antes de firmarlo (clinica-4), «mi cita» para cambiar o anular (reserva online), la
encuesta post-visita y el formulario del equipo. Si cada uno hace el suyo, cada uno elige sus
cabeceras, sus topes y su forma de caducar, y el que se equivoque expone datos.

¿Y qué?: (1) un enlace que se filtra no enseña nada que no deba, porque lo decide la puerta común y
no cada pantalla; (2) el siguiente bloque que necesite un enlace sólo declara su `purpose`, sin
volver a escribir seguridad; (3) recepción puede anular cualquier enlace desde un sitio.

## Decisiones ya tomadas (S1, 07-10) — no se re-debaten

1. **Una tabla común** (`public_links`): `tenantId`, `purpose`, a qué apunta (`targetType` +
   `targetId`), **huella SHA-256** del token (nunca el token), `expiresAt`, `maxUses` / `usedCount`,
   `revokedAt`, `createdByUserId` (nulo si lo crea el sistema), `createdAt`. Índice único por huella.
2. **Una sola puerta** en el servidor: formato antes de la base; huella; caducidad; usos; revocado;
   **la misma 404** para «no existe», «caducado», «gastado» y «revocado»; cabeceras comunes
   `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.
3. **Cada `purpose` declara en código** (registro tipado, no en la fila): caducidad, usos, **perfil**
   y **en qué estado del objeto admite enlace**. Perfiles:
   - `SOLO_ESCRIBIR` — contesta, nunca recibe datos de vuelta (valoración y todo lo clínico).
   - `SOLO_LEER` — ve un documento, no escribe (consentimiento para leer, S3).
   - `ACTUAR_SOBRE_CITA` — ve día, hora, servicio y profesional de **esa** cita y actúa sobre ella;
     nada de la ficha ni de salud («mi cita»).
4. **Dos límites de peticiones**: el general por IP (el que ya existe) **y** uno de **tokens
   inexistentes por IP** (10/min). Los `purpose` del equipo limitan **por token**, no por IP (todo el
   centro sale por el mismo wifi). En este bloque no hay ninguno del equipo: deja el mecanismo y un
   test con un `purpose` de prueba.
5. **Reenviar rota el token**: fila nueva, la anterior revocada (como hace hoy la valoración al abrir
   la tablet).
6. **Los enlaces clínicos dejan rastro**: cada uso de un `purpose` clínico va a `ClinicalAccessLog` con
   el actor «paciente por enlace» que ya existe. Lo declara el `purpose` (`registraAccesoClinico`).
7. **La valoración apunta a la valoración, no a la cita**: mover o anular la cita no toca su enlace;
   admite enlace mientras está pendiente de contestar.
8. **`Ticket.publicSlug` no se toca.**

## Alcance

### 1 · Datos
- Migración aditiva: `public_links` con lo de la decisión 1. Trigger o `CHECK` para que `usedCount`
  no supere `maxUses` y para que una fila revocada no se des-revoque (mismo estilo que el sellado de
  `link_used_at` de clinica-2).
- **Migración de clinica-2**: las filas de `clinical_assessments` con `link_token_hash` pasan a
  `public_links` (`purpose = VALORACION`, misma huella, misma caducidad, `usedCount` según
  `link_used_at`). En producción no hay ninguna clínica encendida: compruébalo con una consulta en el
  `-done` y migra igual (puede haber filas de prueba). Las columnas viejas **no se borran en este
  bloque**: se dejan de leer y se marcan obsoletas en el esquema; se quitan en un bloque posterior.

### 2 · La puerta (`apps/api/src/enlaces/` o donde encaje con el estilo del repo)
- `crearEnlace(purpose, target, opciones)` → token en claro una sola vez + fila.
- `resolverEnlace(token, purpose)` → el objeto, o la 404 común. Comprueba el estado admitido que
  declara el `purpose`.
- `consumirEnlace` (incrementa usos dentro de la transacción del acto que lo gasta) y
  `revocarEnlace` / `revocarEnlacesDe(target)`.
- El registro de `purpose` con sus reglas. En este bloque sólo se da de alta **`VALORACION`** (con
  sus dos caducidades por canal, email 30 días y tablet 4 h, que hoy están en `enlace.ts`). Los demás
  `purpose` los añade el bloque que los necesite.

### 3 · La valoración, sobre la puerta
- `valoracion-publica.ts` y el envío (`valoracion-envio.ts`, la apertura en tablet) pasan a usar la
  puerta. **El comportamiento visto desde fuera no cambia**: mismas rutas, mismos textos, misma 404,
  mismo correo. Los tests y el e2e de clinica-2 siguen verdes **sin tocarlos**; si alguno hay que
  tocar, el `-done` explica por qué.

## Con quién convive
- **`clinica-5`** está en Code a la vez (sesión, caja, `tag_visit_types`). Este bloque **no toca**
  `packages/clinica-sesion`, `SesionPodologia.tsx`, `lineas-de-la-sesion.ts` ni el catálogo. Si
  necesitas tocar algo de `apps/api/src/clinica/` que no sea valoración o enlace, para y dilo.
- Las dos ramas añaden migración: nombra la tuya con fecha posterior a la última de `master` en el
  momento de abrir el PR. Quien mergee segundo rebasa.

## Lo que NO entra
- Los `purpose` de «mi cita», consentimiento, encuesta y equipo: sólo la puerta preparada para ellos.
- Pantalla de recepción para ver y anular enlaces (vendrá con «mi cita»).
- Borrar las columnas viejas de `clinical_assessments`.
- El slug del ticket.

## Cómo se da por hecho
- Suite verde en local y CI, **incluidos sin cambios** `clinica-valoracion-rutas.test.ts`,
  `clinica-valoracion-migracion.test.ts`, `clinica-valoracion.e2e.ts` y
  `apps/e2e-ui/specs/11-clinica-valoracion.spec.ts`.
- **Tabla de sabotajes en el `-done`**, cada test visto en rojo:
  - guardar el token en claro en vez de la huella;
  - responder distinto a «caducado» que a «no existe»;
  - quitar una de las tres cabeceras;
  - dejar usar un enlace una vez más de su tope;
  - des-revocar una fila con un `UPDATE`;
  - que un `purpose` `SOLO_ESCRIBIR` devuelva un campo de la valoración en la respuesta;
  - que el tope de tokens inexistentes no frene a la undécima petición;
  - que el uso de un enlace clínico no deje fila en `ClinicalAccessLog`;
  - que anular la cita revoque el enlace de la valoración (no debe).
- `docs/blocks/enlaces-publicos-done.md` con lo hecho, la consulta de producción de filas a migrar,
  los sabotajes y «Al desplegar» (la migración; sin variables nuevas, y si añades alguna, dilo).
- Al cerrar, actualiza la línea del S1 en `docs/clinica/solapes-clinica-agenda.md` con «construido en
  `enlaces-publicos`».
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue: eso es de Dirección.
