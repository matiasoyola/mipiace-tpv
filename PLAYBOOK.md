# Playbook · Continuar mipiace-tpv en Claude Code

Punto de partida: existe un repo previo en
https://github.com/matiasoyola/mipiace-tpv y existe la especificación nueva
en `docs/`. Hay que cruzar ambos antes de tocar código.

Sigue los pasos en orden. No saltes la fase de análisis.

---

## Paso 0 · Preparativos (Terminal, 5 min)

```bash
# 0.1 — instalar Claude Code si aún no lo tienes
npm install -g @anthropic-ai/claude-code
claude --version

# 0.2 — login (sólo la primera vez)
claude login

# 0.3 — clonar el legacy DENTRO de esta carpeta
cd "/Users/matiasoyolasanchez/Documents/Claude/Projects/Holded"
mkdir -p legacy
git clone https://github.com/matiasoyola/mipiace-tpv.git legacy/mipiace-tpv

# 0.4 — comprobar que está
ls legacy/mipiace-tpv
```

> Lo dejamos en `legacy/` para que conviva con la especificación. Si
> después decidimos reescribir desde cero, el legacy queda como
> referencia. Si decidimos seguir evolucionándolo, lo movemos a la raíz
> del proyecto.

---

## Paso 1 · Abrir Claude Code en la carpeta del proyecto

```bash
cd "/Users/matiasoyolasanchez/Documents/Claude/Projects/Holded"
claude
```

Importante: **abrir Claude Code en la raíz del proyecto**, no dentro de
`legacy/`. Así ve tanto el código antiguo como la nueva especificación a
la vez.

---

## Paso 2 · Análisis (prompt #1) — NO codear todavía

Pega esto como primer mensaje en Claude Code:

```
Lee TODO lo que hay en docs/ (especialmente 01-spec-funcional.md,
02-arquitectura.md, 03-integracion-holded.md, 04-stack-y-decisiones.md y
05-roadmap.md). Después lee el código en legacy/mipiace-tpv.

Quiero un análisis comparativo, sin escribir código. Estructúralo así:

1. **Estado del legacy** (1 página máx):
   - Stack real detectado (lenguajes, frameworks, BD, deps clave).
   - Qué está implementado y qué no (rutas, modelos, servicios).
   - Estado de la integración con Holded si existe (auth, endpoints,
     mapeo de entidades, manejo de errores).
   - Calidad percibida (tests, tipado, estructura, deuda evidente).

2. **Diff funcional contra la spec**:
   - Qué requisitos de docs/01-spec-funcional.md ya cubre el legacy.
   - Qué requisitos faltan.
   - Qué hay en el legacy que NO está en la spec (decidir si conservar).

3. **Diff arquitectónico contra docs/02 y docs/04**:
   - Coincidencias con el stack recomendado.
   - Divergencias y si son razonables.

4. **Recomendación** (elige UNA y justifica):
   A) Evolucionar el legacy tal cual está.
   B) Refactor mayor manteniendo decisiones clave.
   C) Reescribir desde cero usando el legacy sólo como referencia.

5. **Tres dudas críticas** que necesitas resolver antes de tocar código.

Cuando termines, NO escribas código. Espera mi decisión.
```

Lee la respuesta con tiempo. No aceptes la recomendación a ciegas — si
algo no encaja con lo que sabes del legacy, pregunta y discute.

---

## Paso 3 · Tomar decisión sobre el rumbo

Tres caminos posibles:

| Camino | Cuándo | Coste | Riesgo |
|---|---|---|---|
| **A · Evolucionar** | El legacy ya cubre >60% de la spec y el stack es razonable | Bajo | Heredas la deuda |
| **B · Refactor** | Hay base útil pero el stack o la arquitectura no encajan | Medio | Mezcla viejo/nuevo durante meses |
| **C · Reescribir** | El legacy está incompleto o el stack es incompatible | Alto | Re-hacer trabajo ya hecho |

> En la mayoría de proyectos como este, **B (refactor mayor)** o
> **A (evolucionar)** suelen ganar. C sólo si el legacy es un prototipo
> muy incipiente.

Cuando decidas, díselo a Claude Code así:

