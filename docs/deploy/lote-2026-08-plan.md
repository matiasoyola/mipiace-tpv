# Plan de despliegue del lote de agosto 2026

Escrito el 2026-08-27, con dos sesiones de Claude Code corriendo (v1.12-A y v1.12-B).
Fuente de verdad del orden de salida a producción. Se actualiza, no se duplica.

## Estado verificado hoy

```
$ curl https://api.mipiacetpv.com/health
{"ok":true,"version":"4669bfa","startedAt":"2026-08-19T16:01:57.503Z"}
```

Producción lleva **ocho días** con la misma imagen. Entre esa imagen y lo que hay escrito se
acumulan **cinco bloques**:

| Bloque | Dónde está | Qué toca | Migración |
|---|---|---|---|
| v1.10.2 impresión honesta | **ya en master** (`fffaddd`) | `api/tickets/print.ts`, `tpv-web`, `escpos-builder` | no |
| paso de humo en CI | **ya en master** (`a286220`) | `.github/workflows/ci.yml` | no |
| v1.10.3 barra en hora punta | rama, sin mergear | sólo `tpv-web` | no |
| v1.11 cierre de día | rama, sin mergear | `api`, `tpv-web`, `admin`, **worker** | **sí**, una |
| v1.12-A manos de camarero | en curso | sólo `tpv-web` | no |
| v1.12-B mesas abandonadas | en curso | `api`, `admin` | por ver |

**Un lote de cinco bloques no se despliega de una vez.** Se parte en dos.

## Despliegue 1 · lo que ya está en master (hoy o mañana, sin esperar a nadie)

Sólo v1.10.2 + el paso de humo. Sin migración, sin worker nuevo, sin cambio de operativa: la
impresión deja de decir "Enviado a impresora" cuando no hay ninguna configurada. Riesgo bajo, y
sirve para **validar el canal de despliegue después de ocho días sin tocarlo** — que es
exactamente el momento en que un despliegue falla por algo que no tiene que ver con el código.

```bash
# En el VPS, con el sha de master ya pusheado y CI verde
IMAGE_TAG=<sha de master> bash infra/deploy.sh
curl https://api.mipiacetpv.com/health     # version = <sha>
```

Rollback: `IMAGE_TAG=4669bfa bash infra/deploy.sh`.

## Despliegue 2 · el bloque gordo (sólo con v1.13 en verde)

10.3 + 11 + 12-A + 12-B juntos, en este orden de merge a master:

```
v1-10-3-barra-hora-punta  →  v1-11-cierre-de-dia  →  v1-12-A  →  v1-12-B
```

Es el orden en que se construyó `v1-12-base`, así que los conflictos ya están resueltos una vez.

### Puertas go/no-go

1. **CI verde en master**, incluido el paso de humo. Puerta del protocolo anti-sustos.
2. **v1.13 (e2e del ciclo de caja) en verde contra Postgres de verdad.** Esta es la puerta nueva y
   la que justifica todo: v1.11 mete un job que cierra turnos solo a las cinco de la mañana en la
   caja de un cliente, y hoy sólo está probado contra un prisma falso.
3. **Saber qué turnos hay abiertos antes de desplegar** (ver más abajo).
4. Los dos clientes vivos avisados del cambio de operativa (ver más abajo).

Sin las cuatro, no se despliega. Con las cuatro, no hace falta pedir permiso a nadie.

### La migración

Una sola: `20260820000000_v1_11_cierre_de_dia`. **Aditiva**: cinco columnas y un enum, todas con
default, más un `UPDATE` de backfill que marca como ya confirmados los resúmenes de los turnos
cerrados antes de v1.11 (sin él, el primer login enseñaría a Sirope el resumen del 9 de julio).

Consecuencia práctica, y es buena noticia: **el rollback de código no necesita rollback de
esquema**. Las columnas nuevas le sobran a la imagen `4669bfa`; puede correr encima de ellas sin
enterarse. `deploy.sh` corre `prisma migrate deploy` antes de recrear los contenedores.

### Los dos cambios de comportamiento que verá un cliente sin tocar nada

Esto no es una nota técnica: son las dos cosas por las que puede sonar el teléfono al día
siguiente.

1. **Cerrar turno deja de exigir contar el efectivo.** `require_cash_count_on_close` entra con
   default `false` — decisión de producto tomada el 2026-08-20. Sole lleva meses haciendo el
   arqueo de pie antes de su primera clienta; a partir del despliegue, no.
2. **A las 5:00 hora local, un job cierra los turnos que vienen del día anterior**, con
   `closeReason = AUTO_DAY_CUT` y sin arqueo. **La primera madrugada tras el despliegue barrerá
   de golpe todos los turnos viejos que estén abiertos.** Eso es lo que queremos, pero hay que
   saber cuáles son *antes*, no descubrirlo por el resumen de la mañana siguiente:

```sql
SELECT t.name, r.id AS register_id, s.opened_at, s.id
  FROM shifts s
  JOIN registers r ON r.id = s.register_id
  JOIN tenants   t ON t.id = r.tenant_id
 WHERE s.closed_at IS NULL
 ORDER BY s.opened_at;
```

Guardar el resultado en el done del despliegue. Al día siguiente, esos mismos turnos tienen que
aparecer cerrados con `AUTO_DAY_CUT` y ninguno más.

### Ventana

Dos restricciones que se cruzan, y hay que respetar las dos:

- **Peluquería Sole vende por las mañanas** y es el único cliente facturando a diario (184 ventas,
  la última el 18 de agosto). Un despliegue del núcleo por la mañana cae encima de un negocio
  vivo. → **Se despliega por la tarde.**
- **El corte de día corre a las 5:00.** El primer corte real ocurre en la madrugada *siguiente* al
  despliegue.

Por tanto: **desplegar por la tarde y estar mirando a primera hora de la mañana siguiente, antes
de que Sole abra.** Nunca un viernes por la tarde: el primer corte caería en sábado sin nadie
delante. Martes o miércoles por la tarde es la ventana buena.

## Fuera de este plan

- **Reinicio del VPS y las 29 actualizaciones pendientes** (una de seguridad): tarea propia, otro
  día, **nunca la misma sesión que un despliegue de aplicación**. Si algo se rompe, hay que saber
  cuál de las dos cosas fue.
- **La APK.** Las pruebas del AP11 dejaron claro que ningún terminal se entrega con la PWA sobre
  el Chrome de fábrica. Eso es implantación (bloque A3), no este lote.
- Reservas / agenda: sigue con sus flags apagados y su propio carril.
