# declaracion-responsable · la declaración del SIF, visible dentro de mipiacetpv — DONE

**Rama:** `declaracion-responsable` (sale de `master` en 1ed5f46) · **Estado:** **en master desde el
02-10-2026** (merge `231db55`, PR #1, CI verde en `13f9933`), **desplegado el 02-10-2026** (`de4f915`).

mipiacetpv es un sistema informático de facturación (ADR-019, en producción desde el 27-09 con
2310f6e). El art. 15 de la Orden HAC/1177/2024 obliga al productor a que la declaración
responsable esté «disponible de manera legible e individualizada dentro del propio sistema
informático», accesible «de forma rápida, fácil e intuitiva», y a entregarla gratis en papel o
formato electrónico a clientes y distribuidores. No existía:
[`posicion-verifactu.md`](../legal/posicion-verifactu.md) §7 la tenía como pendiente.

---

## 0 · Lo primero: qué sigue pendiente

**El documento no está firmado.** El bloque lo produce, lo publica y lo mantiene sincronizado con
el código; la **firma** del productor es un acto de Matías y no de código. El ☑ de
`posicion-verifactu.md` §7 lo dice con esas palabras.

Y **la fecha del apartado 1.l) sólo aparece en imágenes construidas por CI.** Se hornea como
`APP_VERSION_DATE` (§3). En una build local sin el `--build-arg`, el documento dice «Fecha: no
disponible en esta build». Es deliberado y está en §3.

---

## 1 · Lo que hay ahora

Un solo origen para el texto, cuatro superficies que lo pintan:

```
packages/verifactu/src/productor.ts      ← las constantes que firman cada registro
            │
            ▼
packages/verifactu/src/declaracion.ts    ← buildDeclaracionResponsable()  (función pura)
            │
            ├── GET /legal/declaracion-responsable       (JSON, público)
            ├── GET /legal/declaracion-responsable.pdf   (A4, público)
            ├── /admin/declaracion-responsable           (pantalla del panel)
            ├── menú del cajero del TPV                  (abre el PDF)
            └── docs/legal/declaracion-responsable.md    (generado, con test)
```

Estructura y rótulos según los **ejemplos oficiales de la AEAT**
(`EjemplosDeclaracionResponsable(V0.5.1).pdf`): apartados `1.a)` … `1.l)` con el rótulo literal de
la Orden, y un `ANEXO` `2.a)` / `2.b)`. Los 13 puntos que pedía el bloque mapean uno a uno sobre
esa numeración, en el mismo orden.

---

## 2 · La regla de oro, y cómo se demuestra

Nada se teclea dos veces. Lo que también viaja dentro de cada registro de facturación sale de las
**mismas** constantes que lo firman:

| Apartado | De dónde sale |
|---|---|
| 1.a) nombre del sistema | `NOMBRE_SISTEMA_INFORMATICO` |
| 1.b) código identificador | `ID_SISTEMA_INFORMATICO` |
| 1.c) versión | `getAppVersion()` — la misma del campo `Version` de cada registro |
| 1.e) sólo VERI\*FACTU | `TIPO_USO_POSIBLE_SOLO_VERIFACTU`, formateado (`"S"` → `"S - Sí"`) |
| 1.f) varios obligados | `TIPO_USO_POSIBLE_MULTI_OT`, igual |
| 1.h) razón social | `PRODUCTOR_NOMBRE_RAZON` |
| 1.i) NIF | `PRODUCTOR_NIF` |

No es una promesa en un comentario: `packages/verifactu/test/declaracion.test.ts` **mockea
`productor.ts`** con otro NIF, otra razón social y los indicadores en `"N"`, y comprueba que la
declaración cambia con ellos. Tecleado a mano en la plantilla, ese test se pone rojo
(sabotajes 1–3 de §7).

Lo que **sí** vive en `declaracion.ts` es lo que el registro no lleva: dirección postal, lugar,
descripción de componentes y el texto de cumplimiento. No se metieron en `productor.ts` porque ese
fichero es el bloque `SistemaInformatico` del diseño de registro y nada más — el bloque además lo
pedía intacto, y lo está.

