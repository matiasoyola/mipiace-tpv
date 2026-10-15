# Bloque kds-2b · lo que encontró la pasada en el hierro del 15-10

Rama `kds-2b-hierro`, **sale de `7f74ef1`** (lo que corre en producción y lo que lleva la APK 1.24.0),
NO de master: master lleva clinica-7, que no se puede desplegar sin la ceremonia de claves, y una APK
de master llamaría a rutas que producción no tiene. Al terminar, PR contra master.

Lee antes: `docs/blocks/kds-1-cocina-done.md`, `docs/blocks/kds-2-wifi-done.md` y las capturas de
`docs/qa/2026-10-15-kds-hierro/` (en la carpeta principal del repo, sin commitear; cópialas a la rama).
Hallazgos completos en el doc de proyecto `claude/pasada-hierro-kds-2026-10-15.md` (resumen abajo).

**Regla de entrega:** todo lo que se pueda arreglar en la PANTALLA (tpv-web) se arregla ahí, porque
llega con una APK sin desplegar el servidor. Lo del servidor va además, pero no se cuenta con él.

## 1 · 🔴 Tarjeta fantasma tras «Lista», sin alérgenos (bloquea la fecha de La Maestranza)

Reproducción real (D8 TPV + AP11 cocina, ambos con internet, misma wifi): enviar M5 con celíaco en la
silla 3 y bravas (GLUTEN) a la silla 3 → tachar todo → «Lista». La M5 pasa a LISTAS **y además** su
tarjeta reaparece en el centro, sin tachados, con el «ERAN 2 · −1» ya visto, y **las bravas como
«SILLA 3 · SIN GLUTEN» sin «¡LLEVA GLUTEN!»**. Reiniciar la app la quita.

Causa localizada: el TPV manda SIEMPRE por los dos caminos (nube + wifi). La copia de la wifi vive en
`useCocinaLan().extras` y `sinDuplicados()` (`apps/tpv-web/src/kitchen/useCocinaLan.ts:511`) sólo la
descarta contra `vista.orders` (abiertas). Al pasar la de la nube a `ready`, la de la wifi pierde su
gemela y se pinta. Arreglo esperado:
- descartar contra **todo lo que el servidor conoce** (abiertas + listas, y lo servido que haya en la vista);
- y **soltar del almacén local** las comandas de la wifi en cuanto un GET correcto trae su gemela
  (hoy sólo se sueltan «al volver la red»; con internet siempre puesto no se sueltan nunca y crecen).
  Revisa también `CLAVE_RECIBIDAS` en localStorage: que no reanime la fantasma tras un reinicio.

Segunda mitad del mismo fallo — **la copia de la wifi llegó sin alérgenos del plato**. La compone el TPV
(`envioLan.ts` con `alergenosPorLinea` de `SalePage.tsx:1788`, que salen de `line.allergens`, que salen
del catálogo del TPV). Los alérgenos de ENSAYO se cargaron por script a las 13:21 y el D8 (sin
`pm clear`, catálogo en caché) no los tenía. Averigua y deja dicho en el `-done`:
- si un cambio de alérgenos (por script o desde el panel) invalida la caché de catálogo del TPV;
- si no la invalida, arréglalo (que el cambio de alérgenos cuente como cambio de catálogo).
Sin esto, en un apagón la cocina de La Maestranza no recibe ningún «¡LLEVA GLUTEN!».

## 2 · Al tachar, el plato salta al final de la tarjeta

Tachar un plato lo manda abajo y los demás suben: el siguiente toque cae en otro plato (se tacha o
destacha el equivocado con prisa). Causa: `apps/api/src/kitchen/vista.ts` selecciona `lines` **sin
`orderBy`** y Postgres devuelve la fila recién actualizada al final.
- **Pantalla (lo que llega con la APK):** el orden de las líneas de una tarjeta no puede cambiar al
  tacharlas. Que la pantalla conserve el orden en que vio cada línea por primera vez (las nuevas, al
  final), sea cual sea el orden que traiga el GET.
- **Servidor (además):** `orderBy` estable en las líneas (el orden de la comanda en el TPV).

## 3 · El total del D8 no se recalcula tras «−» en una línea ya enviada

Croquetas 2 → «−» → la línea dice 1 · 10,00 € pero el TOTAL sigue en 43,40 € (debía ser 33,40 €) y la
mesa en la sala también dice 43,40 € — hasta salir y volver a entrar. El cobro fue correcto (45,40 € con
los calamares). Localízalo en `SalePage` (el «−» con margen de Deshacer de las líneas EN COCINA) y que el
total y la tarjeta de la mesa cambien en el momento, también si se pulsa «Deshacer».

## 4 · Plato sin alérgenos informados en una mesa con alergia

El magro (sin alérgenos informados: `allergens = {}` es «no informado», no «sin alérgenos») sale como
«SILLA 3 · SIN GLUTEN», igual que uno comprobado. Decisión tomada: si el plato va a una silla con
alergia y su producto **no tiene alérgenos informados**, la cocina lo ve marcado como
**«ALÉRGENOS SIN INFORMAR»** (que se distinga de un plato comprobado). Mismo criterio en el camino de la
wifi y en el del servidor.

## Cierre

- Tests que se pongan **rojos** si se rompe lo que cubren (tabla de sabotajes en el `-done`, como en
  kds-1 y kds-2). Para el 1, un sabotaje que reproduzca exactamente la secuencia de la pasada.
- Bucle visual de la pantalla de cocina con capturas.
- `docs/blocks/kds-2b-hierro-done.md` con decisiones tomadas sin preguntar.
- Push de la rama y PR contra master. No despliegues ni publiques nada: la APK 1.25.0 desde la rama y
  la pasada repetida en el D8 + AP11 las hace Dirección con Matías.
