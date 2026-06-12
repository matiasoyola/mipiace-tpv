# Bloque v1.0-Pilotos · Flecos operativos + endurecer bares antes de implantar

**Rama:** `v1-0-pilotos` (worktree limpio desde master)
**Contexto:** vamos a implantar los 4 tenants DRAFT (Librería Thalia y Frutos Secos Cachitos = RETAIL, Cafetería Sirope = HOSPITALITY, Fouzia = SERVICES). Producción ya tiene CI, GHCR+rollback, Sentry, conciliación diaria. Este bloque cierra lo que un cliente nuevo nota la primera semana. Tras él se etiqueta `v1.0`.
**Estimación:** 3-4 días Code.
**Entrega:** un único commit, sin merge. `pnpm test` 0 failed, CI verde, `docs/blocks/v1-0-pilotos-done.md`.

---

## Lote 1 · Bares: suite E2E del flujo de mesas + fixes de lo que destape (PRIORITARIO)

El flujo HOSPITALITY (B7: TableMapScreen, mover líneas, agrupar/desagrupar, DRAFT→checkout→PAID, WebSockets table.*) está desplegado pero NUNCA se ha validado con un cliente real. Cafetería Sirope entra en semanas. Antes de poner a un bar encima:

1. Suite de integración API que recorra el ciclo completo: abrir mesa → añadir líneas → mover línea a otra mesa → agrupar dos mesas → desagrupar (reversibilidad via originalTableId) → checkout → internalNumber asignado al cobrar → upload a Holded (mock) → estados consistentes. Incluir: dos cajas operando sobre la misma mesa (last-writer-wins), mesa con ticket DRAFT no cobrable dos veces, y el caso "agrupar mesa con ticket en otra mesa ya agrupada".
2. Tests del modo degradado online-only de mesas: sin conexión, el TPV debe BLOQUEAR operativa de mesas con mensaje claro y la venta rápida seguir 100% funcional.
3. **Todo bug real que la suite destape se arregla en este mismo lote** (es su propósito). Si alguno es grande (>medio día), documentarlo en done.md y parar a preguntar.
4. Revisar que los eventos WS table.* publican tras COMMIT de transacción (no antes — riesgo de estado fantasma en la otra caja).

## Lote 2 · #9 Reimprimir ticket falla con body vacío

Síntoma reportado: reimprimir desde el historial falla, request con body vacío. Reproducir en test, arreglar (probable: endpoint espera payload que el front no manda o viceversa). Cubrir también reimpresión de ticket histórico de turno cerrado.

## Lote 3 · #28 Arqueo Z con desglose por método de pago

El informe Z (PDF + pantalla de cierre) debe desglosar: efectivo / tarjeta / otros métodos (lo que haya en TicketPayment.method), ventas brutas, devoluciones, descuadre. Los datos ya existen (methodTotals en el close); es presentarlos. Actualizar generateZReportPdf y la pantalla de cierre. Tests del cálculo del desglose con pagos mixtos y devoluciones.

## Lote 4 · Sesión y login del cajero (#18 + #6)

- #18: TTL de la sesión del cajero configurable por tenant (default actual se queda corto — el cajero re-loguea varias veces al día). Añadir `cashierSessionTtlMinutes` a Tenant settings (default 720 = 12h, el turno entero), respetando el refresh existente. Settings del admin.
- #6: botón ojo mostrar/ocultar contraseña en los logins (TPV cajero, admin, super-admin). Componente único reutilizado.

## Lote 5 · #19 Borrar impresora completamente

Hoy la impresora borrada deja residuos (reaparece o bloquea re-alta). Borrado debe limpiar config local (IndexedDB/localStorage del TPV) y BD, y soportar re-alta limpia del mismo dispositivo. Test del ciclo alta→borrado→re-alta.

## Lote 6 · #22 Importador de clientes desde Excel/CSV (Thalia lo pedirá el día 1)

Página OWNER-only en el admin: subir .xlsx o .csv (columnas: nombre*, NIF, email, teléfono — plantilla descargable).

- **Holded es la fuente de verdad de contactos**: el importador crea los contactos EN HOLDED vía API (`type=client`) con GET-back, throttle ~5 req/s y reintentos; la BD local se rellena por el upsert del propio flujo (no escribir contactos "solo locales").
- Idempotencia: si ya existe contacto con mismo NIF (o email si no hay NIF) en Holded/local, skip y contar como "ya existía". Releer el archivo dos veces no duplica.
- Resultado en pantalla: creados / ya existían / con error (y CSV de errores descargable con el motivo por fila).
- Límites: máx 2.000 filas por archivo; validación de NIF con util-validation (los inválidos van a errores, no se crean).
- Proceso en worker (BullMQ) con progreso consultable — un Excel de 1.000 clientes a 5 req/s son ~3-4 min, no puede ser un request HTTP.

## Lote 7 · Etiqueta de versión visible

`v1.0` como versión de producto visible en el admin (footer) y en `/version.json` junto al hash de build. Fuente: constante única en un solo sitio (no hardcodear en tres).

---

## Reglas del bloque

- NO tocar: aritmética de precios, deploy/CI (acaba de estrenarse), SalePage layout (hotfixes 4/5 recientes — los lotes 2-5 tocan piezas concretas, no la estructura del aside).
- Sin dependencias nuevas salvo parser de xlsx para el Lote 6 (SheetJS/exceljs — justificar elección en done.md).
- Migraciones: solo las imprescindibles (Lote 4 settings; aditivas).
- Cualquier hallazgo fuera de alcance → done.md.

## Definición de hecho

1. `pnpm test` 0 failed (los nuevos E2E de mesas incluidos).
2. CI verde en el push de la rama.
3. `docs/blocks/v1-0-pilotos-done.md` con: resumen por lote, bugs destapados por el Lote 1 y su estado, acciones manuales de deploy si las hay.
4. Un único commit: `v1.0-pilotos · E2E mesas + reimprimir + arqueo Z + sesión/login + impresoras + importador clientes + versión`.
