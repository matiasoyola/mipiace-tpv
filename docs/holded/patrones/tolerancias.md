# Patrón · Tolerancias numéricas

Comparar importes contra Holded con `===` o diff exacta produce falsos
silent rejects. La aritmética float64 con IVA 21% genera epsilons de ~1
céntimo. La constante `TOTAL_TOLERANCE_EUR = 0.05` (5 céntimos) absorbe
ese ruido sin enmascarar errores reales.

## La constante

```ts
export const TOTAL_TOLERANCE_EUR = 0.05;
```

- 5 céntimos.
- Aplicable a comparaciones de importes en euros.
- Fijada en hotfix 9 tras varios falsos positivos en la cuenta de
  pruebas.

## Dónde se usa

| Comparación | Por qué hace falta tolerancia |
|---|---|
| `expectedTotal` vs `stored.total` | Suma de items con IVA en float64 → epsilon ~0.01 |
| `paymentsPending` vs 0 tras pay | Holded redondea internamente; queda residual ~0.01 |
| Sub-total de línea (units × price) | Multiplicación float64 |

## Helper estándar

```ts
function isWithinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOTAL_TOLERANCE_EUR;
}
```

Y en validación de silent reject:

```ts
if (!isWithinTolerance(stored.total, expectedTotal)) {
  throw new HoldedSilentRejectError({ ... });
}
```

## Por qué 5 céntimos y no más

- Por debajo de 5 céntimos no hay caso de uso real que se vea afectado
  (los precios mipiacetpv tienen al menos 1 céntimo de granularidad y
  los items son < ~50).
- Por encima de 5 céntimos empezaría a enmascarar errores reales (por
  ejemplo: precio mal copiado del catálogo).
- 5 céntimos es además la moneda mínima física en EUR, lo que da una
  intuición natural a humanos cuando aparece en logs.

## Tradeoff conocido

Tickets con MUCHAS líneas (ej. 100+ items) podrían acumular epsilon más
allá de 5 céntimos. Hasta ahora no se ha visto en producción. Si pasa:

- Recalcular con suma redondeada a 2 decimales por línea ANTES de comparar,
  en lugar de subir la tolerancia global.

## NO usar para

- Comparar **stock**: el stock es entero, no float. Tolerar diff aquí
  oculta bugs de inventario.
- Comparar **fechas**: usar diff explícita en segundos.
- Comparar **strings** (`sku`, `docNumber`, etc.): tienen que ser
  exactos.

## Referencias

- Hotfix 9 (introducción de la tolerancia).
- [endpoints/pay](../endpoints/pay.md)
- [patrones/silent-reject](silent-reject.md)

Last-updated: 2026-06-03
