# Despliegue · Bar La Maestranza (Santa Olalla) — sin Holded

Preparado el 04-10-2026. Decisión de Matías (04-10): **La Maestranza va sin Holded.** Sigue la
regla del 27-09 (todo cliente nuevo empieza sin Holded) y, además, hoy no habría otra opción: a una
cuenta nueva de Holded sólo le dan tokens `pat_`, y el TPV no los acepta hasta `holded-v2`.

Consecuencias de ir sin Holded:

- **El TPV es el SIF del bar.** Cada caja tiene su serie (`C1`) y cada venta lleva número
  correlativo, QR y leyenda (Verifactu V1, en producción desde el 27-09).
- **El catálogo es local** (ADR-017): se da de alta en el panel, con SKU obligatorio y el precio
  **con IVA**.
- **El gestor del bar liquida a partir de los tickets** (decisión del 27-09).

Plantilla base: `checklist-sirope.md` y `checklist-terminal.md`. Este documento sólo dice lo que es
propio de La Maestranza.

---

## 0 · ✅ Resuelto por el bloque `catalogo-en-alta` (04-10-2026)

El bloqueo que tenía este apartado **está resuelto en la rama `catalogo-en-alta`** (pendiente de
merge y despliegue, que los decide Dirección). Lo que decía: un alta nueva sin Holded y con caja no
se podía activar, porque `products-sellable` exige productos, los productos sólo entraban por el
panel del OWNER, y el OWNER no nace hasta activar.

Al recorrer el camino entero contra el código de verdad aparecieron **dos** bloqueos, no uno, y los
dos están arreglados:

| Lo que bloqueaba | Cómo está resuelto |
|---|---|
| **El catálogo vacío** (`products-sellable` en rojo con 0 productos) | «Cargar catálogo» en la ficha del tenant: sube el CSV, enseña una vista previa y escribe al confirmar. Ver el §3 |
| **El cajero técnico** (`test-cashier-provisioned` en rojo) — lo provisionaba sólo el worker del sync inicial, que sin Holded no corre nunca, y el botón «Probar TPV» estaba deshabilitado esperándolo | «Probar TPV» ya no espera a nadie: provisiona el cajero técnico la primera vez que se pulsa, que es lo que el endpoint hacía desde siempre |

Y una tercera cosa que no bloqueaba la activación pero ensuciaba el comercio: la **venta de ensayo**
del modo prueba se quedaba como venta cobrada (`PAID`) en un comercio sin Holded, así que la purga de
la activación no la borraba. Ahora nace `TEST` y la activación se la lleva.

**Lo que NO entró en el bloque** (se puede hacer después de activar, sin facturas de prueba, con el
dueño delante): la sala —zonas y mesas—, los cajeros reales y la impresora. Los tres se configuran
desde el panel del propietario una vez activado. El ensayo del TPV se puede hacer igual sin mesas:
la venta rápida de barra no las necesita.

Detalle del recorrido y de las decisiones: `docs/blocks/catalogo-en-alta-plan.md` y
`docs/blocks/catalogo-en-alta-done.md`.

---

## 1 · Datos que faltan del bar (se piden de uno en uno)

- [x] **Razón social y NIF**: autónoma **Eguez García Pabla Salome**, NIE **Y8303186Q** (control verificado). Fuente: factura F260010 de Mi Piace (Kit Digital), 04-10.
- [x] Dirección fiscal y teléfono: Calle Paseo de los Rosales, nº 6, 45542 El Casar de Escalona (Toledo) · 641 602 868 (de la factura F260010).
- [ ] **Terminal**: ¿cuál y cuántos? ¿Lo pone Mi Piace (AP12) o ya tienen uno? Una caja = una
      serie; dos cajas = dos series (`C1/1`, `C2/1`…).
- [ ] **Impresora** de tickets (modelo, USB o red) y si quieren comanda en cocina.
- [ ] **Sala**: barra, salón, terraza; número de mesas por zona.
- [ ] Camareros que van a cobrar (nombre o alias) → cajeros con PIN.
- [ ] Email del dueño para la activación (se pide **en el momento** de activar).
- [ ] Precio de la **botella de vino** (en el catálogo de julio estaba sin precio; se ha dejado fuera).
- [ ] Fecha de la visita (mañana, nunca la tarde antes de un fin de semana).

## 2 · Catálogo listo para cargar

`maestranza/catalogo-tpv.csv` — **128 productos**, generado del `Maestranza_import_Holded.xlsx`
de julio con estos cambios:

- Precio pasado a **IVA incluido** (el xlsx traía el subtotal de Holded; el catálogo local pide el
  precio con IVA). Todo al 10 % (hostelería).
- Nombres con tildes y, donde coincide, **el nombre de la carta** (`Café con leche`, `Patatas
  alioli`, `Croissant york y queso`…): el camarero busca lo que lee en la carta.
- Añadido `BOL-021 Croissant mermelada y mantequilla` (2,50 €): está en la carta validada y no en
  el xlsx.
