# Bloque · Soporte: ver los cajeros de un tenant desde el superadmin

> **Hallazgo (validación del 2026-08-20).** El superadmin **no lista los cajeros de un tenant**. Cuando un
> cliente llama diciendo *"no puedo entrar"* —que es la llamada de soporte más frecuente que hay en un TPV—
> no hay forma de ver qué cajeros tiene dados de alta, con qué alias, ni si el que dice usar existe. Se
> resuelve entrando como OWNER al tenant, que es una sesión de escritura auditada de 30 minutos: **un
> martillo para colgar un cuadro.**
>
> Es un bloque pequeño y aburrido, y por eso lleva meses sin hacerse. También es el que se paga cada vez que
> suena el teléfono.

## Contexto (leer antes)

- `apps/api/src/superadmin/` — `hub.ts` (el listado de tenants que ya existe), `middleware.ts`,
  `audit.ts` (**todo lo que hace el superadmin se audita**; esto también), `rate-limit.ts`.
- `apps/api/src/cashiers/` y `apps/api/src/shift/cashier-auth.ts` — el modelo real de cajero: alias, PIN,
  rol, `isTestCashier`.
- Memoria: en el equipo hay una regla dura — **nadie teclea PINs ni contraseñas de un cliente**. Este bloque
  la respeta al pie: es de **lectura**.

## Alcance

### 1. La lista

En la ficha de tenant del superadmin, los cajeros de sus tiendas y cajas: alias, rol, si está activo, si es
el cajero técnico de pruebas, y **cuándo entró por última vez**. Ese último dato es el que contesta la
llamada: *"tu cajero María entró ayer a las 9:04"* cierra el caso en diez segundos.

### 2. Lo que NO se enseña, y se dice en pantalla

- **El PIN no se muestra, ni entero, ni parcial, ni su hash.** Ni en la API, ni en el JSON de la respuesta.
- Tampoco se resetea desde aquí. Si el cajero perdió el PIN, lo cambia el OWNER con su sesión, que es de
  quien es esa decisión.
- La pantalla lo dice con una frase, en vez de dejar al de soporte buscando el botón que no existe.

### 3. Auditoría y límite

Cada consulta se audita como el resto de acciones del superadmin (quién, qué tenant, cuándo) y pasa por el
rate-limit que ya existe. Ver la lista de cajeros de un cliente **es** un acceso a datos de un cliente.

## Entregable

- Endpoint de sólo lectura + su test (incluido uno que asegure que **el PIN no viaja en la respuesta** —
  ese test es el que más vale de todo el bloque).
- La pantalla en el admin.
- `docs/blocks/soporte-cajeros-superadmin-done.md`.
- **Criterio de "funciona"**: con Sirope delante, se ve en una pantalla quién puede entrar en esa caja y
  cuándo entró por última vez, **sin abrir una sesión de OWNER**.

## Bucle visual (obligatorio antes de cerrar)

Es admin de escritorio, así que basta con 1280 px y un ancho estrecho: la lista con datos reales de forma
(alias largos como `matias.oyola.san…`, un tenant sin cajeros, un cajero que no ha entrado nunca). Importes
no hay; fechas sí, y **las fechas se dicen enteras** — nada de "hace 3 días" sobre algo de julio, que ese
error ya lo hemos pagado dos veces.

## Fuera de alcance

- Crear, editar, desactivar o resetear cajeros desde el superadmin.
- Tocar el login del TPV, el modelo de PIN o los roles.
- Métricas, gráficas o "actividad del cajero". Es una lista.
