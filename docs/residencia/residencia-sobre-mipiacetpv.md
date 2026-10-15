# Residencia × mipiacetpv — qué comparten y decisiones

> **Copia en el repo** del documento fuente del proyecto «Jardin de Gredos» (`claude/residencia-sobre-mipiacetpv.md`),
> traída el 15-10-2026. Las decisiones vinculantes viven en `00-decisiones.md`; si discrepan, manda `00-decisiones.md`.

> Sesión 3 · 2026-10-14. Comparación del software de residencia (Fase 0) con el TPV de Mi Piace (`mipiacetpv`), incluida la vertical de clínica (clinica-1 a clinica-4).
> Complementa `respuestas-requisitos-fase0.md` y `rama-catalogo-de-controles.md`.

---

## 1. Decisiones tomadas

| # | Decisión | Efecto |
|---|---|---|
| **D-36** | **Holded es siempre opcional.** La plataforma no depende de Holded en ningún caso: es un conector que el centro activa o no. | **Revisa D-01 y D-09.** D-01 se mantiene en su primera mitad (la plataforma es la fuente de verdad del residente); "Holded queda reducido a lo financiero" pasa a "si el centro usa Holded". D-09: la liquidación mensual es de la plataforma; enviarla a Holded es opcional. ADR-04 deja de ser bloqueante. |
| **D-37** | **Técnicamente, vertical sobre el núcleo de mipiacetpv; comercialmente, producto propio** (app y marca propias para residencias). | Se reutiliza el núcleo (tenants, dispositivos, PIN/roles, offline + sync, paquetes clínicos, fichaje, Verifactu). El dominio de residencia se construye como vertical propia encima, no dentro del núcleo. Resuelve en la práctica ADR-01 (offline-first + sync) y ADR-03 (multi-tenant), heredados de mipiacetpv. |

### Por qué D-37

- A favor del núcleo común: lo más caro ya funciona en producción (offline + cola de sync, flota de dispositivos, PIN por rol, registro de accesos clínicos, entradas inmutables, fichaje). La clínica ya probó que el núcleo aguanta datos de salud.
- En contra de "una vertical más": el dominio (residente 24 h, PAI, tareas, observación, incidencias, relevo, medicación) es mayor que cualquier vertical actual y la pantalla es otra (tablet en la puerta, no caja).
- Escalera de mipiacetpv: la Fase 0 es documental y no abre frente. Al pasar a código entra como peldaño 4 (lo nuevo vendible), con fecha natural en la auditoría AENOR del 20-07-2027 → **llevar a Dirección · mipiacetpv antes de abrir el primer bloque de código.**

## 2. Lo que ya existe en mipiacetpv y sirve

| Necesidad de la residencia | En mipiacetpv |
|---|---|
| Multi-centro (D-25 / ADR-03) | Multi-tenant + tiendas |
| Conectividad (ADR-01) | PWA offline-first, IndexedDB, cola outbox con worker |
| Tablets en puerta | Emparejamiento por código, revocación, heartbeat, acceso remoto (ADR-014) |
| PIN y roles (D-07, D-29-31) | PIN por usuario, rol, PIN de encargado para autorizar |
| App tablet | Capacitor Android; iOS recomendado en clínica |
| Registro de accesos clínicos (ADR-05) | `ClinicalAccess` + `ClinicalAccessLog` |
| Evidencia no editable | `ClinicalEntry` cerrada + `ClinicalAddendum` |
| Escalas (Barthel, Lobo, Tinetti, Norton) | `ClinicalAssessment` + correcciones con autor |
| Consentimientos | `ClientConsent` + firma con el dedo → PDF |
| Informes a familia (Obs. 10 AENOR) | Informe PDF con registro de entrega (`ClinicalReportDelivery`) |
| Personal | `Employee` + `TimeEntry` (fichaje), `StaffShift` |
| Facturación sin Holded | Verifactu propio (`FiscalRecord`) |
| Principio de pantalla | "Mucho clic, poco escribir" |

## 3. Lo que es nuevo de la residencia

Tareas programadas por residente desde el PAI · observación diaria con línea base ("como siempre") · incidencias derivadas por umbral/ausencia con gravedad N0-N4 · libro único de incidencias · relevo de turno con acuse · cadena de medicación (prescribe → prepara → administra) · `Lesión` longitudinal · comunicación a familia como dimensión aparte.

## 4. Pendiente derivado

- Revisar el modelo de roles de residencia (D-29-31: rol ≠ persona, categoría, vigencia) contra `User`/`UserRole` de mipiacetpv: hoy allí el rol es un único campo por usuario.
- Ver si `Client` de mipiacetpv puede ser el residente o si el residente es entidad propia que lo extiende.
- Plazas y pagadores (dos pagadores, copago, vigencia) no existen en el TPV: modelo nuevo de la vertical.
