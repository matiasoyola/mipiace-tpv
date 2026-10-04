# catalogo-en-alta · paso 0: el camino de un bar nuevo sin Holded, recorrido

Hecho el 04-10-2026 en la rama `catalogo-en-alta` (worktree propio, base
`mipiacetpv_catalogo` en el Postgres local, Redis aislado en la db 3 para no
comerle los jobs a las otras sesiones). API en `:3001` y admin en `:5173`, los dos
de verdad; el recorrido se hizo con la UI del super-admin, no con curl, y lo que
sale abajo es lo que respondió el servidor.

## Lo que se hizo, en orden

1. Super-admin nuevo (`paso0@mipiace.es`) y login en `/superadmin/login`.
2. Alta por el formulario: **«No lo usa»** (sin Holded), módulo **Caja**,
   **Hostelería**, NIF `B12345674`, razón social `Bar La Maestranza SL`.
   → tenant `551a6c41` en **DRAFT**, `caja_enabled = t`, `holded_enabled = f`.
3. Inventario de la ficha en DRAFT. Paneles que salen: Datos fiscales (con
   «Editar»), Validación de onboarding, **Modo prueba**, Activar cuenta, ID de
   cuenta Holded, Pie de ticket, Icono del catálogo, Cajeros (lectura) y
   Facturación (VERI*FACTU). **No hay ningún panel de catálogo.**
4. Intento de activar, de impersonar y de abrir el modo prueba.

## Lo que la salud dice en ese DRAFT

```
modules-enabled          applies=True  ok=True   caja
fiscal-minimum           applies=True  ok=True   Bar La Maestranza SL · B12345674
sync-done                applies=False ok=False  NOT_APPLICABLE
taxes-ratio              applies=False ok=False  0/0 (100%)
tickets-before-holded    applies=False ok=True   0
products-sellable        applies=True  ok=False  0/0 (100%)
no-sync-failures         applies=True  ok=True   0 pendientes
test-cashier-provisioned applies=True  ok=False  no
```

Y la activación, pedida de verdad:

```
POST /super-admin/tenants/551a6c41…/activate
→ 400 {"error":"ONBOARDING_NOT_READY",
       "failing":["≥50% de productos sellable","Cajero técnico provisionado"]}
```

**Son DOS motivos, no uno.** El §0 del checklist de La Maestranza sólo había visto
el primero.

## Hallazgo nuevo · el cajero técnico tampoco se puede provisionar

El prompt del bloque daba por bueno que «Probar TPV» funciona en DRAFT. **No
funciona en un tenant sin Holded**, y no por el servidor sino por la pantalla:

- `test-cashier-provisioned` se pone en verde cuando existe el usuario técnico
  (`onboarding-health.ts:384`), y lo crea **sólo el worker del sync inicial**
  (`workers/initial-sync-worker.ts:53`). Sin Holded el sync está en
  `NOT_APPLICABLE` y ese worker no corre nunca.
- El endpoint **sí** sabe provisionarlo a demanda: `issueTestCashierSession`
  llama a `provisionTestCashier` en su primera línea
  (`superadmin/test-cashier.ts:233`). Lo comprobé: un `POST
  /super-admin/tenants/:id/test-cashier-token` creó tienda, caja, dispositivo y
  cajero técnico, y el check pasó a verde al instante.
- Pero el botón que lo llama está **deshabilitado** con
  `disabled={busy || !h.testCashierProvisioned}`
  (`admin/src/superadmin/TenantDetailPage.tsx:1150`), y debajo pone **«Esperando
  a que el sync inicial termine para provisionar el cajero técnico»**. En este
  comercio no hay sync que esperar: el mensaje es falso y la espera es infinita.
- La salida que sugiere el propio código del worker («dejamos al super-admin
  reaprovisionar manualmente (re-sync)») tampoco existe aquí:
  `POST …/resync` → `409 HOLDED_NO_HABILITADO`.

O sea: **el botón que provisiona el cajero técnico está cerrado con la llave que
sólo él puede fabricar.** Es el mismo bucle que el del catálogo, con otra puerta.

## Tabla de lo encontrado

| Cosa | ¿Se puede en DRAFT? | ¿Bloquea la ACTIVACIÓN? | Decisión |
|---|---|---|---|
| **Catálogo** (128 productos) | No. No hay ruta de catálogo en el super-admin y `POST /catalog/products` pide OWNER o MANAGER, que no existen hasta activar | **Sí** — `products-sellable` con 0 productos es rojo | **Entra** (alcance §1 del prompt) |
| **Cajero técnico / modo prueba** | No, por la UI (ver arriba). El servidor sí puede | **Sí** — `test-cashier-provisioned` | **Entra**. Arreglo pequeño: el botón no debe depender del flag que él mismo enciende, y la nota ámbar no debe hablar de un sync que no existe |
| **Sala** (zonas y mesas) | No: no hay ruta en el super-admin y el panel del OWNER no existe hasta activar | No. Y el ensayo **sí** se puede hacer sin mesas: `POST /tickets` no exige `tableId` (venta rápida de barra) | Se apunta. Se hace tras activar, con el dueño delante, igual que en Sirope |
| **Cajeros reales** (camareros con PIN) | No: el panel de cajeros del super-admin es de **lectura** (bloque soporte-cajeros) | No | Se apunta. Tras activar |
| **Impresora** | No: `/admin/printers` es del panel del OWNER | No | Se apunta. Tras activar, y la impresora real sólo se prueba en el bar (§4 del checklist) |
| **Datos fiscales del ticket** (razón social, NIF, dirección, teléfono, pie de ticket, icono del catálogo) | **Sí**, desde la ficha del super-admin en DRAFT | No (y `fiscal-minimum` ya pasa) | Nada que hacer |
| Cosmético: `products-sellable` enseña `0/0 (100%)` en rojo | — | No | Se apunta. Un catálogo vacío leyéndose como «100 %» confunde al implantador; una línea en `onboarding-health.ts` |

## La puerta del paso 0

El prompt dice: si aparece algo **aparte del catálogo** que bloquee la activación,
entra en el bloque; si cambia de tamaño (más de un día), para y que lo redimensione
Dirección.

Ha aparecido: el cajero técnico. **No cambia el tamaño del bloque.** Lo que falta
es una condición de `disabled` y el texto que la acompaña en un panel que ya
existe, más su prueba en el e2e del camino completo —que el prompt ya pedía, con
«Probar TPV» dentro—. Sigo con el alcance declarado, con ese arreglo dentro.

Lo que **no** entra, por la misma regla (estorban, no bloquean): sala, cajeros
reales e impresora. Los tres se hacen después de activar, desde el panel del
propietario, y ninguno obliga a emitir una factura de prueba.
