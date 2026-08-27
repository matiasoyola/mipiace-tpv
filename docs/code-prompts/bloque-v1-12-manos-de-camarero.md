# Bloque v1.12 · Manos de camarero

**Origen**: pruebas físicas sobre AP11-1006 del 2026-08-27
(`docs/qa/2026-08-27-pruebas-fisicas-ap11.md`, capturas en `docs/qa/2026-08-27-ap11/`).
Todo lo de aquí se detectó tocando el terminal con el dedo; nada salió del simulador de 1280×800.

**Premisa de producto**: el camarero ejecuta, no piensa. Ninguna acción de barra puede depender
del teclado del sistema operativo ni de un objetivo táctil de 5 mm.

---

## 0. Base de rama (leer antes de tocar nada)

**Este bloque NO sale de `master`.** Sale de una base de integración con v1.10.3 y v1.11 dentro:

```
master  ←  v1-10-3-barra-hora-punta  ←  v1-11-cierre-de-dia  =  v1-12-base
```

Motivo: los tres campos de importe que hay que convertir a `CashPad` viven en ficheros que esas
dos ramas reescriben enteros. `CheckoutPage.tsx` (cobro mixto) es de v1.10.3;
`ShiftActiveScreen.tsx` y `ShiftForceCloseScreen.tsx` **desaparecen** en v1.11 y su contenido pasa
a `ShiftResumeScreen.tsx` y `DaySummaryCard.tsx`; `CloseShiftModal.tsx` lo tocan las dos.
Trabajar sobre `master` significaría reescribir el bloque entero en el merge.

Si la rama de trabajo no contiene `DaySummaryCard.tsx` y `ShiftResumeScreen.tsx`, **para y avisa**:
la base está mal.

### 0.1 · Resolver la integración (paso 0 del bloque)

Si la rama llega sin las dos ramas mergeadas, hazlo tú antes de escribir una línea de v1.12:

```bash
git merge v1-10-3-barra-hora-punta      # limpio
git merge v1-11-cierre-de-dia           # 4 conflictos esperados
```

Sólo cuatro ficheros se solapan, y la regla de resolución es la misma en todos: **v1.11 manda en
la forma, v1.10.3 manda en el contenido de importes.**

- `apps/tpv-web/src/pages/ShiftForceCloseScreen.tsx` y
  `apps/tpv-web/test/shift-force-close-sync-pending.test.tsx` — v1.11 los **borra** a propósito
  (su contenido vive ahora en `ShiftResumeScreen.tsx`). El borrado se acepta. Lo que v1.10.3 les
  había añadido (formato de importes, unidades humanas de tiempo) **hay que reponerlo** sobre
  `ShiftResumeScreen.tsx`, no restaurar el fichero viejo.
- `apps/tpv-web/src/pages/CloseShiftModal.tsx` — se queda la estructura de v1.11 con los arreglos
  de importe de v1.10.3 dentro.
- `.gitignore` — unir las dos listas.

Al terminar el merge: `pnpm -r test` y `pnpm -r typecheck` en verde **antes** de empezar el
bloque, y un commit propio (`merge · base de integración v1.10.3 + v1.11`) separado del trabajo
de v1.12. Si algo no cuadra, para y pregunta: no reescribas v1.11 para que compile.

## Contexto (leer antes)

- `docs/qa/2026-08-27-pruebas-fisicas-ap11.md` — los 9 hallazgos con medidas y capturas.
- `docs/design/tokens.md` — paleta, radios, tipografía. Nada se inventa fuera de aquí.
- `docs/04-stack-y-decisiones.md` — ADRs de front.
- `docs/blocks/v1-10-3-barra-hora-punta-done.md` y `docs/blocks/v1-11-cierre-de-dia-done.md` —
  qué acaba de cambiar en las pantallas que vas a tocar.
