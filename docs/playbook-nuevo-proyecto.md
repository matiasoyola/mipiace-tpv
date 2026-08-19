# Playbook · Cómo replicar mipiacetpv en un proyecto nuevo

Documento portable. Destila la metodología, el stack y la estética de
mipiacetpv para arrancar cualquier producto nuevo de Mi Piace sin
reconstruir decisiones desde cero. Copia este archivo (y los ficheros
listados en §6) al repo nuevo el día 1.

Fuentes canónicas en este repo: `docs/04-stack-y-decisiones.md` (ADRs),
`docs/02-arquitectura.md`, `docs/design/tokens.md`, `docs/ux-principles.md`,
`docs/working-with-claude-code.md`.

---

## 1. Metodología de trabajo (lo más valioso de trasladar)

### 1.1 Docs antes que código

El proyecto se define primero en `docs/` numerados y luego se implementa.
Orden que funcionó:

1. `00-analisis-legacy.md` — qué existe hoy y por qué duele.
2. `01-spec-funcional.md` — qué hace el producto (contrato funcional).
3. `02-arquitectura.md` — vista de alto nivel + componentes.
4. `03-integracion-X.md` — cada integración externa con su spike previo.
5. `04-stack-y-decisiones.md` — mini-ADRs: contexto, decisión,
   alternativas descartadas, consecuencias. **Toda decisión técnica
   relevante deja ADR**; es lo que evita re-debatir.
6. `05-roadmap.md` / `roadmap-master.md` — bloques.

### 1.2 Trabajo por bloques (B1, B2, B3…)

- Cada bloque tiene su **prompt canónico** en `docs/code-prompts/bloque-N.md`:
  contexto (qué docs leer antes), alcance, restricciones, entregables,
  y explícitamente **qué queda fuera**.
- Cada bloque termina con `docs/blocks/Bx-done.md`: estructura del repo,
  qué quedó hecho, qué quedó fuera, **decisiones tomadas sin preguntar
  (con justificación, para revisión una a una)**, dudas, y cómo arrancar
  todo de cero. Es el contrato de transferencia entre sesiones de Code.
- Sesión nueva de Claude Code por bloque grande; sesión continuada solo
  para fixes iterativos. Ver §1-3 de `working-with-claude-code.md`.

### 1.3 División Cowork / Code

- **Cowork** (Claude desktop): producto, diseño, docs, planning, mockups,
  preparación de commits en su sandbox. Toca `docs/`.
- **Claude Code** (terminal): implementación. Toca `apps/` y `packages/`.
- Paralelizables porque tocan áreas distintas del repo.
- Code no commitea sin pedirlo; el push lo hace Matías (credenciales en
  su Mac).

### 1.4 Spike antes de integrar

Antes de construir sobre una API externa, spike empírico documentado
(`docs/spike-holded.md` como referencia de formato). Del spike de Holded
salió la lección más cara del proyecto: **no fiarse del 2xx — GET-back
tras cada escritura y verificar invariantes** (ADR-010). Aplicable a
cualquier API de terceros.

### 1.5 Validación con usuarios reales

Antes de cada release mayor: sesión de 1 h con usuario real sin
instrucciones, "test de los 30 segundos" (pantalla principal entendible
sin explicar), y test de carga humana (10 operaciones en 5 min).

---

## 2. Stack técnico (reutilizable tal cual)

| Capa | Elección | Notas |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | PWA vía `vite-plugin-pwa` si hace falta offline |
| Estado servidor | TanStack Query | |
| Estado local | Zustand | |
| Offline | Dexie sobre IndexedDB + Service Worker | solo si el producto lo exige |
| Backend | Node 20 + Fastify + TypeScript | JSON Schema en todos los bodies |
| ORM / BD | Prisma + PostgreSQL | JSONB para payloads crudos de APIs externas |
| Colas | BullMQ sobre Redis | reintentos exponenciales 30s→24h, jobs idempotentes con `externalId` UUID |
| Auth | JWT access+refresh, PIN con argon2id | tokens de terceros cifrados AES-GCM con clave maestra en env |
| Multi-tenant | aislamiento por fila, `tenant_id` inyectado vía Prisma extension desde el JWT | |
| Deploy | Docker Compose en VPS Hostinger: `api`, `worker`, `postgres`, `redis`, `caddy` | Caddy da HTTPS automático |
| Observabilidad | Pino (JSON logs) + Sentry (front y back) + UptimeRobot + `/metrics` Prometheus | |
| Monorepo | pnpm workspaces: `apps/*` + `packages/*` | un solo lenguaje en todo el repo |
| Tests | Vitest (workspace) | |

Principios transversales del stack:

- **Un solo lenguaje** (TS) en front, back y worker: baja el coste cognitivo.
- **Clientes de APIs externas abstraídos** detrás de interfaz
  (`HoldedClient` → OAuth y ApiKey intercambiables). Hacer lo mismo con
  cualquier integración nueva.
- **Cero SDK propietario en el núcleo** (ADR-011): periféricos y
  servicios por protocolos estándar; lo exótico va en adaptadores
  opcionales en `packages/*-adapters/` que implementan una interfaz
  abstracta.
- **Rebuild obligatorio al desplegar**: tsx no hot-reloadea del host;
  rebuild de imagen + `--env-file infra/.env.production`.

---

## 3. Estética (design system trasladable)

