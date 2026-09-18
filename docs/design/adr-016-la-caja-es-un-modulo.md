# ADR-016 · La caja es un módulo

_2026-09-12. Decide cómo existe en mipiacetpv una empresa que **no tiene caja** y **no tiene
Holded**. Precede al bloque H1 y es el nivel 1 de la decisión del 05-09 ("Holded es opcional")._

---

## 0. Tesis en una frase

La caja —venta, turno, catálogo del TPV, cajeros, dispositivos, impresión— es **una capacidad
por tenant**, `Tenant.cajaEnabled`, hermana de `crmEnabled` y `agendaEnabled`; su único rasgo
propio es que la **mueve el super-admin y no el cliente**, porque es una decisión comercial.

## 1. Contexto

Mi Piace abre un producto nuevo: el **control horario del personal**. Vive dentro de
mipiacetpv y a la vez se vende solo, a empresas que no quieren caja.

El cliente 0 es un **colegio de Talavera** que tenía Holded únicamente para fichar, se le ha
vencido y no lo renueva. Desde entonces no tiene registro de jornada.

Medido en el Frente 0 del bloque (`docs/blocks/h1-plan.md` §2), el sistema daba por supuesto
que todo tenant tiene caja y Holded en **92 rutas de API**, **una veintena de pantallas** y
—lo que lo hacía imposible— en dos sitios concretos:

- `POST /super-admin/tenants` exigía `holdedApiKey`: sin clave de Holded no había alta.
- `apps/admin/src/App.tsx` mandaba a `/onboarding` a **toda** empresa sin clave, y de ahí no
  se salía. Ése era el muro.

La decisión del **05-09-2026** ya estaba tomada: Mi Piace no entra en ERP y no será SIF; quien
necesite ERP activa Holded (ADR-015 §1). Lo que faltaba era la consecuencia estructural: si
Holded es opcional, **la caja también tiene que poder serlo**.

## 2. Lo que NO se decide aquí (frontera dura)

Ni el módulo de control horario, ni el CRUD local de productos y su capa anticorrupción
(nivel 2, la peluquería), ni la facturación del módulo, ni el alta pública o el autoservicio.
Y **nada del camino de cobro**: el GET-back de Holded, los 5 céntimos y el `/pay` idempotente
se quedan exactamente como están, igual que los triggers de S1 (ADR-015) y la agenda.

## 3. Decisión: una columna booleana, no un vertical ni un plan

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| `businessType` nuevo (p. ej. `WORKFORCE`) | ADR-R6 lo prohíbe explícitamente: capacidades por tenant, no verticales clavados. Un colegio podría querer caja en la cafetería mañana, y un `businessType` obliga a elegir una identidad. |
| Un enum de **plan** (`BASIC`/`FULL`/`HORARIO`) | Ata la capacidad a la tarifa. La tarifa cambia más rápido que el producto, y cada cambio comercial sería una migración. Los planes se construyen COMBINANDO capacidades, no al revés. |
| Un `jsonb capabilities` | Ya descartado en B-reservas-1 (ADR-R6): columnas explícitas son tipadas, indexables y aparecen en la migración. |
| Derivarlo de datos existentes ("¿tiene registers?") | Un tenant nuevo con caja tampoco tiene registers todavía. Se confundiría "sin configurar" con "sin módulo". |

**Decisión:** `Tenant.cajaEnabled Boolean @default(true) @map("caja_enabled")`.

`@default(true)` y no `false`: el backfill de la migración deja a **todos** los tenants de hoy
exactamente como estaban. Sólo un `false` explícito apaga la caja — criterio que se repite en
cada gate del sistema (`=== false`, nunca `!`).

### 3.1 Quién la mueve

CRM y agenda las enciende el propietario desde su panel (`POST /admin/tenant/settings`). **La
caja no.** Se mueve sólo desde el super-admin, en el alta y en el detalle del tenant.

La razón no es técnica: **encender la caja es vender un producto**. Un propietario que la
enciende solo empieza a usar un módulo que no ha contratado; uno que la apaga sin querer deja
de cobrar. La ruta del panel devuelve 400 si alguien intenta mandarla
(`additionalProperties: false`), y el `GET` sí la devuelve porque el panel la necesita para
esconder lo que no aplica.

**Consecuencia asumida:** la asimetría entre las tres capabilities hermanas. Se documenta en
el propio `tenant-settings.ts` para que no parezca un olvido.

## 4. Decisión: el sync que no aplica es un estado, no un flag

Una empresa sin Holded tiene que dejar dicho, en algún sitio, que **nunca va a sincronizar**.

**Alternativas descartadas:**

| Alternativa | Por qué no |
|---|---|
| Reutilizar `DONE` | Miente, y además es el filtro **literal** del cron incremental (`catalog-incremental-worker.ts:72`) y del script de reconciliación: el colegio entraría en la barredera cada 15 minutos. |
| Dejar `PENDING` | Parece un sync a medias. El panel del super-admin lo pinta como "esperando" y el implantador se queda esperando algo que no ha empezado nunca. |
| Una columna nueva `usesHolded` | Redundante: `holdedApiKeyCiphertext != null` ya es la fuente de verdad que mira todo el sistema. Una segunda fuente es una oportunidad de que las dos discrepen. |

