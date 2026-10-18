# n1-vertical · el TPV se puede usar en un aparato de mano — DONE

_Rama `n1-vertical`, commits pequeños en español: cuatro del alcance, uno de bancos, dos de lo que encontró el repaso a 360×640, y el merge de `master`. APK **1.27.0 (12700)** compilada y **sin publicar**. 2026-10-16/18._

Lo que había que poder hacer y no se podía: **vender desde un TPV portátil tipo móvil**. La APK
estaba fijada en horizontal, así que en el N1 (720×1440 físicos, densidad 320) el viewport era de
**720×360 px CSS**: salía el layout de móvil pero con 360 px de alto, y ahí la hoja del ticket
dejaba 24 px para las líneas, el cobro 70 px para 651 px de contenido y la búsqueda con el teclado
abierto no enseñaba ni un resultado (`docs/qa/2026-10-16-pasada-n1-movil.md`).

Ahora el aparato decide su orientación por su **tamaño**: los de menos de 600 dp de lado corto van
en vertical, y los de 10" y 15" siguen exactamente igual que ayer.

---

## 0 · Lo primero, porque es la restricción del bloque

**Los terminales de 10" no cambian.** El AP11-1006 mide `sw800dp` (medido hoy con `adb shell am
get-config`: `sw800dp w1280dp h728dp land`), así que cae del lado de tablet y pide la misma
orientación que llevaba el manifiesto hasta ayer. Los tres bancos que lo vigilan están en §4, y
dos de los sabotajes de §5 son exactamente «poner el AP11 de canto».

Lo único que un terminal grande ve distinto después de este bloque es **dónde sale el aviso de
PIN incorrecto**: sube de debajo del botón «Entrar» a justo encima del teclado. Es un cambio
deliberado y se explica en §2.4.

---

## 1 · Lo que hay ahora

### 1.1 La orientación la decide el tamaño, en un solo sitio

`OrientacionPorTamano.paraSmallestScreenWidthDp(dp)`:

| `smallestScreenWidthDp` | decisión | quién es |
|---|---|---|
| `<= 0` (no se pudo medir) | `SCREEN_ORIENTATION_SENSOR_LANDSCAPE` | lo desconocido cae a lo conocido |
| `1 … 599` | `SCREEN_ORIENTATION_SENSOR_PORTRAIT` | el N1 (`sw360dp`) |
| `>= 600` | `SCREEN_ORIENTATION_SENSOR_LANDSCAPE` | el AP11 (`sw800dp`), AP12, AP13, D8 |

- `android:screenOrientation` **sale del manifiesto**. Con las dos fuentes, el manifiesto gana al
  arrancar y el código corrige después: un giro en la cara del cajero.
- La llamada va en `onCreate` **después** del rescate de A4 (que no se toca) y **antes** de
  `super.onCreate`, que es donde el bridge crea el WebView. Pedida después, el WebView mediría la
  pantalla en horizontal y el giro sería un reflow a la vista.
- Todo envuelto en `try/catch`: esto corre en el camino crítico del arranque de una caja. Si algo
  falla se pide horizontal; si eso también falla, el arranque sigue.
- `configChanges` se queda igual, así que **el WebView no se recrea al girar** y una venta con
  líneas dentro no se reinicia.

### 1.2 La barra del ticket, sólo donde tiene sentido

La barra inferior (`lg:hidden fixed inset-x-0 z-40`) es lo único que enseña el total en pantalla
estrecha, así que no se toca mientras el cajero marca. Se oculta en dos casos:

- **Con un overlay encima** (`overlayEncima`): la agenda, «Cerrar el día» y el arqueo X. La venta
  no se desmonta cuando se abre cualquiera de los tres, la barra es `fixed` en z-40 y gana la que
  va después en el DOM: tapaba el botón «Reservar» de «Nueva cita» (captura `22-nueva-cita` del
  N1) y el «Cancelar» de «Cerrar el día» (encontrado hoy, §6.2).
- **Con el teclado del sistema abierto**: la barra se pega sobre el teclado con
  `--keyboard-offset` y ocupaba el único hueco que quedaba para los resultados de la búsqueda
  (captura `27-busqueda-teclado`).

El hueco de 80 px bajo la rejilla se queda puesto aunque la barra esté oculta: con el teclado
abierto cae debajo del teclado y no molesta, y quitarlo haría saltar la rejilla cada vez que el
cajero toca el buscador.

### 1.3 Cómo se sabe que hay teclado

No hay API de «hay teclado» en el WebView; sí hay `visualViewport`, y funciona en el WebView 154
del N1. La cuenta sale de `startVisualViewportSync` —la misma que ya alimentaba
`--keyboard-offset`— a dos funciones puras en `lib/visualViewportSync.ts`:

```ts
offsetDelTeclado(innerHeight, visualHeight, visualOffsetTop) // máx(0, lo tapado por abajo)
tecladoTapaLaPantalla(...)                                   // ¿pasa de UMBRAL_TECLADO_PX?
export const UMBRAL_TECLADO_PX = 120;
```

**El umbral no es `> 0`.** En el WebView el viewport visual se encoge unos píxeles sin teclado —las
barras de sistema del modo inmersivo al reaparecer, el rebote del scroll elástico que deja
`offsetTop ≠ 0`— y con el umbral en cero la barra parpadearía al desplazar el catálogo. El teclado
del N1 se come ~290 px, y hasta un teclado numérico corto en apaisado pasa de 120.

Sin `visualViewport` (jsdom, navegadores viejos) se devuelve `false`: nadie pierde el total por una
API que no existe.

### 1.4 El cajón se desplaza solo

```
<nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1.5">
```

Cuatro piezas y las cuatro hacen falta:

- `overflow-y-auto` — que recorte y desplace;
- `flex-1` — que ocupe el hueco que sobra en la columna;
- `min-h-0` — sin él el mínimo de contenido de un hijo flex es su alto intrínseco, la lista
  desborda el cajón y `overflow-y-auto` no tiene nada que recortar. Era el fallo que había;
- `overscroll-contain` — sin él, al llegar al final de la lista el gesto sigue hacia la pantalla de
  venta de detrás (*scroll chaining*), que es justo lo que se vio en el aparato.

La cabecera y la línea de versión pasan a `shrink-0`: lo que se encoge tiene que ser la lista.

### 1.5 La pantalla de PIN cabe

- **En compacto son dos pasos**, cajero y luego PIN. Las dos tarjetas apiladas suman ~860 px; la
  del teclado sola mide ~490 y cabe entera. De `md` (768 px) hacia arriba el paso no existe: las
  dos tarjetas se pintan en paralelo, como ven los quince terminales en producción.
- **Por debajo de 560 px de alto** —el N1 en apaisado, 720×360— la tarjeta del PIN pasa a dos
  columnas: teclado a la izquierda, estado y «Entrar» a la derecha. De ~490 px a ~230.
- **El aviso sube** a pegarse a los puntos del PIN.
- **Y el primer PIN mal ya avisa** (§6.1), que resultó ser el verdadero hallazgo del punto 8 de la
  pasada.

---

## 2 · Las decisiones que tomé sin preguntar

### 2.1 `SENSOR_PORTRAIT`, no `PORTRAIT`

Deja usar el vertical del revés, que es como se acaba sujetando un aparato con funda o con la
correa al cuello. `PORTRAIT` a secas obliga a una sola forma de cogerlo.

### 2.2 El umbral es 600 dp porque es el de Android, no uno nuestro

`sw600dp` es el calificador de recursos de toda la vida. Usar el mismo número deja la decisión
nativa y la del CSS contando lo mismo, y evita tener que justificar un valor propio cada vez que
entre un aparato nuevo. Un umbral más arriba (720) pondría de canto una tablet de 7" legítima, y
hay un test que lo dice.

### 2.3 El prop se llama `overlayEncima` y no `agendaAbierta`

Empezó llamándose `agendaAbierta` —era el único caso conocido— y el repaso a 360×640 encontró el
segundo: «Cerrar el día». La regla no es «la agenda», es **que la barra no pinta sobre nada que
esté por encima de la venta**. El nombre dice la regla, así que el tercer caso que aparezca se
arregla añadiendo un estado a una condición y no descubriendo el fallo en un bar.

La agenda llega por prop desde `App` —ese overlay no es de la pantalla de venta y no puede
deducirlo— y los modales de cierre y arqueo son suyos y los sabe.

### 2.4 El aviso de PIN sube también en los terminales grandes

El prompt pide que el aviso se vea «donde el cajero está mirando». Lo tenía debajo de «Entrar»,
que en el N1 era el único sitio de la pantalla que no se veía. Se podía haber movido sólo en
compacto, dejando dos sitios distintos según el ancho, pero eso es dos maquetaciones del mismo
aviso y un sitio donde un cambio futuro se olvida. Sube en todos: **en el AP11 el aviso aparece
ahora encima del teclado en vez de debajo del botón**. Es el único cambio visible en un terminal
de 10" y va aquí dicho en voz alta.

### 2.5 El paso compacto es estado, no «¿hay email?»

Con la condición derivada (`activeEmail.length > 0`) la tarjeta del cajero desaparecía al teclear
la **primera letra** del email, con el teclado abierto y el campo a medias. Hay un test y un
sabotaje para esto (§5).

### 2.6 El banco de la agenda entra ahora por la puerta nueva

Con la pantalla de PIN en dos pasos, `apps/e2e-ui/lib/entrar.ts` tecleaba el email y buscaba el
teclado numérico, que por debajo de 768 px está en el paso siguiente: el capítulo 7 a 390 px se
habría caído. Ahora pulsa «Continuar» si lo ve. En los capítulos de 1280 no cambia nada.

### 2.7 Lo que NO toqué

- **El horizontal en móvil.** Con la app fija en vertical no se da, y el prompt lo deja fuera.
  La defensa de `max-height: 500px` para la hoja del ticket y el cobro sigue fuera de alcance.
- **La fila de filtros de Tickets** (§7.1): no es de una línea.
- **La impresora IPOS y la zona horaria**: bloques propios.

---

## 3 · Lo que encontré sin commitear al retomar, y qué estaba mal

La sesión del 16-10 se cortó con el trabajo en el árbol y **sin compilar**: `PinScreen.tsx` tenía
un `</div>` de más y `tsc -b` lo decía en cuatro errores encadenados
(`JSX element 'main' has no corresponding closing tag`). O sea que lo que había no era «hecho y
sin commitear», era «a medias». Arreglado antes del primer commit, y por eso los cuatro commits
del alcance salen con la suite en verde detrás.

---

## 4 · Los tests

### 4.1 Los nuevos

| Fichero | Qué fija |
|---|---|
| `apps/tpv-android/.../OrientacionPorTamanoTest.java` | 360 dp → vertical, 800 dp → horizontal, el umbral por los dos lados, los móviles y las tablets típicas, lo desconocido a horizontal, y el texto del log |
| `apps/tpv-web/test/n1-teclado-del-sistema.test.ts` | la cuenta del offset (nunca negativa) y el umbral de 120 px, con las medidas del N1 y con el ruido que NO es teclado |
| `apps/tpv-web/test/n1-barra-ticket.test.tsx` | la barra está en la venta; no está con la agenda ni con «Cerrar el día»; desaparece con el teclado y vuelve al bajarlo; 8 px no la quitan; sin `visualViewport` se queda |
| `apps/tpv-web/test/n1-menu-cajon-scroll.test.tsx` | «Declaración responsable» cuelga de un contenedor que desplaza, con las cuatro piezas, y lo que se encoge es la lista |
| `apps/tpv-web/test/n1-pin-cabe.test.tsx` | los dos pasos, que teclear un email no se lleve la tarjeta, el aviso por encima del teclado y de «Entrar», el primer fallo avisando, el reparto a 720×360 y que `md` no cambie |

### 4.2 Lo que estos bancos NO pueden hacer, dicho en cada cabecera

jsdom no aplica hojas de estilo ni evalúa media queries: ahí no se mide si algo cae dentro de la
pantalla (`getBoundingClientRect` devuelve ceros). Lo que fijan es lo que se rompió —qué se monta,
en qué orden y con qué clases—. **La medida de verdad está en §6**, con un navegador a 360×640 y
720×360 contra la stack del banco.

### 4.3 En verde

```
pnpm -r test   (vitest run desde la raíz)
  Test Files  383 passed (383)
       Tests  5316 passed | 10 skipped (5326)

