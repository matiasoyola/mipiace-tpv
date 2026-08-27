# Bloque v1.12 · Manos de camarero — DONE

Rama `v1-12-manos-de-camarero`. Origen: **pruebas físicas sobre el AP11-1006 del 2026-08-27**
(`docs/qa/2026-08-27-pruebas-fisicas-ap11.md`). Todo lo que hay aquí se detectó tocando el
terminal con el dedo; nada salió del simulador de 1280×800.

Premisa que ordena el bloque: **el camarero ejecuta, no piensa.** Ninguna acción de barra puede
depender del teclado del sistema operativo ni de un objetivo táctil de 5 mm.

---

## Paso 0 · Base de integración (commit aparte)

El bloque no sale de `master`, sino de `master ← v1-10-3-barra-hora-punta ← v1-11-cierre-de-dia`.
El merge se resolvió con la regla del bloque —**v1.11 manda en la forma, v1.10.3 manda en el
contenido de importes**— y va en su propio commit (`merge · base de integración v1.10.3 + v1.11`),
separado del trabajo de v1.12.

Cuatro solapes, resueltos así:

| Fichero | Resolución |
|---|---|
| `pages/ShiftForceCloseScreen.tsx` | Se acepta el borrado de v1.11. Lo que v1.10.3 le había metido (`formatEur` en la lista de documentos rechazados) se repone **donde vive ahora ese contenido**: `CloseShiftModal.tsx`. |
| `test/shift-force-close-sync-pending.test.tsx` | Se acepta el borrado; la regresión que guardaba sigue cubierta en `shift-resume-screen.test.tsx`, cuya aserción vuelve a exigir coma decimal (`27,40 €`). |
| `pages/CloseShiftModal.tsx` | Estructura de v1.11 (`syncBlock` extraído, tarjeta de resumen) con los arreglos de importe de v1.10.3 dentro. |
| `.gitignore` | Unión de las dos listas (verificado: no falta ninguna línea de ninguna de las dos ramas). |

Un extra que el merge dejó a la vista: **v1.11 traía su propio `formatEur`** en
`lib/shiftSummary.ts` —`n.toFixed(2).replace(".", ",")`, sin la normalización del `-0`—, que es
justo el duplicado que v1.10.3 vino a matar. Ahora `shiftSummary.ts` **reexporta** el de
`lib/money.ts`: los imports de v1.11 siguen igual y el formateador vuelve a ser uno solo.

Y `ShiftResumeScreen.tsx` pintaba el fondo inicial como `{shift.cashOpening} €` —crudo, tal cual
llega del server: "50 €"—. Ahora pasa por `formatEur(parseAmount(...))`: "50,00 €".

Verde antes de empezar el bloque: **142 ficheros de test, 1209 tests** y `tsc -b`.

---

## 1 · CashPad y AmountField (H2 — el peor hallazgo de la sesión)

**Lo que pasaba en el terminal.** Al tocar cualquier importe salía el teclado de Android: ocupaba
el 52 % inferior de la pantalla y tapaba los métodos de pago y el botón Cobrar; sacaba un menú
nativo *Cortar / Copiar / Seleccionar todo* flotando sobre el ticket; y encima el que salía era el
teclado de **símbolos** (`- + . * / , ( ) =`), no un pad de caja. Cobrar "me da cinco" eran seis
gestos y una pantalla que desaparecía. **La APK no arregla esto**: el teclado es del sistema
operativo.

**`components/CashPad.tsx`** — grid de 3 columnas calcado del keypad del PIN (`PinScreen.tsx`):
mismos radios, mismos fondos, mismas alturas. Teclas de **56 px** (`h-touch-pad`). `1..9`, `00`,
`0`, `,`, y una fila aparte con `C` y `⌫` —las dos que se pulsan con prisa y sin mirar—. Sin
estado propio: el importe lo posee el formulario.

**`components/AmountField.tsx`** — la coraza anti-IME son cuatro cosas y hacen falta las cuatro:

```
readOnly              → el navegador no ofrece edición de texto
inputMode="none"      → y si aun así enfocara, no pide teclado
onFocus → blur        → ni siquiera se queda el foco de texto
user-select: none  +  -webkit-touch-callout: none
                      → mata el menú "Cortar / Copiar / Seleccionar todo"
```

Verificado en navegador real (bucle visual): `readOnly: true`, `inputmode: "none"`,
`user-select: none`, teclas de 56 px y barra de cobro de 64 px.

