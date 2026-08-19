# Diseño · Operativa del TPV diferenciada por rol

**Estado:** auditoría CTO 2026-07-03 · matriz actual verificada sobre código en prod (post v1.6/v1.7). Decisiones de producto pendientes de Matías marcadas ⚖️.
**Principio (Matías, 2026-07-03):** no es la misma operativa un OWNER que un simple cajero — darle a cada rol lo que su operativa necesita.

## 1. Cómo funciona el rol hoy en el TPV

- Pueden hacer login por PIN: OWNER, MANAGER y CASHIER (`cashier-auth.ts`).
- **El OWNER opera el TPV como si fuera MANAGER**: el frontend tipifica el rol como `"MANAGER" | "CASHIER"` y el OWNER pasa todos los gates de manager. Funcionalmente correcto, pero impide darle al OWNER nada exclusivo. Si la fase 2 lo necesita, hay que ensanchar el tipo.

## 2. Matriz ACTUAL (verificada)

| Funcionalidad | CASHIER | MANAGER/OWNER | Notas |
|---|---|---|---|
| Vender / cobrar / cancelar carrito | LIBRE | LIBRE | |
| Cerrar turno propio | LIBRE (opt-in PIN por flag tenant) | LIBRE | Con SYNC_FAILED pendientes → PIN manager SIEMPRE |
| Force-close turno ajeno | PIN MANAGER | LIBRE | |
| Arqueo X y recuento del Z | Recuento CIEGO | Recuento CIEGO | El esperado/descuadre solo aparece TRAS cerrar |
| Descuento % | LIBRE hasta umbral del tenant | LIBRE hasta umbral | Sobre umbral → PIN manager (5 min token). El umbral es por tenant, no por rol |
| **Modificar precio de línea (v1.6)** | **LIBRE** | LIBRE | Sin gate de rol NI de PIN en retail; en mesa no existe |
| **Devoluciones (refunds)** | **LIBRE, sin límite** | LIBRE | Sin umbral, sin PIN — solo queda auditado `createdByUserId` |
| Historial de tickets del turno | Ve TODOS los del turno | Ve todos | Caja compartida: probablemente intencional |
| Reimprimir / línea libre / guardar-pendientes | LIBRE | LIBRE | |
| Mesas (mover/agrupar) | LIBRE | LIBRE | |

## 3. Los dos agujeros que la matriz destapa

1. **Devoluciones libres para cualquier cajero.** El fraude interno nº1 del retail es la devolución falsa (se marca devolución, se queda el efectivo). Hoy un CASHIER puede hacer refunds ilimitados sin PIN. Dato: el descuento >umbral SÍ pide PIN, la devolución del 100% no — incoherente.
2. **Modificar precio libre para cualquier cajero** (desde v1.6 además es más cómodo). Cachictos lo pidió por agilidad del dueño; en una tienda con empleados es un vector de "precio a 1 € para el amigo". Queda auditado (`unitPriceOverride` persiste) pero sin freno.

## 4. Propuesta · Fase 1 (bloque `v1-10-roles-tpv`, pequeño)

1. **Arqueo con esperado por rol** (APROBADO por Matías 2026-07-03): en Arqueo X y modal de cierre Z, mostrar "Efectivo esperado del turno" DURANTE el recuento solo si rol ∈ {OWNER, MANAGER}. CASHIER sigue con recuento ciego (anti-fraude) y ve el resultado tras cerrar, como hoy. El teórico ya se calcula al cerrar — hace falta exponerlo pre-cierre en la API del turno, gated por rol.
2. ⚖️ **Refunds con PIN de encargado para CASHIER** (patrón discount-override reutilizado, purpose=refund-override). Propuesta CTO: siempre que rol=CASHIER, sin umbral (las devoluciones no son tan frecuentes como para que moleste). MANAGER/OWNER libres.
3. ⚖️ **Modificar precio: flag por tenant** `priceOverrideRequiresPin` (default OFF para no romper a Cachictos): ON → CASHIER necesita PIN manager; MANAGER/OWNER siempre libres. Cada dueño elige su equilibrio agilidad/control.

Los tres reutilizan infraestructura existente (manager-auth tokens, flags de tenant en SettingsPage, rol ya presente en sesión). Sin migraciones salvo el flag (aditiva).

## 5. Fase 2 (diseñar más adelante, no bloquear v1.0)

- OWNER como rol propio en el TPV (hoy = MANAGER): p. ej. ver ventas acumuladas del día en vivo, acceso a informes desde el TPV.
- Historial: ¿debe un CASHIER ver importes de todo el turno o solo los suyos? (multi-cajero por caja).
- Matriz visible en admin: pantalla "Permisos del TPV" donde el OWNER vea (y en el futuro edite) qué puede cada rol.
- Renombrar en la UI "PIN de encargado" de forma consistente (hoy convive con "manager").

## 6. Qué NO proponemos

Recuento ciego se mantiene para CASHIER (estándar anti-fraude); no se añade rol nuevo tipo "supervisor" (KISS hasta que un cliente lo pida); no se toca la matriz del admin (B6), solo TPV.
