# Bloque hotfix-menu-capabilities · «Bonos» y «Contrato de datos» salen en cuentas que no los tienen, y Bonos se queda cargando para siempre

Rama `hotfix-menu-capabilities`, worktree `~/Developer/Claude/Projects/mipiacetpv-hotfix-menu`, desde
`origin/master`. PR contra `master`. Escrito el 23-10-2026 desde el proyecto de Jardín de Gredos.
**Hotfix: pequeño, sin pantallas nuevas, se despliega en cuanto esté verde.**

## Qué pasa (encontrado en producción, cuenta de Jardín de Gredos)

1. **El filtro del menú olvida dos capabilities.** En `apps/admin/src/AdminShell.tsx`, `visibleItems`
   evalúa `agenda`, `caja`, `holded`, `fichaje`, `holdedDejado` y `residencia`, y todo lo demás cae en
   `return true`. Las entradas con `capability: "bonos"` («Bonos») y `capability: "clinica"`
   («Contrato de datos») **se pintan en todas las cuentas**: «Bonos» en todas, y «Contrato de datos» en
   todo OWNER aunque su cuenta no tenga la clínica.
2. **`BonosPage.tsx` se queda en «Cargando bonos…» para siempre** cuando la API contesta con error (en
   una cuenta sin bonos, la 404 del módulo): el `catch` guarda el error, pero el gate sólo pinta el
   aviso si `error === null`, y después `!ajustes` devuelve el loader. El error nunca se enseña.

## Qué hay que hacer

1. En el filtro del menú, `bonos` y `clinica` como las demás: `=== true`, y mientras `caps` es `null`
   no se pinta (para no parpadear). **Y que no vuelva a pasar**: que una capability declarada en el
   tipo de `NavItem` y no evaluada en el filtro sea un error de tipos o de test (p. ej. un `switch`
   exhaustivo con `never`, o un test que recorre `NAV_ITEMS` y comprueba que cada capability tiene su
   rama). Sin `return true` silencioso para capabilities desconocidas.
2. En `BonosPage.tsx`: si hay error y no hay datos, se enseña el error (o el aviso de «no tiene los
   bonos encendidos» si es la 404 del módulo), nunca el loader. Revisa de paso si alguna otra página
   del admin tiene el mismo patrón (error guardado + loader mientras no hay datos) y arréglala igual;
   lista en el done cuáles.
3. Comprueba que las rutas siguen dando la 404 de siempre a quien no tiene el módulo (esconder no es
   gatear).

## Cómo se cierra

- Tests: una cuenta sin bonos no ve «Bonos»; una sin clínica no ve «Contrato de datos»; una con
  residencia ve «Contrato de datos»; `BonosPage` con 404 pinta el aviso y no el loader; el test que
  impide una capability sin rama.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/hotfix-menu-capabilities-done.md` corto: qué se arregló, qué otras páginas tenían el
  patrón, qué hay que hacer al desplegar (nada especial salvo desplegar).
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
