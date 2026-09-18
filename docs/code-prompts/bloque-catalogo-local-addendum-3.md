# Addendum 3 · el muro de /onboarding, y el interruptor que faltaba

Hallazgo verificado en código + decisión de Matías, 2026-09-13. Esto **amplía el alcance**
de `bloque-catalogo-local.md`: sin ello el bloque no funciona.

## El muro

`apps/admin/src/App.tsx:194`:

```ts
if (!me.tenant.hasHoldedKey) navigate("/onboarding", { replace: true });
```

Un tenant **con caja y sin Holded** entra al admin y cae en la pantalla de "Conectar
Holded", y de ahí no sale. H1 (ADR-016) abrió la puerta **sólo** para
`cajaEnabled === false` — el colegio. El que tiene caja sigue contra el muro.

Traducido: este bloque le daría un catálogo local **al que no puede llegar**, y el
**criterio 1 del prompt** ("un tenant sin Holded y con caja da de alta tres productos, los
ve en el TPV y cobra un ticket con ellos") es hoy literalmente imposible de cumplir.

## La raíz

`!hasHoldedKey` significa **dos cosas distintas** y el código no puede distinguirlas:

- *"todavía no lo ha conectado"* → está a mitad del onboarding, el muro es correcto.
- *"no lo va a conectar nunca"* → es el cliente de este bloque, y el muro es un error.

Hace falta un interruptor explícito. No se deduce del catálogo ni de la ausencia de clave:
deducirlo sería circular (para crear productos hay que entrar, y para entrar habría que
tener productos).

## La decisión de Matías

**El interruptor lo apaga sólo el super-admin, al dar de alta el tenant.** El propietario
no tiene ninguna salida de "trabajar sin Holded" en su pantalla de onboarding.

Por qué: la implantación de Holded es una **decisión de venta de Mi Piace**, no una casilla
que el cliente se marca solo. Poner la salida barata a un clic en la misma pantalla donde
se vende la implantación es regalarla. Y el cliente que se la marcara por no leer acabaría
con catálogo local queriendo el ERP, sin marcha atrás cómoda: es **forward-only**, no se
sube nada de lo cobrado en el periodo local.

Hoy **todas** las altas pasan por Matías, así que esto no añade trabajo real.

## Lo que hay que construir

### 1 · La columna

`Tenant.holdedEnabled Boolean @default(true)`, mismo patrón y mismo criterio que
`cajaEnabled` en H1: nace encendido, todo lo que existe hoy se comporta exactamente igual,
y **sólo un `false` explícito** lo apaga (`holdedEnabled !== false`, no `!holdedEnabled`).

Va en la **misma migración** `20260913000000_catalogo_local`: el bloque despliega una vez y
`tenants` tiene decenas de filas, no miles. Dilo en el done con su medición, igual que el
resto.

⚠️ **Colisión de vocabulario**: `onboarding-health.ts` ya tiene un `usesHolded` calculado
que significa *"tiene clave"*. Ahora son **dos preguntas distintas**: ¿está previsto que use
Holded? (`holdedEnabled`) y ¿lo tiene conectado ya? (`hasHoldedKey`). Desambigua los nombres
en ese fichero, no dejes las dos ideas llamándose parecido.

### 2 · Las cuatro cosas que cuelgan del interruptor

- **El gate del admin** (`App.tsx`): la comprobación de `holdedEnabled === false` va
  **justo después** de la de `cajaEnabled === false` y **antes** de la de `hasHoldedKey`.
  Ese tenant entra a su panel y no ve `/onboarding` jamás.
- **El alta local** se abre **si y sólo si** `holdedEnabled === false`. Ojo: esto **cambia**
  lo que decía el prompt (§3, "si el tenant tiene Holded conectado"). Con el interruptor la
  regla es mejor y más estricta: un tenant con `holdedEnabled = true` que aún no ha
  conectado está **a mitad de su onboarding** y tampoco debe crear productos locales. El 403
  sigue el patrón de `caja-gate.ts`.
- **`shouldEnqueueHoldedUpload` / `paidTicketStatus`**: ver la sección propia más abajo.
  Code ya los resolvió antes de este addendum, y bien, pero con el predicado equivocado.
- **`onboarding-health.ts`**: los checks que dependen de Holded dicen **"No aplica"** cuando
  `holdedEnabled === false`, exactamente como H1 hizo con los de caja. Un tenant sin Holded
  no puede salir "no listo" por no tener impuestos sincronizados.

### 3 · La guarda del propio interruptor

El super-admin **sólo puede apagarlo si el tenant no tiene clave de Holded conectada**.
Apagarlo en un tenant que ya está subiendo tickets dejaría documentos a medias y ventas sin
subir sin que nadie se enterara. Si tiene clave: 409 con el motivo, no un toggle que
obedece.

`/auth/me` tiene que devolver `holdedEnabled` para que el gate del front pueda leerlo.

## Al done-doc

- El sabotaje obligatorio: apagar el interruptor a mano en un tenant con clave y demostrar
  que el 409 lo caza.
- El recorrido completo del criterio 1, de punta a punta, en un tenant creado con
  `holdedEnabled = false`: entra al panel sin muro, da de alta tres productos con SKU, los
  ve en el TPV, cobra, y **en los logs se ve que no intenta subir nada**.
- Y el criterio 4 con Sole: `holdedEnabled` nace `true`, nada de esto se le aplica.

## El choque con lo que Code ya hizo (leer entero antes de tocar el gate)

Code encontró y arregló, antes de este addendum, algo que precede al bloque y que estaba
roto de verdad: `shouldEnqueueHoldedUpload()` decidía **sólo por `TicketStatus`**, así que
un tenant con caja y sin Holded cobraba bien pero se le creaba la fila `HoldedUpload`, se
encolaba el job y `uploadTicket` lo tumbaba con `no_holded_key` → `SYNC_FAILED`. Vendía
perfectamente y tenía la bandeja de errores encendida con todos sus tickets, para siempre.
Y había **cuatro** caminos que encolaban, no dos: mesa y devolución no pasaban por el gate.
Lo resolvió con `paidTicketStatus()`: sin Holded el ticket nace `PAID`.

**El arreglo es correcto y se queda.** Lo que hay que cambiar es su predicado: lo decide
`tenantHasHoldedKey`, que es exactamente la señal de dos significados que este addendum
viene a partir en dos.

### La tabla

| | ¿encola? | estado al cobrar |
|---|---|---|
| `holdedEnabled = false` | no | `PAID` |
| `holdedEnabled = true`, **sin** clave todavía | no | `PAID` |
| `holdedEnabled = true`, con clave | sí | `PENDING_SYNC` |

Las dos primeras filas **hacen** lo mismo y **no significan** lo mismo. Por eso no pueden
compartir la línea de log:

- La primera es **correcta por diseño**: no hay destino y no lo habrá. Log informativo.
- La segunda es una **anomalía**: un cliente que compró el ERP está cobrando antes de
  conectarlo, y esas ventas **no llegarán nunca a su contabilidad**. Eso no puede pasar en
  silencio — es justo lo que el bloque prohíbe en la puerta del §3 ("que falle ruidosamente,
  nunca en silencio"). Log de **warning** con el id del ticket, y un check en
  `onboarding-health` que lo cante: *"N tickets cobrados antes de conectar Holded; no se
  subirán"*.

### Lo que NO se hace, y por qué

No se manda esa segunda fila a `PENDING_SYNC`. Sería lo intuitivo ("que espere y suba
cuando llegue la clave"), pero Code ya demostró que **no hay sweeper** que recoja
`PENDING_SYNC`, así que el ticket se quedaría ahí para siempre y arrastraría las tres
consecuencias que él documentó: no se podría devolver (`POST /tickets/:id/refunds` exige
`SYNCED` o `PAID`), el corte y el Z lo contarían como incidencia pendiente cada día, y el
cliente cerraría en falso. `PAID` + warning es peor de lo ideal y mejor que todo lo demás.

Un sweeper que suba lo cobrado antes de conectar es un bloque aparte, y tendría que
resolver primero la pregunta fiscal de las fechas pasadas.

### Nota de alcance para el done

Esto es **alcance por encima del prompt** y Matías lo sabe. Se acepta porque está puesto
detrás de "sin Holded" y por tanto el **criterio 4** sigue en pie: un tenant con Holded
conectado se comporta exactamente igual que antes. Demuéstralo, no lo afirmes.