**Reglas de escritura** (todas con test, `test/cash-pad-rules.test.ts`):

- Euros con **coma** decimal, máximo 2 decimales; el tercero se ignora (no redondea: el cajero ve
  exactamente lo que ha metido).
- `00` sobre campo vacío **no** antepone ceros: se queda vacío. Y `0` + `5` es `5`, no `05`.
- `00` con hueco para un solo decimal mete un cero, no dos (`7,5` + `00` = `7,50`).
- Una sola coma. La coma sobre campo vacío arranca en `0,`.
- **Campo vacío ≠ `0,00`**: vacío es "no introducido" y el botón de acción sigue bloqueado.
- El parseo sigue en `lib/money.ts` (v1.10.3). Aquí no se reimplementa nada.

**Los cuatro campos sustituidos:**

| Dónde | Fichero | Pad |
|---|---|---|
| Efectivo entregado | `pages/CheckoutPage.tsx` | importes, con coma |
| Importe del método secundario (mixto) | `pages/CheckoutPage.tsx` | importes, con coma |
| Las 15 denominaciones del arqueo | `pages/CloseShiftModal.tsx` | conteos enteros (`maxDecimals = 0`) |
| Fondo de caja al abrir turno | `pages/ShiftOpenScreen.tsx` | importes, con coma |

(El bloque hablaba de 14 denominaciones; en el código son **15** —de 500 € a 5 cts—. Se cambian
las 15.)

En el arqueo son unidades, no euros: ahí el pad va sin coma y el `0` ocupa el hueco que dejaría
—una tecla muerta bajo el pulgar es peor que una tecla grande—.

**El pad no tapa ni desplaza el botón de acción.** La hoja se reparte cabecera + total arriba,
campo activo, pad, y el botón primario en el borde inferior. En la hoja de cobro el pie crece y el
body (que es `flex-1 min-h-0`) se encoge, así que "Cobrar" no se mueve del borde. Medido a
1280×800: `Cobrar` termina en y=744 de 800, sin scroll.

`ReloginPinModal.tsx` y `PinScreen.tsx` no se tocan (ver **Hallazgo nuevo** más abajo).

---

## 2 · Objetivos táctiles (H3)

Escala cerrada en `tailwind.config.js` y documentada en `docs/design/tokens.md`:

| Token | Valor | ≈ mm en el AP11 |
|---|---|---|
| `touch` | 48 px | 9 mm |
| `touch-pad` | 56 px | 10 mm |
| `touch-lg` | 64 px | 11 mm |

Nada de `h-[52px]` sueltos: es la escala que heredan los bloques siguientes.

| Elemento | Antes (medido en el terminal) | Ahora |
|---|---|---|
| Chips de zona, "Nueva venta rápida", "Tickets" (`TableMapScreen`) | 5 mm | `h-touch` |
| "Importe exacto", billetes 5/10/20/50/100 (`CheckoutPage`) | 6 mm | `h-touch` |
| Métodos de pago (`CheckoutPage`) | 7 mm | `h-touch` |
| Barra "Cobrar" (`CheckoutPage`) | 7 mm | `h-touch-lg` |
| Casillas de la hoja de cobro (`CheckoutPage`) | **2,5 mm** | fila de `min-h-touch`, casilla de 20 px |
| Botones del modal de arqueo, menú y drawer del mapa | 36-40 px | `h-touch` |

Efecto colateral de los tokens: los chips de zona eran `rounded-full` a 36 px. A 48 px una píldora
incumple la regla de radios de `tokens.md` ("sin esquinas tipo pill con altura ≥ 40 px"), así que
pasan a `rounded-2xl`.

---

## 3 · Higiene de la hoja de cobro

"Enviar por email" y "Ticket regalo" se pliegan tras **Más opciones**, cerrado por defecto (se abre
solo si el contacto ya trae email: entonces el cajero venía a usarlo). "Imprimir ticket" se queda a
la vista: de los tres, es el único que se usa en cada cobro. En hora punta la pantalla es para el
dinero.

---

## 4 · ConfirmSheet (H5)

`SalePage` usaba dos `confirm()`. En el terminal salen como *"mipiacetpv.com dice: ¿Vaciar la
mesa?"*, con botones azules de Chrome y —lo peor— **dos "Cancelar" que significan cosas opuestas**:
cancelar la cuenta y cancelar el diálogo.

`components/ConfirmSheet.tsx`, con los tokens del sistema y verbos explícitos que no se pisan:

