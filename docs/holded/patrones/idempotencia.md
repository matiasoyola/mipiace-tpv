# Patrón · Idempotencia

Holded **no respeta** headers estándar de idempotencia (`Idempotency-Key`,
`X-Request-Id`, etc.). Cualquier POST repetido crea/cobra de nuevo. Hay
dos estrategias distintas según endpoint: marcador en `notes` para
creación, pre-check con GET-back para `pay`.

## Qué hace Holded

| Header probado | Comportamiento |
|---|---|
| `Idempotency-Key: <uuid>` | Ignorado. POST duplicado crea segundo recurso |
| `X-Request-Id` | Idem |
| Cualquier custom header | Idem |

No hay respuesta `409 Conflict` por repetición. Holded trata cada POST
como independiente. Nuestro problema: un timeout intermedio del worker
seguido de retry produciría tickets duplicados / dobles cobros si no
defendiéramos a nivel de cliente.

## Estrategia 1 — Marcador en `notes` (creación de salesreceipt)

Incluir UUID v4 propio en el campo `notes`:

```json
{
  "notes": "TPV-uuid: 7c9a4f8d-1e2b-4f3a-9c0d-5b6e8f9a0b1c"
}
```

Convención: el prefijo `TPV-uuid:` seguido del externalId del ticket en
mipiacetpv.

### Flujo

1. Antes de POST, **search** por ese UUID:
   ```
   GET /invoicing/v1/documents/salesreceipt?starttmp=X&endtmp=Y
   ```
   y filtrar localmente por `notes` que contengan `TPV-uuid: <externalId>`.
2. Si existe → ya creado, devolver el `id` existente.
3. Si no → POST normal con el UUID en `notes`.

### Por qué `notes` y no `code` u otro campo

- `code` no es indexado para search por la API.
- `notes` es un texto libre que Holded NO modifica.
- Aparece en el GET-back íntegro, fácil de detectar.

### Tradeoff conocido

El search por rango temporal puede ser costoso si el rango es amplio.
mipiacetpv reduce el rango a las últimas 24h del externalId para
mantener latencia baja.

## Estrategia 2 — Pre-check con GET-back (`pay`)

Para `pay` no hay equivalente a `notes`: el endpoint no tiene un campo
texto libre que persista. Estrategia distinta:

1. Antes de POST, **GET-back** del salesreceipt.
2. Si `paymentsPending ≈ 0` (con tolerancia 5 céntimos) → ya pagado,
   skip.
3. Si no → POST y volver a GET-back para verificar.

Ver [endpoints/pay](../endpoints/pay.md) para pseudo-código completo.

## Reintentos del worker

Las dos estrategias son seguras frente a reintentos. El worker puede
disparar un POST N veces sin riesgo de duplicar:

- En creación: la búsqueda por `TPV-uuid:` lo detecta.
- En cobro: el pre-check lo detecta.

Esto es **load-bearing** para nuestro modelo de sync: el worker
reintenta cualquier `SYNC_FAILED` y la idempotencia local es lo que
evita doble efecto.

## Por qué no usar `Idempotency-Key` aunque exista la convención

Por si Holded la implementa en el futuro: la incluimos igualmente como
defensa-en-profundidad sin coste. Si algún día empieza a respetarse,
mejor. Pero **nunca** dependemos sólo de eso.

## Referencias

- [endpoints/salesreceipt](../endpoints/salesreceipt.md)
- [endpoints/pay](../endpoints/pay.md)
- Hotfix 10 (pre-check pay).
- Memoria del proyecto: rarezas confirmadas de Holded (sin idempotencia
  server-side).

Last-updated: 2026-06-03