---

## 3 · La fecha del 1.l), que es la decisión menos obvia

El apartado pide la fecha en que el productor **suscribe** la declaración, y eso es la fecha de **la
versión**, no la de hoy. No existía nada parecido: la imagen sólo horneaba `GIT_SHA → APP_VERSION`.

Decisión de Matías (27-09): hornear la fecha del commit por el mismo camino.

```
ci.yml  git show -s --format=%cs HEAD
   → build-arg GIT_COMMIT_DATE
     → infra/Dockerfile  ARG → ENV APP_VERSION_DATE
       → getAppVersionDate()
```

**Sin fallback a `new Date()`**, y esto es lo importante: una declaración responsable cuya fecha
cambia cada vez que alguien abre el documento no es la declaración de ninguna versión. Si la env no
está, `getAppVersionDate()` devuelve `null` y el documento dice «no disponible en esta build», que
es la verdad en una build de desarrollo.

`infra/test/fecha-de-la-version.test.ts` guarda la cadena entera, incluido que el `ARG` esté **vacío
por defecto**: un default con fecha convertiría toda build local en una declaración fechada el día
que alguien escribió esa línea. Sin ese test, romper un eslabón no se ve — la declaración sale sin
fecha, en silencio y en producción.

La otra decisión de Matías: **la versión de producto de la APK** (1.c), segunda línea) se lee de
`releases.json` vía `latestRelease()`. Ese número no está en el repo (lo pone Gradle al construir) y
ya es público — `/apk/latest.json` lo sirve sin sesión. Sin índice, la línea sale sólo con el sha:
«media versión es peor que ninguna» (`apps/tpv-web/src/platform/AppInfo.ts`).

---

## 4 · Los endpoints, y por qué son públicos

`GET /legal/declaracion-responsable` y `…​.pdf`, **sin autenticación**. La Orden obliga a entregar el
documento gratuitamente a clientes y distribuidores: la URL **es** la entrega, y un `<a href>` no
puede llevar cabecera `Authorization` de todas formas.

Tres consecuencias que el banco de pruebas fija:

1. **No tocan la base de datos.** El fake de Prisma del test es un `Proxy` que **lanza** si alguien
   lo llama: el día que estas rutas necesiten una query, el test se pone rojo y hay que justificarlo.
2. **El cuerpo lleva la declaración y nada más.** Se comprueban las claves exactas del cuerpo, de la
   declaración y de cada apartado. En un endpoint público, un campo de más es una filtración
   esperando a pasar (fue uno de los dos sabotajes que salieron verdes, §7).
3. **`/legal` está exento del guard de tenants bloqueados.** El OWNER de una cuenta bloqueada abre la
   declaración desde su panel con su Bearer puesto; sin la exención recibiría un 423. Un impago es un
   asunto comercial y no puede esconder un documento legal. Se prueba con el guard montado de verdad
   y una ruta de control que **sí** devuelve 423.

El PDF va en `packages/ticket-pdf`, que ya tiene `pdf-lib`: A4 y Helvetica en vez de 80 mm y Courier,
porque esto se entrega en papel. **Ninguna librería nueva**, como pedía el bloque.

---

## 5 · Dónde se ve

**Panel** — pantalla `/admin/declaracion-responsable` que pinta los apartados tal como llegan, cada
uno con su clave (`1.f)`), más «Descargar PDF». Es una ventana, no una copia: no teclea ningún dato.

El enlace va en el **pie de la barra lateral** (escritorio y drawer móvil), no en `NAV_ITEMS`: allí
toda entrada pasa por el filtro de capabilities, y la declaración no depende de lo que el comercio
haya comprado. Segundo camino en **Ajustes**, fuera del bloque gateado por `cajaEnabled`.

El test recorre la matriz entera: OWNER y MANAGER × con Holded y sin Holded, más el comercio **sin
caja** (el colegio de Talavera, ADR-016). Y comprueba que **si el JSON falla, el botón del PDF sigue
ahí**: la entrega en formato electrónico es la obligación, no puede caerse por un fetch de más.