(cd apps/tpv-web && npx tsc -b)      # sin salida
(cd apps/tpv-android/android && JAVA_HOME=/usr/local/opt/openjdk@17 \
   ANDROID_HOME=/usr/local/share/android-commandlinetools \
   ./gradlew :app:testDebugUnitTest) # BUILD SUCCESSFUL
```

La suite se corre **desde la raíz**: dentro de `apps/tpv-web` fallan 219 por el entorno jsdom del
comando, no por el código.

---

## 5 · Tabla de sabotaje

Cada fila: se rompe el código, se ve el rojo, se copia el mensaje real y se restaura. Los seis
primeros son los del prompt; los cinco siguientes son de lo que el bloque añadió por el camino.

| # | Sabotaje | Qué cae | Mensaje real |
|---|---|---|---|
| 1 | La función devuelve horizontal para 360 dp | 3 del banco de Android | `elN1_que_mide_360dp_va_en_vertical → java.lang.AssertionError: expected:<7> but was:<6>` · `moviles_tipicos_en_vertical → sw320dp debería ser móvil expected:<7> but was:<6>` · `el_umbral_esta_en_600_y_600_es_tablet → expected:<7> but was:<6>` |
| 2 | La función devuelve vertical para 800 dp | 3 del banco de Android | `elAP11_que_mide_800dp_sigue_en_horizontal → expected:<6> but was:<7>` · `tablets_y_terminales_grandes_en_horizontal → sw600dp debería ser tablet expected:<6> but was:<7>` · `el_umbral_esta_en_600_y_600_es_tablet → expected:<6> but was:<7>` |
| 3 | Umbral en 720 en vez de 600 | 2 del banco de Android | `el_umbral_esta_en_600_y_600_es_tablet → expected:<600> but was:<720>` · `tablets_y_terminales_grandes_en_horizontal → sw600dp debería ser tablet expected:<6> but was:<7>` |
| 4 | La barra del ticket sale en la Agenda (quitar `overlayEncima` de la condición, en el TPV claro y en hostelería) | 2 de `n1-barra-ticket` | `con la AGENDA abierta encima, la barra no se pinta → AssertionError: expected <div …(3)>…(1)</div> to be null` (y la gemela de hostelería handheld) |
| 5 | La barra no se oculta con el teclado (quitar `tecladoAbierto`) | 1 de `n1-barra-ticket` | `con el teclado abierto desaparece, y vuelve al bajarlo → AssertionError: expected <div …(3)>…(1)</div> to be null` |
| 6 | El cajón sin `overflow-y-auto` | 3 de `n1-menu-cajon-scroll` | `«Declaración responsable» cuelga de un contenedor que desplaza → AssertionError: expected null not to be null` · `ese contenedor tiene las cuatro piezas → TypeError: Cannot read properties of null (reading 'classList')` · `lo que se encoge es la lista → AssertionError: expected false to be true` |
| 6b | El cajón sin `min-h-0` (desborda y no recorta) | 1 de `n1-menu-cajon-scroll` | `ese contenedor tiene las cuatro piezas que hacen falta → AssertionError: expected false to be true` |
| 7 | El aviso de PIN vuelve debajo de «Entrar» | 3 de `n1-pin-cabe` | `el aviso de PIN incorrecto se pinta ARRIBA, no debajo de «Entrar» → AssertionError: expected false to be true` (y los de error plano y bloqueo) |
| 8 | El paso compacto derivado de `activeEmail` en vez de ser estado | 1 de `n1-pin-cabe` | `se puede volver al cajero sin recargar → AssertionError: expected true to be false` |
| 9 | El umbral del teclado a ~0 | 2 de `n1-teclado-del-sistema` + 1 de `n1-barra-ticket` | `el umbral es 120 px y no cero → AssertionError: expected 1 to be 120` · `el ruido del WebView sin teclado NO cuenta como teclado → expected true to be false` · `un encogimiento pequeño no la quita (nada de parpadeos) → expected null not to be null` |
| 10 | El aviso de PIN vuelve a `attemptsRemaining <= 3` | 1 de `n1-pin-cabe` | `el PRIMER PIN mal ya avisa, aunque queden 4 intentos → AssertionError: expected null not to be null` |
| 11 | `overlayEncima` deja de mirar los modales de la propia venta | 1 de `n1-barra-ticket` | `con el modal de cierre abierto, la barra no se pinta encima → AssertionError: expected <div …(3)>…(1)</div> to be null` |

Y uno que no busqué y salió solo: poner `title="Nueva cita"` en el botón de la agenda puso en rojo
`agenda-mostrador.test.tsx > el motivo NUNCA va en un tooltip: ux-principles §6 los prohíbe` con
`AssertionError: expected true to be false`. El arreglo fue dejar sólo `aria-label`, que es un
nombre accesible y no un tooltip.

---

## 6 · El repaso a 360×640 (punto 5), midiendo

Contra la **stack del banco** (API + Postgres + la PWA de verdad), navegador a 360×640 y a
720×360, con la cuenta «Peluquería Demo» y su cajera. Capturas y medidas en
`docs/blocks/n1-vertical-shots/` (`medidas-360x640.json`).

| Pantalla | Medida | Captura |
|---|---|---|
| PIN, paso cajero | la página no desborda (`scrollW 360 == clientW 360`) | `01` |
| PIN, teclado | la tarjeta entera: `y 92 … bottom 639` de 640. Tecla «0» `bottom 534`, «Entrar» `bottom 614`, las dos dentro sin desplazar | `02` |
| PIN mal | el aviso en `y 280 … 339`, dentro y encima del teclado | `03` |
| PIN a 720×360 | tarjeta `y 92 … bottom 312` de 360; «0» y «Entrar» en `bottom 299`; aviso en `y 220 … 259` | `04` |
| Venta | barra en `y 575 … 640`, sin desbordar por la derecha | `05`, `06` |
| Hoja del ticket | el diálogo mide **387 px** y enseña la línea entera (en horizontal eran 24 px) | `07` |
| Cobro | «Cerrar servicio» en `bottom 624` de 640, sin desborde horizontal | `08` |
| Menú a 360×640 | cabe entero (`scrollH 506 == clientH 506`): aquí el arreglo no se nota | `09`, `10` |
| **Menú a 720×360** | **antes**: «Declaración responsable» en `y 354`, `bottom 402`, ventana 360 → **fuera**. **Ahora**: la lista desplaza (`scrollH 318 > clientH 226`, `overscroll-behavior-y: contain`) y la línea llega a `y 262`, dentro y sin que nada la tape | `15`, `16` |
| Cerrar el día | ya no lleva la barra encima (§6.2) | `11` |
| Tickets | la fila de filtros se sale: «Hasta» en `x 633 … 666` con ventana de 360. La fila **sí desplaza en horizontal** (`overflow-x: auto`, `scrollW 838`), así que el campo es alcanzable deslizando. Pendiente (§7.1) | `12` |
| Agenda | **sin barra del ticket** (`falta: true`). La tira de días desborda dentro de su propio scroller horizontal, que es como está diseñada | `13` |
| Nueva cita | «Reservar» en `y 524 … 572` de 640, **sin barra encima** y sin que nada lo tape | `14` |

### 6.1 Hallazgo · el primer PIN mal no avisaba de NADA

El aviso estaba gateado por `attemptsRemaining <= 3` y la API contesta **4** en el primer fallo:

```
POST /shift/cashier-login  → 401
{"error":"INVALID_CREDENTIALS","message":"Email o PIN incorrectos","attemptsRemaining":4}
```

Así que el primer PIN mal borraba el PIN y no pintaba nada: el cajero no sabía si había fallado él
o la máquina. La pasada del N1 lo anotó como «el aviso de error no se veía» y la lectura natural
era que estaba mal colocado; la medida dice que **no existía**. Ahora se pinta desde el primer
fallo, en el mismo gris suave de v1.3 (la decisión de no asustar en el primer fallo se respeta: lo
que cambia es que ahora hay algo que leer).

### 6.2 Hallazgo · la barra del ticket tapaba «Cerrar el día»

A 360×640, el pie del modal («Cancelar») quedaba debajo de la barra inferior de la venta: mismo
mecanismo que el de la agenda (la venta no se desmonta, la barra es `fixed` en z-40 y va después
en el DOM). Arreglado con `overlayEncima` (§2.3) y con su banco y su sabotaje (§5, fila 11).

### 6.3 Hallazgo · el «+» de la agenda no tenía nombre

El rótulo «Nueva cita» vive en un `<span className="hidden sm:inline">`, así que por debajo de
640 px el botón es un «+» sin nombre accesible: ni para un lector de pantalla ni para el banco,
que no podía encontrarlo. Arreglado con `aria-label` (y **no** con `title`: en la agenda los
tooltips están prohibidos, ux-principles §6).

### 6.4 Cómo se rehace este repaso

```bash
# 1 · la stack del banco, con base y puertos propios de la sesión
DATABASE_URL="postgresql://mipiacetpv:mipiacetpv_dev@localhost:5432/mipiacetpv_n1_vertical_e2e?schema=public" \
BANCO_API_PORT=3107 BANCO_ADMIN_PORT=5277 BANCO_TPV_PORT=5278 \
  pnpm --filter @mipiacetpv/e2e-ui run stack

