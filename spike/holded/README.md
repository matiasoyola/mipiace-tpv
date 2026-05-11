# Spike · Integración Holded (Fase 0)

Scripts aislados para validar la integración con Holded antes de
construir nada de la Fase 1. Resultado final esperado:
`docs/spike-holded.md` con hallazgos reales.

## Requisitos

- Node 20.11+.
- `pnpm install` ejecutado en la raíz del monorepo.
- Cuenta Holded con **Veri\*factu DESACTIVADO**
  (`Configuración → Facturación → Veri*factu`), tal como exige
  `docs/01-spec-funcional.md` §6.

## Configuración

```bash
cp spike/holded/.env.example spike/holded/.env
# Editar spike/holded/.env y pegar la HOLDED_API_KEY.
```

## Scripts

| # | Comando | Qué hace |
|---|---|---|
| 01 | `pnpm spike:01` | Auth + lectura: `GET /products` + `GET /warehouse`. Sólo lectura. Vuelca respuestas crudas a `fixtures/`. |

Los scripts 02–06 se añaden según avanzan los hallazgos. Ver
`docs/05-roadmap.md` Fase 0.

## Salidas

- `spike/holded/fixtures/*.json` — respuestas crudas (gitignored).
- `docs/spike-holded.md` — documento final con hallazgos (se crea al
  cerrar Fase 0).
