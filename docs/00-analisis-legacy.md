# 00 · Análisis del repo legacy (mipiace-tpv)

Repo: https://github.com/matiasoyola/mipiace-tpv
Estado al analizarlo: 2026-05-11.

## TL;DR

El legacy **no es una base sobre la que construir**: son 67 líneas de
Express en un único `server.js`, sin BD, sin auth de usuarios, sin
frontend versionado, sin tests y sin nada de la complejidad operativa
(multi-tenant, offline, cola, multi-caja).

Es un **spike funcional**: alguien lo escribió para validar que se puede
hablar con Holded. Y eso sí lo demuestra. Hay que tratarlo como
**referencia de campos y endpoints reales**, no como cimientos.

**Recomendación: opción C del playbook — reescribir desde cero**
siguiendo `docs/02-arquitectura.md`, **aprovechando los hallazgos de este
documento** como confirmación de los endpoints reales de Holded.

## Inventario del repo

```
legacy/mipiace-tpv/
├── .gitignore           # ignora node_modules/, clientes/*/config.json, .env
├── package.json         # solo dependencia: express ^4.18.2
├── package-lock.json
├── public/              # vacío en git (el HTML del front no está versionado)
└── server.js            # 67 líneas
```

No hay: tests, BD, ORM, tipado (TypeScript), OAuth, manejo de errores
estructurado, logging, configuración multi-tenant, cola de sync,
agente de impresión, etc.

## Modelo de funcionamiento del legacy

- **Mono-cliente.** Variable de entorno `CLIENTE=thalia` selecciona un
  archivo `clientes/{nombre}/config.json` (gitignored).
- **Auth a Holded por API Key** (no OAuth). Header `key: {api_key}`.
- El servidor lee productos, contactos y crea `salesreceipt` directos
  contra Holded **sin persistencia local**. Cada GET es un hit a la API.

## Hallazgos confirmados contra la API de Holded

Estos datos vienen de código que el autor anterior **sí probó** contra
Holded. Tratarlos como verdad operativa (pero validar en spike formal):

### Autenticación
```
Header:  key: {api_key}
URL:     https://api.holded.com/api/invoicing/v1
```
No es Bearer. El header se llama literalmente `key`.

### GET /products
- Respuesta: array directo **o** `{data: [...]}` (defensivo en el código).
- Campos observados:
  - `id` (string)
  - `name`
  - `barcode`
  - `sku`
  - `price` (string parseable a float)
  - `kind` (tipo de producto)
  - `stock` (parseable a int)
  - `imageURL`
  - `forSale` (numérico — `0` significa no vendible, filtrar en TPV)
  - `attributes[]` con `{value}` — usado en el legacy como "categoría"
    haciendo `attributes[0].value`. **Frágil**: depende del orden y de
    que el cliente use atributos de forma consistente.

### GET /contacts?name=...
- Acepta filtro por nombre en query.
- Respuesta: array directo o `{data: []}`.
- Campos: `id`, `name`, `email`.

### POST /documents/salesreceipt
Payload usado (probado contra Holded):
```json
{
  "date": 1746979200,
  "notes": "...",
  "numSerie": "TPV-CAJA-01",
  "contactId": "OPCIONAL",
  "items": [
    {
      "name": "Producto X",
      "units": 1,
      "price": 12.40,
      "tax": 4,
      "discount": 0
    }
  ]
}
```

Hallazgos importantes:
- **`numSerie`** es un parámetro válido en el documento → permite que
  cada caja del TPV tenga su propia serie de numeración Holded.
- La línea acepta `tax` numérico (en el legacy default 4 — IVA reducido).
- `discount` por línea es soportado.
- No vimos `subtotal` explícito — Holded lo calcula a partir de
  `price * units` y aplica `tax`.
- Respuesta incluye `id` del documento creado.

## Decisiones que **cambian** respecto a la spec original

Tras ver el legacy:

1. **API Key sigue siendo viable como fallback** o como modo "single
   tenant simple". Confirmado que `key: {api_key}` funciona. OAuth
   sigue siendo el objetivo del SaaS multi-tenant, pero podemos
   arrancar el MVP con API Key y migrar después.

2. **`numSerie` per-caja** es la forma natural de tener numeración
   fiscal de Holded separada por TPV físico. La especificación lo
   pone en `register.ticket_counter` interno; **además** debemos
   guardar el `numSerie` que Holded asigne a esa caja y enviarlo en
   cada `salesreceipt`.

3. **`forSale`** como filtro en la sincronización inicial del catálogo
   — ya no traemos todo, sólo lo vendible.

4. **Atributos como categoría** (`attributes[0].value`): NO replicarlo
   tal cual. Diseñar un sistema propio de categorías/grupos rápidos en
   el TPV (botones rápidos configurables) en lugar de depender del
   orden de atributos en Holded.

5. **El frontend no está versionado en el legacy.** Si el autor lo
   tiene en local, conviene rescatarlo aunque sea sólo para entender
   el flujo de UI que tenía en mente.

## Pendiente de rescatar del autor del legacy

- El contenido de `clientes/thalia/config.json` (estructura del config
  por cliente: nombre, IVA por defecto, pagos, datos de impresora,
  almacén de Holded, etc.).
- El contenido de `public/index.html` (la UI del prototipo).
- Saber si llegó a probar **devoluciones** o sólo ventas directas.

## Plan de acción para Claude Code

1. **No copiar el legacy.** Tratarlo como `legacy/` de sólo-lectura.
2. **Sí leerlo al arrancar** para tener los nombres de campo de Holded.
3. **Arrancar el monorepo nuevo en la raíz del proyecto** siguiendo
   la arquitectura de `docs/02-arquitectura.md`.
4. **En el spike de Fase 0**, usar API Key del propio Matías para
   validar:
   - Endpoints arriba descritos (re-confirmar shape de respuesta).
   - Idempotencia con `externalId` (¿hay duplicado al reintentar?).
   - Devoluciones (`salesreceipt` con negativos vs `creditnote`).
   - Webhooks de Holded (si existen).
5. **Cuando se monte OAuth**, hacerlo detrás de la misma interfaz
   `HoldedClient` que la implementación API Key, para que el TPV no
   sepa cuál está usando.
