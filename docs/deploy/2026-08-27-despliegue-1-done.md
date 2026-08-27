# Despliegue 1 · 2026-08-27 — DONE

**Sha desplegado:** `4be2f67` · **Anterior en producción:** `4669bfa` (2026-08-19T16:01:57Z, ocho días)
**Ventana:** tarde del jueves 27. **Rollback anclado:** `IMAGE_TAG=4669bfa bash infra/deploy.sh`.

## Qué entró

| Bloque | Sha | Migración |
|---|---|---|
| v1.10.2 impresión honesta | `fffaddd` | no |
| paso de humo en CI | `a286220` | no |
| soporte · cajeros del tenant en el superadmin | `8baf11d` | no |
| docs (plan del lote, pruebas AP11, prompts de bloques) | varios | no |

El merge de soporte fue limpio: la rama colgaba de `fffaddd` (= `origin/master`) y los commits que
master llevaba encima eran sólo documentación. Cero solape con los carriles v1.12-A (`apps/tpv-web/`)
y v1.12-B (que aún no había commiteado nada sobre `fc508a9`).

## Puertas

1. **CI verde en master** — run **#88** sobre `4be2f67`, 8m 22s, incluido el paso de humo que arranca
   la imagen de la api y le pide `/health`. Verificado en Actions, no en el `done.md` de la rama.
2. Sin migración pendiente: `prisma migrate deploy` → *48 migrations found · No pending migrations to apply*.

## Ejecución

Consola web de Hostinger (hPanel → VPS srv1582207 → Consola web), sesión root ya abierta.

```
cd /opt/mipiacetpv && IMAGE_TAG=4be2f67 bash infra/deploy.sh
```

- `git pull --ff-only` OK.
- Pull GHCR: `mipiacetpv-api:4be2f67` (51,3 s) y `mipiacetpv-static-publish:4be2f67` (3,3 s).
- Recreate: api *Healthy* (24,3 s), worker *Started* (23,1 s), static-publish *Started* (3,3 s).
- `/health` OK. **Deploy completado.**

## Verificación posterior

```
{"ok":true,"version":"4be2f67","startedAt":"2026-08-27T13:45:01.142Z"}

mipiacetpv-worker    Up 58 seconds (healthy)
mipiacetpv-api       Up About a minute (healthy)
mipiacetpv-postgres  Up 2 months (healthy)
mipiacetpv-redis     Up 2 months (healthy)
mipiacetpv-caddy     Up 2 months
```

`GET /super-admin/tenants/x/cashiers` sin token → **400**, no 404: la ruta nueva existe y su
validación de `params` (`id` con `format: uuid`) corre antes del `preHandler`, así que rechaza el
`x` antes de llegar a `requireSuperAdmin`. Con un uuid bien formado y sin token daría 401.

## Lo que este despliegue demuestra

El canal funciona después de ocho días parado: GHCR responde, el `docker login` del VPS sigue vivo,
`deploy.sh` no se ha quedado atrás respecto al compose, y las migraciones corren sin sorpresas. Es
lo que hacía falta saber **antes** de meter por ese mismo canal el lote gordo (D2), que sí trae
migración, worker nuevo y dos cambios de operativa.

## Estado del VPS, para la sesión de mantenimiento (no esta)

Disco 14 % de 48 G. Carga 0,21. Memoria 45 %. Pero el banner de login dice **42 actualizaciones
pendientes, 5 de seguridad** (eran 29 el día 20) y **`*** System restart required ***`**. Sigue
siendo tarea de otro día: nunca la misma sesión que un despliegue de aplicación.
