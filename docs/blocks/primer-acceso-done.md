# Bloque primer-acceso · done

Rama `primer-acceso`, worktree `~/Developer/Claude/Projects/mipiacetpv-primer-acceso`, desde
`origin/master` = `80fb72e` (el prompt del bloque). Escrito el 23-10-2026, el día que se activó la
primera residencia real en producción.

**Toca el núcleo: vale para todas las cuentas.**

Lo que este bloque hace verdad, en una frase: **el día del alta, la persona del centro abre un
correo, pulsa un botón, elige su contraseña y ya está haciendo su trabajo.** Sin llamar a Mi Piace,
sin copiar nada y sin contraseñas que no ha elegido. Y para Mi Piace: **ninguna contraseña en claro
en pantallas, correos ni WhatsApp.**

**Medido en el producto de verdad** (§11): del correo al primer residente, **cinco pantallas y
ningún login**.

---

## 1 · Lo que había, y por qué no servía

Activar una cuenta mandaba al propietario una **contraseña provisional de 16 caracteres raros** que
tenía que copiar, y en el primer acceso se le obligaba a cambiarla: **dos contraseñas para entrar
una vez.** Y la provisional viajaba por tres sitios a la vez — el correo, la respuesta de la API y
la pantalla del super-admin.

Y había un agujero que no era de forma sino de fondo: si en vez de copiar la provisional usaba
**«¿Olvidaste tu contraseña?»**, el reset **no limpiaba `mustChangePassword`**. Elegía su
contraseña, entraba, y se le volvía a pedir otra. Para siempre, hasta que alguien tocara la base.

Después de entrar, nadie le guiaba. En una cuenta con la clínica encendida, la sección del contrato
de datos existe en el menú, pero si no la encontraba, **cada pantalla de residentes le contestaba con
un 423**. La directora de una residencia no tiene por qué saber qué es un contrato de encargado ni
dónde está.

---

## 2 · La invitación: un token como el del reset, de otro tipo

Decisión 1 del prompt, y es lo que decide la forma de todo lo demás.

`password_reset_tokens` gana una columna `type` con su enum (`RESET` | `INVITE`), con
`DEFAULT 'RESET'` — así la migración **no reescribe ni una fila** de las que hay vivas en
producción. El `INVITE` dura **7 días**; el reset sigue con **1 hora**, porque son dos urgencias
distintas: el reset lo pide quien está delante de la pantalla ahora mismo, y la invitación la abre
quien ese día tenía la inspección en el centro.

| Qué | Dónde |
| --- | ----- |
| Crear, buscar y contar invitaciones | `apps/api/src/auth/invitacion.ts` |
| Las tres rutas | `apps/api/src/auth/invitacion-routes.ts` |
| El correo y la marca por módulos | `apps/api/src/superadmin/invite-email.ts` |
| Los requisitos de la contraseña, puros | `packages/util-validation/src/contrasena.ts` |
| La migración | `20261023000000_primer_acceso_invitacion` |

**El `type` va en el `where`, nunca en un `if` detrás.** Es lo que hace que un token de reset no
valga como invitación ni al revés, y que no haya ninguna rama futura capaz de colarlo por descuido.
Los dos sabotajes cruzados de §10 lo prueban con un fake que **respeta el campo** — con uno que lo
ignorara, los dos habrían pasado en verde sin que el código cumpliera nada.

### Las tres rutas, y por qué las tres son POST

```
POST /auth/invitacion/consultar  → { nombre, email, centro }  |  410
POST /auth/invitacion/aceptar    → { accessToken, refreshToken } | 410 | 400
POST /auth/invitacion/reenviar   → respuesta neutra, siempre
```

El token viaja en el **cuerpo**. Con `GET /auth/invitacion?token=…`, Fastify habría dejado el token
completo en el log de acceso de producción sin que nadie lo escribiera, y «ningún token en los logs»
es una de las cosas que el bloque respeta. Hay un test que lee el stream de pino y lo comprueba.

**Aceptar deja la sesión iniciada**: devuelve el par access/refresh, como `/auth/login`. Volver a
pasar por el login después de elegir la contraseña era el paso que el bloque viene a quitar.

Dos detalles de orden que no son cosméticos:

