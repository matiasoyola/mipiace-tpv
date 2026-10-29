# Bloque pin-1 · mi PIN lo elijo yo

Rama `pin-1-mi-pin`, worktree `~/Developer/Claude/Projects/mipiacetpv-pin-1`, desde `origin/master`. Escrito el
27-10-2026. **Capa común**: todas las verticales y todos los roles que entran con PIN.

Lee antes:
1. `apps/api/src/auth/routes.ts` (`/auth/me/regenerate-owner-pin`, login con PIN, bloqueo por intentos),
   `apps/api/src/cashiers/routes.ts` (`PATCH /cashiers/:id/pin`, `pinFormat`), `apps/admin/src/App.tsx` (Mi cuenta ·
   «PIN de respaldo del propietario»), `apps/admin/src/pages/CashiersPage.tsx`, `apps/tpv-web/src/pages/PinScreen.tsx`.
2. `apps/api/src/superadmin/welcome-email.ts` e `invite-email.ts`: **ya prometen** «Puedes cambiar tu PIN en cualquier
   momento desde el panel». Hoy es falso.
3. Lo de residencia (`residencia/ficha-routes.ts`, PIN de puerta) es otra cosa: no se toca, pero no se rompe.

## Por qué existe

El 27-10, en la pasada de clinica-9, Matías **perdió el PIN de la propietaria dos veces en la misma mañana**. Para
entrar hubo que ir a super-admin → «Configurar como OWNER» → «Regenerar PIN», que da cuatro cifras al azar y las
enseña una vez. Requisito suyo desde el 18-10: «el PIN debe ser personal y cambiable por el propio usuario desde su
panel; no me cuadra que el sistema lo genere y solo se enseñe una vez».

¿Y qué?: **cada persona entra con un PIN que recuerda**, y quien lo olvida lo recupera sin llamar a Mi Piace.

## Decisiones (Matías / Dirección) — no se re-debaten

- **Mínimos clics.** Cambiar el PIN es una pantalla: PIN actual, nuevo, repetir, guardar.
- El PIN lo elige la persona. El sistema **no genera PINs al azar** para nadie salvo como último recurso de soporte.

## Lo que entra

1. **Cambiar mi PIN, cualquier rol que entre con PIN** (propietaria, encargado, cajero, sanitario): con el PIN actual,
   nuevo PIN y repetirlo. Desde **el panel** (Mi cuenta) y desde **el TPV** (menú → «Cambiar mi PIN»). Mismo endpoint.
   Formato el de hoy (`pinFormat`). Se rechazan los triviales (`0000`, `1111`, `1234`, `4321`…) con un mensaje que
   diga por qué. Cambiarlo cierra las demás sesiones de esa persona salvo la actual (o se justifica en el `-done` por
   qué no).
2. **Olvidé mi PIN, la propietaria**: en el panel, ya autenticada con email y contraseña, elige uno nuevo **sin** el
   actual (la contraseña ya la ha identificado). Desaparece «Regenerar PIN» de Mi cuenta: lo sustituye «Elegir PIN».
3. **Olvidé mi PIN, el personal**: la propietaria (o el encargado, como hoy) le pone uno **provisional** desde Cajeros /
   Personal; en el siguiente login con ese PIN, el TPV **obliga a elegir uno propio** antes de entrar. Un PIN
   provisional no sirve más que para eso.
4. **Primer acceso**: el alta de cuenta y la invitación dejan de enviar/enseñar un PIN generado; la persona elige el
   suyo en su primer acceso (o en la propia pantalla de activación). Los correos de bienvenida e invitación dicen
   cómo hacerlo, y lo que dicen **es verdad**.
5. **Super-admin**: «Regenerar PIN» (vía «Configurar como OWNER») se queda solo como último recurso y deja el PIN
   **provisional** (punto 3), no definitivo.
6. El bloqueo por intentos (5 fallos → 15 min) sigue igual y también protege el «PIN actual» del punto 1.
7. Auditoría: cada cambio de PIN queda registrado (quién, a quién, provisional o propio), sin el PIN.

## Lo que NO entra

- Login sin PIN, biometría, PIN por terminal.
- El PIN de puerta de residencia.
- Cambiar el formato (4–8 cifras se queda).

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, cada test visto en rojo, fichero entero (no `-t`).
  Mínimo: cambiar el PIN exige el actual; un trivial se rechaza; el provisional obliga a elegir antes de entrar y no
  abre la caja; la propietaria autenticada con contraseña elige PIN sin el actual; el cajero no puede cambiar el PIN de
  otro; los correos no prometen nada que no exista; el bloqueo cuenta los fallos del «PIN actual».
- **Migración**, si hace falta un campo de «PIN provisional», con el comportamiento para los PIN que ya existen (siguen
  valiendo como propios: nadie se queda fuera tras desplegar).
- Capturas a 1280×800 (TPV) y del panel. Sin pasada en hierro aquí: la hacen Matías y Claude con la Lenovo.
- `docs/blocks/pin-1-done.md` con lo hecho, decisiones tomadas sin preguntar, sabotajes y **«Al desplegar»**
  (migración, APK nueva, qué pasa con los PIN actuales y con las tablets ya emparejadas).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue.