**TPV** — una línea en el menú del cajero que abre el mismo PDF. Un `<a>`, no un botón con estado:
sin handler async, sin spinner, nada que pueda quedarse a medias delante de un cliente esperando el
cobro. **No se tocó el flujo de venta.** La URL sale de un helper con base configurable porque en la
APK el origen del WebView es `mipiacetpv.com` y la API vive en `api.mipiacetpv.com` — con `/api` a
secas la línea abriría un 404 del frontend.

**Doc** — `docs/legal/declaracion-responsable.md` **se genera** (`pnpm docs:declaracion`) desde el
mismo builder. Sería la cuarta copia del texto y la primera en desincronizarse; el test lo vuelve a
generar y compara byte a byte. Lleva marcadores donde van la versión y la fecha: son del despliegue,
no del repo, y hornear un sha ahí haría mentir al fichero en cuanto se despliegue otra cosa.

---

## 6 · El bucle visual, que encontró un fallo de verdad

Capturas en [`declaracion-responsable-shots/`](declaracion-responsable-shots/): panel a **1280 × 800**
(AP12) y a **320**, el drawer a 320, el pie de la barra lateral, y el PDF en el visor.

**A 320 px el enlace no se alcanzaba.** Medido, no intuido:

```
antes   scrollHeight 848 · clientHeight 720 · overflow-y: visible · enlace en y=789 → visible: false
después scrollHeight 872 · clientHeight 720 · overflow-y: auto    · tras scroll y=637 → visible: true
```

El drawer tenía 848 px de contenido en una caja de 720 y el `overflow` era `visible`: el pie entero
—«Cerrar sesión en todos los dispositivos», el enlace a la declaración y la versión— quedaba fuera
de la pantalla **y sin scroll**. No es que costara llegar: no se llegaba.

Es un fallo **anterior al bloque** y afectaba igual al logout y a la versión. Se arregla aquí
(`overflow-y-auto` en las dos barras) porque sin eso «un clic desde cualquier pantalla» es falso en
una pantalla baja, que es justo donde el art. 15 pide llegar de forma rápida, fácil e intuitiva.
Queda un test de la clase, con el aviso de que la reachability de verdad la mide el bucle visual y no
jsdom.

---

## 7 · Tabla de sabotaje

Cada fila se aplicó de verdad sobre el árbol, se corrió la suite indicada y se revirtió.
**24 de 24 en rojo.**

| # | Sabotaje | Qué se pone rojo |
|---|---|---|
| 1 | Teclear el NIF a mano en la plantilla | `verifactu/declaracion` |
| 2 | Teclear la razón social a mano | `verifactu/declaracion` |
| 3 | Escribir `"S - Sí"` en 1.e) en vez de derivarlo del indicador | `verifactu/declaracion` |
| 4 | `TIPO_USO_POSIBLE_SOLO_VERIFACTU = "N"` sin tocar la declaración | `verifactu/productor`, `ticket-pdf` |
| 5 | Reescribir el 1.k) y dejarse el RD 1007/2023 | `verifactu/declaracion`, `ticket-pdf` |
| 6 | Quitar el apartado 1.g) | `verifactu/declaracion`, `ticket-pdf`, `api/legal` |
| 7 | Rellenar la fecha con la de hoy cuando no está horneada | `api/app-version` |
| 8 | Quitar el `ARG`/`ENV` de la fecha del Dockerfile | `infra/fecha-de-la-version` |
| 9 | Quitar el build-arg `GIT_COMMIT_DATE` de CI | `infra/fecha-de-la-version` |
| 10 | Hornear una fecha por defecto en el `ARG` | `infra/fecha-de-la-version` |
| 11 | Colar `tenantId` en la respuesta del endpoint | `api/legal` |
| 12 | Hacer que el endpoint consulte la base de datos | `api/legal` |
| 13 | Quitar `/legal` de los prefijos exentos del guard | `api/legal` |
| 14 | Marcar la caché del documento como `private` | `api/legal` |
| 15 | Que el PDF se trague el ANEXO | `ticket-pdf` |
| 16 | Perder el texto que no cabe en vez de saltar de página | `ticket-pdf` |
| 17 | Quitar el enlace del drawer móvil | `admin/panel` |
| 18 | Gatear el enlace del panel por la capability de Holded | `admin/panel` |
| 19 | Quitar la sección de Ajustes | `admin/panel` |
| 20 | Dejar la pantalla sin botón de PDF cuando el JSON falla | `admin/panel` |
| 21 | Quitar la línea del menú del cajero | `tpv-web` |
| 22 | Gatear la línea del TPV por Holded | `tpv-web` |
| 23 | Ignorar la base absoluta de la API en el TPV (rompe la APK) | `tpv-web` |
| 24 | Editar `declaracion-responsable.md` a mano | `verifactu/declaracion-doc` |