- Fuera `VIN-007 Botella de vino` (sin precio).
- Categorías (tags) para los chips del TPV: cafés, desayunos, raciones, bocadillos, platos,
  refrescos, cervezas, vinos, licores.

Bocadillos y combinados van como **genéricos** (`Bocadillo` 5 €, `Bocadillo especial` 7 €,
`Plato combinado` 10 €, `de ternera` 12 €), igual que en la carta: en hora punta se cobra el
precio, no el relleno.

## 3 · Antes de salir (remoto)

- [ ] Bloqueo del §0 resuelto: `catalogo-en-alta` **mergeado y desplegado**. Se comprueba mirando la
      ficha de un tenant sin Holded: tiene que salir el panel **«Cargar catálogo»**.
- [ ] Producción sana: `curl -s https://api.mipiacetpv.com/health` y anotar el sha (rollback:
      `IMAGE_TAG=<sha> bash infra/deploy.sh`).
- [ ] Alta en super-admin: «¿La empresa tiene Holded?» → **«No lo usa»**. Razón social y NIF reales.
- [ ] **Cargar el catálogo** desde la ficha del tenant:
      - [ ] «Cargar catálogo» → elegir `maestranza/catalogo-tpv.csv`.
      - [ ] En la vista previa tienen que salir **128 filas que entran y ninguna saltada**. Si sale
            alguna saltada, el motivo lleva el número de línea del fichero: se corrige y se vuelve a
            subir (lo ya cargado no se duplica).
      - [ ] Confirmar. El precio del fichero es **con IVA** y es el que el TPV va a pintar: el café
            con leche tiene que verse a **1,60 €**, no a 1,76 €.
- [ ] Catálogo revisado en el TPV de prueba (chips de categoría, nombres a dos líneas, precios de la
      carta).
- [ ] Sala creada según el §1.
- [ ] «Probar TPV» (la primera vez que se pulsa, provisiona el cajero técnico y la salud se pone en
      verde): venta de dos líneas, cobro en efectivo y mixto, devolución, arqueo. **Ningún registro
      fiscal** — el panel de Facturación tiene que seguir con la serie `C1` a cero registros.
- [ ] Comprobar que las ventas del ensayo quedan como **TEST**: al activar se purgan solas y el bar
      empieza con el libro limpio.
- [ ] Terminal preparado en el taller según `checklist-terminal.md` con la **APK 1.19.0**.
- [ ] Declaración responsable de Mi Piace firmada (tarea humana 4 del tablero): el bar va a cobrar
      con nuestro SIF.
- [ ] Contrato piloto con la cláusula 2 revisada (verifactu-1 §7.4: la frontera fiscal ya no es
      Holded) y modelo de representación para Verifactu, listos para firmar.

## 4 · En el bar (lo no simulable)

- [ ] Terminal en el WiFi del local; densidad y pantalla siempre encendida.
- [ ] Impresora real: un ticket con **serie, número, QR y leyenda** y la cabecera fiscal correcta.
  - **Puerta de la impresora del bar** (se verá en el local). La APK sólo imprime de verdad
    por **USB ESC/POS**. La «WiFi» la manda el servidor por TCP a `ip:puerto`, y desde el VPS no se
    llega a una impresora de la red privada del bar. Bluetooth y serie no existen. Así que:
    - USB y ESC/POS → se enchufa al D8 y se prueba el ticket.
    - Sólo red, Bluetooth, o una impresora fiscal o propietaria → **no sirve**. Plan B: llevar una
      térmica USB ESC/POS de 80 mm de repuesto (presupuesto con el 20 % de margen si se le vende).
    - Mirar la etiqueta y apuntar el modelo en `docs/qa/ficha-terminal-ap13-kozen-d8.md`.
- [ ] **Probar conexión directa con cocina** (kds-2). En el TPV, menú ☰ → «Probar conexión
      directa con cocina». **Tiene que salir en VERDE.** Mide los ms y, si falla, dice qué hacer.
  - **Sin esto en verde, el bar depende del papel cuando se va internet**: la comanda no llega a
    la tablet y hay que cantarla. Es puerta, no mejora.
  - La causa número uno de un rojo es el router con **«aislamiento de clientes»** (viene encendido
    en casi todas las redes de invitados): deja a cada aparato hablar con internet y con nadie
    más. Se desactiva en el router, o se ponen el D8 y la tablet en la wifi normal del local.
  - Se prueba **desde el terminal**, no desde el navegador del implantador: la llamada sale por el
    puente nativo de la APK y tiene que salir del aparato que está en la wifi del bar.
- [ ] **Cable de internet fuera del router, wifi encendida** (no vale el modo avión, que corta
      también la wifi): comanda de una mesa → aparece en la tablet, franja **ámbar** arriba
      («Sin internet · recibiendo por la wifi del local»), **no roja**. Se vuelve a enchufar →
      el panel tiene esa comanda **una sola vez** y con los tiempos de cocina buenos.
