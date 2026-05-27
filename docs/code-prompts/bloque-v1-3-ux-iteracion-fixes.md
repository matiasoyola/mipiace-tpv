# Bloque v1.3-UX-Iteración-fixes · 5 fixes

Tras el deploy del bloque `v1.3-UX-Iteración` (commits 140ac3e/18b786d/2734b92, mergeados en master), feedback del piloto Peluquería Sole en caliente. Master en commit posterior al merge. Crea rama `v1-3-ux-iteracion-fixes` desde master, un commit por fix, sin merge.

## Contexto

El layout apaisado del Lote 1 + scrollFocusIntoView del Lote 2 introdujeron varios efectos colaterales:

1. **Los chips de categoría ya no se ven.** Probable: el contenedor del catálogo con `lg:overflow-y-auto` (en `section.flex.flex-col` de SalePage línea ~1315) los empuja fuera del viewport o quedan colapsados detrás del grid.
2. **El buscador de productos roba el foco al cargar la página.** Esto abre el teclado Android automáticamente — Matías lo odia profundamente (lleva meses pidiendo "que el teclado no se llame solo"). Probablemente algún `autoFocus` o el `scrollFocusIntoView` del Lote 2 dispara `focus()` al primer paint.
3. **Copy en el cobro: "Confirmar cierre"** debería ser **"Cobrar"** en el botón principal del CheckoutOverlay.
4. **Atajos de efectivo SUMAN en lugar de SETEAR.** Pulsar el atajo "20€" cuando el campo tiene "10" debería dejar "20", no "30". Bug funcional, no UX.
5. **El teclado en general se llama demasiado fácil.** Hay un patrón sistémico de llamadas a `.focus()` programáticas que disparan el IME de Android sin que el cajero lo haya pedido.

Los 5 fixes son independientes. Pueden ir en commits separados.

---

## Fix 1 · Chips de categoría visibles tras el nuevo layout

**Motivo**: el cajero filtra el catálogo con los chips ("Todos", "Tinte y color", "Cortes y peinados"…). Sin ellos, la pantalla está rota para el flujo principal de un piloto SERVICES.

**Cambios en `apps/tpv-web/src/pages/SalePage.tsx`**:

La barra de chips está alrededor de la línea 1372:

```tsx
<div className="flex items-center gap-2 mb-4 md:mb-6 overflow-x-auto">
```

Dentro de la `<section className="flex flex-col min-w-0 order-2 lg:order-1 lg:h-full lg:min-h-0 lg:overflow-y-auto">`. Como la section es la que scrollea verticalmente, los chips quedan al inicio del scroll y se ocultan al desplazar la grid de productos.

**Solución sugerida**: extraer la barra de chips a un contenedor **`flex-shrink-0 sticky top-0`** dentro de la section (o sacarla fuera de la zona `overflow-y-auto`), con `bg-mipiace-stone` para que tape el contenido al hacer scroll. Algo así:

```tsx
<section className="flex flex-col min-w-0 order-2 lg:order-1 lg:h-full lg:min-h-0">
  {/* Barra de chips fija */}
  <div className="flex-shrink-0 sticky top-0 z-10 bg-mipiace-stone py-2">
    <div className="flex items-center gap-2 overflow-x-auto">
      {/* ...chips actuales... */}
    </div>
  </div>
  {/* Zona scrollable solo para grid */}
  <div className="flex-1 min-h-0 lg:overflow-y-auto">
    {/* favoritos sub-grid + grid principal */}
  </div>
</section>
```

Valida en apaisado (1024×600) y vertical que los chips se ven siempre y que el scroll del grid sigue funcionando.

**Why**: cierra task #96.

---

## Fix 2 · Quitar autoFocus del buscador de productos al cargar SalePage

**Motivo**: el cajero entra al TPV, no quiere teclear → quiere tocar tiles de productos/servicios. El foco automático abre el teclado y oculta media pantalla.

**Cambios**:

En `apps/tpv-web/src/pages/SalePage.tsx`, busca el `<input>` del buscador de productos (probablemente tiene `placeholder="Buscar producto..."` o similar). Verifica si tiene `autoFocus` o si algún `useEffect` llama a `inputRef.current?.focus()` al montar. Quítalo.