### 7.1 · Los dos que salieron verdes a la primera

La tabla se corrió antes de darla por buena, y **dos fallaron en abrir**. Eran fallos de los tests,
no del código, y se arreglaron (commit `19eefb8`):

- **#11.** `{ declaracion, tenantId }` pasaba porque el test miraba el texto de los apartados y no la
  **forma** del cuerpo. Ahora se fijan las claves exactas y se busca `tenantid` en el payload crudo.
- **#19.** El enlace de Ajustes no se comprobaba: `SettingsPage` se pinta **dentro** de `AdminShell`,
  que ya trae el del pie, y el selector los contaba juntos. Ahora se filtran los que no cuelgan de un
  `<aside>`.

Que la tabla encontrara dos huecos en su propio banco es el argumento para correrla de verdad y no
razonarla.

---

## 8 · Verificación

```
npx vitest run     →  264 ficheros · 2874 pasan · 3 saltados · 0 fallos
tsc -b (admin)     →  limpio
tsc -b (tpv-web)   →  limpio
```

Nota para quien monte el worktree: hay que correr `pnpm db:generate` antes de la suite, o 61
ficheros de `api` fallan con `Cannot find module '.prisma/client/default'`. No tiene que ver con el
bloque.

---

## 9 · Lo que NO se tocó

Cobro, registros fiscales, huella, cadena, Holded, sync, config de la APK
(`androidScheme`/`hostname` intactos). **Ninguna constante de `productor.ts` cambió** — sólo el
comentario de su test, que decía que la declaración vivía fuera del repo y ya no es verdad.

Fuera del alcance literal del bloque se tocaron tres cosas, todas declaradas arriba:
`infra/Dockerfile` y `.github/workflows/ci.yml` (§3, decisión de Matías) y el `overflow-y-auto` de
las barras del panel (§6).

---

## 10 · Commits

```
295a131  feat(declaracion): la declaración responsable del art. 15, desde productor.ts
dbdf227  chore(deploy): la imagen hornea la fecha de su versión
c488893  feat(admin): la declaración responsable, a un clic desde cualquier pantalla
49c9024  feat(tpv): la declaración responsable en el menú del cajero
00dab04  docs(legal): el texto de la declaración, generado, y el ☑ de posicion-verifactu
19eefb8  test(declaracion): cerrar los dos huecos que la tabla de sabotaje encontró
fd863d2  fix(admin): la barra lateral se desplaza, o su pie no se alcanza
```

---

## Addendum 02-10 · lo que costó poner verde la CI de la PR #1

Tres commits posteriores a este done:

- `741c7f3` guarda la declaración sin object streams, como el ticket. Es inocuo, pero **no era la causa** del rojo.
- `4596f3f` es el arreglo de verdad del «bad XRef entry»: pdf.js 1.10.100 (el de `pdf-parse`) lee mal un `Buffer` de menos de 4096 bytes, porque vive en el pool compartido de Node. El ticket pesa 3208 bytes y cae dentro; la declaración (7949) no. Los tres ficheros que usan `pdfParse` le pasan ahora un `Uint8Array` propio.
- `13f9933` corrige `f4-panel.e2e.ts`: sembraba un tramo a las 10:00 de hoy y fallaba si la suite corría antes de las 09:55 de Madrid. La trampa ya estaba en master.