1. **La contraseña se valida ANTES de tocar el token.** Al revés, una errata de tecleo habría quemado
   el enlace de un solo uso y Carmen se queda fuera con el correo ya gastado. Hay test.
2. **El `tokenVersion` se incrementa en la misma transacción que marca el token usado, y la sesión se
   firma con el valor nuevo.** Firmada antes, el refresh del primer minuto se rechazaría a sí mismo.

El único uso es un candado **del motor**, no de la aplicación: `updateMany … WHERE used_at IS NULL`
dentro de la transacción. El e2e lanza **dos aceptaciones en paralelo** con el mismo token y exige
`[200, 410]`.

---

## 3 · Activar ya no genera ninguna contraseña (decisión 2)

El OWNER nace con `passwordHash: null` —que `/auth/login` ya rechazaba con su 401 genérico— y con la
invitación pendiente, creada **dentro de la misma transacción**: si la activación se deshace, el
enlace se deshace con ella.

Y `mustChangePasswordAt` se queda a **`null`**. El estado «le falta entrar por primera vez» lo cuenta
la invitación viva, y tenerlo en dos sitios era lo que dejaba a un propietario con la contraseña
elegida y el aviso puesto.

Lo que vuelve una sola vez en la respuesta es **el enlace**, para el botón «Copiar enlace» del
super-admin cuando el correo no llega y hay que mandárselo por otro canal.

**El PIN de caja sigue exactamente como hoy** (decisión 7): se genera con caja, viaja en el correo y
en la respuesta, y `cashierPinIssued` lo dice. Fuera de este bloque.

---

## 4 · El reset limpia `mustChangePassword` (decisión 4)

Una línea, y arregla el caso de hoy aunque nadie use la invitación: quien eligió su contraseña con un
enlace ya la ha elegido él, así que no se le pide otra.

Va con `type: "RESET"` explícito en el `create` y en el `where` de los candidatos, por lo de §2.

---

## 5 · El correo, y la marca la decide una función (decisión 5)

`marcaDelCorreo({ residenciaEnabled, razonSocial, nombreDeLaCuenta })`. Hoy contesta una pregunta —
¿es una residencia? — y el día que la marca de la residencia exista (D-37) se cambia **en un sitio**.

- **Residencia**: «Hola Carmen, ya tienes acceso a la gestión de Jardín de Gredos, S.A.», firmado
  «El equipo de Mi Piace». Ni una vez la palabra «Mipiacetpv».
- **Comercio**: el de siempre, con Mipiacetpv.

Dentro: un botón grande **«Crear mi contraseña»**, y debajo en pequeño que el enlace vale 7 días
(con la fecha) y que desde la misma página puede pedir otro. **Ninguna contraseña.** Hay test de que
no aparece ni la frase «contraseña temporal».

La razón social sale de `fiscalProfile.legalName` y cae al nombre de la cuenta si no la hay.

---

## 6 · El super-admin, después de activar (decisión 3)

«**Invitación enviada a carmen@jardindegredos.es · caduca el 30/10**». Ninguna contraseña en
pantalla.

Y un panel permanente, **«Invitación del propietario»**, con **«Reenviar invitación»** y **«Copiar
enlace»**. Se pinta a sí mismo sólo mientras el propietario no haya elegido su contraseña: un botón
«Reenviar invitación» en una cuenta que lleva seis meses funcionando es un botón que le deja la
cuenta sin contraseña.

En la tabla de usuarios, tres estados donde antes había uno:

| Estado | Cuándo |
| ------ | ------ |
| **Invitación pendiente (caduca dd/mm)** | hay un `INVITE` vivo |
| **Invitación caducada · hay que reenviarla** | sin contraseña y sin enlace vivo |
| **Contraseña provisional sin cambiar** | un OWNER del flujo viejo |

`POST /super-admin/tenants/:id/reenviar-invitacion` anula la anterior, devuelve el enlace nuevo y
escribe su línea de auditoría **sin el token ni el enlace** — la auditoría del super-admin la lee
gente, y un enlace de un solo uso ahí dentro es una contraseña escrita en una pizarra. Hay test.

