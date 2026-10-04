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

## 0 · ⛔ Bloqueo encontrado al preparar esto: un alta nueva sin Holded y con caja no se puede activar

Leído en el código de `master` (`b629a31`), no probado en producción:

1. La activación exige que la salud esté en verde, y el check `products-sellable` **aplica a todo
   tenant con caja**: con 0 productos está en rojo (`superadmin/onboarding-health.ts:365`).
2. Sin Holded no hay sync inicial, así que **los productos sólo pueden entrar por el catálogo
   local** (`POST /catalog/products`), que exige sesión de OWNER o MANAGER.
3. En DRAFT **no hay OWNER**: se crea al activar. Y la impersonación del super-admin necesita un
   OWNER al que suplantar (`superadmin/tenants.ts:1507`, 409 `NO_OWNER`). No hay ruta de catálogo
   en el super-admin.

Resultado: **DRAFT sin productos → no se activa → sin OWNER no se cargan productos.** Los e2e que
activan un alta sin Holded (`h1-empresa-sin-caja`, `f8-colegio`) son todos **sin caja**: el camino
de un bar nuevo nunca se ha recorrido. Sole cortó Holded con su catálogo ya dentro; La Maestranza
sería la primera.

(El cajero técnico sí se resuelve: «Probar TPV» llama a `provisionTestCashier` y crea tienda, caja y
cajero técnico en DRAFT.)

### Las dos salidas

| | Rodeo sin código | Bloque pequeño en Code |
|---|---|---|
| Cómo | Alta con caja **apagada** y otro módulo → activar (nace el OWNER) → encender la caja → cargar catálogo, cajeros y sala desde el panel | El super-admin puede cargar el catálogo local de un tenant **DRAFT** sin Holded (importando `catalogo-tpv.csv`) |
| Modo prueba antes de activar | **No existe**: el tenant ya está ACTIVE. Toda venta de ensayo es **una factura real** de la serie `C1` y hay que anularla | Sí, como cualquier alta: «Probar TPV» con el catálogo real y cero registros fiscales |
| Camino probado | No (nadie ha encendido la caja después de activar) | Lo prueba el propio bloque |
| Carga de 128 productos | A mano en el panel, uno a uno | Un fichero |
| Sirve para el siguiente cliente sin Holded | Habría que repetir el rodeo | Sí |

**Recomendación: el bloque.** El rodeo se salta la puerta que da sentido al protocolo
anti-sustos (ensayar sin consecuencias) y deja facturas de prueba en la cadena del bar desde el
primer día. Es un frente de desarrollo nuevo, así que lo coloca Dirección (§5 del tablero).

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

- [ ] Bloqueo del §0 resuelto (bloque desplegado, o rodeo decidido por escrito).
- [ ] Producción sana: `curl -s https://api.mipiacetpv.com/health` y anotar el sha (rollback:
      `IMAGE_TAG=<sha> bash infra/deploy.sh`).
- [ ] Alta en super-admin: «¿La empresa tiene Holded?» → **No**. Razón social y NIF reales.
- [ ] Catálogo cargado y revisado en el TPV (chips, nombres a dos líneas, precios).
- [ ] Sala creada según el §1.
- [ ] «Probar TPV»: venta de dos líneas, cobro en efectivo y mixto, devolución, arqueo. **Ningún
      registro fiscal** (el cajero técnico no emite, verifactu-1b).
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
