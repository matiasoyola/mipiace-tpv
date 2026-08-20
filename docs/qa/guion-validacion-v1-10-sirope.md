# Guion · validar v1.10 en producción sin tocar a Sole ni el AP12

**Fecha:** 2026-08-20 · **Producción:** `4669bfa` · **Duración:** ~15 min · **Dónde:** navegador del portátil.

## Por qué existe este guion

v1.10 reescribió **login, apertura y cierre de turno** y la capa de impresión. Está en producción desde el 19 por
la tarde. Pero el único turno vivo de Sole se abrió **el 19 a las 10:00**, o sea con el código anterior, y sigue
abierto — ella no cierra nunca (ver memoria `sole-nunca-cierra-turno`).

Consecuencia: **desde el despliegue no se ha ejecutado ni un login, ni una apertura, ni un cierre**. Lo único
ejercitado es el cobro (ticket del 20 a las 10:17). Los tres caminos se estrenan de golpe **mañana sobre las
10:00**, en un turno de 26 h, con una clienta delante y nadie mirando.

Este guion los ejercita hoy, contra la producción real, en **Cafetería Sirope** — tenant ACTIVE con 0 ventas
reales y 12 tickets de prueba. No toca a Sole.

## Antes de empezar

- [ ] `curl https://mipiacetpv.com/health` (o `/api/health`) devuelve `version` = **4669bfa**. Si no, no estás
      probando lo que crees.
- [ ] Ventana horaria: Sole vende por las mañanas. Sirope es otro tenant, así que no hay riesgo cruzado, pero si
      algo obliga a reiniciar el API, hazlo cuando ella no esté cobrando.

## Paso 1 · Login de cajero — **con login real, no modo prueba**

**Importante:** el modo prueba del super-admin emite el `cashierSessionToken` directamente y **se salta el login**.
Si entras por ahí no estás probando lo que hay que probar. Entra con PIN de cajero de Sirope, como un cajero.

- [ ] Abre `https://mipiacetpv.com` en una ventana **de incógnito** (para no arrastrar sesión).
- [ ] Login de cajero con PIN.
- [ ] ✅ Entra a la primera, sin errores de consola.
- [ ] Anota si aparece algo raro: contador de intentos restantes, aviso de dispositivo nuevo, banner de versión.

> Esto es lo que v1.10 más tocó (login offline, `offlineAuth.ts`, `offlineSession.ts`). Es el paso más importante
> del guion.

## Paso 2 · Apertura de turno

- [ ] Abre turno con un fondo de caja (p. ej. 50 €).
- [ ] ✅ El turno abre y aterrizas en la pantalla de venta.
- [ ] Si sale `409 SHIFT_ALREADY_OPEN`, **es el hallazgo de hoy en directo**: anótalo y reanuda.

## Paso 3 · Una venta

- [ ] Añade un par de líneas y cobra en efectivo.
- [ ] ✅ El ticket se emite, el overlay de éxito aparece y se autocierra.
- [ ] La impresión fallará o no hará nada (no hay impresora conectada al portátil): **es lo esperado**. Anota si
      falla **con un error visible y elegante** o si se queda muda — eso sí es un bug de v1.10.

> Ojo: la impresión va **después** del pago, en el overlay. Que un ticket se cobre no demuestra que salga papel.
> El papel sólo lo cierra el AP12, y eso sigue pendiente para cuando quieras.

## Paso 4 · Cierre de turno — el que nadie ha ejecutado

- [ ] Cierra el turno con su arqueo.
- [ ] ✅ El cierre pasa, se genera el informe Z y lo puedes abrir.
- [ ] Cronometra mentalmente cuántos pasos y cuánto tiempo te lleva. Es exactamente lo que Sole hace cada mañana de
      pie: es la mejor forma de calibrar el bloque v1.11.

## Paso 5 · Modo avión (si te apetece rematar)

- [ ] Con el turno abierto, corta la red del portátil, cobra un ticket, vuelve a conectar.
- [ ] ✅ El ticket sale de la cola y aparece cobrado. Es la promesa de v1.10.

## Verificación final en la BD

```
docker exec mipiacetpv-postgres psql -U mipiacetpv -d mipiacetpv -c "SELECT t.name, s.opened_at AT TIME ZONE 'Europe/Madrid' AS abierto, s.closed_at AT TIME ZONE 'Europe/Madrid' AS cerrado, (SELECT count(*) FROM tickets tk WHERE tk.shift_id = s.id AND tk.paid_at IS NOT NULL) AS tickets FROM shifts s JOIN registers r ON r.id = s.register_id JOIN stores st ON st.id = r.store_id JOIN tenants t ON t.id = st.tenant_id WHERE t.name LIKE '%Sirope%' ORDER BY s.opened_at DESC LIMIT 5;"
```

## Resultado

- **Los cuatro pasos en verde** → v1.10 está validado en todo menos el papel. Mañana a las 10:00 no hay sorpresa, y
  se puede encender el CRM a Sole con tranquilidad.
- **Cualquiera en rojo** → rollback antes de que ella abra: `IMAGE_TAG=964f4e1 bash infra/deploy.sh`.