| Acción | Confirmar | Salir |
|---|---|---|
| Vaciar mesa | "Vaciar mesa" | "Volver" |
| Cancelar venta | "Cancelar la venta" | "Seguir con la venta" |
| Cancelar servicio (SERVICES) | "Cancelar el servicio" | "Seguir con el servicio" |

La salida va **primera en el DOM** y a la izquierda en fila: en móvil eso la deja abajo, que es
donde cae el pulgar. Salir de una acción destructiva tiene que ser lo barato. Y sin líneas no hay
nada que destruir: ahí no se pregunta, se limpia.

**Test de guardia** (`test/no-native-dialogs.test.ts`): recorre `src/` entero —80 ficheros—,
ignora comentarios y distingue una llamada real de un identificador nuestro (`AlertCircle`,
`showAlert`, `onConfirm`, `setConfirmAction`). Si alguien vuelve a meter un `confirm`/`alert`/
`prompt`, falla aquí y no en el terminal de un cliente.

---

## 5 · El Atrás del sistema ya no echa al camarero (H6, H7)

Durante el arqueo, el Atrás cerró el modal y acabó expulsando al escritorio de Android **con el
turno abierto**; al volver con el icono de Chrome se abrió una segunda pestaña que **pedía el PIN
otra vez** (la sesión de cajero no viaja entre pestañas).

`hooks/useBackGuard.ts`:

- Al arrancar (`App.tsx`, una vez) se empuja un **estado centinela** en la historia. Cada
  `popstate` vuelve a empujarlo, así que la historia nunca se vacía y el navegador no tiene a dónde
  salir.
- **Pila de capas**: cada hoja/modal se registra con `useBackGuard(onClose, isOpen)` y el Atrás
  cierra la de más arriba. Registradas: hoja de cobro, pad de la hoja de cobro, modal de arqueo,
  pad del arqueo y `ConfirmSheet` (donde el Atrás equivale siempre a la salida neutra, nunca a la
  acción destructiva).
- **Sin capas abiertas** manda el guardia de fondo que pone `App.tsx`: dentro de una venta, vuelve
  al mapa de mesas; en el mapa, con el turno abierto, no hace nada. Nunca al escritorio.
- La capa guarda una referencia estable y lee el callback fresco al dispararse: re-registrarla en
  cada render la subiría a lo alto de la pila y el Atrás cerraría la hoja equivocada (hay test).

**H7 · el botón destructivo fuera de la zona de tecleo.** El turno se cerró sin que nadie pulsara
"Cerrar turno" deliberadamente, con 104,00 € contados frente a 104,50 € esperados. En el arqueo,
las acciones van ahora **antes** del pad, y a partir de `sm` el pad se va a su propia columna: el
dedo que teclea no pasa por encima del botón que cierra el día. Hay test de orden en el documento.

---

## 6 · Navegador no soportado: decirlo, no pintar basura (H1)

Chrome 81 (el de fábrica del AP11) no soporta `gap` en flexbox —llegó en el 84— y la UI usa `gap-*`
en 245 sitios: los textos salen pegados ("Sala5 abiertas", "GEgemmamgc720,00 €").

`lib/browser-support.ts`, comprobado en `main.tsx` **antes** de montar React:

- `flexGapSupported()` **mide la caja de verdad** (dos hijos, `rowGap: 1px`, `scrollHeight === 1`).
  `CSS.supports("gap", "1px")` no vale: Chrome 81 lo soportaba en grid y devuelve `true` mientras
  lo ignora en flex, que es donde lo usamos.
- Si falta soporte, pantalla de bloqueo en **HTML plano con estilos en línea y sin un solo `gap`**
  (si dependiera de `gap` saldría rota igual): iconmark, "Este navegador es demasiado antiguo para
  el TPV", qué hacer (actualizar Chrome desde Play Store o instalar la APK) y **la versión del
  navegador detectada**, para que soporte sepa qué tiene delante sin pedir capturas. Sin botón de
  "continuar igualmente".
- `describeBrowser()` no confunde con Chrome a los que se hacen pasar por él (Edge, Samsung
  Internet, Opera), y el UA se escapa antes de pintarlo.

Verificado en Chromium moderno: la detección devuelve `true` (no hay falso positivo que bloquee a
un navegador bueno).

---

## Decisiones tomadas sin preguntar