# 2 · la agenda encendida y dos profesionales activas (el banco las crea por el panel en el cap. 3)
docker exec mipiacetpv-postgres psql -U mipiacetpv -d mipiacetpv_n1_vertical_e2e \
  -c "UPDATE tenants SET agenda_enabled = true WHERE name ILIKE '%Peluquer%';"

# 3 · API y TPV (el .env de la raíz NO viaja al worktree: copiar el del árbol principal)
(cd apps/api && PORT=3107 pnpm dev)
MIPIACETPV_API_PROXY=http://127.0.0.1:3107 MIPIACETPV_DEV_PORT=5278 pnpm --filter @mipiacetpv/tpv-web dev
```

Dos cosas que costaron un rato y no están en ninguna otra parte:

- **El cliente de Prisma hay que regenerarlo después del merge.** `master` añadió
  `Tenant.facturaDesde`, y sin `pnpm db:generate` el login contesta **500** con
  `Unknown field 'facturaDesde' for select statement on model 'Tenant'`. Y hay que **matar el
  proceso viejo**: nodemon no recarga el cliente generado.
- La API necesita `CLINICAL_KEK` en cuanto la base tiene una clínica sembrada (la del banco la
  tiene): base64 de 32 bytes, y para una base desechable vale una recién generada.

---

## 7 · Lo que queda pendiente, con su captura

### 7.1 La fila de filtros de Tickets se sale por la derecha

Captura `12-tickets-360x640.png`. Medido: «Hasta» en `x 633 … 666` con una ventana de 360. **No
es un callejón sin salida** —la fila es `overflow-x: auto` con `scrollW 838`, así que deslizándola
se llega a los dos campos de fecha— pero a 360 px lo primero que se ve es un «Desde» cortado.

No se arregla aquí porque no es de una línea: la fila es un carrusel horizontal de chips **y**
campos, y meter los dos `input[type=date]` en su propia línea pide romper el carrusel
(`flex-wrap` pelea con `overflow-x-auto`) o sacar las fechas a un desplegable. Es la mejora 10 de
la pasada y da para su propio ratito.

### 7.2 La pasada en el hierro — ver §9

---

## 8 · La APK

```
fichero   apps/tpv-android/build-releases/mipiacetpv-1.27.0-12700.apk
versión   1.27.0 (versionCode 12700)
commit    ab36a95   (árbol limpio: sin marca -dirty)
tamaño    9.386.837 bytes
SHA-256   8c11b2c477dbc7e42b834d5bf305c5fa3734e86a39dc87508b8a8109ca582cd8
firma     Signer #1 CN=mipiacetpv, O=mipiace, L=Madrid, C=ES
          SHA-256 677d862054ea4aff904d1dd885231d28609e7de2f0b6997cc96d529dd405bfd6
