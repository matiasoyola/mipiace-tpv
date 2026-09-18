# Addendum 1 · la pantalla "Catálogo" también se le enseña al tenant con Holded

Decisión de Matías, 2026-09-13, sobre `bloque-catalogo-local.md`. No reabre nada del
prompt: lo concreta donde estaba abierto.

## La decisión

La entrada **"Catálogo"** (capability `caja`) la ven **todos** los tenants con caja,
también los que tienen Holded conectado. Para ellos es un **listado de solo lectura**.

## Por qué

Hoy el admin no tiene ninguna pantalla que enseñe el catálogo que el TPV va a vender.
La única pantalla bajo "Productos" es la bandeja de SKUs silenciados. Esa ceguera es lo
que dejó **54 servicios de Peluquería Sole invisibles durante semanas** en mayo de 2026
sin que nadie lo viera: no había dónde mirar.

El listado no es una pantalla de consulta: es el diagnóstico de *por qué el TPV no
vende lo que el propietario cree que vende*.

## Qué implica, concretamente

- El listado muestra **todos** los productos del tenant, con el **origen visible**
  (`Holded` | `Local`) como dato de primera clase, no como detalle escondido.
- Las columnas sirven al diagnóstico, no al adorno: nombre, SKU, precio, tipo de IVA,
  `kind`, activo y **vendible por el TPV**. Los tres filtros de
  `tpv-catalog/routes.ts:81-86` (`active`, `sellableViaTpv`, `sku` no nulo) tienen que
  poder leerse en la fila, para que se vea **por qué** algo no aparece en la caja.
- `source = HOLDED`: **sin acciones de edición**, y el motivo **escrito en la pantalla**
  ("manda Holded; el sync lo pisa a los 15 minutos"). No un campo gris, no un tooltip.
- El **botón de alta sólo se pinta** si el tenant NO tiene Holded conectado, **y además**
  la ruta de la API responde **403** si lo tiene (patrón de `caja-gate.ts`). Las dos
  cosas, no una: el botón es cortesía, el 403 es la puerta.
- Estado vacío informativo, como ya pedía el prompt.

## Lo que hay que decir en el done-doc, sin darlo por supuesto

Esto **cambia el sidebar** de Sole, Cachitos, Thalía y La Maestranza: les aparece una
entrada nueva.

El criterio 4 del prompt ("un tenant con Holded se comporta exactamente igual que
antes") sigue en pie y se refiere a **cobro, sync y catálogo**: la pantalla es aditiva y
no toca ninguno de esos caminos. Pero el done-doc tiene que decir explícitamente que el
sidebar sí cambia, y demostrar que el 403 del alta local está probado contra un tenant
con Holded conectado, no sólo asumido por el botón que no se pinta.
