# Guía de trabajo con Claude Code (y con Cowork)

Doc operativo para que Matías, Pedro, y cualquier futuro contratado
trabajen con eficiencia con las dos herramientas que mueven el proyecto:

- **Claude Code** — el agente que escribe código (corre en Terminal vía
  `claude`).
- **Cowork** — el asistente de producto, diseño y planning (donde Matías
  conversa con Claude para tomar decisiones, escribir docs, generar
  mockups).

> Esta guía cristaliza decisiones operativas tomadas durante B1-B3. No
> es ideología, es lo que ha funcionado empíricamente.

## 1. Sesiones de Claude Code

### 1.1 Cuándo abrir sesión nueva vs continuar

**Abrir sesión nueva (`/exit` + `claude` otra vez):**

- Cuando arrancas un **bloque grande nuevo** (B1, B2, B3, B4…).
- Cuando una sesión lleva varias horas y empiezas a notar que Code
  contesta más despacio, olvida detalles, o mezcla decisiones de
  bloques distintos.
- Tras un commit + push importante.

**Continuar la sesión activa:**

- Para **fixes pequeños iterativos** sobre el código que la sesión
  acaba de escribir ("eso me ha dado un error, arréglalo", "añade un
  test más a X").
- Para preguntas conversacionales rápidas ("¿qué hace Y?", "¿por qué
  elegiste Z?").
- Cuando la tarea cabe en 15-30 minutos más de trabajo.

### 1.2 Por qué — coste y calidad

**Coste de tokens:**

- Cada turn del modelo carga **todo el historial conversacional**
  acumulado. Tras 4 horas de trabajo, esto puede ser 30-50k tokens por
  pregunta. Si Code hace 10 sub-pasos internos, ya son 300-500k tokens
  por una sola pregunta tuya.
- Una sesión fresca carga sólo los docs que le indicas leer (típicamente
  5-10k tokens iniciales) y luego cada turn arranca con poco contexto.
- Con Claude Max no es coste económico, pero sí afecta a latencia.

**Calidad ("attention degradation"):**

- Modelos large-context (Sonnet/Opus 1M) sufren "lost in the middle":
  detalles del principio se diluyen tras decenas de mensajes.
- He visto sesiones de 4h donde Code:
  - Olvida requisitos planteados al inicio.
  - Mezcla decisiones de bloques anteriores con el actual.
  - Re-introduce código que ya había borrado.
  - Pregunta cosas que tú ya respondiste.
- Una sesión fresca, leyendo los docs canónicos (`Bx-done.md` +
  el prompt de su bloque) **reconstruye la información esencial sin el
  ruido del historial**.

### 1.3 El sistema `Bx-done.md` como memoria persistente

Cada bloque termina escribiendo `docs/blocks/Bx-done.md` siguiendo un
formato fijo:

- Estructura del repo tras el bloque.
- Lo que dejé hecho (con qué endpoints, qué tablas, qué pantallas).
- Lo que dejé fuera (con qué bloque lo cubrirá).
- Decisiones que tomé sin preguntar (con justificación).
- Dudas y cosas a confirmar antes del siguiente bloque.
- Cómo arrancarlo todo de cero (comandos).

Este doc es **el contrato de transferencia entre sesiones** de Code.
La sesión nueva del bloque siguiente lo lee primero y se pone al día
sin tener que excavar git history ni leer código.

Reglas duras:

- **Cada bloque tiene su `Bx-done.md`**. Si no, hay que reconstruir
  desde código, mucho más lento.
- **Las decisiones tomadas sin preguntar van con justificación**, no
  como hechos consumados. Matías las revisa y confirma una a una.
- **Las dudas se anotan en el doc, no en el chat**. El chat es
  volátil; el doc sobrevive.

## 2. El flujo "prompt por bloque"

Cada bloque tiene su prompt en `docs/code-prompts/bloque-N.md` con:

- Contexto: qué leer antes de tocar nada (los docs canónicos del
  proyecto + decisiones del bloque anterior).
- Alcance: qué frentes cubre, en qué orden por dependencias.
- Restricciones: TypeScript estricto, JSON Schema en body, nada de
  loguear secrets, etc.
- Entregables: PR único + commit con mensaje descriptivo + `Bx-done.md`.
- Fuera de alcance: qué NO entra en este bloque (B+1, B+2, etc.).

**Cómo se le pasa a Code en una sesión nueva:**

1. `cd ~/Documents/Claude/Projects/Holded`
2. `claude`
3. Cuando arranque la sesión, le pegas exactamente:
   ```
   tienes el prompt con la tarea a realizar en docs/code-prompts/bloque-N.md
   ```

Code leerá el prompt, los docs referenciados, hará su resumen y
planteará discrepancias antes de tocar código. **No le des luz verde
hasta revisar el resumen** — es donde detecta cosas que tú o yo (Cowork)
pasamos por alto.

## 3. Code en paralelo (dos sesiones a la vez)

### 3.1 Cuándo SÍ tiene sentido

- **Tareas claramente desacopladas** sobre áreas distintas del repo
  (sesión A en `apps/tpv-web/`, sesión B en una migración independiente).
- **Cuando entre Pedro**: él en su sesión sobre un módulo concreto
  (p.ej. el `print agent` cuando llegue B5), Matías en la suya sobre
  otra área.
- **Tareas accesorias** mientras corre el bloque principal: limpieza de
  tests viejos, mini-spikes de investigación, setup de CI/CD,
  actualización de docs externos.

### 3.2 Cuándo NO

- **El mismo bloque desde dos sesiones**. Conflictos en git, archivos
  pisados, decisiones contradictorias, mental load insoportable para
  ti.
- **Cuando no estás seguro de qué archivos toca cada sesión**. La regla
  es: si las dos sesiones pueden tocar el mismo archivo, NO.
- **Mientras estás cansado**. Revisar dos hilos de Code requiere
  atención plena.

### 3.3 La paralelización óptima que ya practicamos

**Tú + Cowork (Claude desktop) trabajando en docs/diseño/planning** +
**Code en otra terminal codeando**. Eso ya lo hicimos en B2:

- Cowork: diseño visual + tokens + ADR-011 + mockups + docs verticales.
- Code en paralelo: schema, auth, sync incremental, contactos, admin.

Esta paralelización funciona porque:

- Tocamos áreas distintas del repo (Cowork → `docs/`, Code → `apps/`).
- Los conflictos son raros (sólo si Cowork toca un prompt y Code lo
  está leyendo, pero los prompts se editan antes de pasarse).
- La carga mental se reparte (Code en automático, tú haciendo
  decisiones estratégicas).

## 4. Política de commits

- **Code NO commitea automáticamente** salvo que se lo pidas
  explícitamente. Su rol es preparar el PR y dejarlo listo para
  revisión.
- **Matías o Cowork (con su sandbox bash) hacen el commit local** tras
  revisar `Bx-done.md` y validar en navegador.
- **Matías hace el push a GitHub** desde su Mac (porque las
  credenciales viven ahí). Cowork no puede pushear desde su sandbox.
- **Estilo del mensaje de commit**: ver commits previos (`5a43aad`
  para B1, `c51109e` para diseño, `535b3e1` para B2). Mensaje corto en
  línea 1, párrafos descriptivos debajo agrupando por área funcional.

## 5. Sobre backup del trabajo en local

Cosas que viven SÓLO en el Mac de Matías y se pierden si el Mac muere:

- **`.env` con los 3 secrets** (`JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `HOLDED_KEY_ENCRYPTION_SECRET`). Sin estos, la
  BD de producción queda inservible si ya hay datos cifrados con
  `HOLDED_KEY_ENCRYPTION_SECRET`. **Guardar copia en 1Password u
  otro gestor de secretos.**
- **Memoria persistente de Cowork** (`~/Library/Application
  Support/Claude/.../memory/`). No crítica, se reconstruye de los docs.
- **Conversaciones con Cowork**. Tampoco críticas, pero útiles como
  referencia.

Cosas que viven en GitHub (a salvo de muerte del Mac):

- Todo el código + docs + migraciones + ADRs + design system.

**Recomendación mínima de backup:**

1. **Time Machine** activado a disco externo. Cubre todo de un golpe.
2. **Secrets de `.env` copiados a 1Password** (o equivalente). Por si
   Time Machine falla, los recuperas de ahí.

Verificar Time Machine activo:

```bash
tmutil status
```

## 6. Tooling extra recomendado

### 6.1 Claude Code útiles

- `/exit` — cierra la sesión limpiamente.
- `/clear` — limpia el historial conversacional sin cerrar la sesión.
  Útil cuando quieres reiniciar contexto sin cerrar la terminal.
- `/init` — genera o actualiza un `CLAUDE.md` con instrucciones del
  proyecto (no lo hemos generado todavía; cuando Pedro venga, podría
  ayudar).
- `Ctrl+C` durante una respuesta — interrumpe y permite re-encaminar.

### 6.2 Cowork útiles

- Cowork tiene acceso a tu repo en `~/Documents/Claude/Projects/Holded/`
  y puede leer/escribir archivos directamente.
- Cowork tiene un sandbox bash separado para git, build, tests. Útil
  para preparar commits limpios sin que Matías abra Terminal.
- Cowork NO tiene credenciales de GitHub — el push siempre lo hace
  Matías desde su Mac.

## 7. Cuando Pedro se incorpore

Setup recomendado para Pedro:

1. Clonar `github.com/matiasoyola/mipiace-tpv` en su Mac.
2. Leer en orden: `docs/07-nucleo-comun.md`, `docs/04-stack-y-decisiones.md`,
   los `Bx-done.md` existentes, `docs/design/tokens.md`, esta guía.
3. `cp .env.example .env` y pedir a Matías los secrets vía 1Password
   compartido (o generar los suyos si va a montar su propia BD).
4. `docker compose up -d` + `pnpm install` + `pnpm db:migrate` +
   `pnpm dev:api` + `pnpm dev:admin` para tener el stack local.
5. Su primera sesión de Code arranca con `cd ~/Documents/.../Holded`
   + `claude` y se le pasa el prompt del bloque que le toque, igual
   que hace Matías.

Áreas naturales para Pedro (a partir de su perfil senior backend):

- B5 (worker de tickets, idempotencia, GET-back) — encaja con su
  perfil.
- Print agent en otra sesión paralela cuando llegue B5 hardware.
- Setup de CI/CD (GitHub Actions con tests + build) — tarea claramente
  independiente.
- Migración a OAuth Holded cuando el roadmap lo pida.

---

## Referencias

- `docs/07-nucleo-comun.md` — contrato funcional del producto.
- `docs/04-stack-y-decisiones.md` — ADRs (incluido ADR-011 sobre
  portabilidad de hardware).
- `docs/design/tokens.md` — sistema de diseño v1.
- `docs/ux-principles.md` — principios UX transversales.
- `docs/blocks/Bx-done.md` — memoria persistente por bloque.
- `docs/code-prompts/bloque-N.md` — prompts canónicos para Code.
