# Bloque primer-acceso · del correo de bienvenida al primer trabajo hecho, sin contraseñas raras

Rama `primer-acceso`, worktree `~/Developer/Claude/Projects/mipiacetpv-primer-acceso`, desde
`origin/master`. PR contra `master`. Escrito el 23-10-2026 desde el proyecto de Jardín de Gredos,
el día que se activó la primera residencia real en producción. **Toca el núcleo: vale para todas las
cuentas**, no sólo para la residencia.

Lee antes:
1. `apps/api/src/superadmin/welcome-email.ts`, la ruta `POST /super-admin/tenants/:id/activate` en
   `apps/api/src/superadmin/tenants.ts` y el modal de activar en
   `apps/admin/src/superadmin/TenantDetailPage.tsx`.
2. `apps/api/src/auth/password-reset.ts`, `auth/must-change-password.ts`,
   `apps/admin/src/pages/PasswordResetPages.tsx` y `ChangePasswordInitialPage` (en `App.tsx`).
3. `docs/blocks/clinica-7-done.md` (el contrato de encargado: `negativaClinica`, el 423 de las rutas
   de residencia y clínica sin contrato vigente, `ContratoTratamientoPage.tsx`).
4. `docs/blocks/B-SuperAdmin-done.md` y `docs/blocks/residencia-5-done.md` (el panel de dirección es
   la pantalla de inicio de una residencia).

## Por qué existe

Hoy, al activar una cuenta, el propietario recibe una **contraseña provisional de 16 caracteres raros**
que tiene que copiar, y en el primer acceso se le obliga a cambiarla. Son dos contraseñas para entrar
una vez. Y si en vez de eso usa «¿Olvidaste tu contraseña?», el reset **no limpia
`mustChangePassword`**: elige su contraseña, entra y se le vuelve a pedir otra.

Después de entrar no se le guía. En una cuenta con la clínica encendida, nadie le dice que lo primero
es aceptar el contrato de datos: la sección existe en el menú, pero si no la encuentra, cada pantalla
de residentes le contesta con un 423. La directora de una residencia no tiene por qué saber qué es un
contrato de encargado ni dónde está.

¿Y qué?: el día del alta, la persona del centro abre un correo, pulsa un botón, elige su contraseña y
ya está haciendo su trabajo (en una residencia, dando de alta a su primer residente). Sin llamar a Mi
Piace, sin copiar nada y sin contraseñas que no ha elegido. Y para Mi Piace: ninguna contraseña en
claro en pantallas, correos ni WhatsApp.

## El recorrido que tiene que salir (el caso de Carmen, propietaria de Jardín de Gredos)

1. **Correo**: «Hola Carmen, ya tienes acceso a la gestión de Jardín de Gredos, S.A.». Un botón
   grande, **«Crear mi contraseña»**. Debajo, en pequeño: «El enlace vale 7 días. Si caduca, desde la
   misma página puedes pedir otro». Ninguna contraseña en el correo.
2. **Página de bienvenida** (`/bienvenida?token=…`): su nombre y su email (sin poder editarlos), **un
   solo campo** «Elige tu contraseña» con el botón de mostrar, los requisitos marcándose en vivo
   según escribe y el botón «Entrar». Al pulsarlo **queda dentro**, sin pasar otra vez por el login.
3. **Si la cuenta tiene la clínica encendida y el contrato no está vigente, y ella es la propietaria**:
   la primera pantalla es el contrato. Arriba, tres líneas en lenguaje llano (qué es, qué se compromete
   Mi Piace a hacer y que lo puede descargar en PDF cuando quiera); el texto completo, plegado; y
   **«Acepto»**. Al aceptar, sigue sola a la pantalla de inicio. Si quien entra no es la propietaria:
   «Antes de empezar, la propietaria del centro tiene que aceptar el contrato de datos», sin botones
   que no puede usar.
4. **Inicio de una residencia sin residentes** (el panel de dirección): en lugar de «Todavía no hay
   ningún parte de relevo», **una sola tarjeta**: «Empieza dando de alta a tus residentes», con el
   botón **«Nuevo ingreso»**, que abre directamente el formulario. Nada de una lista de diez tareas de
   configuración.
5. **Nuevo ingreso**: al guardar, **«Guardar y dar de alta otro»** además de «Guardar». Cuarenta y
   ocho residentes no se cargan volviendo cada vez a la lista.
6. **Si el enlace ha caducado o ya se usó**: «Este enlace ya no vale» y el botón «Envíame uno nuevo»
   (que manda otro al mismo email si la invitación sigue pendiente; respuesta neutra, como el reset).

**Medido**: toques y pantallas desde que abre el correo hasta que guarda el primer residente.
Objetivo: correo → contraseña → contrato → «Nuevo ingreso», sin ninguna pantalla más. Va en el done.

## Decisiones de producto ya tomadas — no se re-debaten