**Decisión:** `InitialSyncStatus.NOT_APPLICABLE`. El estado del sync **ya es el sitio donde
todo el mundo mira** — el panel, los crons, la salud del onboarding—, así que ahí es donde se
dice.

**Consecuencia medida:** ningún cron ni worker necesita cambio. Los dos que barren tenants
filtran por `initial_sync_status = 'DONE'` **y** por clave presente, y `NOT_APPLICABLE` no
entra por ninguna de las dos puertas. El e2e lo ejecuta contra Postgres, no lo razona.

**Salida en un solo sentido:** de `NOT_APPLICABLE` se sale al guardar una clave de Holded, que
lo pasa a `PENDING` y encola el sync inicial. Desde cualquier otro estado, guardar una clave
sigue siendo una **rotación** y no resincroniza nada.

## 5. Decisión: cada check de activación declara de qué depende

`computeOnboardingHealth` daba por hecho caja y Holded en sus cinco checks, y `ready` era
`checks.every(ok)`. Una empresa sin caja no pasaba ninguno: no se podía activar **nunca**.

**Alternativa descartada:** un conjunto de checks distinto por tipo de empresa. Multiplica los
caminos y garantiza que el día que se añada un check alguien olvide una de las ramas.

**Decisión:** un solo conjunto. Cada check declara `requires: "always" | "caja" | "holded"`, y

```
ready = checks.filter(applies).every(ok)
```

Los que aplican siguen **igual de duros**: ni un umbral se relaja.

`sync-done` depende de **Holded**, no de la caja. Una empresa con caja y sin Holded (caja
local) no debe quedar bloqueada por un sync que nunca va a correr: la dependencia real de ese
check es la clave.

Y dos checks nuevos que valen para cualquier empresa y sí bloquean: **al menos un módulo
encendido** y **datos fiscales mínimos**.

**Consecuencia en la UI:** un check tiene **tres** estados, no dos, y se distinguen sin
depender del color (icono + etiqueta): *Cumple*, *Falta*, *No aplica · sin caja*.

## 6. Decisión: el gate es del servidor, en ruta y en UI, sin `if (businessType)`

Se copia literalmente el patrón de `ensureAgendaEnabled` (ADR-R6): un `preHandler` tras la
autenticación que devuelve **403 `CAJA_DISABLED`** con una frase. Dos diferencias, las dos
deliberadas:

1. Resuelve el tenant desde las **tres** puertas de auth (`request.auth`, `request.cashier`,
   `request.device`), porque la caja se cruza desde las tres.
2. La lectura es **tolerante y falla hacia "encendida"**. Esto es una *capability*, no la
   frontera de aislamiento —ésa la hacen `requireCashierSession` y `requireOwner`, y ninguna
   depende de esta función—. Fallar hacia "apagado" dejaría sin cobrar a un cliente que cobra,
   que es lo peor que este cambio puede romper; fallar hacia "encendido" deja el
   comportamiento de master.

Esconder no es gatear: cada sección escondida del panel tiene además su puerta de servidor, y
el flag que el TPV cachea es UI — un catálogo cacheado no abre nada.

**Excepción documentada:** `GET /tpv/catalog/products` lleva la puerta **dentro** del handler,
sobre el tenant que la primera página ya lee. Un `preHandler` añadiría una consulta por cada
cursor de paginación, que es justo lo que B4 evita.

## 7. Consecuencias

**Se gana:**

- Una empresa puede existir, activarse y entrar en su panel sin caja y sin Holded. El colegio
  deja de ser imposible.
- La caja se puede apagar a un cliente existente sin borrarle nada.
- Los planes comerciales futuros se construyen combinando capabilities, sin migración.

**Se paga:**

- Una consulta por PK más en las rutas de caja. Mismo coste que el gate de agenda, ya asumido.
- La asimetría de gobierno entre las tres capabilities hermanas (§3.1).
- 92 sitios que gatear, y la lista tiene que mantenerse viva: una ruta de caja nueva que no
  lleve la puerta es un agujero silencioso. Lo cubre un test que cuenta las puertas por
  fichero.

**Queda fuera y hace falta para el colegio:** el flag del módulo de control horario. Con el
invariante "al menos un módulo encendido", hoy el colegio se da de alta como DRAFT y **no se
activa** hasta que ese flag exista. Es el nivel siguiente, no un fallo de éste.

## 8. Referencias

- `docs/design/reservas-modulo-kickoff.md` §ADR-R6 — capacidades por tenant, el patrón que se copia.
- `docs/design/adr-015-sello-de-la-venta.md` §1 — la decisión del 05-09 de la que esto es consecuencia.
- `docs/blocks/h1-plan.md` §2 — el inventario medido de lo que suponía caja o Holded.
- `docs/blocks/h1-done.md` — decisiones del bloque, tabla de sabotaje y qué no cubre la suite.
