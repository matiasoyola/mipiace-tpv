# Bloque v1.3-UX-Iteración · 3 lotes

Feedback en tablet apaisado durante el piloto activo de Peluquería Sole (2026-05-27). Master tras el merge de `v1-3-piloto-feedback` + hotfixes 8/9/10 (commit `eda911b`). Crea rama `v1-3-ux-iteracion` desde master, un commit por lote, sin merge.

## Contexto

El cajero usa la tablet en apaisado (1024×600 típico, Chrome Android). Tres dolores recurrentes detectados en uso real:

1. **Pull-to-refresh de Chrome saca al cajero del PIN.** Cuando hace scroll desde el tope del catálogo para ver más productos, Chrome interpreta el gesto como "recargar" → la PWA se reinicia → pierde la sesión del cajero → vuelve a la PinScreen. Es operativamente inaceptable en mitad de un cobro.

2. **La columna del ticket en venta se va con el scroll del catálogo.** Cuando el catálogo es largo, el cajero scrollea para encontrar un producto y pierde de vista las líneas ya añadidas + el total + el botón "Cobrar".

3. **Sidebar izquierdo ocupa espacio que necesita el catálogo.** En apaisado la columna fija del menú (Cerrar/Bloquear, etc.) se come ancho útil. El cajero prefiere verlo sólo cuando lo necesita.

4. **El teclado Android tapa el total + botón Cobrar al enfocar inputs** (email cliente, búsqueda contactos, efectivo recibido). Es el mismo problema en apaisado: el viewport se reduce a la mitad y los elementos críticos quedan ocultos.

5. **Caché del Service Worker sirve datos viejos.** Tras un cambio en Holded (un tag nuevo, un servicio recién activado, un ticket nuevo), el TPV sigue mostrando el catálogo/historial anterior hasta que se cierra y reabre la PWA. Ya nos pasó en task #55 con los tags, y ahora se manifiesta en historial vacío (#81) y filtro de tag "Tinte y color" (#92).

Los 3 lotes son independientes; se pueden commitear por separado en cualquier orden.

---

## Lote 1 · Layout TPV apaisado (columna ticket sticky + sidebar drawer + sin pull-to-refresh)

**Motivo**: cierra los puntos 1, 2 y 3 del contexto. Es el lote más visible para el cliente: cambia drásticamente la sensación de usar el TPV.

**Cambios**:

(1) **Disable pull-to-refresh global.**

En `apps/tpv-web/index.html` añadir en el `<head>` (si no están ya):

```html
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="theme-color" content="#0F172A" />
```

En el CSS global (`apps/tpv-web/src/index.css` o equivalente):

```css
html, body {
  overscroll-behavior-y: contain;
  overscroll-behavior-x: contain;
  /* PWA standalone también lo deshabilita, pero en Chrome navegador no.
     `contain` evita el pull-to-refresh y el bounce horizontal. */
}
```

Verifica que tras este cambio NO se rompe el scroll interno de listas (productos, historial) — sólo se desactiva el gesto a nivel raíz.

(2) **Columna ticket en venta sticky/fixed.**

`apps/tpv-web/src/pages/SalePage.tsx` línea ~1224 tiene:

```tsx
<div className="flex-1 grid lg:grid-cols-[1fr_360px] gap-4 lg:gap-6 p-4 md:p-7 min-h-0">
```

Cambia el layout para que en `lg+` (apaisado tablet):
- El contenedor padre tiene `h-screen overflow-hidden`.
- La columna izquierda (catálogo) tiene su propio `overflow-y-auto` interno.
- La columna derecha (ticket) tiene `h-full overflow-hidden flex flex-col` y dentro:
  - El header del ticket (badge mesa/cajero, etc.) fijo arriba.
  - La lista de líneas con `flex-1 overflow-y-auto` (scroll interno propio).
  - El footer con Total + Cobrar `flex-shrink-0` pegado abajo.

Resultado: el cajero scrollea el catálogo SIN tocar el ticket. El ticket scrollea sus líneas SOLO si rebasa la altura disponible.

En móvil (vertical) mantener el comportamiento actual (apilado).

(3) **Sidebar izquierdo → drawer off-canvas.**

Hoy el sidebar de TPV (botones Cerrar turno, Bloquear, Tickets, etc.) está siempre visible. Cámbialo a drawer:

- Por defecto oculto. Botón hamburger en la esquina superior izquierda (icono `Menu` de lucide-react, h-10 w-10).
- Al pulsar el hamburger: aparece un panel deslizando desde la izquierda, ancho ~280px, con overlay semitransparente a la derecha que cierra al tocar.
- Al pulsar cualquier acción del drawer, se cierra automáticamente.
- Animación de entrada/salida de ~150ms (`transition-transform`).
- Mantener accesible por teclado: `Esc` cierra el drawer; focus trap mientras abierto.

Aprovecha para no mover el resto del layout cuando el drawer está abierto (es overlay, no empuje).

**Tests/QA**:
- Abrir TPV en Chrome Android apaisado, scrollear el catálogo hacia abajo desde el tope → NO se recarga la página.
- Añadir 8 productos al ticket → la lista del ticket scrollea sin que el total se vaya de vista.
- Pulsar hamburger → drawer aparece. Pulsar fuera → cierra. Pulsar Cerrar turno → ejecuta acción y cierra.

**Why**: cierra task #82 + el bug crítico del PIN tras pull-to-refresh + el feedback explícito de Matías de 2026-05-27.