### 3.1 Paleta

| Token | Hex | Uso |
|---|---|---|
| `mipiace.coral` | `#E97058` | acento primario, CTAs |
| `mipiace.coral-dark` | `#C75A45` | hover, texto sobre coral-soft |
| `mipiace.coral-soft` | `#FDEAE3` | fondos de estado activo, badges |
| `mipiace.ink` | `#1F2937` | texto principal |
| `mipiace.ink-soft` | `#374151` | texto secundario |
| `mipiace.stone` | `#F8F6F3` | fondo cálido de superficies e inputs |
| `emerald-500` / `amber-*` (Tailwind) | — | semánticos OK / atención |

La marca: iconmark de 4 barras en ink + corazón coral; wordmark
`mipiace` (ink) + producto (coral). Para un producto nuevo se mantiene
el split marca/producto: `mipiace` + `<producto>` en coral. SVG canónico
en `docs/design/tokens.md` §1.

### 3.2 Tipografía

- **DM Sans** (Google Fonts), `font-feature-settings: 'cv11','ss01'`.
- Pesos solo 400/500/600 (700+ reservado al logo).
- Sentence case siempre; ALL CAPS solo en eyebrows (10.5-11px,
  tracking 0.06-0.12em).
- Tracking negativo (-0.01 a -0.025em) solo en headings ≥18px.
- Importes y conteos siempre `tabular-nums`.

### 3.3 Forma y espacio

- Radios: 4 (kbd/badges) · 8 (tablas) · 12 (avatares/badges icono) ·
  **16 (botones, inputs, cards producto)** · 24 (cards grandes).
  Sin pills grandes.
- Sin sombras pesadas: máximo `shadow-sm` en hover; los bordes
  (`slate-200`, 0.5-1px) hacen el trabajo.
- Touch targets: 44px móvil, 56px tablet operativa, 64-72px acción
  primaria.
- Transiciones 150-200ms; sin animaciones de entrada, parallax ni lottie.

### 3.4 Iconografía

Lucide React. Stroke 2.25 en UI, 1.4 en iconos grandes decorativos.
Nada de emojis en interfaz.

### 3.5 Componentes base

Inventario completo con medidas en `docs/design/tokens.md` §5 y código
literal en `docs/design/reference-app.tsx`: botón primario/outline/
fantasma, input stone con focus ring coral, card blanca borde slate,
badge `rounded-xl`, sidebar item con activo coral-soft.

### 3.6 Principios UX (genéricos, no solo TPV)

- **Latencia percibida cero**: la acción del usuario nunca espera al
  servidor; sync en background.
- **Feedback visual <100 ms** y nada de toasts de esquina para acciones
  críticas.
- **Deshacer 4 s en banner** en lugar de confirmaciones múltiples.
- **Sin modales en flujo crítico** (bottom sheet / popover inline);
  modal solo para destructivo con autorización.
- **Máximo 8-12 elementos accionables por vista**; scroll vertical,
  nunca horizontal.
- **Estado de red permanente** (verde/ámbar/rojo), no notificación efímera.
- Anti-patrones prohibidos: menús >2 niveles, animaciones >300ms,
  iconos sin texto en nav principal, drag-and-drop como única vía,
  tooltips al hover, push del navegador durante operación.

---

## 4. Marco legal/fiscal (si el producto toca facturación)

mipiacetpv **no** es sistema fiscal Verifactu: Holded es el emisor
(ADR-008). Regla trasladable: si un producto nuevo toca facturación,
apoyarse en una capa que ya cumpla (Holded u otro) y no implementar
lógica fiscal propia sin asesor. Identidad: Mi Piace Internet
Solutions SL, B45902186.

---

## 5. Checklist de arranque de proyecto nuevo

1. Crear repo monorepo pnpm (`apps/`, `packages/`, `docs/`, `infra/`).
2. Copiar los ficheros de §6 a `docs/design/` y este playbook a `docs/`.
3. Escribir `00-analisis` y `01-spec-funcional` en Cowork antes de
   tocar código.
4. Spike de toda API externa → doc + ADRs (incluido el patrón GET-back
   si la API no es fiable).
5. `04-stack-y-decisiones.md` con ADRs propios (aunque hereden de aquí:
   dejar constancia de qué se hereda y qué diverge).
6. Roadmap por bloques + primer `bloque-1.md` en `docs/code-prompts/`.
7. Docker Compose con `api`/`worker`/`postgres`/`redis`/`caddy` desde
   el día 1; Sentry + UptimeRobot al primer deploy.
8. Secrets de `.env` a 1Password desde el primer día.
9. Dominio: producto en su `.com` propio; el paraguas mipiace.com está
   diferido hasta que haya segundo producto en lanzamiento.

## 6. Ficheros a copiar literalmente al repo nuevo

- `docs/design/tokens.md` — design system completo.
- `docs/design/tailwind.config.reference.js` — tokens `mipiace.*`.
- `docs/design/index.reference.css` — CSS vars + DM Sans.
- `docs/design/reference-app.tsx` — patrones de componentes.
- `docs/ux-principles.md` — adaptar la sección específica de TPV.
- `docs/working-with-claude-code.md` — metodología de sesiones.
- `tsconfig.base.json`, `pnpm-workspace.yaml`, `vitest.workspace.ts`,
  `.gitignore`, `.env.example` (como plantilla de estructura).