- `apps/tpv-web/src/pages/PinScreen.tsx` (líneas ~380-420) — el keypad del PIN. **Es la
  referencia visual y de comportamiento del `CashPad`**: mismo grid 3 columnas, mismas alturas,
  mismos radios. No inventes un teclado nuevo.

## Alcance

### 1. `CashPad` — teclado numérico propio (el corazón del bloque)

Hoy, tocar cualquier importe abre el teclado de Android: tapa el 52 % inferior de la pantalla,
esconde los métodos de pago y el botón Cobrar, y saca un menú nativo *Cortar / Copiar /
Seleccionar todo* sobre el ticket. Es del sistema operativo: **la APK no lo arregla**.

Dos componentes nuevos en `apps/tpv-web/src/components/`:

- **`CashPad.tsx`** — grid de 4×3: `1..9`, `00`, `0`, `,` · más `⌫` (borrar último) y `C`
  (limpiar). Teclas de **≥ 56 px** de alto. Props: `value: string`, `onChange(next: string)`,
  `maxDecimals = 2`, `disabled`. Sin estado propio: el importe lo posee el formulario.
- **`AmountField.tsx`** — el input de importe: muestra `value` formateado con `tabular-nums`,
  y es `readOnly` + `inputMode="none"` + `onFocus={e => e.target.blur()}` +
  `style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}`.
  Nunca recibe foco de texto, así que el IME del sistema no aparece jamás. Al tocarlo, marca el
  campo como activo y el `CashPad` de la hoja escribe sobre él.

Reglas de escritura del pad (todas con test):

- Se teclea en euros con coma decimal, máximo 2 decimales; el tercer decimal se ignora.
- `00` no antepone ceros a un campo vacío (queda vacío, no `00`).
- Sólo una coma; una segunda pulsación no hace nada.
- El valor se normaliza a céntimos con el helper de `lib/money.ts` (v1.10.3) — **no reimplementes
  el parseo de importes**.
- Campo vacío ≠ `0,00`: vacío significa "no introducido" y el botón de acción sigue bloqueado.

Sustituir por `AmountField` + `CashPad` **todos** los campos de importe:

| Dónde | Fichero (tras la base de integración) | Referencia |
|---|---|---|
| Efectivo entregado | `pages/CheckoutPage.tsx` | `inputMode="decimal"` ~línea 1083 |
| Importe del método secundario (mixto) | `pages/CheckoutPage.tsx` | ~línea 1181 |
| Las 14 denominaciones del arqueo | `pages/CloseShiftModal.tsx` | `inputMode="numeric"` ~401 y ~485 |
| Fondo de caja al abrir turno | `pages/ShiftOpenScreen.tsx` | ~línea 138 |

En el arqueo son **conteos enteros**, no importes: el mismo `CashPad` sin coma
(`maxDecimals = 0`). Una sola instancia de pad por hoja, abajo, fija; el campo activo se resalta.

**El pad no desplaza ni tapa el botón de acción.** La hoja se reparte: cabecera + total arriba,
campo activo, pad, y el botón primario siempre visible en el borde inferior. Verificado a 800 px
de alto (el AP11 a densidad 240) y a 320 px de ancho.

`ReloginPinModal.tsx` y `PinScreen.tsx` ya tienen su propio keypad: **no los toques**, sólo
comprueba que sus inputs cumplen la misma coraza anti-IME (`readOnly` + `inputMode="none"`).

### 2. Objetivos táctiles

Mínimo **48 px de alto** en todo lo que se toca a diario (11 mm ⇒ 64 px en la barra de cobro).
Medido en el terminal:

| Elemento | Fichero | Ahora | Objetivo |
|---|---|---|---|
| Chips de zona, "Nueva venta rápida", "Tickets" | `TableMapScreen.tsx` | 5 mm | ≥ 48 px |
| "Importe exacto", billetes 5/10/20/50/100 | `CheckoutPage.tsx` | 6 mm | ≥ 48 px |
| Métodos de pago | `CheckoutPage.tsx` | 7 mm | ≥ 48 px |
| Barra "Cobrar" | `CheckoutPage.tsx` | 7 mm | ≥ 64 px |
| Casillas de la hoja de cobro | `CheckoutPage.tsx` | 2,5 mm | ≥ 48 px |