```
Vamos por la opción [A / B / C]. Razones: [tus razones].
Antes de codear, actualiza docs/ para reflejar esta decisión:
- Si la spec ya no coincide con el legacy, corrige los puntos divergentes.
- Si añadimos algo del legacy que no estaba previsto, anótalo.
- Crea docs/00-analisis-legacy.md con tu análisis del paso 2.
```

---

## Paso 4 · Fase 0 · Spike de integración con Holded

**No pasar a UI sin esto resuelto.** Es lo más arriesgado de todo el
proyecto: si la API de Holded no permite algo que necesitamos, mejor
descubrirlo en la semana 1 que en la semana 10.

Prompt sugerido:

```
Vamos a por la Fase 0 del roadmap (docs/05-roadmap.md): spike de
integración con Holded.

Trabaja en una rama nueva: spike/holded-integration.

Crea un script aislado (puede ser un sub-paquete o una carpeta
spike/holded/) que, contra una cuenta sandbox o de pruebas:

1. Haga OAuth (o use API key si OAuth no está disponible aún).
2. Liste productos (1ª página).
3. Liste almacenes.
4. Cree un salesreceipt con 1 línea y nuestro externalId como
   idempotency key.
5. Refresque el token (si OAuth).
6. Pruebe el caso de duplicado: vuelva a crear el mismo externalId y
   verifique que no se duplica.

Documenta el resultado en docs/spike-holded.md con:
- Endpoints reales usados y nombres exactos de campos.
- Respuestas reales (anonimizadas si hace falta).
- Hallazgos: lo que la spec asumía vs lo que Holded realmente hace.
- Recomendaciones para Fase 1.

Antes de empezar, dime qué credenciales necesitas en .env y dónde las
pongo. No me pidas que las hardcodee.
```

Lo que sale del spike es la base sobre la que se construye **toda** la
fase 1.

---

## Paso 5 · Fase 1 · MVP

Una vez el spike esté verde:

```
El spike funciona (ver docs/spike-holded.md). Vamos a por la Fase 1 del
roadmap.

Propón un plan de trabajo dividido en bloques de 1-2 días cada uno,
ordenados por dependencia. NO codees todavía. Cuando lo apruebe,
empezamos por el bloque 1.
```

A partir de aquí trabajáis bloque a bloque. **Regla de oro: un PR /
commit pequeño por bloque, con tests donde corresponda, y validación
manual antes de seguir.**

---

## Ritmo de trabajo recomendado

- **Una sesión de Claude Code por fase grande** (spike, MVP-backend,
  MVP-frontend, MVP-agente-impresión). Al cambiar de fase, `/clear` para
  empezar limpio el contexto.
- **Commits pequeños**: pídele que haga commit al cerrar cada bloque.
  Así si algo se tuerce, `git reset` deja el repo en un punto sano.
- **Tests cuando toque dinero/stock**: la lógica de cobro, de descuento
  de stock y de cola de sync debe tener tests automáticos. El resto
  (UI, configuración) puede ir con tests más ligeros.
- **Vuelve a Cowork (aquí)** cuando necesites:
  - Replantear la spec o el roadmap.
  - Redactar documentación de usuario (manual cajero, FAQ).
  - Tomar decisiones de producto o comerciales.
  - Analizar logs / datos sin tener que ejecutar nada.

---

## Lo que NO debes pedirle a Claude Code

- **Registrar la app en developers.holded.com**: lo haces tú a mano.
  Cuando tengas `client_id` y `client_secret`, los metes en `.env`.
- **Configurar el VPS de Hostinger**: te dará el `docker-compose.yml` y
  un script de provisión, pero el `ssh root@vps && bash provision.sh`
  lo lanzas tú.
- **Decisiones legales/fiscales**: confirma con tu asesor la ADR-008
  ("TPV no-emisor, Holded como sistema Veri*factu") antes de salir a
  producción.

---

## Checklist mental antes de cada paso

- [ ] ¿Estoy en la rama correcta?
- [ ] ¿Tengo backup del estado actual (push reciente)?
- [ ] ¿He leído lo que Claude Code propone antes de aceptar?
- [ ] ¿He validado el cambio manualmente (no sólo "los tests pasan")?
- [ ] ¿Está el commit limpio y descriptivo?

Si te saltas estos pasos, te encontrarás con sorpresas. Mejor 10 min de
verificación que 2 horas de debug a oscuras.
