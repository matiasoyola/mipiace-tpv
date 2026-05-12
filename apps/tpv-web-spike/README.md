# `apps/tpv-web-spike`

Frontend del super-mini-MVP de la Fase 0. **No es producción.** Existe
para que cualquiera pueda ver una venta E2E funcionando con
`apps/api` antes de que `apps/tpv-web` tenga venta real (B4).

## Cuándo se borra

Cuando B4 implemente la venta de verdad en `apps/tpv-web/`, evaluaremos:

- Si el spike sirve de referencia visual: lo archivamos en
  `docs/spikes/tpv-mini-mvp/`.
- Si ya no aporta: lo borramos.

## Arrancar en local

Requiere que `apps/api` esté corriendo con `HOLDED_API_KEY` definida en
el `.env` (modo single-tenant single-key).

```bash
pnpm --filter @mipiacetpv/tpv-web-spike dev
```

Disponible en `http://localhost:5175`.