---

## Lote 2 · Teclado Android no tapa UI

**Motivo**: punto 4 del contexto. El teclado en pantalla ocupa hasta 40-50% de la altura en apaisado; los inputs críticos quedan ocultos.

**Cambios**:

(1) **Variable CSS `--keyboard-offset` driven por `visualViewport`.**

Crear `apps/tpv-web/src/lib/visualViewportSync.ts`:

```ts
// Sincroniza el alto del teclado virtual con una variable CSS global.
// El TPV usa --keyboard-offset para pegar el footer (total + Cobrar)
// por encima del teclado en vez de quedar oculto.
export function startVisualViewportSync(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const update = () => {
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty(
      "--keyboard-offset",
      `${offset}px`,
    );
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
  };
}
```

Llamarlo desde `App.tsx` (o el root del TPV) en `useEffect`. Cleanup en unmount.

(2) **Aplicar `--keyboard-offset` al footer del ticket.**

En `SalePage.tsx`, el bloque del footer (Total + Cobrar) ya queda como `flex-shrink-0` tras el Lote 1. Añadir:

```tsx
<div
  className="flex-shrink-0 ..."
  style={{ paddingBottom: "var(--keyboard-offset, 0px)" }}
>
```

Esto empuja el contenido del footer HACIA ARRIBA cuando aparece el teclado, manteniéndolo visible justo encima.

Aplicar la misma lógica al footer del Checkout (cobro) y al de Refund si los tienen.

(3) **`scrollIntoView` en `onFocus` de buscadores e inputs cliente.**

En los inputs de búsqueda (clientes en CheckoutPage, productos en SalePage, historial en TicketsHistoryPage):

```tsx
onFocus={(e) => {
  // Espera al próximo frame para que visualViewport ya tenga el alto
  // post-teclado (~100ms tarda Android en ajustar).
  setTimeout(() => {
    e.target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 150);
}}
```

Esto asegura que el campo enfocado quede centrado en el viewport visible y que el dropdown de resultados (debajo del input) sea visible.

**Tests/QA**:
- En tablet Android apaisado, enfocar el input "Efectivo recibido" en CheckoutPage → el panel inferior queda visible justo encima del teclado.
- Enfocar el buscador de clientes → el dropdown aparece visible, no oculto detrás del teclado.

**Why**: cierra el item (b) y (c) del feedback de Thalía. Sin esto, el cajero acaba escribiendo a ciegas el email del cliente.

---

## Lote 3 · Service Worker NetworkFirst + botón Sincronizar

**Motivo**: punto 5 del contexto. Tasks #81 e #92 sospechosamente apuntan a caché vieja, además del precedente confirmado de #55.

**Cambios**:

(1) **Auditar la estrategia actual del SW** (`apps/tpv-web/vite.config.ts` o `workbox-config.js`).

Si las rutas `/tpv/catalog/products` y `/tickets` están como `CacheFirst` o `StaleWhileRevalidate`, cambiarlas a `NetworkFirst` con `networkTimeoutSeconds: 5`. El offline puede seguir funcionando con un fallback de caché pero la prioridad debe ser red.

(2) **Versionar el SW por commit hash, no por timestamp ni por package version.**

En `vite.config.ts` (PWA plugin):

```ts
VitePWA({
  registerType: "autoUpdate",
  workbox: {
    cleanupOutdatedCaches: true,
    // El plugin ya invalida la caché cuando cambia el SW.
    // Asegurarnos de que cada build cambia el SW: useamos el commit
    // hash inyectado por CI o por define.
  },
  manifest: { ... },
}),
```

Inyectar `import.meta.env.VITE_BUILD_HASH` desde `git rev-parse --short HEAD` en build time, y embebido en el SW para que el contenido cambie en cada commit.

(3) **Botón "Sincronizar" en SalePage y TicketsHistoryPage.**

En el drawer (Lote 1), añadir un botón "Sincronizar catálogo" que:

```ts
async function syncNow() {
  if (navigator.serviceWorker?.controller) {
    // Manda mensaje al SW para purgar caché de runtime.
    navigator.serviceWorker.controller.postMessage({ type: "PURGE_RUNTIME" });
  }
  await refreshCatalog();
  toast.success("Catálogo actualizado");
}
```

En el SW, añadir handler:

```ts
self.addEventListener("message", (ev) => {
  if (ev.data?.type === "PURGE_RUNTIME") {
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.includes("runtime"))
          .map((k) => caches.delete(k)),
      ),
    );
  }
});
```

En TicketsHistoryPage añadir el mismo botón para el historial.

(4) **Test funcional**: crear un servicio nuevo en Holded → sync incremental backend lo trae → en el TPV pulsar "Sincronizar" → el servicio nuevo aparece en menos de 5 segundos sin reiniciar la PWA.

**Why**: cierra #81, #92 y la causa raíz de futuros problemas similares. El precedente #55 ya lo dejó claro: en producción real el catálogo cambia constantemente y `CacheFirst` envenena la experiencia.

---

## Convenciones (recordatorio)

- Un commit por lote, mensaje `Lote X · v1.3-UX-Iteración · ...`.
- NO mergear. Espero `git merge --ff-only` manual desde master.
- Tests unitarios donde tenga sentido (los de Lote 2 y 3 son testables en jsdom; el Lote 1 es visual y se valida en device).
- Si encuentras un blocker o ambigüedad, anótalo en el cuerpo del commit y sigue con el resto.