- [ ] Modo avión 2 min: venta offline → reconectar → sube sola (y su registro fiscal no se repite).
- [ ] Si hay dos cajas: expulsión pasiva y doble cobro simultáneo (`checklist-sirope.md` §3).
- [ ] **Activar** con el email del dueño delante. Irreversible. Primer login, contraseña y PIN.
- [ ] Formación con el guion de Sirope (§5): el cobro nace en la mesa, venta rápida en barra,
      arqueo X y Z.

## 5 · Antes de irnos — criterio de «desplegado» sin Holded

El criterio del protocolo dice «primera venta real en su Holded». Sin Holded se traduce así:

- [ ] **Primera venta real del dueño** con su registro fiscal `C1/1` (o el número que toque),
      visible en el panel de cadenas, y el ticket impreso con QR.
- [ ] Arqueo del primer turno que **cuadra**.
- [ ] Todas las puertas del §4 en verde.
- [ ] Teléfono de soporte en la barra.

Hasta entonces, La Maestranza está «validada en prueba», y se dice así.

---

## Hecho el 06-10 · carril A en producción

- Cuenta creada sin Holded, en **DRAFT** (`81f2177b`). Razón social, NIE, dirección y teléfono
  según la factura F260010. Hostelería y caja.
- Pie de ticket: «Bar La Maestranza · Santa Olalla (Toledo)». El alta no tiene campo de nombre
  comercial.
- Catálogo: **128/128** cargados por CSV, 0 rechazados. Salud: todo en verde salvo el cajero
  técnico, que se crea al pulsar «Probar TPV».
- Modo prueba en el navegador: chips por categoría y precios iguales a la carta. Venta de 3 líneas
  por **14,60 €** en efectivo con 20 € → cambio 5,40 €. Nace **PRUEBA** con número interno
  #000001, sin serie fiscal. La cabecera del ticket sale con los datos de Salomé.

### Hallazgos del ticket (no bloquean el cobro, sí la imagen)

1. Las líneas salen con el **precio sin IVA** (café con leche «1 x 1,45 €») y el total con IVA
   (14,60 €). En un bar el cliente lee el 1,60 de la carta y no le cuadra.
2. **Un céntimo de diferencia en la base imponible dentro del mismo ticket**: «IVA 10 % s/13,26 €»
   frente a «Subtotal 13,27 €». Las líneas suman 13,26; la base agregada es 13,27. En un documento
   fiscal no puede salir la base con dos valores.
3. La tienda se llama «Tienda principal». Hay que renombrarla a «Bar La Maestranza» desde el panel
   del propietario, tras activar.

Los puntos 1 y 2 son del render del ticket, no de esta cuenta. Probablemente salen igual en todos
los comercios. Se miran antes de la visita.

## Hecho el 06-10 · cuenta activada y lista para el miércoles 07-10 (corregido: decía 08-10)

- **Activada.** El propietario es `lamaestranza@mipiacetpv.com` (alias del buzón `no-reply@` en
  Hostinger, creado el 06-10), con el nombre de Salomé Éguez. La contraseña temporal y el PIN de
  Salomé los tiene Matías. Se le entregan en mano y se cambian en el primer login. Al activar se
  purgaron la venta de ensayo y el cajero técnico.
- **D8 (AP13) vinculado** a Tienda principal · Caja 1 con la APK 1.21.0. Arranca en la pantalla de
  login del camarero.
- **Sala**: barra B1-B4, salón M1-M6 y terraza T1-T6 (capacidad 4). Se cambia desde el panel →
  Tiendas → Mesas y barra.
- **Cajeros**: de momento solo Salomé, que es la propietaria y además tiene PIN de cajera. El
  resto se da de alta el miércoles.
- Desde la activación, **cualquier cobro es una factura real (serie C1)**. No se cobra nada de
  prueba. La primera venta la hace Salomé en el bar.

### En el bar el miércoles

1. Conectar el D8 a la wifi del bar.
2. Impresora del bar: ver si es USB ESC/POS (puerta de arriba).
3. Salomé entra con su email y su PIN y cambia la contraseña del panel.
4. Dar de alta a los camareros (panel → Cajeros) y renombrar la tienda a «Bar La Maestranza».
5. Abrir turno, cobrar en mesa y en barra, y hacer arqueo. La primera venta real cierra el
   criterio de «desplegado».

## 06-10 tarde · la cuenta 81f2177b NO es la que se entrega

- La auditoría de usabilidad del AP13 (`docs/qa/2026-10-06-auditoria-ap13.md`) cobró sobre la
  cuenta ya activada: facturas C1 #000002 (2,60 €) y #000003 (6,90 €), turno cerrado y reabierto.
  `fiscal_records` es append-only por trigger: no se borran. Decisión de Matías: **esta noche se
  monta una cuenta nueva desde cero** y la de ensayo se deja apartada. Plan completo:
  `docs/implantaciones/maestranza/reset-noche-2026-10-06.md`.
- Mesas M4 (55 €) y M6 (4,10 €) vaciadas sin cobrar. Zona horaria del D8 puesta en
  Europe/Madrid (la automática le ponía Asia/Shanghai: sin SIM no sabe dónde está).
- **Regla nueva de implantación: después de activar, nadie prueba en la cuenta.** Para probar
  está «Probar TPV», que no factura.
