# Auditoría técnica completa · mipiacetpv

**Fecha:** 2026-06-10
**Alcance:** repo completo (apps/api, apps/tpv-web, apps/admin, packages/*, infra/, docs/) + infraestructura de producción descrita en docs/deploy
**Método:** 4 revisiones paralelas (seguridad/multi-tenancy, integridad de datos y dinero, infraestructura/SRE, calidad/tests/frontend) + verificación manual de los hallazgos críticos contra el código + revisión normativa
**Contexto:** producto en producción con clientes piloto reales cobrando; intención de monetizar

---

## Resumen ejecutivo

El proyecto NO es un prototipo de juguete. Tiene cosas que muchos equipos profesionales no tienen: 270+ tests de API, ADRs documentando decisiones, migraciones versionadas, cifrado AES-256-GCM de las API keys de Holded, Argon2id para credenciales, JWTs versionados, validación zod, auditoría de acciones super-admin, idempotencia GET-back-first contra Holded y soft-deletes para trazabilidad. La crítica de "vibecoding" no se sostiene mirando el repo.

Dicho esto, un equipo experto habría cubierto antes de cobrar dinero real **cuatro carencias estructurales** que hoy son el riesgo real del negocio:

1. **Cero observabilidad.** Si la API cae a las 3am o el worker lleva 2 días sin subir tickets a Holded, nadie se entera hasta que llama un cliente.
2. **Cero CI.** No existe `.github/workflows`. Los errores de TypeScript se descubren durante el build de Docker en el VPS de producción (ocurrió dos veces el 2026-06-09).
3. **Backup sin restore probado y (probablemente) sin copia offsite activa.** El script soporta B2 pero es opcional; si no está configurado, los backups viven en el mismo disco que la BD.
4. **Frontend sin red de seguridad:** 1 test en tpv-web, sin error boundary, cálculo de dinero con float de JS, y el flujo de cobro offline puede perder ventas en un caso límite.

Ninguna es difícil de cerrar. El plan de acción al final ordena todo por riesgo/esfuerzo.

---

## 1. Seguridad y multi-tenancy

### Lo que está bien hecho
- API keys de Holded cifradas en BD con AES-256-GCM (no texto plano).
- Argon2id para passwords/PINs, 2FA en super-admin, JWTs con versionado para invalidación.
- Guard global de tenant bloqueado que cubre todos los roles.
- Audit log de acciones super-admin con metadata validada por zod.
- CSP + Permissions-Policy desplegadas (B-Hardening A).

### Hallazgos

| Sev. | Hallazgo | Detalle | Recomendación |
|------|----------|---------|---------------|
| ALTO | Clave maestra de cifrado única e irrotable | `HOLDED_KEY_ENCRYPTION_SECRET` en `.env.production`: si se filtra el .env, todas las API keys de todos los tenants quedan expuestas; si se pierde, son irrecuperables | Copia de la clave en gestor de secretos (1Password/Apple Passwords ya identificado); diseñar rotación (versionar la clave en el ciphertext) |
| ALTO | Lookups por `externalId` sin filtro de tenant | Búsquedas globales por UUID permiten, con un UUID conocido/filtrado, tocar recursos de otro tenant | Añadir `tenantId` a todos los `where` de idempotencia |
| ALTO | Email único global, no por tenant | Colisión de OWNERs entre tenants; el rate-limit por email es compartido y permite enumeración | `@@unique([tenantId, email])` donde aplique |
| MEDIO | Password reset / 2FA sin rate-limit en confirmación | Brute-force del token/código viable | `@fastify/rate-limit` en esos endpoints |
| MEDIO | WebSocket: validar suscripción contra tenant del JWT | Riesgo de escuchar eventos `table.*`/`ticket.*` de otra tienda | Comprobar tenantId/storeId del token al suscribir |
| MEDIO | `publicSlug` del ticket PDF con ~64 bits de entropía y sin TTL | URL pública eterna y teóricamente fuerza-bruteable | Subir a 96+ bits; valorar expiración o revocación |
| BAJO | Impersonación super-admin sin revocación inmediata | Expira pero no se puede cortar a mitad | Lista de revocación en Redis |

**Lo que un equipo experto habría añadido y no existe:** test suite específica de aislamiento multi-tenant (un test parametrizado que para cada endpoint intente acceder a recursos de otro tenant y espere 404/403). Es la prueba más valiosa de todo un SaaS multi-tenant y conviene tenerla antes de crecer en clientes.

---

## 2. Integridad de datos y dinero

### Lo que está bien hecho
- Idempotencia de subida a Holded con GET-back-first + `externalId` (evita dobles cobros en reintentos).
- Tolerancia de 5 céntimos en `paymentsPending` documentada y deliberada.
- Migración b30 a `Decimal(12,4)` ya en schema (rama en curso).
- Soft-delete de productos huérfanos del sync (correcto para histórico).
- Máquina de estados de ticket con validaciones de transición.

### Hallazgos

| Sev. | Hallazgo | Evidencia | Recomendación |
|------|----------|-----------|---------------|
| CRÍTICO | El dinero se calcula con float de JS en el frontend | `apps/tpv-web/src/lib/cart.ts` (computeLine/computeCart): `number` IEEE-754 en todos los pasos intermedios; los precios viajan por IndexedDB como float | La b30 arregla la BD pero no el cálculo. Centralizar la aritmética en céntimos enteros (o decimal.js) en `packages/ticket-model` y que frontend y backend usen LA MISMA función. Hoy hay dos implementaciones paralelas (cart.ts y totals.ts) que pueden divergir |
| CRÍTICO | Backfill b30 pendiente | La migración amplía columnas pero los valores siguen siendo los truncados a 2 decimales | Ejecutar `resync-catalog` por tenant ACTIVO inmediatamente tras el deploy de la rama de decimales; añadirlo al runbook |
| ALTO | `Decimal → Number` prematuro en checkout y refunds | `apps/api/src/tickets/routes.ts` (~317, ~644, ~1259): se convierte a Number antes de computeTicket | Mantener precisión hasta el final; mismo fix que arriba si se unifica la aritmética |
| ALTO | `ticketCounter` se incrementa FUERA de la transacción | `routes.ts:396-405` (patrón repetido en checkout y refunds): si la transacción posterior falla, el número se quema → **huecos en la numeración interna** (sensible en contexto fiscal/auditoría). *Nota: NO hay riesgo de colisión — el incremento es atómico* | Mover el `register.update` dentro del `$transaction` |
| ALTO | Encolado BullMQ fuera de la transacción sin barrido de rescate | `routes.ts:467`: si Redis falla justo ahí, el ticket queda PENDING_SYNC para siempre (solo se loguea) | Cron "sweeper" cada N min que re-encole HoldedUpload PENDING con antigüedad > X. Esto además cubre reinicios de Redis sin persistencia |
| ALTO | Refunds: las líneas de refunds FALLIDOS cuentan como ya devueltas | `routes.ts:~1226`: el mapa `alreadyRefunded` no filtra por status | Filtrar por SYNCED/DONE |
| MEDIO | Redondeo de tax en refunds por línea, no por bucket de IVA como en venta | `routes.ts:~1280` | Reutilizar el algoritmo de computeCart |
| MEDIO | Sin job de conciliación TPV ↔ Holded | El bug de los decimales lo detectó la clienta a ojo | Job diario que compare totales de tickets SYNCED contra los documentos en Holded y alerte ante cualquier desfase. Es la red de seguridad definitiva para todo lo monetario |

---

## 3. Infraestructura, deploy y resiliencia

### Lo que está bien hecho
- Docker multi-stage con typecheck en build, compose con healthchecks (API/Postgres/Redis), Caddy con TLS automático, bootstrap idempotente, script de backup con retención y soporte B2.
- `.env.production.example` versionado, secretos fuera de git.

### Hallazgos

| Sev. | Hallazgo | Recomendación |
|------|----------|---------------|
| CRÍTICO | Sin monitoring/alerting de ningún tipo | Mínimo viable en 1 día: UptimeRobot/Hetrix sobre `/health` + Sentry (API y frontend, plan gratuito) + una alerta si `HoldedUpload` lleva >1h con PENDING/FAILED acumulados (puede ser un simple cron + email) |
| CRÍTICO | Sin CI | GitHub Actions: `tsc --noEmit` + vitest + build de imágenes en cada push. Publicar imágenes a GHCR y que el VPS haga `docker pull` en vez de build (elimina los builds de 100s en 1 vCPU y los fallos de typecheck en producción) |
| ALTO | Backups: sin restore probado, sin verificación de integridad, offsite opcional | Activar B2 ya (está soportado en el script), añadir `gzip -t` + checksum, y hacer UN restore de prueba documentado. Un backup no probado no es un backup |
| ALTO | Redis sin persistencia confirmada → jobs BullMQ se pierden al reiniciar | Con el sweeper del punto 2 esto pasa de crítico a tolerable; aun así, activar AOF en compose |
| ALTO | Logs Docker sin rotación → llenan el disco de 50GB con el tiempo | `logging: { driver: json-file, options: { max-size: 10m, max-file: 3 } }` en compose |
| MEDIO | Worker sin healthcheck (puede colgarse y Docker lo reporta "running") | Healthcheck que verifique latido del worker (key en Redis con TTL) |
| MEDIO | Sin rollback de deploy | Con imágenes en GHCR el rollback es `docker pull tag-anterior && up -d`. Etiquetar imágenes por commit |
| MEDIO | SPOF total asumido (1 VPS, 1 vCPU) | Aceptable en fase piloto SI hay backups offsite probados + monitoring. Documentar RTO objetivo y el procedimiento de reconstrucción (bootstrap + restore) y cronometrarlo una vez |
| BAJO | Contenedores como root; tsx en runtime en vez de compilar | `USER node` en Dockerfile; compilar a JS es optimización, no urgencia |

---

## 4. Calidad de código, tests y frontend

### Lo que está bien hecho
- ~270 tests en API con escenarios de negocio reales, vitest workspace, TypeScript en todo el monorepo, docs/ excepcionalmente completo (ADRs, specs, runbooks, prompts de bloques con criterios de aceptación).

### Hallazgos

| Sev. | Hallazgo | Recomendación |
|------|----------|---------------|
| CRÍTICO | tpv-web casi sin tests (≈1 archivo) y sin e2e del flujo de cobro | El flujo venta→cobro→sync es EL producto. Mínimo: tests unitarios de cart.ts (cuando se unifique la aritmética) + 1 e2e Playwright del happy path de cobro que corra en CI |
| CRÍTICO | Riesgo de pérdida de venta offline | CheckoutPage no persiste la operación (externalId + payload) ANTES del POST; si la red cae en ese instante y la PWA se recarga, la venta puede perderse | Outbox local en IndexedDB: persistir antes de enviar, borrar al confirmar, reenviar al arrancar |
| ALTO | Sin error handler global en Fastify ni Error Boundary en React | Errores de Holded acaban en 500 genéricos; un crash de render deja al cajero ante una pantalla en blanco | setErrorHandler con mapeo de errores Holded + ErrorBoundary con botón "reintentar" |
| ALTO | 16 tests fallando crónicamente en master | Normalizan el rojo y esconden regresiones nuevas. Arreglar o `skip` con ticket — la suite debe quedar en verde antes de activar CI (si no, el CI nace muerto) |
| MEDIO | Archivos gigantes: SalePage.tsx 2.350 líneas, TenantDetailPage 1.872, superadmin/tenants.ts 1.805, tickets/routes.ts 1.691 | Refactor incremental al tocarlos, no big-bang. SalePage ya empezó (SalePage.contact.tsx) |
| MEDIO | Docs ligeramente desfasadas (02-arquitectura menciona TanStack Query/Zustand que no se usan; HoldedUpload sin documentar en 06-modelo-datos) | Pasada de 1h de sincronización docs↔código |

---

## 5. Normativo y legal

| Sev. | Hallazgo | Recomendación |
|------|----------|---------------|
| ALTO | Frontera Verifactu correcta pero implícita | La decisión (mipiacetpv NO es sistema de facturación; Holded es el SIF certificado, el TPV solo le manda salesreceipts) es la correcta y está en docs dispersos. Para monetizar hace falta: (1) un doc canónico `docs/legal/posicion-verifactu.md` con la argumentación, y (2) **validación con un asesor fiscal** de que un TPV que genera tickets con numeración propia y los sube a Holded queda fuera del ámbito del RD 1007/2023. Esto es lo primero que va a preguntar un cliente serio o un competidor malintencionado |
| ALTO | RGPD sin piezas mínimas | Se almacenan datos personales de clientes finales (NIF, email, teléfono) por cuenta de los tenants → mipiacetpv es **encargado del tratamiento**: hace falta contrato DPA con cada tenant, registro de actividades de tratamiento, y política de privacidad + aviso legal en las webs (hoy no hay ninguno en tpv-web ni admin). El trabajo de minimización ya hecho (buscador muestra solo nombre + ••••1234) va en la dirección correcta |
| MEDIO | Sin términos de servicio / contrato con los pilotos | Antes de cobrar: ToS con limitación de responsabilidad (especialmente: el TPV no garantiza la exactitud fiscal, que es responsabilidad de Holded/cliente), SLA realista, y tratamiento de datos |
| MEDIO | Retención y borrado | No hay flujo de baja de tenant (exportar + borrar/anonimizar sus datos). Necesario para RGPD y para los ToS |

---

## 6. Lo que diría un equipo experto del conjunto

**A favor (y es mucho):** arquitectura razonada y documentada como pocos proyectos; decisiones revertibles (ADR-011 hardware, printing); idempotencia y cifrado pensados desde el diseño; testing de API muy por encima de la media; los bugs encontrados en producción (taxes, decimales) tienen root cause empírico documentado, no parches a ciegas. El proceso de bloques con prompts cerrados y criterios de aceptación ES un proceso de ingeniería.

**En contra:** todo el rigor está concentrado en el backend y en el diseño; la **operación** (CI, monitoring, backups probados, rollback) y el **frontend** (tests, errores, offline robusto) están a nivel prototipo. Y son precisamente las dos cosas que fallan delante del cliente. Un equipo senior habría montado CI + Sentry + uptime check la misma semana del primer deploy — no por dogma, sino porque es 1-2 días de trabajo que convierte "nos enteramos cuando llama Sole" en "nos enteramos antes que Sole".

**La respuesta a la crítica de vibecoding** no es defender el código (se defiende solo), es cerrar la lista de abajo y poder decir: tests en CI en cada commit, errores monitorizados en producción, backups offsite con restore probado, conciliación fiscal diaria automática contra Holded. Ningún crítico tiene respuesta a eso.

---

## 7. Plan de acción priorizado

**Semana 1 — riesgo de dinero y de enterarse tarde (≈3-4 días de trabajo):**
1. Terminar rama decimales + ejecutar backfill `resync-catalog` en todos los tenants activos.
2. Unificar aritmética de dinero en `packages/ticket-model` (céntimos enteros), usada por frontend y backend. Tests de precisión.
3. UptimeRobot sobre /health + Sentry en API y tpv-web + alerta de HoldedUpload atascados.
4. CI GitHub Actions (typecheck + tests + build) — requiere antes dejar la suite en verde (arreglar/skip los 16).
5. Activar backup a B2 + `gzip -t` + un restore de prueba cronometrado.

**Semana 2 — integridad y resiliencia (≈3-4 días):**
6. Mover ticketCounter dentro de $transaction (3 sitios); sweeper de HoldedUpload PENDING; filtro de status en refunds.
7. Outbox offline en CheckoutPage (persistir antes de POST).
8. Error handler global Fastify + ErrorBoundary React.
9. Rotación de logs Docker + AOF Redis + healthcheck del worker.
10. Imágenes a GHCR + deploy por pull con tag por commit (rollback instantáneo).

**Semanas 3-4 — seguridad y legal (mezclable con roadmap de producto):**
11. Test suite de aislamiento multi-tenant; fix de lookups por externalId sin tenantId; rate-limits en reset/2FA; validación tenant en WS.
12. Job de conciliación diaria TPV↔Holded con alerta.
13. Asesor fiscal (posición Verifactu) + DPA/privacidad/aviso legal/ToS para los pilotos.
14. Backup de la clave de cifrado en gestor de secretos + plan de rotación.

Los puntos 1-5 son la diferencia entre "proyecto personal en producción" y "producto monetizable". Todo lo demás es mejora continua sobre una base que ya es sólida.
