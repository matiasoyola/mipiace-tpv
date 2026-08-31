# Despliegue 2 · 2026-08-31 — DONE

**Sha desplegado:** `c7c67eb` · **Anterior en producción:** `4be2f67` (2026-08-27T13:45:01Z)
**Arranque:** `2026-08-31T10:46:07Z` · **Ventana:** lunes por la mañana.
**Rollback anclado:** `IMAGE_TAG=4be2f67 bash infra/deploy.sh`.

## Qué entró

| Bloque | Migración |
|---|---|
| v1.10.3 · la barra en hora punta | no |
| v1.11 · cierre de día automático | **sí** (`20260820000000_v1_11_cierre_de_dia`) |
| v1.12-A · manos de camarero (CashPad, ConfirmSheet, back guard) | no |
| v1.12-B · mesas abandonadas | **sí** (`20260827000000_v1_12_mesas_abandonadas`) |
| v1.13 · e2e del ciclo de caja + `runDayCutPass()` | no |
| ci · el e2e pasa a ser puerta de `publish` | no |

**Dos migraciones, no tres.** La tercera del inventario (`ApkDownloadCode`) es de A3, que **no está
mergeado**: sale por su cuenta como D1.5. Ambas aditivas: el rollback de código no necesita
rollback de esquema.

## Puertas

1. **CI verde sobre el árbol mergeado** — run `33378476682` en `c7c67eb`: `ci` ✅ `smoke` ✅
   `e2e` ✅ `publish` ✅. Primera vez que los merges del 27 se compilaban en algún sitio.
2. **El e2e ya bloquea**: `publish` pasó a `needs: [ci, smoke, e2e]` en este mismo despliegue.
3. **Turnos abiertos inventariados** y revalidados esa mañana: los mismos cuatro del 27, ninguno
   nuevo. Ver `2026-08-27-turnos-abiertos-pre-d2.md`.
4. **Sin ventas en curso**: Sole no factura desde el 22-08 (9 días), así que la ventana no pisó a
   nadie. Por eso se desplegó por la mañana y no por la tarde.

## El susto: el PAT de GHCR había caducado

El primer intento abortó en el pull:

```
Error response from daemon: error from registry: denied
[deploy] Sin imagen api:c7c67eb ni acceso a GHCR. ¿docker login ghcr.io?
```

`deploy.sh` **falló bien**: cortó antes de recrear nada y antes de las migraciones. Producción
quedó intacta.

Diagnóstico: hasta el tag que ya estaba corriendo (`4be2f67`) daba `denied` → era la credencial, no
la imagen. El PAT classic con `read:packages` de `/root/.docker/config.json` había caducado. La
entrada seguía en el fichero; lo muerto era el token.

Segundo susto, encadenado: `docker login` interactivo devolvía `denied: denied` porque **la consola
web se traga el pegado en el prompt oculto** — llegaba una contraseña vacía. Se resolvió con:

```
read -rsp 'Pega el token y Enter: ' T; echo; printf 'longitud=%s prefijo=%s\n' "${#T}" "${T:0:4}"; echo -n "$T" | docker login ghcr.io -u matiasoyola --password-stdin
```

`longitud=40 prefijo=ghp_` → el token siempre fue correcto. `Login Succeeded`.

**Lección:** el D1 del 27 se hizo para "validar el canal" y su done afirma que el `docker login`
del VPS seguía vivo. Cuatro días después estaba caducado. **El canal no se valida una vez: caduca
solo.** Comprobar el login como puerta previa de cada despliegue y anotar la caducidad del PAT al
crearlo.

## Ejecución

```
cd /opt/mipiacetpv && IMAGE_TAG=c7c67eb bash infra/deploy.sh
```

- `git pull --ff-only` OK · Pull GHCR: api (62,4 s) + static-publish (2,6 s).
- 50 migraciones encontradas, 2 aplicadas, sin errores.
- Recreate: static-publish *Started* (4,9 s), api *Healthy* (26,4 s), worker *Started* (23,5 s).
- Healthchecks api y worker OK · `/health` OK.

## Verificación posterior

```
{"ok":true,"version":"c7c67eb","startedAt":"2026-08-31T10:46:07.490Z"}
https://mipiacetpv.com/ → 200
```

## Lo que falta mirar (día siguiente, 2026-09-01)

A las **05:00 Europe/Madrid** corre por primera vez el corte de día. Tiene que cerrar **esos cuatro
turnos y ninguno más**, con `close_reason = AUTO_DAY_CUT` y `cash_counted = NULL`:

```sql
SELECT left(id::text,8), closed_at, close_reason, cash_counted
  FROM shifts
 WHERE left(id::text,8) IN ('060def78','06db63c3','7cb1400a','08795489');
```

Y la query de turnos abiertos debe dar 0 filas (o sólo los abiertos esa misma mañana).

**Pendiente con el cliente:** avisar a Sole de que al volver verá la tarjeta de resumen de su turno
del 22-08 con el botón "Cuadrar caja". Es el diseño, pero conviene decirlo antes.
