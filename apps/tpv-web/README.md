# `apps/tpv-web`

PWA del TPV — la app que abren las cajas. React + Vite +
`vite-plugin-pwa`.

En B1 sólo está el esqueleto: el shell PWA arranca, el service worker se
registra, el manifest existe (sin iconos definitivos). Las pantallas de
emparejamiento (B3) y venta (B4) llegan en bloques posteriores.

Para ver el spike de venta funcionando, usa `apps/tpv-web-spike` (puerto
5175) — sigue accesible como referencia viva durante B1-B3.

## Arrancar en local

```bash
pnpm --filter @mipiacetpv/tpv-web dev
```

Disponible en `http://localhost:5174`.

## Notas

- El SW está activo también en `vite dev` (devOptions.enabled) para
  detectar bugs de cacheo desde el día 1.
- `registerType: "autoUpdate"` => recarga sin pedir confirmación al
  detectar nueva versión. Cuando el TPV esté en uso real, podríamos
  pasar a `"prompt"` para no recargar a mitad de venta.
- Los iconos definitivos (192, 512, maskable) entran en B4 cuando
  exista identidad visual.
