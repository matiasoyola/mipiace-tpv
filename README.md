# TPV Holded — Paquete de especificación

Proyecto: **TPV web multi-tenant** alojado en VPS de Hostinger, integrado con
Holded via OAuth2 + API.

Este repositorio (todavía vacío de código) contiene la documentación previa
necesaria para que Claude Code pueda implementar el TPV de principio a fin.

## Mapa de documentos

| Documento | Para qué sirve |
|---|---|
| [`docs/01-spec-funcional.md`](docs/01-spec-funcional.md) | Qué hace el TPV: roles, flujos, casos de uso, reglas de negocio |
| [`docs/02-arquitectura.md`](docs/02-arquitectura.md) | Arquitectura técnica: módulos, despliegue, modo offline, sync |
| [`docs/03-integracion-holded.md`](docs/03-integracion-holded.md) | OAuth, endpoints, mapeo de entidades, contrato con Holded |
| [`docs/04-stack-y-decisiones.md`](docs/04-stack-y-decisiones.md) | Stack recomendado y por qué (ADRs cortas) |
| [`docs/05-roadmap.md`](docs/05-roadmap.md) | Fases MVP → v1.0 → v2.0, con criterios de salida |
| [`docs/06-modelo-datos.md`](docs/06-modelo-datos.md) | Esquema de la base de datos local del TPV |
| [`GETTING-STARTED.md`](GETTING-STARTED.md) | Cómo pasarle todo esto a Claude Code y arrancar |

## Resumen ejecutivo en 30 segundos

- **Quién:** SaaS multi-tenant. Cada negocio se loguea con su cuenta de Holded
  vía OAuth2 y queda asociado.
- **Qué importa al loguear:** descarga inicial de productos, servicios,
  variantes, stock y métodos de pago propios del cliente.
- **Qué hace el TPV en caliente:** vende de forma autónoma (lector de
  barras, ticket ESC/POS, cajón portamonedas), tolera caída de internet.
- **Qué devuelve a Holded:** cada venta como **ticket de venta**
  (`docType: "salesreceipt"`) para que Holded haga el registro fiscal
  (Veri*factu / TicketBAI). El TPV no firma nada fiscalmente.
- **Qué se queda dentro del TPV (no se manda a Holded):** cierres de caja,
  arqueos, formas de pago detalladas, turnos de cajero.
- **Datáfono:** fuera de MVP. Versión 2.

## Estado

Documentación inicial · pendiente de revisión por Matías antes de empezar a
codear.
