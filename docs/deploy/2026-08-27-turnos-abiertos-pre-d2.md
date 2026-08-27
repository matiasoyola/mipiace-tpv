# Turnos abiertos en producción antes del Despliegue 2

**Sacado el 2026-08-27 (tarde), contra producción en `4be2f67`.** Puerta 3 de las go/no-go de D2.
La primera madrugada tras v1.11, a las 05:00 Europe/Madrid, el corte de día cierra **estos cuatro**
con `closeReason = AUTO_DAY_CUT`, `cashCounted = NULL` y un informe Z generado por el server. Al
día siguiente hay que comprobar que aparecen cerrados **estos cuatro y ninguno más**.

## La SQL del plan estaba mal

`registers` **no tiene `tenant_id`**: cuelga de `stores`, y es `stores` la que tiene el tenant. La
query del plan (`JOIN tenants t ON t.id = r.tenant_id`) falla con `column r.tenant_id does not
exist`. La buena, ya corregida también en `lote-2026-08-plan.md`:

```sql
SELECT t.name AS tenant, r.name AS caja, COALESCE(u.alias, u.email) AS cajero,
       s.opened_at::date AS abierto_el,
       EXTRACT(DAY FROM now() - s.opened_at)::int AS dias, s.id
  FROM shifts s
  JOIN registers r ON r.id = s.register_id
  JOIN stores    st ON st.id = r.store_id
  JOIN tenants   t ON t.id = st.tenant_id
  JOIN users     u ON u.id = s.user_id
 WHERE s.closed_at IS NULL
 ORDER BY s.opened_at;
```

Se ejecuta sin manejar secretos, dejando que el contenedor ponga sus propias credenciales:

```bash
docker exec mipiacetpv-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "…"'
```

## El resultado (4 filas)

| Tenant | Caja | Cajero | Abierto el | Días | Fondo | Tickets | Total | Shift id |
|---|---|---|---|---|---|---|---|---|
| Fouzia Attaoui Batah | Caja 1 | `mipiacetpv-test-351fed3b` | 2026-06-08 | 80 | 0,00 | 1 | 37,50 | `060def78-53db-43e3-a59f-65c0c64c6ca2` |
| Frutos Secos Cachitos | Caja 1 | sanchezmillanvirginia | 2026-06-26 | 62 | 82,00 | 0 | 0,00 | `06db63c3-7ad5-4bf5-bf03-dd0ff39b7dd5` |
| Librería Thalía | Caja 1 | `mipiacetpv-test-4bbb539c` | 2026-07-03 | 55 | 100,00 | 1 | 6,20 | `7cb1400a-4880-42b3-8d3d-8b8f2b127524` |
| María Soledad Morán Segovia · Peluquería Sole | Caja 1 | solepelos | 2026-08-22 | 5 | 0,00 | 1 | 32,10 | `08795489-0326-47db-95e6-13f55b12d90a` |

## Lectura

**Tres de los cuatro son basura conocida y el barrido es justo lo que hace falta.** Dos los abrió
un cajero de pruebas (`mipiacetpv-test-*`) en junio y julio; el de Cachitos lleva 62 días abierto
con fondo de 82 € y **cero tickets** — encaja con las 8 semanas de parón del cliente.

**El cuarto es el que hay que mirar: es el turno real de Sole.** Abierto el 22 de agosto con un
ticket de 32,10 €, y ahí sigue. Confirma lo que ya sabíamos de ella: no cierra el turno nunca.

Consecuencia concreta, y es la que puede hacer sonar el teléfono: cuando el corte lo cierre, **a la
mañana siguiente Sole se encontrará la tarjeta de resumen de un turno del 22 de agosto**, con su
Z generado por el server y el botón de "Cuadrar caja" (el arqueo a posteriori que v1.11 permite
sólo para cierres `AUTO_DAY_CUT`, `apps/api/src/shift/routes.ts` §postHocCount). No es un fallo —
es el diseño — pero conviene decírselo antes, no que lo descubra ella.

Los otros tres tenants no están operando, así que su resumen no lo verá nadie.

## Comprobación del día después

Misma query. Tiene que devolver **0 filas** (o sólo turnos abiertos esa misma mañana), y estos
cuatro ids deben salir con `close_reason = AUTO_DAY_CUT`:

```sql
SELECT id, closed_at, close_reason, cash_counted
  FROM shifts
 WHERE id IN ('060def78-53db-43e3-a59f-65c0c64c6ca2',
              '06db63c3-7ad5-4bf5-bf03-dd0ff39b7dd5',
              '7cb1400a-4880-42b3-8d3d-8b8f2b127524',
              '08795489-0326-47db-95e6-13f55b12d90a');
```