1. **El pad se abre al tocar un importe, no vive siempre abierto.** El bloque lo pide "abajo,
   fijo"; con las cuatro filas de teclas siempre visibles, el cuerpo de la hoja de cobro se quedaba
   en una línea incluso sin estar tecleando. Se abre al tocar el campo y se cierra con **Listo**,
   que es también lo que da sentido a la captura "hoja de cobro con el pad abierto" de la matriz.
   Mientras está abierto, el campo activo se resalta y su importe se repite en la cabecera del pad.

2. **En el arqueo, las acciones van encima del pad** (y no el botón primario en el borde inferior
   como en la hoja de cobro). Es lo que pide el §5 del bloque para H7: el primario de esa pantalla
   es destructivo. Donde no hay conflicto —hoja de cobro, apertura de turno— el botón sí se queda
   en el borde inferior.

3. **Dos columnas a partir de `sm` en arqueo y apertura de turno.** Con el pad apilado debajo, a
   1280×800 (el AP11 a densidad 240) se veían 3 denominaciones de 15, y "Abrir turno" caía por
   debajo del pliegue. Con el pad en su columna se ven 9 denominaciones y el botón está siempre en
   pantalla. En estrecho sigue apilado.

4. **Cabecera y total del arqueo pegados (`sticky`) dentro de la tabla**, y la fila activa se
   centra sola al tocarla. En 320 px la ventana de la tabla son ~140 px: contar sin ver la fila que
   cuentas es exactamente cómo se cuela un descuadre. En estrecho con el pad abierto la cabecera de
   columnas se despega (las columnas son tres y se aprenden; el total contado, no).

5. **`shiftSummary.ts` reexporta `formatEur` de `money.ts`** en vez de duplicarlo. Es la regla de
   resolución del merge aplicada a un duplicado que el propio merge sacó a la luz.

6. **La explicación de "Abrir turno" baja a pie de campo mientras se teclea.** Son 50 px que
   necesita el pad para caber sin empujar el botón fuera de pantalla, y a esas alturas el texto ya
   se ha leído.

7. **El banco visual de v1.10.3 se amplía en vez de montar Playwright contra el stack entero.**
   Cuatro pantallas nuevas (`arqueo`, `abrir-turno`, `confirmar`, `bloqueo`) con la misma red de
   mentira. Sigue fuera del bundle de producción.

8. **La cobertura de la coraza anti-IME con prefijo `-webkit-` se comprueba sobre el fuente del
   componente.** jsdom descarta las propiedades que no conoce, así que en el DOM no se pueden leer;
   `user-select` sí se verifica en el DOM y las tres se verificaron en navegador real en el bucle
   visual.

9. **21st MCP no se usó.** El keypad de referencia ya estaba en casa (`PinScreen.tsx`) y el bloque
   pide explícitamente no inventar un teclado nuevo. Traer estructura de fuera para luego
   normalizarla a nuestros tokens habría sido trabajo de más para llegar al mismo sitio.

---

## Hallazgo nuevo (fuera de alcance, para el siguiente bloque)

El bloque pide "comprobar que `PinScreen` y `ReloginPinModal` cumplen la misma coraza anti-IME,
porque ya tienen su propio keypad". **Comprobado, y no es así:**

- `PinScreen.tsx` sí tiene keypad propio para el PIN (dígitos por botón, sin input) — correcto. Su
  campo de email es texto de verdad y el teclado del sistema ahí es legítimo.
- **`ReloginPinModal.tsx` NO tiene keypad.** Es un `<input>` editable con `autoFocus` +
  `inputMode="numeric"`: al aparecer, el teclado de Android sube solo. Es el mismo H2, en el modal
  que sale justo cuando caduca la sesión a mitad de servicio.

No se ha tocado, y a propósito: ponerle `readOnly` + `inputMode="none"` **sin** darle antes un
keypad dejaría el PIN sin forma de introducirse, y añadirle el keypad es precisamente lo que el
bloque declara fuera de alcance ("no se toca `ReloginPinModal` más allá de verificar"). Lo que
falta es pequeño y evidente: reutilizar `CashPad` con `maxDecimals = 0` y un `AmountField` en modo
oculto. **Recomendación: entra en el siguiente bloque.**

(Relacionado y también del acta: H2 apunta que en el alta de cajero el teclado tapa el pad del PIN
y la tarjeta no scrollea. Mismo sitio, misma cita.)

---

## Tests

Nuevos:

