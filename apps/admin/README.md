# `apps/admin`

UI del propietario. React + Vite + react-router. Sin PWA (el admin se
usa desde un portátil, no es offline-first).

## Arrancar en local

1. Asegúrate de que `apps/api` está corriendo en `http://127.0.0.1:3001`.

2. ```bash
   pnpm --filter @mipiacetpv/admin dev
   ```

   Disponible en `http://localhost:5173`. El proxy `/api/*` apunta al
   server Fastify, así que CORS no entra en juego en local.

## Pantallas

- `/signup` — alta del propietario y de su tenant.
- `/login` — entrada.
- `/onboarding` — pegar API Key de Holded.
- `/onboarding/sync` — polling de progreso del sync inicial.
- `/onboarding/done` — resumen (X productos, Y servicios, etc.).

Tras `/onboarding/done` el flujo de B1 termina. B2 añadirá la creación
de tiendas + cajas.

## Tokens y storage

El access/refresh JWT viven en `sessionStorage` (no `localStorage`): si
el propietario cierra la pestaña sale automáticamente. Si quiere
persistencia, la añadimos cuando tengamos "recuérdame" (B2+).