**Comportamiento esperado**:
- Al cargar la pantalla, NINGÚN input recibe foco automáticamente.
- El teclado solo aparece si el cajero toca explícitamente el input.

**Why**: cierra task #97. Si el Lote 2 introdujo `scrollFocusIntoView` en el `onFocus` del buscador, NO quites eso — solo el autoFocus al montar.

---

## Fix 3 · Copy "Confirmar cierre" → "Cobrar" en CheckoutOverlay

**Motivo**: castellano natural. "Cerrar el cobro" o "Confirmar cierre" suena raro al cajero.

**Cambios**:

Busca el string `"Confirmar cierre"` en el repo (probable en `apps/tpv-web/src/pages/CheckoutPage.tsx` o `CheckoutOverlay.tsx`). Reemplaza por `"Cobrar"`.

Si hay un caso donde "Confirmar cierre" sigue siendo correcto (cerrar turno, no cobro), revisa que NO lo cambies allí. Confirma con grep que solo aparece en el contexto del cobro.

**Why**: cierra task #98.

---

## Fix 4 · Atajos de efectivo: SET, no SUM

**Motivo**: bug funcional. El cajero pulsa "20€" creyendo que pone 20 en el campo; en realidad lo suma a lo que ya hay → confusión + cobros mal calculados.

**Cambios**:

Buscar los atajos de efectivo (probablemente en `CheckoutPage.tsx` o un componente de cobro mixto). Habrá algo como:

```tsx
<button onClick={() => setAmount(amount + 20)}>20€</button>
// o
<button onClick={() => setAmount((a) => a + 20)}>20€</button>
```

Cambiar a:

```tsx
<button onClick={() => setAmount(20)}>20€</button>
```

Verifica los atajos típicos (5, 10, 20, 50, 100). El comportamiento esperado: pulsar un atajo establece ese valor exacto en el campo, sobrescribiendo lo que hubiera.

**Test**: en CheckoutPage, escribir manualmente "10" en el campo billete recibido → pulsar "20" → el campo debe pasar a "20.00" (no "30.00").

**Why**: cierra task #99. Bug histórico de ese campo, mencionado por Matías como "ya nos ha dado problemas alguna vez".

---

## Fix 5 · Auditoría general: no llamar `.focus()` salvo si el usuario tocó

**Motivo**: rige sobre el resto. Cualquier patrón sistémico que abra el teclado sin acción explícita del cajero está mal en este TPV.

**Auditar y limpiar**:

(1) Buscar en `apps/tpv-web/src/` todas las llamadas a `.focus()`, `autoFocus`, y `scrollFocusIntoView`. Para cada una, justificar:
- **Mantén** si está dentro de un `onClick`/`onPointerDown` del usuario (acción explícita).
- **Mantén** si está dentro de un `onFocus` (el usuario ya enfocó, solo lo centramos).
- **Quita** si está en un `useEffect` que se ejecuta al montar.
- **Quita** si está en respuesta a un cambio de ruta sin acción del usuario.

(2) Reglas para inputs del TPV:
- Buscadores nunca tienen `autoFocus`.
- Inputs de cobro (efectivo recibido, etc.) nunca tienen `autoFocus`.
- Si quieres pre-rellenar un input, hazlo con `value` (controlled), no con `focus`.

(3) `visualViewportSync` (introducido en Lote 2) puede quedarse — eso solo ajusta el CSS, no llama a focus.

**Test general**: en cada pantalla del TPV, al cargar, el teclado Android NO debe aparecer. Solo aparece al tocar explícitamente un input.

**Why**: cierra task #100. Es una iteración general sobre la "agresividad" del foco. Si encuentras casos límite legítimos donde el foco automático mejora la UX (p.ej. modal de PIN, modal de cantidad), documenta el caso en el commit y mantén el foco — pero piensa dos veces si realmente es necesario.

---

## Convenciones

- Un commit por fix, mensaje `Fix N · v1.3-UX-Iteración-fixes · ...`.
- NO mergear. Espero `git merge --ff-only` desde master.
- Tests donde tenga sentido (Fix 4 es testable; el resto es visual).
- Si encuentras un blocker, anótalo en el commit y sigue con el resto.