No subas la altura a base de `h-[52px]` sueltos: fija la escala en los tokens
(`docs/design/tokens.md` + `tailwind.config.js`) como `touch` / `touch-lg` y úsala. Es la escala
que heredarán los bloques siguientes.

### 3. Higiene de la hoja de cobro

"Enviar por email" y "Ticket regalo" se pliegan tras **Más opciones** (cerrado por defecto).
"Imprimir ticket" se queda visible. En hora punta la pantalla es para el dinero.

### 4. Modal propio en acciones destructivas

Hoy `SalePage.tsx:1600` y `:1607` usan `confirm()`: sale *"mipiacetpv.com dice: ¿Vaciar la
mesa?"* con botones azules de Chrome y dos "Cancelar" que significan cosas opuestas (cancelar la
cuenta vs. cancelar el diálogo).

Crear **`components/ConfirmSheet.tsx`** con los tokens del sistema: título, cuerpo, acción
destructiva en coral y salida neutra, verbos explícitos — **"Vaciar mesa" / "Volver"**,
**"Cancelar la cuenta" / "Seguir con la cuenta"**. Nunca dos botones que empiecen por la misma
palabra. Barrer **todos** los `confirm`/`alert` de `tpv-web` (hoy quedan 2; el test de guardia
debe impedir que vuelvan).

### 5. El Atrás del sistema no puede echar al camarero

Durante el arqueo, el Atrás cerró el modal y acabó expulsando al escritorio de Android **con el
turno abierto**; al volver, Chrome abrió una segunda pestaña que **pedía el PIN otra vez**.

`tpv-web` **no tiene router**: `App.tsx` es una máquina de estados y no hay entradas de historia,
así que el primer Atrás sale de la aplicación. Crear **`hooks/useBackGuard.ts`**:

- Al arrancar, `history.pushState` de un estado centinela; en `popstate`, volver a empujarlo.
- Una pila de capas cerrables: cada hoja/modal se registra al abrirse
  (`useBackGuard(onClose, isOpen)`) y el Atrás cierra **la de más arriba**.
- Sin capas abiertas, el Atrás **no hace nada** si hay turno abierto (o, si estás dentro de una
  venta, vuelve al mapa de mesas — nunca al escritorio).
- Y que ningún botón destructivo (cerrar turno) quede bajo el dedo mientras se teclea: revisa la
  posición de "Cerrar turno" respecto del pad del arqueo.

### 6. Navegador no soportado: decirlo, no pintar basura

Chrome 81 no soporta `gap` en flexbox (llegó en el 84) y la UI usa `gap-*` en **245 sitios**: en
el navegador de fábrica del AP11 los textos salen pegados ("Sala5 abiertas", "GEgemmamgc720,00 €").
No se polirrellena: se bloquea con honestidad.

**`lib/browser-support.ts`**, comprobado en `main.tsx` **antes** de montar React:

```ts
export function flexGapSupported(): boolean {
  const el = document.createElement("div");
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.rowGap = "1px";
  el.appendChild(document.createElement("div"));
  el.appendChild(document.createElement("div"));
  document.body.appendChild(el);
  const ok = el.scrollHeight === 1;
  el.parentNode?.removeChild(el);
  return ok;
}
```

(`CSS.supports("gap", "1px")` **no vale**: Chrome 81 lo soportaba en grid y devuelve `true`.)

Si falta soporte, pintar una pantalla de bloqueo **en HTML plano con estilos en línea y sin
`gap`** (si dependiera de `gap` saldría rota igual): logo, "Este navegador es demasiado antiguo
para el TPV", "Actualiza Chrome desde Play Store o instala la aplicación Mi Piace TPV", y la
versión del navegador detectada, para que soporte sepa qué tiene delante. Sin botón de "continuar
igualmente".