| Fichero | Qué fija |
|---|---|
| `test/cash-pad-rules.test.ts` (12) | Coma decimal, tercer decimal ignorado, una sola coma, `00` sobre vacío, `00` con hueco de un decimal, `⌫`/`C`, vacío ≠ 0, teclas que no existen, y el modo conteo sin coma. |
| `test/cash-pad-checkout.test.tsx` (9) | Coraza anti-IME (`readOnly`, `inputMode="none"`, blur al foco, `user-select`), cero `inputmode="decimal|numeric"` en toda la hoja, el pad abre/cierra, escribe sobre el campo activo, va **antes** de "Cobrar" en el documento, vacío bloquea el cobro, el importe tecleado llega al POST, y "Más opciones" pliega email y ticket regalo. |
| `test/cash-pad-arqueo.test.tsx` (6) | Las 15 denominaciones son `readOnly`, el pad cuenta unidades (sin coma, `0` a doble ancho), escribe una denominación cada vez con el subtotal vivo, y **"Cerrar turno" va antes del pad en el documento** (H7). |
| `test/back-guard.test.tsx` (10) | Centinela al instalar y repuesto en cada Atrás, instalación idempotente, la pila cierra de arriba abajo, desmontar saca de la pila, re-render con `onClose` nuevo no reordena, y el guardia de fondo (venta → mapa; mapa → nada). |
| `test/browser-support.test.ts` (9) | La detección mide la caja (no `CSS.supports`), no deja basura en el DOM, `describeBrowser` con el UA real del AP11 y con los que fingen ser Chrome, y la pantalla de bloqueo: dice qué pasa y qué hacer, enseña la versión, **no usa `gap`**, no ofrece "continuar igualmente" y escapa el UA. |
| `test/no-native-dialogs.test.ts` (3) | Ni un `confirm`/`alert`/`prompt` en `src/`, más un test de que la regla detecta lo que dice detectar. |

Tocado: `test/checkout-mixed-payment.test.tsx` — los importes ya no se escriben en el `<input>`
(ahora es `readOnly`), se teclean con el pad. El helper `setInputValue` se sustituye por
`typeAmount(fila, "10")`, que hace exactamente lo que hace el dedo: tocar el campo y pulsar teclas.
Las 11 aserciones del cobro mixto de v1.10.3 siguen intactas.

```
pnpm test    → 148 ficheros, 1258 tests, 3 skipped · verde
tsc -b       → verde
```

---

## Bucle visual

Banco visual de v1.10.3 ampliado (`apps/tpv-web/visual/main.tsx`, sólo desarrollo, fuera del
bundle): `?screen=arqueo | abrir-turno | confirmar | bloqueo` además de los de antes. Capturas con
Playwright sobre el dev server, en `docs/blocks/v1-12-manos-shots/`.

| Captura | Qué enseña |
|---|---|
| `checkout-pad-1280.png` | 1280×800 (el AP11 a densidad 240). 20 € tecleados con el pad → "Cambio 6,00 €". **Cobrar visible sin scroll** (termina en y=744 de 800). |
| `checkout-pad-390.png` | 390 de ancho. Campo activo resaltado sobre el pad, Cobrar en el borde inferior. |
| `checkout-pad-320.png` | 320 de ancho. Métodos, campo, pad y Cobrar, todo dentro. |
| `arqueo-pad-1280.png` | 9 denominaciones + pad en su columna, cabecera y "Total contado 100,00 €" pegados, "Cerrar turno" fuera de la zona de tecleo. |
| `arqueo-pad-390.png` | Apilado: fila activa centrada, total pegado, acciones y pad. |
| `arqueo-pad-320.png` | Ídem a 320, sin recortes horizontales (la tabla se ajustó de `min-w-280` a `min-w-240`). |
| `abrir-turno-pad-1280.png` | Fondo de caja tecleado a 150,00 € con "Abrir turno" en pantalla. |
| `mapa-1280.png` | Chips de zona, "Tickets" y "Nueva venta rápida" a 48 px. |
| `confirm-vaciar-mesa-1280.png` | `ConfirmSheet` con "Volver" / "Vaciar mesa". |
| `bloqueo-navegador-1280.png` | Pantalla de navegador no soportado con "Chrome 81.0.4044.138". |

Lo que el bucle cambió sobre lo primero que se escribió (todo esto sale de mirar, no de tests):

1. El pad del arqueo caía **fuera de pantalla**: la tarjeta entera scrolleaba. Se repartió en
   cabecera fija, tabla con scroll propio y acciones + pad clavados abajo.