1. **La invitación es un token, como el del reset, pero de otro tipo** (`INVITE`): de un solo uso,
   guardado con hash como `PasswordResetToken`, válido 7 días (el reset sigue con 1 hora). Se
   reutiliza la maquinaria del reset; no se inventa otro mecanismo.
2. **Activar cuenta no genera contraseña provisional.** El OWNER nace sin contraseña utilizable y con
   la invitación pendiente. Se quita `tempPassword` de la respuesta, del correo y del modal.
3. **Super-admin, después de activar**: «Invitación enviada a info@jardindegredos.com · caduca el
   30/10». Botones **«Reenviar invitación»** (anula la anterior y manda una nueva) y **«Copiar
   enlace»**, para cuando el correo no llega y hay que mandárselo por otro canal. En la tabla de
   usuarios, el estado «Invitación pendiente (caduca dd/mm)» en lugar de «Pendiente de cambiar
   password».
4. **El reset limpia `mustChangePassword`.** Si alguien eligió su contraseña con un enlace, ya la ha
   elegido él: no se le pide otra. Arregla el caso de hoy aunque no se use la invitación.
5. **El correo no dice «Mipiacetpv» en una cuenta de residencia.** La residencia se vende como
   producto propio (D-37) y su marca aún no existe: mientras tanto, texto neutro («ya tienes acceso a
   la gestión de <razón social>»), y una sola función que decida la marca del correo según los
   módulos del tenant, para que el día que exista la marca se cambie en un sitio. Los comercios siguen
   recibiendo el de Mipiacetpv.
6. **El contrato primero es una redirección y no un muro nuevo**: el 423 de `negativaClinica` se queda
   como está (es la garantía); lo que cambia es que la propietaria llega al contrato antes de chocar con
   él. Si cualquier pantalla de clínica o residencia recibe ese 423, en vez de un error enseña
   «Falta aceptar el contrato de datos» y, a la propietaria, el botón para ir.
7. **El PIN de caja** de los comercios con caja: fuera de este bloque. Se sigue mandando como hoy.

## Alcance

- API: tipo de token `INVITE`; activar sin contraseña; `POST /auth/invitacion/aceptar` (token +
  contraseña → sesión iniciada); `POST /auth/invitacion/reenviar` (neutra); reenviar y copiar enlace
  desde super-admin, con su línea de auditoría; el reset limpia `mustChangePassword`.
- Correo de bienvenida nuevo (texto y HTML) con la marca decidida por módulos.
- Admin: página de bienvenida, página de enlace caducado, redirección al contrato, la tarjeta de
  inicio de la residencia vacía, «Guardar y dar de alta otro» y el tratamiento del 423 de contrato.
- Super-admin: el modal y el detalle después de activar, y el estado de la invitación en la tabla.
- **Lo que hay en producción**: Jardín de Gredos se activó el 23-10-2026 con contraseña provisional y
  está «Pendiente de cambiar password». Al desplegar, «Reenviar invitación» tiene que servir también
  para un OWNER en ese estado (anula la provisional). Dilo en «qué hay que hacer al desplegar».

## Respeta

- Ninguna contraseña ni token en logs, ni en la auditoría.
- El rate limit del reset se aplica también al reenvío.
- Los propietarios ya activos no notan nada.
- Sistema visual y metodología de front de Mi Piace. Filtro «¿y qué?»: cada pantalla nueva tiene que
  quitar un paso; si no lo quita, sobra.

## Fuera de alcance (declarado)

Invitar al personal (usuarios que no son OWNER) con el mismo enlace: se anota como siguiente paso
natural, pero no entra. Marca comercial de la residencia. PIN de caja.

## Cómo se cierra

- Tests de tabla: activar no devuelve contraseña; el token vale una vez; caducado → 410 con su
  código; reenviar anula el anterior; aceptar la invitación deja la sesión iniciada y
  `mustChangePassword = false`; el reset limpia `mustChangePassword`; OWNER de clínica sin contrato →
  redirige al contrato; no OWNER → mensaje sin botón; tenant sin clínica → directo al inicio de
  siempre.
- **Sabotajes**: reutilizar un token usado · usar uno de reset como invitación y al revés · cambiar
  la hora para alargar uno caducado · pedir reenvío para un email que no existe (respuesta idéntica) ·
  buscar la contraseña o el token en los logs.
- e2e del recorrido completo de Carmen: correo (capturado) → bienvenida → contrato → panel vacío →
  «Nuevo ingreso» → «Guardar y dar de alta otro».
- Capturas del correo, la bienvenida, el enlace caducado, el contrato, el panel vacío y el super-admin
  después de activar, a 390 y en escritorio, en `docs/qa/`.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/primer-acceso-done.md` con la estructura de la metodología: qué se hizo punto a punto,
  decisiones tomadas sin preguntar, dudas abiertas y qué hay que hacer al desplegar. Dice si la rama
  está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
