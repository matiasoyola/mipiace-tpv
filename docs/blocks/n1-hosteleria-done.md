# n1-hosteleria · que el N1 sirva para un bar — DONE (parcial: falta el hierro)

Rama `n1-hosteleria`, desde `master` (`a82843a`). Seis commits. **La pasada en
el hierro está pendiente** y es el criterio de cierre del bloque: ver §9.

---

## 0 · Lo primero, porque es la restricción del bloque

**Los terminales grandes no cambian ni un píxel**, y está medido en navegador
contra la stack del banco sembrada como Sirope:

| | AP11 1280×800 | D8 1442×811 |
|---|---|---|
| cabecera | 80 px, **0 filas de mano** | 80 px, **0 filas de mano** |
| lado de mesa | 136 | 152 |
| mesas a la vista | 23 / 23 | 23 / 23 |
| rejilla de familias | siempre | siempre |
| primer producto con familia | y=399, visible | y=399, visible |
| desborde horizontal | no | no |

Todo lo del bloque cuelga de **un único umbral** (`UMBRAL_MANO_PX`, §1.1) y cada
función que lo acepta lo hace **con el valor del terminal por defecto**, así que
un terminal no puede entrar en el camino de mano sin que alguien lo escriba a
mano. Dos bancos lo vigilan (§5) y uno de los sabotajes es exactamente «aplicar
el reparto de mano al AP11».

---

## 1 · Lo que hay ahora

### 1.1 El umbral, una sola vez

`lib/aparatoDeMano.ts` tiene el número y `hooks/useAparatoDeMano.ts` el hook.

```ts
export const UMBRAL_MANO_PX = 640;
export const MEDIA_MANO = `(max-width: ${UMBRAL_MANO_PX - 1}px)`;
export function esAparatoDeMano(ancho: number): boolean;
```

**640 y no un número propio**, por la misma razón que `n1-vertical` eligió 600 dp
para la orientación: es el `sm` de Tailwind, que es lo que las clases `sm:` de
estas pantallas ya usan para repartirse. Con un umbral propio —620, 480— la
decisión de JS y la del CSS contarían cosas distintas y habría un tramo de
anchos en el que la rejilla cree que es de mano y el `flex-wrap` cree que no. Y
cae holgado en el hueco que hay que separar: el N1 mide 360 y la tablet más
estrecha de la casa pasa de 1000.

Antes del bloque el número vivía **tres veces**: el `max-width: 639px` escrito
dos veces dentro del `useIsHandheld` privado de `SalePage.hospitality`, los
comentarios «< 640 px» de las constantes `*_HANDHELD`, y los `sm:` que el mapa
dejaba al CSS.

### 1.2 El reparto de la sala

`roomGrid.ts` gana `RepartoDeSala`: dos juegos de números —`REPARTO_TERMINAL`,
que toma sus valores de las constantes de siempre, y `REPARTO_MANO`— elegidos
con un booleano. Lo aceptan `roomAvailableWidthDark`, `roomAvailableHeightDark`,
`roomFitsWithoutScrollDark`, `tamanoDeMesaPara`, `zoneOuterWidth` y
`roomCanvasHeight`.

### 1.3 La cabecera del mapa, en dos filas

En el terminal sigue siendo UNA fila de 80 px. En la mano son **dos de 60**
(`MIN_TOUCH_PX` = 56 más 2 arriba y 2 abajo):

- **fila 1** · menú, «Sala» + contador, Tickets, cajero. El bloque del título es
  `flex-1 min-w-0` y trunca: es el único hijo que cede.
- **fila 2** · los chips de zona en **su propio desplazador horizontal**
  (`overflow-x-auto min-w-0`) y «Venta rápida» a la derecha.

### 1.4 La raíz pasa a `h-screen` en la mano

