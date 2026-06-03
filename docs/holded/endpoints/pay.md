# Endpoint · `pay`

Registro de cobro contra un `salesreceipt` existente. Marca el documento
como cobrado total o parcialmente. Tres trampas: `date` en epoch seconds
obligatorio, tolerancia de 5 céntimos sobre `paymentsPending`, y CERO
idempotencia server-side — un retry naive duplica el cobro. Los hotfixes
9 y 10 cierran las dos últimas.

## Qué documentado vs qué real

| Aspecto | Docs oficial | Realidad |
|---|---|---|
| `date` | "ISO o epoch" | Sólo epoch seconds funciona consistentemente (spike §04.E) |
| `amount` exacto | "Match con `paymentsPending`" | Aritmética float64 + IVA → tolerancia `TOTAL_TOLERANCE_EUR = 0.05` |
| `paymentsPending` tras pay | "Será 0 si totalmente pagado" | Puede quedar epsilon ≈ 0.01; comparar con tolerancia |
| Idempotencia | No mencionada | NULA — un POST repetido cobra dos veces |
| Silent reject | No mencionado | Sí: 200 OK + `paymentsPending` fuera de tolerancia |

## POST `/invoicing/v1/documents/salesreceipt/{id}/pay`

```json
{
  "date": 1717420800,
  "amount": 1.80,
  "paymentMethodId": "<MongoId del método de pago>"
}
```

- **`date`** obligatorio, epoch seconds (spike §04.E).
- **`amount`** numérico. La aritmética float64 con IVA 21% genera
  epsilons de ~0.01 → comparar siempre con
  [`TOTAL_TOLERANCE_EUR`](../patrones/tolerancias.md).
- **`paymentMethodId`** — método de pago configurado en Holded (efectivo,
  TPV, transferencia, etc.). Sincronizado al arranque del worker.

## Idempotencia por pre-check (hotfix 10)

Holded NO ofrece idempotencia para `pay`. La estrategia:

1. **Pre-check**: antes de POSTear, hacer GET-back del salesreceipt.
2. Si `paymentsPending ≈ 0` (con tolerancia 5 céntimos) → ya está
   pagado, NO postear de nuevo.
3. Si `paymentsPending > tolerancia` → POSTear y luego volver a
   GET-back para verificar que ahora sí está ≈ 0.

Sin este pre-check, un timeout intermedio en el primer POST seguido de
un retry del worker producía doble cobro. Ver hotfix 10 en historial.

## Silent reject específico de pay

POST devuelve 200 OK + JSON con `status: 1`. GET-back muestra:

```json
{
  "id": "65f0ff00aa11bb22cc33dd44",
  "total": 1.80,
  "paymentsPending": 1.80
}
```

`paymentsPending` igual al total → el cobro **no se aplicó**. Lanzar
`HoldedSilentRejectError` y dejar al worker reintentar (con su
pre-check).

## Pseudo-código del cliente

```ts
async function payTicket(id: string, expectedAmount: number, paymentMethodId: string) {
  // 1. Pre-check
  const doc = await client.getSalesReceipt(id);
  if (Math.abs(doc.paymentsPending) <= TOTAL_TOLERANCE_EUR) {
    return { skipped: true, reason: 'already-paid' };
  }

  // 2. POST pay
  await client.postPay(id, {
    date: Math.floor(Date.now() / 1000),
    amount: expectedAmount,
    paymentMethodId,
  });

  // 3. GET-back verify
  const after = await client.getSalesReceipt(id);
  if (Math.abs(after.paymentsPending) > TOTAL_TOLERANCE_EUR) {
    throw new HoldedSilentRejectError({
      endpoint: 'pay',
      ticketId: id,
      paymentsPending: after.paymentsPending,
    });
  }

  return { ok: true };
}
```

## Referencias

- [`docs/spike-holded.md`](../../spike-holded.md) §04.E.
- Hotfix 9 (tolerancia 5 céntimos).
- Hotfix 10 (pre-check idempotencia).
- [patrones/silent-reject](../patrones/silent-reject.md)
- [patrones/idempotencia](../patrones/idempotencia.md)
- [patrones/tolerancias](../patrones/tolerancias.md)

Last-updated: 2026-06-03
