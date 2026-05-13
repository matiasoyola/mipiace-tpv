# `apps/tpv-web`

PWA del TPV — la app que abren las cajas. React + Vite +
`vite-plugin-pwa`.

Pantallas: emparejamiento (B3), login cajero, apertura/cierre de turno,
venta + cobro (B4), histórico de tickets, devoluciones.

## Arrancar en local

```bash
pnpm --filter @mipiacetpv/tpv-web dev
```

Disponible en `http://localhost:5174`.

## Notas

- `workbox-window` está declarado como dependencia explícita aunque
  formalmente sea peer de `vite-plugin-pwa`. El warning de peer dep
  falsa de B4 queda resuelto y `pnpm install` desde raíz no muestra
  ya el aviso.
- El SW está activo también en `vite dev` (devOptions.enabled) para
  detectar bugs de cacheo desde el día 1.
- `registerType: "autoUpdate"` => recarga sin pedir confirmación al
  detectar nueva versión. Cuando el TPV esté en uso real, podríamos
  pasar a `"prompt"` para no recargar a mitad de venta.
- Los iconos definitivos (192, 512, maskable) entran en B4 cuando
  exista identidad visual.