Con `min-h-screen`, si el contenido es más alto que la pantalla el contenedor
crece, el `flex-1` del `<main>` crece con él y su `overflow-y-auto` no tiene nada
que recortar: desplaza la PÁGINA y la cabecera se va. Con `h-screen` la altura
queda clavada y lo que desplaza es el lienzo.

Se elige en JS y **no** con `sm:` porque la regla `body.con-banda-ensayo
.h-screen` del `index.css` gana en especificidad a una utilidad `sm:`, y un
`sm:h-auto` habría clavado la altura también en el terminal.

### 1.5 La venta: quién tiene el sitio

`repartoDelCatalogo` (`lib/hospitalityGrid.ts`) decide, y sólo cambia en la mano:

1. **con texto en el buscador** no se pinta ni la rejilla ni la tira;
2. **con familia elegida** la rejilla se pliega a una **tira** (la familia con su
   color + «Cambiar» de 56 px), salvo que el camarero haya pedido verla.

### 1.6 La comanda en estrecho

En la mano la línea sin enviar se parte en **dos renglones**: el nombre arriba
con todo el ancho y debajo `−`, cantidad, `+`, importe y chips. Y la hoja de la
comanda se cierra al salir de la venta, por dos vías (derivado + efecto).

---

## 2 · Las decisiones que tomé sin preguntar

### 2.1 La mesa de mano mide 88, y el número no es de gusto