Se **niega con un 409** (`YA_TIENE_CONTRASENA`) si el propietario ya eligió la suya, y dice qué hacer
en su lugar. Ver §13.

---

## 7 · La página de bienvenida

`/bienvenida?token=…`, fuera de cualquier gate: quien llega no tiene sesión — **el enlace ES su
credencial**.

Su nombre y su email, **sin poder editarlos**. **UN solo campo** de contraseña con el botón de
mostrar. Los tres requisitos marcándose en vivo según escribe. Y «Entrar», que la deja dentro.

**Un campo y no dos.** Ni «repite la contraseña»: el segundo campo existe para cazar una errata que
no puedes ver, y aquí sí puedes verla —está el botón de mostrar—. Y si aun así se equivocara, el
camino de vuelta ya existe y no quema ningún enlace.

**El nombre se guarda.** `activate` escribe `ownerName` en `User.alias`; antes sólo viajaba al correo
y a la auditoría, y la pantalla tiene que poder decir «Hola Carmen» sin pedirle que se presente otra
vez.

**Los requisitos viven en el paquete**, no en la pantalla: `requisitosDeContrasena()` en
`@mipiacetpv/util-validation/contrasena`, que importan **el panel y el servidor**. Con una copia en
cada lado, el día que alguien suba el mínimo a 14 la pantalla pondría el tic verde a los 12 y el
botón devolvería un 400 que Carmen no sabe leer.

Son tres, y son los que caben en tres líneas que se leen sin pensar: **12 caracteres, alguna letra,
algún número**. `\p{L}` y no `[a-z]`: «añoenlaresidencia» es una contraseña razonable de una
directora española y rechazarla por la ñ sería una norma escrita para otro idioma.

### El enlace muerto tiene su propia cara

«**Este enlace ya no vale**», el campo del correo y «**Envíame uno nuevo**». Respuesta neutra, como
el reset: la pantalla dice lo mismo exista el correo o no, porque quien llega con un token caducado
podría ser cualquiera.

Y el reenvío público **sólo reenvía si la invitación sigue pendiente** — es OWNER y **no tiene
contraseña utilizable**. A quien ya eligió la suya no se le manda nada: un enlace que cambia la
contraseña a quien sabe tu email es una puerta de secuestro de cuenta.

---

## 8 · El contrato, antes que nada (punto 3, decisión 6)

`/auth/me` trae ahora `tenant.contratoClinico`, con el estado, si **falta** y si **esta persona**
puede aceptarlo. Y `RootRouter` lo mira **lo primero**, delante del desvío del MANAGER y del de los
módulos: con el contrato sin aceptar, ninguna de las dos pantallas de destino funciona.

El estado lo calcula `estadoDelContratoParaElPanel` → `estadoDelTenant` → **la misma función pura que
decide el 423**. Un `if` sobre versiones en la ruta de `/me` habría sido la segunda implementación
del estado que `packages/contrato-encargado/estado.ts` existe para evitar, y el síntoma habría sido
mandar a la dueña al contrato cuando el servidor ya la deja escribir, o al revés.

**No es un muro nuevo.** El 423 de `negativaClinica` se queda como está —es la garantía—; lo que
cambia es que la propietaria llega al contrato **antes de chocar con él**.

En una sesión de impersonación va `null`: clinica-7 decisión 24 dice que Mi Piace no abre nada
clínico, y mandar al super-admin a una pantalla que para él no existe habría roto «configurar» sobre
una clínica.

### La pantalla

Arriba, **tres líneas en lenguaje llano** —qué es, qué se compromete Mi Piace a hacer, y que lo puede
descargar en PDF cuando quiera—. Debajo, el texto completo **plegado** en un `<details>`: el
navegador ya sabe hacerlo, el teclado y el lector de pantalla lo entienden sin atributos añadidos, y
el texto sigue EN el documento, así que Ctrl+F lo encuentra y la impresión lo saca. Y «**Acepto**».

Al aceptar, **sigue sola a la pantalla de inicio**. Aceptar es lo que hace que la clínica funcione,
así que lo siguiente es trabajar, no quedarse mirando un «vigente» en verde.

