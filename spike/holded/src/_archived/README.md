# Scripts archivados del spike

Estos cuatro scripts son los **experimentos exploratorios** de la
Fase 0. No reflejan el flujo bueno; cada uno descubrió piezas que se
consolidaron en `../05-final-flow.ts` y `../06-pay-pdf-freeline.ts`.

| Script | Para qué sirvió | Hallazgos | Doc del spike |
|---|---|---|---|
| `01-auth-check.ts`           | Auth API Key + `GET /products` + `GET /warehouse` | shape de productos, /warehouse devuelve 200+HTML | §01 |
| `02-discover.ts`             | Descubrir endpoint real de almacenes + paginación de productos | `/warehouses` (plural), `?page=N` con 500 fijo | §02 |
| `03-create-receipt.ts`       | Primer POST de `salesreceipt` con cascada IVA × warehouse | `items`→`products` rename, draft total=0 sin approveDoc | §03 |
| `04-validate-receipt-flow.ts`| 4 sub-spikes: series, POST corregido, approve, idempotencia | sin endpoint de series, PUT 2xx mentiroso, sin idempotencia server-side, /pay pide date | §04 |

**No re-ejecutar.** Los imports a `./holded-client.js` apuntan al
nivel del archivo original (`src/`), no a `_archived/`. Si alguien
quisiera volver a correrlos, antes habría que cambiar a
`../holded-client.js`. Pero el motivo de archivarlos es que crean
documentos basura en la cuenta de Holded y reproducen comportamiento
ya validado en 05/06.

Para reproducir el flujo bueno, usar:

```bash
pnpm spike:05   # crea salesreceipt aprobado con sku real
pnpm spike:06   # cobra (/pay), descarga PDF, prueba línea libre
```
