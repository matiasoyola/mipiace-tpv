# hotfix-menu-capabilities · done — «Bonos» y «Contrato de datos» fuera de las cuentas que no los tienen, y Bonos deja de cargar para siempre

**Rama:** `hotfix-menu-capabilities`, desde `origin/master`. PR contra `master`. Sin merge y sin despliegue desde aquí.
**Encontrado en:** producción, cuenta de Jardín de Gredos (23-10-2026).
**Estado final:** `pnpm test` desde la raíz → **429 files passed, 6232 tests passed, 10 skipped, 0 failed**. `tsc -b` limpio en `admin`, `tsc --noEmit` limpio en `api` (tras `pnpm db:generate`). `vite build` de admin OK.
**Frontera:** `apps/admin/src/AdminShell.tsx`, `apps/admin/src/ui.tsx`, `apps/admin/src/pages/BonosPage.tsx` + los 15 sitios del barrido (lista abajo), dos ficheros de test nuevos. Ni migraciones, ni rutas nuevas, ni pantallas nuevas.

---

## 1 · El filtro del menú olvidaba dos capabilities

`visibleItems` evaluaba seis capabilities en una escalera de `if` y acababa en `return true`. Las dos
últimas que se habían añadido al tipo de `NavItem` caían por ese agujero: **«Bonos»** (`capability:
"bonos"`) se pintaba en todas las cuentas y **«Contrato de datos»** (`capability: "clinica"`) en todo
OWNER aunque su cuenta no tuviera la clínica.

Arreglo: la decisión se muda a `capabilidadActiva(capability, caps)`, un **`switch` exhaustivo** cuyo
`default` asigna el valor a un `never`. Las ocho capabilities tienen su rama y todas se leen
`=== true`, así que mientras `caps` es `null` no se pinta nada gateado (no parpadea). El `return true`
que queda en el filtro es sólo para las entradas **sin** capability (Resumen, Tiendas, Mi cuenta…).

**Y que no vuelva a pasar**, por dos caminos:

- **De tipos:** declarar una capability en `NavItem` sin darle su `case` no compila
  (`Type '"bonos"' is not assignable to type 'never'`). Lo caza `pnpm --filter @mipiacetpv/admin exec tsc -b`,
  que corre en el job `ci`. Comprobado quitando el `case` a mano.
- **De test:** `apps/admin/test/hotfix-menu-capabilities.test.tsx` **recorre `NAV_ITEMS` entero** —por
  eso la constante ahora se exporta— y, para cada capability, enciende sólo ésa y comprueba que se ven
  sus entradas y ninguna otra gateada. Eso caza además la rama cableada al flag equivocado, que el
  `never` no ve. Una capability nueva sin su línea en la tabla `ENCENDER` del banco también sale en rojo.

## 2 · «Cargando bonos…» para siempre

En una cuenta sin bonos la carga recibía la **404 del gate** (`ensureBonosEnabled`), el `catch`
guardaba el mensaje en `error`, y el aviso de «este negocio no tiene los bonos encendidos» sólo se
pintaba con `error === null`. Resultado: el aviso se saltaba y el `if (!ajustes)` de abajo devolvía el
cargador. Para siempre.

En `BonosPage`: la 404 se reconoce en el `catch` y pone `sinModulo` (estado propio, porque `caps` y el
servidor pueden discrepar y manda el servidor), el aviso se pinta por los dos caminos, y cualquier otro
fallo —500, red caída— se cuenta en vez de esconderse.

### El barrido: el mismo patrón en 15 sitios más

El patrón era «el `catch` guarda el error + justo debajo un `if (!datos) return <CenteredLoader/>` que
se adelanta al `<FieldError>` que lo pintaría». En vez de 15 arreglos distintos, **el error se decide
en un solo sitio**: `CenteredLoader` acepta `error` y, si lo hay, pinta el fallo y un «Reintentar»
(estas pantallas se pintan ANTES de la barra lateral: sin botón no hay salida que no sea el botón de
atrás). Quien ya pinta su propio aviso no pasa nada y se queda como estaba.

Sitios corregidos (`error={error}`):