Quien **no** es la propietaria aterriza en la misma pantalla y lee «Antes de empezar, la propietaria
del centro tiene que aceptar el contrato de datos… lo que sí puedes abrir está en la barra de la
izquierda». **Sin botones que no puede usar**, y lo decide el servidor (`puedeAceptar`), no el rol
del token.

### Y el 423, en cualquier pantalla, deja de ser un error rojo

Son unas veinte pantallas de clínica y residencia. Tocarlas una a una habría sido veinte sitios donde
olvidarse de una, y la olvidada sería precisamente la que la directora abra el primer día.

Así que vive en **`FieldError`**, que es el componente con el que todas pintan el mensaje del
servidor. Reconoce la negativa por **los dos mensajes canónicos exportados del paquete** —la misma
fuente que los manda, así que no hay dos cadenas que mantener— y pinta «**Falta aceptar el contrato
de datos**» en ámbar, con el botón **«Ir al contrato»** sólo para la propietaria.

---

## 9 · La residencia vacía, y el ingreso tras el ingreso

**El panel del primer día** (punto 4). `GET /residencia/panel` trae `centroVacio`, un `count` dentro
del mismo `Promise.all` que ya hacía siete consultas. Cuenta **todos** los perfiles, también los de
quien ya se fue: un centro del que se han ido los 48 no está empezando, y enseñarle «empieza dando de
alta a tus residentes» sería tratar un cierre como un alta.

Con el centro vacío, el panel es **UNA tarjeta**: «Empieza dando de alta a tus residentes» y el botón
**«Nuevo ingreso»**, que lleva a `/admin/residencia/residentes?alta=1` — el formulario **abierto**,
no la lista, que estaría vacía. Un toque menos.

Ni una lista de diez tareas de configuración (el edificio, los turnos, los controles, las
plantillas): ninguna de esas diez es lo que la directora vino a hacer, y la lista las pondría todas
al mismo nivel que la que importa.

**«Guardar y dar de alta otro»** (punto 5), debajo del primario y en contorno: el de arriba sigue
siendo «guardar y cerrar», que es lo que se pulsa un día normal; el de abajo es el del día del alta,
cuando entran los cuarenta y ocho. Guarda, recarga la lista por detrás, deja el formulario abierto y
en blanco, **lo dice** («Dolores queda registrado. Sigue con el siguiente») y **devuelve el cursor al
nombre** (§11).

Se limpia lo que es de la persona y se deja lo que es del ingreso: la fecha se queda —cuarenta y ocho
ingresos del mismo día llevan la misma fecha— y la cama se limpia y se vuelve a pedir, porque la que
estaba elegida acaba de ocuparla el anterior.

---

## 10 · La tabla de sabotajes

Los cinco del prompt, más cinco que salieron por el camino. **Todos verificados en rojo**: se rompe
la línea, el banco cae, se restaura.

| # | Sabotaje | Qué se pone rojo |
| - | -------- | ---------------- |
| 1 | Quitar `type: "INVITE"` del `where` de la invitación | `un token de RESET no vale como invitación` |
| 2 | Quitar `type: "RESET"` del `where` del reset | `una INVITACIÓN no vale como enlace de reset` |
| 3 | Que el reset no limpie `mustChangePassword` | `quien elige su contraseña con un enlace de reset no vuelve a cambiarla` |
| 4 | No marcar el token como usado | `el token vale UNA vez: el segundo intento es 410` |
| 5 | Loguear el token al aceptar | `ni el token ni la contraseña salen por los logs` |
| 6 | Quitar la redirección al contrato | 2 casos de `a dónde entra después de elegir la contraseña` |
| 7 | Devolver el panel de cinco secciones al centro vacío | `sin residentes es UNA tarjeta con «Nuevo ingreso»` |
| 8 | Que el 423 del contrato salga como error rojo | 2 casos de `el 423 del contrato no es un error rojo` |
| 9 | Dejar el nombre del anterior tras «Guardar y otro» | `guarda, se queda abierto y en blanco` |
| 10 | Devolver la banda del ensayo a una cuenta sin caja | `no se pinta en una cuenta sin caja, aunque esté en ensayo` |

Y los que no son una línea que se pueda romper, sino una forma:

- **Reutilizar un token usado**: el segundo intento es 410 y **la contraseña sigue siendo la
  primera** — el 410 no es cosmético.