```

Crece 0,7 MB sobre la 1.26.0 (8,69 MB), que es lo que trae `master` por el camino
(puesta-en-marcha y los demás). Dos builds seguidos del mismo commit dan el mismo tamaño con un
byte de diferencia —el del sellado del zip—, así que el número es del contenido y no del humor de
gradle. **El SHA-256 cambia en cada build**: si Matías recompila, el bueno es el del sidecar
`.sha256` de SU build, que es el que publica `infra/publicar-apk.sh`.

Compilada con `apps/tpv-android/scripts/build-release-apk.sh 1.27.0` (`JAVA_HOME` openjdk@17,
`ANDROID_HOME` las commandlinetools del Mac), con las seis guardas del script en verde: backend de
producción embebido, sin Service Worker en el dist **ni** en los assets sincronizados, origen del
WebView verificado por las dos vías y firma comprobada con `apksigner`.

**No se publica.** La publica Matías tras la pasada:

```bash
infra/publicar-apk.sh apps/tpv-android/build-releases/mipiacetpv-1.27.0-12700.apk
```

Lleva dentro la banda **ENSAYO** de `master` (se ve en la captura `07-hoja-del-ticket-360x640`,
arriba del todo) y la compensación de altura que esa banda necesita.

---

## 9 · La pasada en el hierro — PENDIENTE, Y POR QUÉ

**Lo que SÍ quedó probado en el N1** (emparejado por adb inalámbrico; el aparato está en
`192.168.5.143`, no en el `.144` de la pasada del 16-10). Con la 1.27.0 instalada por `adb install
-r`, en el primer arranque:

```
$ adb logcat | grep n1-vertical
  I mipiacetpv: n1-vertical: móvil (360 dp) -> orientacion 7     # 7 = SENSOR_PORTRAIT