2. A 1280 el pad apilado dejaba **3 denominaciones de 15**: pasó a columna propia (9 visibles).
3. La fila que se cuenta quedaba fuera de cuadro: se centra sola, y con dos frames de espera —al
   abrirse el pad la tabla cambia de alto, y centrar con la geometría vieja fallaba justo en las
   pantallas estrechas—.
4. A 320 la columna de subtotal salía cortada ("40,00" sin €) y "100,00 €" partía en dos líneas.
5. "Abrir turno" quedaba **debajo del pliegue** a 1280×800 con el pad abierto.

---

## Ficheros

```
NUEVO  apps/tpv-web/src/components/CashPad.tsx
NUEVO  apps/tpv-web/src/components/AmountField.tsx
NUEVO  apps/tpv-web/src/components/ConfirmSheet.tsx
NUEVO  apps/tpv-web/src/hooks/useBackGuard.ts
NUEVO  apps/tpv-web/src/lib/browser-support.ts
NUEVO  apps/tpv-web/test/cash-pad-rules.test.ts
NUEVO  apps/tpv-web/test/cash-pad-checkout.test.tsx
NUEVO  apps/tpv-web/test/cash-pad-arqueo.test.tsx
NUEVO  apps/tpv-web/test/back-guard.test.tsx
NUEVO  apps/tpv-web/test/browser-support.test.ts
NUEVO  apps/tpv-web/test/no-native-dialogs.test.ts
NUEVO  docs/blocks/v1-12-manos-shots/*.png

       apps/tpv-web/src/main.tsx              gancho de browser-support antes de montar React
       apps/tpv-web/src/App.tsx               installBackGuard + guardia de fondo del Atrás
       apps/tpv-web/src/pages/CheckoutPage.tsx    AmountField + CashPad, escala táctil, Más opciones
       apps/tpv-web/src/pages/CloseShiftModal.tsx AmountField + CashPad (conteos), reparto de la hoja
       apps/tpv-web/src/pages/ShiftOpenScreen.tsx AmountField + CashPad, parseo por money.ts
       apps/tpv-web/src/pages/TableMapScreen.tsx  escala táctil (chips, Tickets, venta rápida, menú)
       apps/tpv-web/src/pages/SalePage.tsx        ConfirmSheet en lugar de los dos confirm()
       apps/tpv-web/src/pages/ShiftResumeScreen.tsx  formato de importes repuesto (merge)
       apps/tpv-web/src/lib/shiftSummary.ts       reexporta formatEur de money.ts (merge)
       apps/tpv-web/tailwind.config.js            escala touch / touch-pad / touch-lg
       apps/tpv-web/visual/main.tsx               4 pantallas nuevas en el banco visual
       apps/tpv-web/test/checkout-mixed-payment.test.tsx  se teclea por el pad
       apps/tpv-web/test/shift-resume-screen.test.tsx     coma decimal (merge)
       docs/design/tokens.md                      escala táctil + CashPad/AmountField/ConfirmSheet
```

---

## Criterios de aceptación

| # | Criterio | Estado |
|---|---|---|
| 1 | Sin teclado de Android en cobro ni arqueo | Coraza puesta y verificada en navegador; **falta la pasada en el AP11 físico** |
| 2 | Controles diarios ≥ 48 px (barra de cobro ≥ 64) | Hecho y medido en navegador (56 px las teclas, 64 la barra); **falta captura del terminal** |
| 3 | Sin `confirm`/`alert` en `tpv-web`, con test que lo impida | Hecho |
| 4 | El Atrás no saca de la aplicación con turno abierto | Hecho (10 tests); **falta la pasada en el AP11 físico** |
| 5 | Sin soporte de `gap` sale la pantalla de bloqueo | Hecho; falta verlo en el Chrome 81 del terminal |
| 6 | Suite completa y typecheck en verde; CI verde antes del merge | Suite y `tsc -b` en verde en local; CI al abrir el PR |

Los tres "falta" son de terminal, no de código: se cierran en la siguiente sesión con el AP11
delante, que es de donde salió el bloque entero.

---

## Fuera de alcance, como estaba escrito

- No se toca la lógica de cobro mixto (v1.10.3) ni el flujo de cierre de día (v1.11): sólo cómo se
  teclean sus importes. Las 11 aserciones del mixto siguen pasando sin cambiar una cifra.
- No se toca impresión, escáner, offline nativo ni la APK.
- No se toca backend ni esquema de base de datos.
- No se toca `PinScreen` ni `ReloginPinModal` (ver **Hallazgo nuevo**).
- No se hace polyfill de `gap`.
- No se hace push ni merge a `master`.