- **Cambiar la hora para alargar uno caducado**: el sabotaje es intentar mandarla, y el punto es que
  **no hay ningún campo donde ponerla**. Fastify con `additionalProperties: false` no devuelve un
  400: **borra** los campos y sigue. El test manda `ahora` y `expiresAt` inventados y exige que la
  respuesta sea **byte a byte** la misma que sin mandar nada.
- **Pedir reenvío de un email que no existe**: `expect(noExiste.body).toBe(existe.body)`.
- **Buscar la contraseña o el token en los logs**: el banco monta Fastify con **un stream de pino
  capturado** y busca el token, la contraseña y el enlace en todo lo que la API escribiría.

---

## 11 · El bucle visual, y lo que encontró

`apps/e2e-ui/capturas-primer-acceso.ts`, contra el producto de verdad (API y panel en local, base
sembrada con `seed/primer-acceso-demo.ts`: Jardín de Gredos en DRAFT y un super-admin).

**El correo se fotografía de verdad**: `EMAIL_OUTBOX_FILE` hace que la API escriba cada envío como
una línea JSON, y la pasada abre el `html` de la última en una pestaña. Lo que sale en la captura es
el correo que Carmen recibe, no una maqueta de cómo nos lo imaginamos.

### Lo medido

| Qué | Cuánto |
| --- | ------ |
| Pantallas del correo al primer residente | **5**, y ninguna es un login |
| «Entrar» → el contrato | 424 ms |
| «Acepto» → el panel | 119 ms, y **sola** |
| El panel → el formulario de ingreso | **1 toque**, 169 ms |
| Campos en la bienvenida | **1** |
| «Nuevo ingreso» a 390 | 48 px de alto |

Las cinco son: el correo, la bienvenida, el contrato, el panel y el formulario de ingreso. El
objetivo del prompt era «correo → contraseña → contrato → Nuevo ingreso, sin ninguna pantalla más»:
el panel aparece en medio porque **aceptar el contrato aterriza ahí**, y es la pantalla donde está el
botón. No es un paso de más: es el inicio del producto, con una sola tarjeta y el botón encima del
pliegue.

### Cuatro cosas que ninguna suite veía

1. **El throttle dejaba fuera a la propietaria de su propia pantalla.** `consultar` y `aceptar`
   compartían el candado del *confirm* del reset: 10 por IP en 15 minutos, **entre los dos caminos**.
   Abrir el enlace ya cuesta una petición y elegir la contraseña otra; el panel en desarrollo monta
   los efectos dos veces (`StrictMode`), así que cada visita cuenta dos. El bucle se comió el cupo y
   la pantalla contestó **429 con catorce minutos de espera**. Ahora la invitación tiene **su propio
   bucket** (`invitacion:<ip>`, 20 en 15 min) y el reset no se lo gasta. Dos tests nuevos.
2. **La banda «Tu cuenta está en ensayo» abría la PRIMERA pantalla de la directora** con seis líneas
   sobre vender, cobrar, arquear, los tickets de prueba y Hacienda. Jardín de Gredos **no tiene
   caja**: no vende, no cobra y no emite una factura en su vida. Gate `caja === true`, el mismo y por
   la misma razón que el banner de Holded de al lado (H1). Ver §12.
3. **«Jardín de Gredos, S.A..»** en el correo: la razón social ya acaba en punto.
4. **Tras «Guardar y dar de alta otro», el modal se quedaba abajo**, junto a los dos botones, con el
   campo del nombre fuera de pantalla. Un scroll de vuelta por residente, y son cuarenta y ocho.
   Ahora el cursor vuelve al nombre, y `focus()` arrastra el scroll solo.

Y una que se mira y **se deja**: el logo de la pantalla de bienvenida dice «mipiacetpv» también en
una residencia. Decisión 5 habla del **correo**, y el panel entero lleva esa marca en todas sus
pantallas: cambiarlo aquí y no en las otras treinta sería peor. Entra con la marca de la residencia
(D-37). Queda en §15.

### Las capturas

`docs/qa/2026-10-23-primer-acceso/` — 22 PNG a **390** y en **escritorio**, más `medido.md`:

```
01-superadmin-tras-activar   02-correo                 03-bienvenida-vacia
04-bienvenida-requisitos     05-bienvenida-lista       06-enlace-caducado
07-enlace-caducado-reenviado 08-contrato               09-contrato-desplegado
10-panel-vacio               11-nuevo-ingreso          12-guardar-y-otro
```

---

## 12 · Decisiones tomadas sin preguntar

1. **El nombre del propietario se guarda en `User.alias`.** Hacía falta para saludar por el nombre en
   la bienvenida, y antes sólo vivía en el correo y en la auditoría. Es el campo que la casa ya usa
   como «nombre visible».
2. **`mustChangePasswordAt` se queda a `null` al activar.** El estado lo cuenta la invitación viva.
   Tenerlo en dos sitios era el origen del caso de hoy.
3. **El reenvío público no toca al que ya tiene contraseña.** Un enlace que la cambia a quien sabe tu
   email es una puerta de secuestro. El del super-admin sí, y por eso se niega con un 409 explícito
   en ese caso.
4. **Un solo campo de contraseña**, sin repetición. Ver §7.
5. **Doce caracteres, una letra y un número**, no ocho ni las ocho reglas de siempre. Longitud antes
   que ornamento, y es lo que ya pedía `/auth/change-password-initial`.
6. **El 423 se reconoce por el mensaje y no por el código HTTP**, porque es lo que llega hasta
   `FieldError`: las pantallas guardan `err.message` en un `useState<string>`. No es frágil — los dos
   textos son constantes exportadas del paquete que los manda.
7. **`SOLO_LECTURA` también manda al contrato**, no sólo `SIN_CONTRATO`: hay una versión nueva sin
   aceptar o está revocado, y en los dos casos lo siguiente que hay que hacer es mirarlo, no chocar
   con el 423 tres pantallas más adelante.
8. **`centroVacio` cuenta también a los que se fueron.** Ver §9.
9. **La banda del ensayo se gatea con `caja`** — y esto está **fuera del alcance declarado**. Se hace
   porque es la primera pantalla de la persona de este bloque, porque es una línea con el mismo gate
   y la misma razón que su vecina de H1, y porque dejarlo habría sido entregar el bloque sabiendo que
   la pantalla que viene a arreglar abre hablando de un producto que el cliente no ha comprado.
   Tiene su test y su sabotaje (nº 10).
10. **`transfer-owner` se queda como está**, con su contraseña provisional y `sendOwnerWelcomeEmail`.
    No está en el alcance y es el otro camino por el que todavía nace una provisional. Ver §15.

---

## 13 · Dudas abiertas

1. **El reenvío del super-admin a un propietario que ya entró.** Hoy se niega con 409 y le dice que
   use «¿Olvidaste tu contraseña?». Es lo prudente —reenviar le dejaría la cuenta sin contraseña
   hasta que abriera el correo— pero el implantador que quiere **forzar** un reseteo desde el panel
   no tiene botón. ¿Hace falta uno, con una confirmación que lo diga?
2. **El asunto del correo de una residencia** es «Ya tienes acceso a la gestión de tu centro», sin
   marca. Es neutro y verdadero, pero genérico. Cuando exista la marca (D-37) se decide.
3. **La página de bienvenida lleva el logo de mipiacetpv.** Ver §11.
4. **El PIN de caja sigue viajando en el correo** de los comercios con caja (decisión 7). Es la
   última credencial en claro que sale de la casa.
5. **Invitar al personal (usuarios que no son OWNER) con el mismo enlace.** Fuera de alcance
   declarado y **siguiente paso natural**: la maquinaria entera —token tipado, pantalla, reenvío
   neutro, requisitos compartidos— ya está y no distingue por rol; lo único que hay que decidir es
   quién puede invitar y qué ve el invitado al entrar.

---

## 14 · Lo que hay que hacer al desplegar

### 1 · La migración

`20261023000000_primer_acceso_invitacion`. Crea el enum `PasswordResetTokenType`, añade la columna
`type` con `DEFAULT 'RESET'` y un índice `(type, used_at)`.