| Pantalla | Fichero |
| --- | --- |
| Bonos | `pages/BonosPage.tsx` |
| Cajeros | `pages/CashiersPage.tsx` |
| Dispositivos | `pages/DevicesPage.tsx` |
| Impresoras | `pages/PrintersPage.tsx` |
| Sync Holded | `pages/HoldedPage.tsx` |
| Ajustes | `pages/SettingsPage.tsx` |
| Tiendas y ficha de tienda | `pages/StoresPage.tsx` (×2) |
| Etiquetas | `pages/TagAliasesPage.tsx` |
| Comanderas | `pages/TagSectionsPage.tsx` |
| Control horario · Empleados | `pages/fichaje/EmpleadosPage.tsx` |
| Residencia · Controles | `pages/residencia/ControlesPage.tsx` |
| Residencia · Edificio | `pages/residencia/EdificioPage.tsx` |
| Residencia · Plantillas | `pages/residencia/PlantillasPage.tsx` |
| Residencia · Residentes | `pages/residencia/ResidentesPage.tsx` |
| Residencia · Turnos | `pages/residencia/TurnosPage.tsx` |
| Revisión de SKU | `App.tsx` (`SkuReviewPage`) |

**Ya estaban bien** (se revisaron y no se tocan): Catálogo —con el comentario «el error y el cargador
son EXCLUYENTES. Lo encontró el bucle», o sea que esto ya había pasado una vez—, Declaración
responsable, Devoluciones al asesor, Contrato de tratamiento, Tickets regalo, Personal, Agenda ·
Horario, Agenda · Catálogo, y las de residencia Guardia, Incidencia, Incidencias, Indicadores,
Obligaciones, Panel, Plan de cuidados, Registro, Relevo, Relevos y Umbrales, más las dos de fichaje
(Hoy y Registro).

**Queda anotado, fuera del alcance de este hotfix** (es un patrón vecino, no el mismo: el cargador se
queda colgado pero **no hay error guardado** que enseñar, así que el arreglo es capturarlo primero):
`SyncSummaryPage` de onboarding (`.then(setData)` sin `catch`), `AccountPage` y `SecurityPage` (se
tragan todo lo que no sea un 401 de `/auth/me`). Las tres sólo se cuelgan si falla `/auth/me` o la
sincronización del onboarding, y tocar el onboarding en un hotfix cuesta más de lo que arregla.

## 3 · Esconder no es gatear: las rutas siguen dando 404

- **Bonos:** `apps/api/test/hotfix-menu-bonos-gate.test.ts` (nuevo) monta
  `registerVoucherAdminRoutes` **de verdad** y comprueba que las **seis** rutas del módulo contestan la
  404 de una ruta inexistente —cuerpo idéntico, carácter por carácter— con `bonosEnabled: false` y con
  la columna ausente; más el control de que con el módulo encendido contestan 200. Comprobado quitando
  `ensureBonosEnabled` de dos rutas: 3 tests en rojo.
- **Clínica (el contrato):** ya tenía su banco y sigue verde —
  `apps/api/test/clinica-7-contrato-rutas.test.ts`, «con el módulo APAGADO, la ruta del contrato NO
  EXISTE».
- **Observado, sin cambiar nada:** Fastify valida el esquema **antes** de los `preHandler`, así que un
  POST/PUT con cuerpo mal formado contesta 400 en vez de la 404 del gate. No distingue tenants (el 400
  es el mismo para todos y no dice nada de si esta cuenta tiene el módulo), así que no es la fuga que
  la 404 viene a tapar. El banco manda cuerpos válidos a propósito para medir la puerta y no el
  validador.

## Tests nuevos

- `apps/admin/test/hotfix-menu-capabilities.test.tsx` — 21 tests: el recorrido de `NAV_ITEMS` por
  capability, los dos fallos de Jardín de Gredos con su control, la residencia viendo el contrato, el
  «mientras `caps` es null no se pinta nada», `BonosPage` con 404 / con 500 / contestando bien, y el
  cargador compartido.
- `apps/api/test/hotfix-menu-bonos-gate.test.ts` — 8 tests: la puerta del módulo de bonos.

Sabotajes comprobados (los tres dejan el banco en rojo): `case "bonos"`/`case "clinica"` devolviendo
`true`; volver a poner `error === null` en el gate de `BonosPage` y quitarle el `error` al cargador;
quitar `ensureBonosEnabled` de las rutas de lectura.

## Al desplegar

**Nada especial: desplegar.** No hay migración, ni variable de entorno nueva, ni dato que rellenar. Es
front del panel (`apps/admin`) más un fichero de test de la API. Lo que cambia en cuanto entre el
build: en las cuentas sin bonos desaparece «Bonos» del menú, en las que no tienen clínica desaparece
«Contrato de datos», y ninguna pantalla del panel se queda girando cuando su carga falla.