$ adb shell am get-config
  … sw360dp w360dp h648dp … port …     # con la 1.26.0: w672dp h336dp land
```

**El N1 arranca en vertical y el viewport pasa a ser 360×648**, que es justo el tamaño con el que
se midió el repaso del §6. La decisión por tamaño funciona en el hierro: el aparato dice `sw360dp`
y la app le pide vertical.

**Lo que NO se pudo probar, y por qué.** El terminal sólo deja abrir la app **una vez por
arranque** (§9.1): a partir del segundo arranque la pantalla sale en blanco porque el sistema se
niega a lanzar el proceso de renderizado del WebView. Con un solo arranque bueno por reinicio —y
cada reinicio apaga la depuración inalámbrica, que hay que reactivar a mano en el aparato— no se
puede recorrer venta, ticket, cobro, búsqueda con teclado, agenda y menú de un tirón.

De esa única sesión buena queda una captura, `31-n1-arranque-vertical-1.27.0.png`, donde la
tarjeta del PIN aparece **cortada por la derecha**: maquetada con el ancho de antes de girar
(~672 dp) dentro de una ventana de 360. **No está claro si es un fallo de verdad o el renderer ya
colgado repintando un fotograma viejo**, y por eso no se ha tocado ni una línea por ello: se mide
en la próxima sesión buena, con `getBoundingClientRect` sobre la página viva, antes de decidir si
hace falta un `onConfigurationChanged` en `MainActivity` que fuerce el reparto.

**El AP11 sí responde, y está trabajando.** `192.168.5.76:46441`, con la 1.26.0 puesta
(`versionCode=12600`, instalada el 15-10) y **el KDS en primer plano con una comanda viva**
(«T6 esperando · 2 min», captura `20-ap11-antes-1.26.0.png`). Instalarle una APK sin publicar
mientras está en servicio no lo hago sin que Matías lo diga.

Lo que sí quedó medido del AP11, en lectura y sin tocarlo:

```
$ adb -s 192.168.5.76:46441 shell am get-config
  … sw800dp w1280dp h728dp … land …
