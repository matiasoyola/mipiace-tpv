# Patrón · Silent reject

El patrón más recurrente y más peligroso de la API de Holded. Define qué
es, cómo detectarlo, cómo recuperarse y los casos reales que motivaron
los hotfixes 8, 9 y 10.

## Definición

Holded responde **HTTP 200 OK** con un JSON aparentemente exitoso
(`{ "status": 1, "id": "..." }`), pero el GET-back posterior del recurso
muestra un estado **inconsistente** con lo que se mandó.

**No es una excepción del cliente HTTP**: la transacción TCP terminó,
los headers están bien, el cuerpo se parsea correctamente. El "fallo"
sólo se aprecia comparando lo que pediste vs lo que quedó persistido.

## Cómo detectarlo

Tras cualquier escritura, hacer **GET-back** y validar invariantes:

| Operación | Invariante a comprobar |
|---|---|
| POST salesreceipt | `total ≈ expectedTotal` y `products[*].sku !== "0"` |
| POST pay | `paymentsPending ≈ 0` (con tolerancia 5 céntimos) |
| POST salesreceipt con `approveDoc:true` | `docNumber` presente y no null |
| PUT product/service | El campo modificado realmente cambió |

Comparar con [`TOTAL_TOLERANCE_EUR = 0.05`](tolerancias.md) cuando aplica.

## Cómo recuperarse

1. El cliente lanza `HoldedSilentRejectError` con detalle:
   ```ts
   throw new HoldedSilentRejectError({
     endpoint: 'salesreceipt',
     externalId,
     expected: { total: 12.50 },
     stored: { total: 0, products: [...] },
   });
   ```
2. El caller marca el ticket como `SYNC_FAILED` con el detalle del error.
3. El worker de sync lo reintenta con backoff exponencial.
4. Si tras N reintentos sigue fallando → alerta operativa (entra en el
   runbook humano).

**No reintentar dentro del mismo request HTTP del TPV.** El usuario ya
cerró su acción; el worker es quien debe insistir.

## Casos reales

### Caso 1 — `total = 0` por SERVICE sin `serviceId`

POST salesreceipt con un item `{ name: "Catering", price: 250, sku: "CAT-4H" }`
para un item que en realidad es servicio.

Holded acepta, devuelve `{ id }`. GET-back:

```json
{ "total": 0, "products": [{ "name": "Catering", "price": 0, "sku": "0" }] }
```

**Fix (hotfix 8)**: distinguir PRODUCT vs SERVICE en el armado del item,
usar `serviceId` cuando es servicio. Ver
[endpoints/salesreceipt](../endpoints/salesreceipt.md).

### Caso 2 — `paymentsPending` fuera de tolerancia tras pay

POST pay con `amount: 12.50` para un ticket de `expectedTotal: 12.50`.

GET-back:

```json
{ "total": 12.50, "paymentsPending": 12.50 }
```

El cobro no se aplicó (causa: `paymentMethodId` inválido / silent
ignore). **Fix (hotfix 10)**: validar `paymentsPending ≈ 0` tras pay y
lanzar silent reject si no.

### Caso 3 — `docNumber: null` por `approveDoc` omitido

POST salesreceipt sin `approveDoc: true`. Holded acepta y devuelve `id`,
pero GET-back muestra `docNumber: null`. El documento queda inservible
para facturación.

**Fix**: forzar `approveDoc: true` siempre desde el cliente.

## Por qué Holded hace esto

Hipótesis del spike: capas internas de validación distintas entre el
endpoint público (que sólo valida shape JSON) y el motor de facturación
(que valida semántica). El público acepta, el motor descarta
silenciosamente lo que no entiende. Sin contrato server-side que
reconcilie ambas capas.

## Implicación arquitectural

El cliente Holded de mipiacetpv tiene tres capas:

1. **HTTP** — pega y parsea.
2. **Shape validation** — verifica formato JSON esperado.
3. **Invariants** — GET-back y comparación con lo enviado.

Las capas 1 y 2 NO son suficientes. La 3 es lo que detecta silent rejects
y debe estar en cualquier integración nueva.

## Referencias

- [endpoints/salesreceipt](../endpoints/salesreceipt.md)
- [endpoints/pay](../endpoints/pay.md)
- [patrones/tolerancias](tolerancias.md)
- Hotfixes 8, 9, 10.
- [`docs/spike-holded.md`](../../spike-holded.md) §05.A.

Last-updated: 2026-06-03