## Restricciones

- Estética y tokens: `docs/design/tokens.md` + `sistema-visual-mipiace`. Cero colores nuevos,
  radios de la escala cerrada, `tabular-nums` en todo importe, sentence case.
- Sin dependencias nuevas. El `CashPad` es nuestro, no de una librería.
- Sin modales en flujo crítico salvo el `ConfirmSheet` de acciones destructivas (§4).
- Nada de lógica fiscal ni de cálculo: este bloque **no toca importes calculados**, sólo cómo se
  teclean. El parseo va por `lib/money.ts`.
- Puedes usar el MCP de **21st** para buscar estructura de keypad/bottom-sheet; normalízalo a los
  tokens del proyecto antes de cerrar el bloque, y lístalo en el `Bx-done.md`.
- Apóyate en **context7** para APIs de React/Tailwind de la versión real del repo.
- Commits en la rama del bloque; **no hagas push**.

## Entregables

- `apps/tpv-web/src/components/CashPad.tsx`, `AmountField.tsx`, `ConfirmSheet.tsx`
- `apps/tpv-web/src/hooks/useBackGuard.ts`
- `apps/tpv-web/src/lib/browser-support.ts` + gancho en `main.tsx`
- Cambios en `CheckoutPage.tsx`, `CloseShiftModal.tsx`, `ShiftOpenScreen.tsx`,
  `TableMapScreen.tsx`, `SalePage.tsx`
- Escala táctil en `tailwind.config.js` + `docs/design/tokens.md` actualizado
- Tests: reglas del pad (coma, `00`, decimales, vacío≠0), ausencia de `confirm`/`alert` en
  `tpv-web` (test de guardia que recorre `src/`), pila del back-guard, pantalla de bloqueo cuando
  `flexGapSupported()` devuelve `false`
- `docs/blocks/v1-12-manos-de-camarero-done.md` con la plantilla de cierre completa, incluida la
  sección de **decisiones tomadas sin preguntar**

## Bucle visual (obligatorio antes del cierre)

Levanta el dev server y captura con Playwright tu propio resultado; revísalo contra los tokens y
los principios UX, e itera hasta que cuadre. Matriz mínima de capturas en el `Bx-done.md`:

- **1280×800** (el AP11 a densidad 240) — hoja de cobro con el pad abierto, arqueo con el pad,
  mapa de mesas
- **390** y **320** de ancho — hoja de cobro y arqueo
- `ConfirmSheet` de "Vaciar mesa"
- Pantalla de bloqueo de navegador no soportado

En cada captura de hoja de cobro tiene que verse el botón primario **sin hacer scroll**.

## Fuera de alcance (explícito)

- **No** se toca la lógica de cobro mixto (v1.10.3) ni el flujo de cierre de día (v1.11): sólo
  cómo se teclean sus importes.
- **No** se toca impresión, escáner, offline nativo ni la APK (bloques A-x).
- **No** se toca el backend ni el esquema de base de datos.
- **No** se toca `PinScreen` ni `ReloginPinModal` más allá de verificar la coraza anti-IME.
- **No** se hace polyfill de `gap`: se bloquea el navegador y punto.
- **No** se hace push ni se mergea a `master`.

## Criterios de aceptación

1. En el AP11 físico no aparece el teclado de Android en ningún punto del cobro ni del arqueo.
2. Todos los controles de uso diario miden ≥ 48 px de alto (la barra de cobro ≥ 64 px);
   verificado con captura del terminal.
3. No queda ningún `window.confirm`/`alert` en `tpv-web`, y hay un test que lo impide en el futuro.
4. El Atrás del sistema no saca de la aplicación con un turno abierto.
5. Con un navegador sin soporte de `gap` en flexbox sale la pantalla de bloqueo, no la UI descuadrada.
6. Suite completa y typecheck en verde; CI de rama verde antes del merge.