$ adb -s 192.168.5.76:46441 shell wm size      →  1920x1200
$ adb -s 192.168.5.76:46441 shell wm density   →  160 (override 240)
```

`sw800dp` es exactamente lo que `OrientacionPorTamano` manda a horizontal, y `land` es como está
ahora: **la decisión del bloque le da al AP11 la orientación que ya tiene**.

### 9.0 · Lo medido en el N1, pantalla por pantalla

Con la 1.27.0 instalada, el aparato emparejado a **PRUEBAS MIPIACE** y DevTools sobre el WebView
(`adb forward` + CDP). **No se cerró ninguna venta.** Capturas `31`–`41`.

| Pantalla | Medido en el N1 (ventana 360×720) | Veredicto |
|---|---|---|
| Arranque | `n1-vertical: móvil (360 dp) -> orientacion 7`; `am get-config` → `w360dp h648dp port` | **vertical** |
| PIN, paso cajero | `scrollWidth` **581** con `innerWidth` 360 → se salía por la derecha (§9.2). Tras el arreglo: 360 y 360 | arreglado |
| PIN, teclado | tarjeta `y 123 → 670`, tecla «0» `bottom 565`, «Entrar» `bottom 645` | **cabe sin desplazar** |
| PIN incorrecto | aviso en `y 280 → 339`, 24 px por encima del teclado, **al primer fallo** | se ve |
| Venta | barra del ticket `y 655 → 720`; la página no desborda | bien |
| Hoja del ticket | la hoja mide **390 px** y la zona de líneas **83**, con la línea entera | (en horizontal: 24 px) |
| Cobro | los cinco métodos en una fila, importe, teclado de efectivo y **«Cerrar servicio» en `y 640 → 704`** | (en horizontal: 70 px de cuerpo) |
| Búsqueda con teclado | `innerHeight` 720 → **449**; la barra en `y 384 → 449` **tapaba los 4 resultados** (§9.3) | arreglado |
| Agenda | **sin barra del ticket** | bien |
| Nueva cita | «Reservar» en `y 604 → 652`, nada encima, sin barra | bien |
| Menú | «Declaración responsable» en `y 354 → 402`, visible y sin tapar; en vertical la lista cabe entera | bien |
| Cerrar el día | **sin barra encima**; «Cancelar» en `y 630 → 674`, sin tapar | arreglado |
| Chips de familias | la fila necesita **437 px** y tiene 328: «Más (8)» se sale hasta 453 y **no hay scroller** | PENDIENTE (§9.4) |

### 9.2 · Hallazgo · la pantalla de PIN se salía por la derecha

`document.documentElement.scrollWidth` = **581** con `innerWidth` = 360, y la tarjeta de cajeros
midiendo **561**. Sin `grid-template-columns`, la única columna por debajo de `md` es implícita y
`auto` (= `max-content`): el email del cajero de pruebas
—`mipiacetpv-test-64a68dc7@internal.mipiacetpv.tech`— estira la columna y empuja la página, y el
`truncate` de dentro no llega a aplicarse porque la caja crece con el texto.

Probado en vivo en el aparato antes de escribir la línea (`gridTemplateColumns = 'minmax(0,1fr)'`
por consola): 581 → 360 y la tarjeta 561 → 320. Arreglado con `grid-cols-1`, y comprobado después
con la APK nueva: **360 y 320**.

En el banco de 360×640 no salía: la cajera sembrada se llama `marta@peluqueriademo.local`, que
cabe. Es la diferencia entre medir con datos de laboratorio y medir con los del cliente.

### 9.3 · Hallazgo · el teclado del N1 encoge la VENTANA, no el viewport visual

Con el buscador enfocado y «bran» tecleado:

```
innerHeight 720 → 449 · visualViewport.height 449 · offsetTop 0
barra del ticket en y 384 → 449 · 4 resultados, los 4 tapados por ella
```

La resta que alimenta `--keyboard-offset` da **cero**, así que el detector del 16-10 —correcto para
el caso que documenta la web— no se enteraba en el aparato que motiva el bloque, y la barra seguía
sobre los resultados: exactamente la captura `27-busqueda-teclado` de la pasada anterior. Ahora hay
dos señales (viewport visual encogido **o** ventana encogida respecto a su máximo), con el mismo
umbral de 120 px.

Y una señal que se probó y NO vale: «hay un campo de texto enfocado». El banco la tiró en el primer
intento — la pantalla de venta deja el buscador enfocado de continuo para que el escáner escriba
donde debe, así que con esa regla la barra desaparecía nada más abrir la venta.

### 9.4 · PENDIENTE · las 8 familias no se alcanzan en el N1

La fila de chips (`data-testid="category-chips"`) es de una sola línea y `overflow-hidden` por
decisión de diseño (v1.14/v1.22: nada de scroll horizontal sin affordance; para lo que no cabe
está «Más (N)»). En el N1 esa fila tiene **328 px** y necesita **437**:

```
Servicios 92 + Productos 99 + Todos 98 + «Más (8)» 107 + huecos = 437
```

Con **cero** categorías visibles los fijos ya no caben, así que «Más (8)» queda cortado —se sale
hasta x=453— y, al no haber contenedor que desplace, **no se puede llegar a él**: las ocho familias
son inalcanzables. No es de una línea (habría que sacar el selector Servicios/Productos de la fila,
acortar rótulos en estrecho o repensar «Más (N)» para pantallas de 360), así que va como pendiente
con su medida.

### 9.1 · HALLAZGO APARTE · el N1 sólo abre la app UNA VEZ por arranque

**No es de este bloque y no es de nuestro código**, pero bloquea la pasada y hay que saberlo antes
de vender un N1. Medido el 18-10-2026 con las dos versiones:

| prueba | resultado |
|---|---|
| tras reiniciar el terminal, 1er arranque | **pinta** |
| 2º arranque (cerrar y volver a abrir) | **pantalla en blanco** |
| 3er arranque | blanco |
| HOME y volver a entrar | blanco |
| esperar 20 s antes de reabrir | blanco |
| matar `com.google.android.webview` y `am kill-all` | blanco |
| reinstalar la APK (1.26.0 ó 1.27.0) | blanco |
| reiniciar el terminal | vuelve a pintar… **una vez** |

Pasa igual con la **1.26.0 publicada** que con la 1.27.0 de este bloque, así que no lo trae el
bloque.

**La causa, en el log del arranque que falla:**

```
W ActivityManager: Unable to launch app es.mipiace.tpv/10120 for service
    Intent { cmp=es.mipiace.tpv/org.chromium.content.app.SandboxedProcessService0:0 }: process is bad