**No reescribe ni una fila.** Todo lo que hay escrito es de reset y lo sigue diciendo. Un
`ALTER TABLE … ADD COLUMN … DEFAULT` con un valor constante en Postgres 11+ no reescribe la tabla, así
que no bloquea nada apreciable; la tabla tiene además un puñado de filas.

### 2 · Jardín de Gredos, activado el 23-10-2026 con el flujo viejo

Su OWNER tiene **contraseña provisional** y `must_change_password_at` puesto. En el super-admin
aparecerá como «**Contraseña provisional sin cambiar**», con el panel «Invitación del propietario» y
su botón.

**Qué hacer, un paso:** entrar en el detalle de la cuenta y pulsar **«Reenviar invitación»**.

Eso, en una transacción:

- pone `password_hash` a NULL (la provisional **deja de entrar por el login**),
- limpia `must_change_password_at`,
- incrementa `token_version` (las sesiones en vuelo caen),
- y crea la invitación de 7 días, mandando el correo.

Si el correo no llega, **«Copiar enlace»** queda en pantalla para pasárselo por otro canal. Hay un
caso del e2e que hace exactamente esto contra Postgres, incluido comprobar que la provisional ya no
entra por `/auth/login` y que el enlace nuevo sí.

**Antes de pulsarlo, avisar a la directora**: si ya había entrado y elegido su contraseña, el botón
se niega solo (409) — ésa es la red. Si todavía no, el botón es lo que hay que pulsar.

### 3 · Lo que NO hay que hacer

- Ninguna variable de entorno nueva. `PUBLIC_ADMIN_URL` ya existía y es de donde sale el enlace.
- Ningún backfill, ningún script, ningún `UPDATE` a mano.
- Los propietarios **ya activos no notan nada**: tienen contraseña, `mustChangePassword` a null y
  ninguna invitación viva, así que ni ven el panel nuevo ni cambia su login.

### 4 · Una comprobación de un minuto después de desplegar

Pedir «¿Olvidaste tu contraseña?» con un OWNER de pruebas, elegir contraseña y entrar: **no debe
pedir cambiarla otra vez**. Es la decisión 4 y es la que arregla el caso que había.

---

## 15 · Verde

| Qué | Resultado |
| --- | --------- |
| `tsc --noEmit` API | ✅ |
| `tsc` de los siete paquetes | ✅ |
| `tsc -b` admin y tpv-web | ✅ |
| `vite build` admin y tpv-web | ✅ |
| Suite unitaria | **6225 en 430 ficheros** ✅ |
| e2e contra Postgres real | **1096 en 49 ficheros** ✅ |
| Bucle visual | 22 capturas, 4 hallazgos arreglados ✅ |

La suite se corrió **desde la raíz** y **sin `.env`** en el árbol (este worktree no tiene el de la
raíz), que es lo que ve la CI.

Lo que el bloque añade de banco: **20** casos en `primer-acceso-invitacion.test.ts`, **6** en
`primer-acceso-reenviar.test.ts`, **18** en `primer-acceso.e2e.ts`, **18** en
`primer-acceso-pantallas.test.tsx`, **5** en `primer-acceso-ingreso-tras-ingreso.test.tsx` y **7** en
`packages/util-validation/test/contrasena.test.ts`.

Y tres bancos existentes puestos al día porque el comportamiento cambió a propósito:
`onboarding-v2.test.ts` y `h1-activacion-sin-caja.test.ts` (activar ya no devuelve contraseña) y el
fake de sus dos prismas, que ahora conoce la tabla de tokens.

---

## 16 · Commits

```
feat(primer-acceso): la invitación con enlace sustituye a la contraseña provisional
feat(primer-acceso): bienvenida, contrato primero y residencia vacía con «Nuevo ingreso»
test(primer-acceso): tabla y sabotajes de la invitación, la bienvenida y el panel vacío
test(primer-acceso): e2e del recorrido de Carmen contra Postgres
fix(primer-acceso): lo que encontró el bucle visual del día del alta
docs(primer-acceso): el done del bloque
```

---

## 17 · La rama

Rama `primer-acceso`, **pusheada**. **PR contra `master`** abierto. Ni merges ni despliegues desde
aquí: el merge lo hace quien lo mire, y el despliegue lo teclea Matías con §14 delante.
