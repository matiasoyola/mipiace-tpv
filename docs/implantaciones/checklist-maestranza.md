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

- [ ] **Razón social y NIF** del titular (autónomo o sociedad). Sin ellos no pasa `fiscal-minimum`
      ni se puede apagar Holded (409 con la lista de lo que falta).
- [ ] Dirección fiscal y teléfono para la cabecera del ticket.
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