E cr_ChildProcessConn: Failed to establish the service connection.
```

El WebView carga bien (`WebViewFactory: Loading com.google.android.webview version
154.0.8037.106`, `multiprocess=true`) y pide su proceso de renderizado; el `ActivityManager` se lo
NIEGA porque tiene ese proceso marcado como «bad» — la marca que pone Android cuando un proceso se
cae repetidamente, y que sólo se limpia al reiniciar el terminal. Por eso en `chrome://inspect` el
WebView sale como «untitled · hidden», el panel de elementos vacío y ni un `1+1` contesta: no hay
renderer al otro lado, no es JS nuestro.

**Lo que se descartó, midiendo:**

- **El NFC del aparato.** `com.android.nfc` estaba en bucle de caída (27 veces en 41 min, `Abort
  message: 'JNI FatalError called: enableInternal'`, atascado en `mState=turning on`). Se apagó con
  `pm disable-user --user 0 com.android.nfc` —el interruptor normal no existe en este firmware:
  `svc nfc disable` no hace nada y `cmd nfc` contesta `No shell command implementation`— y el bucle
  paró en seco (0 caídas en 25 s). **El patrón no cambió.** Para deshacerlo:
  `adb shell pm enable com.android.nfc`.
- **La memoria.** 2,9 GB totales con 1,6 GB disponibles: no es falta de RAM.
- **Nuestro rescate de A4.** Sólo purga cuando cambia el `versionCode`, y en los arranques que
  fallan no cambia; además registró `directorios purgados: 0`.

