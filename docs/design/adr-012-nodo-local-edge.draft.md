# ADR-012 · Nodo local (edge) / multi-terminal offline — RECHAZADO

> **Estado: RECHAZADO (2026-08-04).** Decisión de Matías. Se conserva el
> registro para no reabrir el debate sin motivo nuevo.

## Contexto

Se evaluó construir una "cajita" edge en el local (mini-PC corriendo el backend
dockerizado) para que **varios terminales** operaran sin internet de forma
indefinida, coordinando el estado mutable compartido (mesas) en la LAN.

## Decisión: NO se construye

Un local con **varios terminales** tiene WiFi/LAN por necesidad — es la
precondición de tener varias tablets trabajando juntas. Por tanto un
multi-terminal **offline** resuelve un escenario que en la práctica no se da:
si hay red local para que las tablets se vean entre ellas, hay red. Meterse en
el nodo edge (semanas/meses: identidad JWT local, descubrimiento, sync
bidireccional, backup, flota) no lo pide ningún cliente y no aporta.

## Qué SÍ queda como historia offline soportada

**Resiliencia offline de UN terminal — ya construida (v1.10 + outbox + catálogo
IndexedDB + PWA).** Una tablet sola aguanta un corte entero (login PIN, turno,
venta, cobro efectivo, cierre) y sincroniza al volver la red, sin duplicar. Esa
es la promesa "sin conexión" del producto, y cubre a casi todos los pilotos
(de un solo terminal).

## Consecuencia

Las Fases 2 (nodo local) y 3 (sync local↔nube) del plan de arquitectura quedan
**archivadas**. El foco de desarrollo pasa a la **app nativa**.