El suelo del terminal son 120 («por debajo se falla con el dedo»,
auditoria-sirope #13), medida pensada para 10–15" **vista desde el mostrador**.
El N1 va en la mano, a 30–40 cm, y 88 px siguen siendo el DOBLE del mínimo
táctil de la casa. Y es el número que hace falta para las tres por fila:

```
ancho útil a 360   = 360 − 2·16 = 328
dentro del marco   = 328 − 2·12 = 304
columnas           = ⌊(304 + 14) / (88 + 14)⌋ = 3
holgura de la fila = 304 − (3·88 + 2·14) = 12 px
```

Doce y no cinco porque `roomCanvasHeight` **reproduce** la regla de corte de
flexbox en vez de medirla, y v2-H1 dejó escrito que cinco píxeles caen dentro
del error de esa reproducción. Con 92 quedan 4; con 94 harían falta marcos de
zona de 8 px, y el marco lleva borde discontinuo y rótulo flotante.

### 2.2 Qué se va de la tarjeta pequeña: la meta

`principio-cobro-en-mesa` no deja elección —«el total visible en la tarjeta» y
«cobrar directo desde la tarjeta, sin entrar a la venta»—, así que el número de
mesa, el importe y el botón de cobro **se quedan**.

Lo que se va es la META: el «hace 12 min» / «cuenta» de debajo del importe. Y se
va porque es lo único que el lienzo ya dice sin palabras: el relleno distingue
libre / ocupada / pide la cuenta, y el aro discontinuo es «+45 min sin atender»,
que es el único umbral de tiempo que se actúa. El minuto exacto se consulta
abriendo la mesa, que es donde se decide algo con él.

### 2.3 El botón de cobro es de 56, no de 44

El bloque pedía 44. Se le da el suelo de la casa (`MIN_TOUCH_PX` = 56), que es
más, y que además es más que los 36 del terminal. La geometría sale de la
cuerda:

```
bottom 6 + alto 56  →  centro del botón a 34 del borde
offset del centro de la mesa = 44 − 34 = 10
cuerda a 10 = 2·√(44² − 10²) = 85,7  →  81 px útiles
«Cobrar 12,50 €» en una línea pide ~113  →  va en DOS renglones
el importe a 12 px pide 9·11,5·12/19 = 65,4 + 8 de relleno = 73,4 ≤ 81
```

A 14 px ya no entra, y con los márgenes del terminal (16 en el rectángulo)
tampoco. Los dos son sabotajes del banco. Y obliga a una cosa más: con el botón
ocupando de 26 a 82 de los 88, el nombre **no puede ir centrado**, así que en la
mano se ancla arriba cuando hay botón de cobro.

### 2.4 Las cifras de `principio-venta-bajo-estres` no se copian

Nombre de producto ≥ 23 px, filas ≥ 64, total ≥ 44: medidas para 10–15" vistas
desde el mostrador. A 360 y a 30–40 cm se mantiene el **espíritu** —nada de
paginación, se lee de un vistazo, objetivo táctil ≥ 44 (aquí 56), el total es lo
más grande de la pantalla— y los números de mano se fijan aquí, junto a las
constantes `*_HANDHELD`, cada uno con su cuenta.

### 2.5 `deMano` se hila, no se deduce

La línea de comanda recibe `deMano` explícito y **no** lo deduce de `inSheet`:
la hoja es la PRESENTACIÓN de la comanda en la mano, y mezclarlas haría que el
día que la hoja se use en otro sitio el reparto de la línea cambiara sin que
nadie lo pidiera.

### 2.6 Lo que NO toqué

El rótulo de familia y el «Más» (§3.1), el cambio a devolver, las fechas en la
hora de la tienda, los objetivos de 32–36 px sueltos, los filtros de Tickets, el
«Reenviar por email» en PRUEBA, el aviso de devolución en ensayo, la impresora
IPOS y el «process is bad» del WebView.

---

## 3 · Cuatro premisas del prompt que ya no eran ciertas

El bloque se escribió contra la pasada del 18-10, y entre medias entró
`auditoria-sirope`. Las cuatro, con lo que había de verdad:

### 3.1 «No toques el rótulo de familia: ya lo arregló `n1-vertical`»

Lo arregló **auditoria-sirope (#6)**, y mejor: dos renglones con peldaño de letra
—el nombre entero— en vez del `truncate` de `n1-vertical` (una línea con puntos
suspensivos). Se vio al mergear `master` dentro del PR #35, que chocaba justo
ahí. Ganó el de auditoria-sirope, también porque `truncate` lleva dentro
`white-space: nowrap` y habría anulado el `line-clamp: 2` del rótulo. **En este
bloque tampoco se toca.**

### 3.2 «Tres por fila» no pedía tocar `roomColumnsFor`

auditoria-sirope (#13) ya había hecho **dinámico** el lado de mesa: el mayor
múltiplo de 4 entre 120 y 200 que quepa sin desplazar. La pasada midió 144 y una
mesa por fila porque fue anterior a #13; hoy a 360 salían 120 y **dos** por fila.
Así que lo que hacía falta era un **suelo** de mano, no otra aritmética.

### 3.3 El hallazgo 3 estaba hecho a medias, y al revés de lo que parecía

auditoria-sirope (#8) ya puso el nombre a dos líneas en la línea sin enviar y en
la enviada con `−`/`+`. Quedaba la enviada **sin** `−`/`+` (destino impresora o
sin pantalla), que seguía con `truncate`.

Y el navegador encontró lo que la pasada no vio: **la línea SIN ENVIAR estaba
rota a 360**. #8 la dejó en UNA fila dimensionada para los ~356 px de la COLUMNA
del D8; en el N1 la comanda es una hoja de 360 y esa misma fila lleva además los
`−`/`+` de 56, así que al nombre le quedaban **76 px** y el `line-clamp: 2` lo
cortaba de verdad («Café con leche» pedía 81 px de alto en una caja de 53). La
pasada midió la línea ENVIADA, que sí estaba bien.

### 3.4 El hallazgo 9 no existe como lo describe el prompt

El bloque supone que la fila de «⚡ Urgente / ⚠ Alergias» **tapa** el «Espera» de
la última línea y pide «que la lista reserve por abajo lo que mide esa fila».
Leyendo el código no hay mecanismo de solape —la fila es hermana POSTERIOR de la
lista en una columna flex, la hoja es `max-h-[88dvh]` con `overflow-hidden`, y
los chips son flex normales sin posición absoluta— y medido en navegador con seis
líneas, con la lista desplazada al final:

```
lista          top 154 … bottom 476
última línea   top 371 … bottom 472      entera: true
«Espera»       top 432 … bottom 472      elementFromPoint → EL PROPIO ESPERA
```

**No se añade la reserva**: arreglaría algo que no pasa y costaría una línea de
comanda visible. Lo que la pasada midió fue, casi con seguridad, una línea
recortada fuera del desplazador —no cubierta—, y el `elementFromPoint` aterrizó
en lo que había pintado en esas coordenadas.

**Consecuencia para la tabla de sabotajes:** la fila «La lista de la comanda sin
la reserva inferior» **no se puede ejecutar**, porque no hay reserva que quitar.

---

## 4 · Los tests

### 4.1 Los nuevos

- `test/n1-sala-de-mano.test.ts` (22) · el umbral, las tres por fila, el importe
  de la mesa pequeña, el botón de cobro y la restricción del terminal.
- `test/n1-catalogo-de-mano.test.ts` (10) · buscando → sin familias, familia
  elegida → plegada, la hoja de la comanda al salir, y las ocho combinaciones del
  terminal.

Y `test/sala-sirope.test.ts` corrige su dato: Sirope son **23** mesas (8/7/8),
contadas en producción, no las 13 que tenía. Sus conclusiones no cambian: con 23
el D8 sigue eligiendo lado 152.

### 4.2 Lo que estos bancos NO pueden hacer

jsdom no aplica hojas de estilo ni evalúa media queries: ahí no se mide si algo
cae dentro de la pantalla. Lo que fijan es **qué se decide** —qué se monta, con
qué números, en qué orden—. La medida de verdad está en §6.

Por eso tres de las piezas de este bloque son **funciones puras** y no lógica
dentro del componente: `repartoDeSala`, `repartoDelCatalogo` y
`hojaDeComandaVisible`. Y por eso el criterio «al menos 9 mesas a la vista» se
escribió como aritmética (`mesasALaVistaDeMano`) en vez de dejarlo sólo al
navegador.

### 4.3 En verde

132 ficheros / **1709 tests** de `tpv-web`. `tsc -b` y `build` limpios (los pasos
que corre el CI; no hay lint).

**Rojo previo, no de este bloque:** `packages/verifactu` falla el `tsc` por un
`rootDir` que no cubre `scripts/generar-declaracion-responsable.ts`. Falla igual
en `master`. Apuntado, no arreglado aquí.

---

## 5 · Tabla de sabotaje

| Sabotaje | Qué cae | El rojo real |
|---|---|---|
| La mesa de mano vuelve a 144 | columnas a 360 ≠ 3 | `expected 2 to be 3`, y la holgura se va a `−156` |
| La mesa de mano vuelve a 144 | mesas a la vista < 9 | `expected 14 to be less than 9` sobre el criterio |
| El reparto de mano se aplica a 1280 | el banco del AP11 **y** `sala-sirope` | `expected 144 to be greater than 144` |
| El importe del botón de cobro a 14 px | no entra en la cuerda | `expected 76.3… to be greater than 81` |
| Con texto en el buscador se pintan las familias | el banco de búsqueda | `expected { rejilla: true, tira: false } to deeply equal { rejilla: false, tira: false }` |
| Con familia elegida no se pliega la rejilla | el banco de familia elegida | `expected { rejilla: true, tira: false } to deeply equal { rejilla: false, tira: true }` |
| La hoja de la comanda no se cierra al ir a Tickets | el banco de navegación | `expected true to be false` |
| La lista de la comanda sin la reserva inferior | — | **no se puede ejecutar**: no hay reserva. Ver §3.4 |

---

## 6 · La medida en navegador

Contra la **stack del banco** (API + Postgres + la PWA de verdad), sembrada como
Sirope con `apps/e2e-ui/seed/sirope-demo.ts`: 23 mesas (BARRA 8 · SALÓN 7 ·
TERRAZA 8) y 13 familias con los nombres reales, los dos conteos sacados de
producción con SELECT de sólo lectura. Capturas y números en
`docs/blocks/n1-hosteleria-shots/` (`medidas.json`, `medidas-comanda.json`).

### 6.1 El mapa

| | pasada 18-10 | N1 360×720 | AP11 1280×800 | D8 1442×811 |
|---|---|---|---|---|
| `innerWidth` | **845** | **360** | 1280 | 1442 |
| `clientWidth` / `scrollWidth` | 360 / 845 | 360 / 360 | 1280 / 1280 | 1442 / 1442 |
| fuera de pantalla | 485 px | **0** | 0 | 0 |
| alto total | 4.020 px | 720 | 803 | 851 |
| lado de mesa | 144 | **88** | 136 | 152 |
| mesas a la vista | **3** / 23 | **14** / 23 | 23 / 23 | 23 / 23 |
| cabecera | 1 fila | **120, 2 filas** | 80, 1 fila | 80, 1 fila |

### 6.2 Los chips de zona

| | chip «Terraza» | dentro | ¿se movió la página? | `elementFromPoint` |
|---|---|---|---|---|
| pasada 18-10 | right **512** | **no** | no desplaza | — |
| N1 | 120 … 207 | sí | **no** | **el propio chip** |
| AP11 | 810 … 911 | sí | no | el propio chip |
| D8 | 972 … 1073 | sí | no | el propio chip |

Con el chip de una zona, **Terraza entera**: 8 / 8 a la vista en los tres anchos.

### 6.3 La venta

| | rejilla | tira | primer producto | visibles |
|---|---|---|---|---|
| pasada · buscando «tost» (360×449) | sí, 6 azulejos | — | y=**592**, fuera | **0** |
| **N1 buscando (360×449)** | **no** | no | **y=343, visible** | 2 / 20 |
| pasada · familia elegida | sí | — | y=**833**, fuera | 0 |
| **N1 familia elegida** | **no** | **sí** | **y=413, visible** | 4 / 12 |
| AP11 familia elegida | sí | no | y=399, visible | 12 / 12 |
| D8 familia elegida | sí | no | y=399, visible | 12 / 12 |

**Lo que no llega:** el bloque pedía el primer resultado entero «y, si es
posible, tres». Salen **dos**. Y al entrar en una mesa, en la vista «Ahora» el
primer producto queda en y=769, fuera: las 13 familias a tres columnas son cinco
filas de 76 px. Es el reparto que pide `principio-venta-bajo-estres` («familia
primero, producto después»), así que se deja, pero queda anotado.

### 6.4 La comanda

| | caja del nombre | texto | ¿cabe? |
|---|---|---|---|
| pasada · «Café Americano» | 71 px visibles | 178 | **no** |
| pasada · «Café Solo» | 64 px visibles | 104 | **no** |
| **N1, línea sin enviar (antes del arreglo)** | **76** | 121 | **no** |
| **N1, línea sin enviar (ahora)** | **336** | 336 | **sí** |
| N1, línea enviada | 217 | 217 | sí |

«Espera» de la última con seis líneas: **el propio «Espera»** en los tres anchos.

### 6.5 Cómo se rehace

```bash
# 1 · Redis propio del worktree (la API de dev se come los jobs de al lado)
docker run -d --name mipiacetpv-n1host-redis -p 6380:6379 redis:7-alpine

# 2 · la stack, con base propia
DATABASE_URL="postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_n1_hosteleria_e2e?schema=public" \
BANCO_API_PORT=3108 BANCO_ADMIN_PORT=5279 BANCO_TPV_PORT=5280 \
  pnpm --filter @mipiacetpv/e2e-ui run stack

# 3 · y encima, Sirope (el stack siembra peluquería; esto la sustituye)
DATABASE_URL="…mipiacetpv_n1_hosteleria_e2e…" \
  ./apps/e2e-ui/node_modules/.bin/tsx apps/e2e-ui/seed/sirope-demo.ts

# 4 · API y TPV
(cd apps/api && DATABASE_URL="…" REDIS_URL="redis://localhost:6380" PORT=3108 \
   CORS_ORIGINS="http://localhost:5280,http://127.0.0.1:5280" pnpm dev)
MIPIACETPV_API_PROXY=http://127.0.0.1:3108 MIPIACETPV_DEV_PORT=5280 \
  pnpm --filter @mipiacetpv/tpv-web dev
```

Cuatro cosas que costaron un rato y no están en ninguna otra parte:

- **`apps/api/.env` del árbol principal son 69 bytes** (tres variables), no el
  completo. El bueno está en el worktree de `n1-vertical`, con 17. Sin él, el
  arranque muere en un ZodError que no dice cuál falta.
- **`CORS_ORIGINS` del `.env` lleva 5277/5278**, los puertos de `n1-vertical`. Con
  otro puerto el TPV pinta «Ha ocurrido un error inesperado» en el PIN, y el
  error de verdad —`CORS bloqueado: http://localhost:5280`— sólo está en el log
  de la API.
- **El acceso tiene DOS caminos**: la primera vez hay campo de email; en cuanto un
  cajero ha entrado, la pantalla ofrece «CAJEROS RECIENTES» y el campo
  desaparece. Y `pin-continuar` es `md:hidden`: existe sólo por debajo de 768.
- **Los procesos en segundo plano del shell mueren con el shell.** La API hay que
  lanzarla con el gestor de tareas, no con `nohup … &`; macOS no tiene `setsid`.

---

## 7 · Lo que queda pendiente, con su captura

### 7.1 En «Ahora» el primer producto queda bajo el pliegue (N1)

y=769 con ventana de 720. Captura `04-venta-entrada-n1-360x720.png`. No es un
hallazgo del bloque —es el reparto «familia primero»— pero si en el hierro
molesta, el arreglo natural es que «Ahora» también se pliegue tras el primer
toque.

### 7.2 Dos resultados a la vista buscando, no tres

Captura `22-venta-buscando-teclado-360x449.png`.

### 7.3 La pasada en el hierro — §9

---

## 8 · La APK

Construida y firmada. **Sin publicar**: mientras el «process is bad» del N1 siga
abierto, la publicación la decide Matías.

```
fichero   apps/tpv-android/build-releases/mipiacetpv-1.28.1-12801.apk
versión   1.28.1 (versionCode 12801)
commit    0bb7d9f
tamaño    8.741.101 bytes
SHA-256   e659e67a7bfdd9e9bc875100ae1ff60eb4a910169a66ca8e6e1edc4c1642c33f
```

La **1.28.1** es la que lleva el arreglo que encontró la pasada del 23-10 (la
fila de cantidad cede con el buscador, §9.2). La **1.28.0** —`d893ec4`, SHA-256
`5dbff9bf…`— es la que se midió ese día y sigue en `build-releases/`; la que
estaba instalada en el N1 era byte a byte ésa, así que no hizo falta
reinstalarla para medir.

Los cuatro chequeos del guion, en verde: `VITE_API_URL` apunta a
`https://api.mipiacetpv.com` (hallazgo A2), **sin Service Worker** en los assets
del proyecto nativo (A4), origen del WebView correcto (R5) y APK firmada
(`Signer #1 … SHA-1 1256a71e…`).

Dos cosas del worktree que no viajan y hacen falta para repetir la build:
`apps/tpv-android/android/keystore.properties` (se copia del árbol principal;
está en `.gitignore`, así que el árbol sigue limpio) y el `.jks` al que apunta,
en `~/keys/mipiacetpv-release.jks`.

Instalar por cable:

```bash
adb install -r apps/tpv-android/build-releases/mipiacetpv-1.28.0-12800.apk
```

---

## 9 · La pasada en el hierro — EMPEZADA, con un hallazgo que la corta

**23-10-2026**, N1 (Android 14, WebView **155**, 720×1440 a densidad 320 →
360×720 CSS) contra **producción con Cafetería Sirope en ensayo**, APK 1.28.0
(12800) — la instalada ya era byte a byte la construida aquí
(`5dbff9bf…`), así que no hizo falta reinstalar. adb inalámbrico; los toques
son `input tap` sobre las coordenadas que da el CDP (**el driver táctil, no el
espejo**) y las capturas son `screencap`.

### 9.1 · El 🔴 del mapa, cerrado en hierro

| | pasada 18-10 | 23-10 en el N1 |
|---|---|---|
| `innerWidth` del mapa | **845** | **360** |
| `clientWidth` / `scrollWidth` | 360 / 845 → 485 px fuera | **360 / 360 → 0 fuera** |
| desborde horizontal | sí | **no** |
| alto de la página | **4.020** | **720** = `clientHeight` |
| cabecera | 1 fila | **120 px, 2 filas** |
| lado de mesa | 144 | **88** |
| chip «Terraza» | right 512, **inalcanzable** | dentro, y con el filtro puesto **8/8 mesas a la vista** |
| chips | sin contenedor que desplace | desplazador propio, `scrollWidth 334 > clientWidth 191` |

Capturas `00-estado-al-empezar`, `01-mapa-terraza`, `04-tras-back`. Tres mesas
por fila, marcos de zona y mostrador compacto, tal como se diseñó.

### 9.2 · 🟡 HALLAZGO · con el teclado abierto el primer resultado SIGUE fuera

El criterio del §2 —«con "tost" y el teclado abierto (360×449) el primer
resultado se ve entero por encima del teclado»— **falla en el aparato**, y en el
banco no se veía porque el tenant del banco no está en ensayo y no paga la banda.

Medido con «tost» tecleado y el teclado abierto (`innerHeight` 449):

```
cabecera de comanda   112 … 180   (68)
buscador              194 … 250   (56)
fila de cantidad      291 … 411   (120)   ← NO cede
primer resultado      425 … 493           ← fuera de 449
```

La rejilla de familias **sí** cede: con texto en el buscador no se pinta, que es
lo que este bloque arregló. Lo que no cede es la **fila de cantidad 1–6**, que en
estrecho mide 120 px porque `n1-vertical` la repartió en 3×2 (seis teclas de 56
en una fila piden 376 y a 360 no caben).

El §2 pide que «los resultados van **justo debajo del buscador**», y con esos
120 px en medio no lo están. La cuenta del arreglo, medida en el propio aparato:

```
ahorro si la fila de cantidad cede   134 px (120 + su hueco)
primer resultado pasaría a           291 … 359   → DENTRO de 449
y caben DOS
```

Sin teclado el caso ya está bien: 28 resultados, el primero en 425 … 493
**visible**, y **6 a la vista**.

**Decisión propuesta:** que `repartoDelCatalogo` decida también la fila de
cantidad, y que en la mano **no se pinte mientras hay texto en el buscador**. La
cantidad no se pierde: se corrige sobre la propia línea con los `−`/`+` de 56 px,
que es lo que `principio-venta-bajo-estres` (regla 6) ya manda.

Captura `03-buscando-teclado-tost`.

### 9.2-bis · Una SEGUNDA sesión de Code en el mismo worktree

Mientras se medía, una segunda sesión de Claude Code abierta por error con este
mismo encargo (PID 21932, arrancada 23-10 a las 11:38, prompt «Retomas el bloque
n1-hosteleria… con último commit ed6c12f») estaba **conduciendo el mismo N1 y
escribiendo en esta misma carpeta**. Es la causa de que la pantalla cambiara
entre medidas: mesa B2 → mapa → filtro Terraza → mesa T1 → búsqueda, sin que
nadie de esta sesión tocara nada.

Dejó **19 capturas** (`01-arranque-n1` … `19-reintento`), diez de ellas
commiteadas por error en `b61996c`. **Se retiran todas**: no se sabe con qué
criterio se tomaron ni qué estado tenía el aparato en cada una, y mezcladas con
las de esta pasada no se puede decir cuál enseña qué. Las seis que se quedan son
las de esta sesión (`00-estado-al-empezar`, `01-mapa-terraza`,
`02-venta-familia-plegada`, `03-buscando-teclado`, `03-buscando-teclado-tost`,
`04-tras-back`).

Y dejó estado en Sirope-ensayo, consultado en producción con SELECT de sólo
lectura:

| estado | mesa | total | hora |
|---|---|---|---|
| VOIDED | B2 | 0,00 € | 11:41:23 |
| VOIDED | T1 | 0,00 € | 11:42:41 |
| **DRAFT** | **T1** | **9,00 €** | **11:46:53** |

**Ningún ticket cobrado, así que ningún `TEST` que borrar.** Lo que queda es la
mesa T1 abierta con 9,00 € y una comanda de cocina (nº 1, sección BARRA, mesa
T1, enviada 11:54:35) con `lan_received_at` **nulo**: el AP11 nunca la recibió.
Las dos cosas se van con «Resetear ensayo».

**Lección, y vale para cualquier bloque con hierro:** dos sesiones en el mismo
worktree no sólo se pisan los ficheros — se pisan **el aparato**. Antes de una
pasada por adb, comprobar que no hay otra sesión viva
(`ps aux | grep -i claude` y el `cwd` de cada pid con `lsof`).

### 9.2-ter · El envío a cocina no llegó

La comanda nº 1 salió del N1 pero el AP11 no la recibió: el TPV lo dijo en
pantalla —«La comanda no llegó a imprimirse · Cocina no recibe ni por internet
ni por la wifi, y el papel tampoco salió»— y la base lo confirma
(`lan_received_at` nulo).

No es de este bloque —no se ha tocado nada del envío— pero **bloquea el paso del
§9 que pide ver la comanda llegar al AP11**. Para cerrar la pasada hace falta el
KDS del AP11 levantado y vinculado.

### 9.3 · Lo que queda de la pasada

Sin hacer todavía: 3–6 líneas con dos cafés distintos, comanda revisada, envío a
cocina visto en el AP11, «Tickets pasados» y volver (hoja cerrada) y cobro en
efectivo. **No se han creado tickets `TEST`**: la mesa T1 que se abrió se cerró
sin líneas y la sala quedó en «0 abiertas · 0,00 €».

Se hará de una sola pasada **después** de arreglar 9.2 y reconstruir la APK: con
el criterio del §2 fallando, la pasada habría que repetirla igual.

El AP11 está conectado y listo (`adb connect 192.168.5.74:5555` →
`model:AP11_1006`).

---

## 9.bis · Qué hace falta para rehacerla



El criterio de cierre del bloque. Hace falta, y es de Matías:

- el **N1 despierto** y vinculado a **Sirope · Caja 1 en ensayo**, cajero
  `soporte+sirope@mipiace.es`;
- **adb inalámbrico** a 192.168.5.143 — el puerto cambia en cada reinicio y la
  depuración se corta si se bloquea la pantalla;
- el **AP11** encendido para ver la comanda llegar.

El guion: mapa → filtro Terraza → mesa de terraza → búsqueda con teclado →
familia → 3–6 líneas con dos cafés distintos → comanda revisada → enviada a
cocina y vista en el AP11 → «Tickets pasados» y volver (hoja cerrada) → cobro en
efectivo. Todo en ensayo; se apuntan los `TEST` creados y los borra Matías con
«Resetear ensayo». Capturas numeradas en `docs/qa/2026-10-XX-n1-hosteleria/`.

Y el antes/después del D8 y del AP11, lado a lado.

---

## 10 · El push y el PR

**PENDIENTE hasta cerrar §8 y §9.**
