# Skill · Holded API — Conocimiento operativo mipiacetpv

Documento maestro que consolida TODO lo aprendido sobre la API de Holded a lo
largo del proyecto mipiacetpv: comportamientos no documentados, "silent
rejects", workarounds aplicados, idempotencias y tolerancias.

## Para quién es

- Desarrolladores nuevos al proyecto mipiacetpv que necesitan entender la
  capa de integración con Holded sin tener que reconstruir el conocimiento
  desde commits sueltos.
- Cualquier integración futura (SDK público, integraciones de terceros,
  nuevos verticales) que tenga que pegar a la API de Holded.
- Consultoría de integración con Holded para otros proyectos: este es el
  punto de partida.

## Cómo leerlo

1. Lee primero la sección de **patrones** — los patrones transversales
   (silent reject, idempotencia, tolerancias, content-type, paginación) son
   el lente con el que se interpretan los endpoints.
2. Luego ve al endpoint que te interesa. Cada subdocumento es autocontenido:
   resumen + tabla "qué documentado / qué real" + ejemplo de payload +
   referencias a commits/hotfixes.
3. Si vienes a apagar un fuego, ve directo al [runbook](runbook.md).

## Índice

### Endpoints

- [salesreceipt](endpoints/salesreceipt.md) — creación de tickets, GET-back,
  PDF, distinción PRODUCT vs SERVICE.
- [services](endpoints/services.md) — catálogo de servicios, paginación,
  ausencia de SKU real.
- [products](endpoints/products.md) — catálogo de productos, SKU canónico,
  imágenes en endpoint separado.
- [pay](endpoints/pay.md) — registro de cobros, tolerancia 5 céntimos,
  idempotencia por pre-check.
- [contacts](endpoints/contacts.md) — contactos cliente, fiscal data,
  search no documentado.
- [taxes](endpoints/taxes.md) — impuestos del tenant.

### Patrones transversales

- [silent-reject](patrones/silent-reject.md) — 200 OK con estado
  inconsistente; cómo detectar y recuperar.
- [idempotencia](patrones/idempotencia.md) — Holded ignora
  `Idempotency-Key`; UUID propio en `notes` y pre-check en `pay`.
- [tolerancias](patrones/tolerancias.md) — `TOTAL_TOLERANCE_EUR = 0.05`
  para comparar totales y `paymentsPending`.
- [content-type](patrones/content-type.md) — `text/html` con cuerpo JSON
  en `/pdf` y algunos GET.
- [paginacion](patrones/paginacion.md) — `?page=N`, sin metadata, fin por
  array vacío.

### Operativa

- [runbook](runbook.md) — errores comunes y su solución.

## Convenciones

- Cada subdocumento empieza con un resumen de 5 líneas + tabla "qué
  documentado / qué real".
- Ejemplos de payload reales, anonimizados (sin emails ni IDs de clientes).
- Referencias a commits y hotfixes donde se aplicaron los workarounds.
- `Last-updated` al final de cada subdocumento.

## Out of scope

- Tutorial de "cómo dar de alta una API key de Holded" — eso es manual de
  implantadores, no skill técnico.
- Comparativa con otros ERPs (Quickbooks, Xero, etc.).

## Fuentes primarias

- [`docs/spike-holded.md`](../spike-holded.md) — hallazgos numerados del
  spike Fase 0 (CERRADO 2026-05-11).
- [`docs/03-integracion-holded.md`](../03-integracion-holded.md) —
  especificación funcional de la integración.
- Hotfixes 1–10 sobre la integración (ver tablas de cada subdocumento).

Last-updated: 2026-06-03