**El mismo síntoma ya se vio en el D8 de Sirope el 17-10**, con WebView **101** — otra versión del
WebView y el mismo cuadro, así que no es un fallo de la 154.

**Lo que falta por saber** (una pasada más, con el terminal recién reiniciado): **por qué** se cae
el renderer durante la PRIMERA sesión, que es lo que deja la marca. Hay que abrir la app con
`logcat` grabando desde el primer segundo y cazar la muerte del proceso hijo.

**Para la implantación, mientras tanto:** un N1 así no vale para vender — el cajero cierra la app y
a la siguiente tiene una pantalla blanca. Antes de darle uno a un cliente hay que resolver esto.

### El guion de la pasada, para cuando estén los dos aparatos

**N1** (cuenta PRUEBAS MIPIACE, cajero de pruebas; **no se cierra ninguna venta real**):

1. `adb connect 192.168.5.144:5555` y `adb install -r apps/tpv-android/build-releases/mipiacetpv-1.27.0-12700.apk`.
2. Arranque: tiene que abrir **en vertical y sin parpadeo** (el log dice
   `n1-vertical: móvil (360 dp) -> orientacion 7`; se ve con
   `adb logcat -s MainActivity:I | grep n1-vertical`).
3. PIN: teclado entero a la vista, «Entrar» sin desplazar, **PIN mal → aviso visible a la primera**.
4. Venta → hoja del ticket con las líneas enteras → cobro con los métodos de pago completos.
5. Búsqueda con el teclado del sistema abierto: **se ven resultados** y la barra del total
   desaparece mientras se teclea.
6. Agenda → «Nueva cita»: **«Reservar» visible**, sin barra encima.
7. Menú hasta «Declaración responsable», deslizando la lista y **sin que se mueva la venta de
   detrás**.
8. «Cerrar el día»: el pie del modal («Cancelar») a la vista.

**AP11** (antes/después, lado a lado): captura con la 1.26.0 (ya está:
`20-ap11-antes-1.26.0.png`), instalar la 1.27.0 y captura de la misma pantalla. Tiene que verse
**idéntica**: horizontal, mismo layout `lg`.

---

## 10 · El push y el PR

```bash
cd /Users/matiasoyolasanchez/Developer/Claude/Projects/mipiacetpv-n1-vertical

git log --oneline master..HEAD          # la rama entera, de un vistazo
git push -u origin n1-vertical

gh pr create --base master --head n1-vertical \
  --title "n1-vertical · el TPV se puede usar en un aparato de mano" \
  --body-file docs/blocks/n1-vertical-done.md
```

Y el worktree, cuando el PR esté mergeado:

```bash
git -C /Users/matiasoyolasanchez/Developer/Claude/Projects/mipiacetpv \
  worktree remove ../mipiacetpv-n1-vertical
```
