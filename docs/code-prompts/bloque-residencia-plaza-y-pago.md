# Bloque residencia-plaza-y-pago · tarifa aplicada y forma de pago de cada residente

Rama `residencia-plaza-y-pago`, worktree
`~/Developer/Claude/Projects/mipiacetpv-plaza-y-pago`, desde `origin/master`. PR contra `master`.
Escrito el 24-10-2026 desde el proyecto de Jardín de Gredos. Matías, al ver la ficha completa del
residente: «me falta tarifa aplicada y forma de pago; si la forma de pago es con recibo domiciliado,
un campo para el IBAN». **Mockup: `docs/mockups/residencia-residentes-ficha.html`, pestaña «Plaza y
pago»** (y su tarjeta en «Resumen»), pendiente de validar con el resto del mockup.

**Ábrelo cuando esté en `master` `residencia-ficha-completa`** (la ficha con pestañas y los
contactos con papeles, que aquí se usan para saber a nombre de quién va la factura). Si no está,
dilo y para.

Lee antes:
1. **`docs/residencia/05-plazas-facturacion.md`**: es el diseño de la Fase 3 (plazas, concesiones,
   tarifas, cierre de mes, remesa SEPA). **Este bloque adelanta sus datos maestros, no la
   facturación**: las entidades que crees aquí son las de su §7 (`Placement`, `Concession`,
   `RateTable`) y las tiene que poder usar `facturacion-1` sin migrar nada.
2. La herramienta que ya factura las concertadas de Jardín de Gredos:
   `~/Developer/Claude/Projects/jardin de gredos operativa/facturas plazas concertadas/`
   (`calculo.py`, `datos/tarifas.json`, `datos/residentes.json`). Las tarifas de la JCCM son
   **por día y sin IVA** (2026: grado 0 40,38 · I 46,15 · II 51,92 · III 57,69 €/día; IVA 4 %), con
   dos regímenes de concesión: **anterior** (% de los ingresos del residente, Tabla I 75/40 y
   Tabla II) y **Decreto** (copago fijo de la resolución). Siembra la tabla JCCM 2026 con esos
   valores; **no copies datos de residentes reales** al repo.
3. `docs/blocks/residencia-ficha-completa-done.md` y la pestaña de Datos y familia.

## Por qué existe

Hoy el programa sabe si una plaza es privada o concertada y nada más. Cuánto cuesta, quién paga, cómo
y a qué cuenta vive en una hoja de Excel y en la cabeza de administración, y es lo primero que hace
falta para que un día el cierre de mes salga solo.

¿Y qué?: abriendo la ficha de cualquier residente se sabe qué tarifa tiene, cuánto paga él y cuánto
la Junta, y cómo cobrarle; y el día que llegue la facturación, los recibos salen de aquí sin teclear
ni un IBAN.

## Decisiones de producto ya tomadas — no se re-debaten

1. **Pestaña «Plaza y pago»** en la ficha completa, entre «Datos y familia» y «Ficha clínica», y
   su tarjeta en «Resumen» (plaza, lo que paga el residente, forma de pago, IBAN o «sin anotar»).
   Arriba, la frase: «Datos económicos: sólo los ve dirección y administración. Nunca salen en la
   lista, la puerta ni el relevo». Un rol que no los puede ver **no ve la pestaña**, no una
   pestaña vacía.
2. **Plaza**, con vigencia (cambiar de privada a concertada cierra una y abre otra; el cambio sale
   en «Historial»): tipo (Privada · Concertada · Temporal), desde, grado reconocido. En concertada y
   temporal, la **concesión**: régimen (Decreto / anterior), nº de resolución, fecha, y según
   régimen, el **copago fijo** (Decreto) o la **tabla** (anterior). Los ingresos del residente del
   régimen anterior **no** entran en este bloque (son de `facturacion-1`, con su acceso aún más
   restringido).
3. **Tarifa aplicada**, que se ve como importe y no como código:
   - **Concertada / temporal**: lo que paga la Junta (tarifa JCCM vigente del grado, por día, sin
     IVA, con su estimación del mes con IVA) y la **aportación del residente** (copago fijo, o «%
     de sus ingresos según Tabla I» en el régimen anterior).
   - **Privada**: se elige una **tarifa del centro**, que sale de una tabla nueva en
     *Configuración → Tarifas* (nombre, importe mensual, vigencia; p. ej. «Habitación doble ·
     grado II»). **El tipo de IVA de las privadas está por confirmar con la asesoría**
     (`05-plazas-facturacion.md` §2): guarda el importe y deja el IVA como dato pendiente de la
     tarifa, sin inventar uno.
   - **Precio pactado distinto** (las dos clases de plaza), con **motivo obligatorio**. Lo que manda
     es el pactado; la tarifa queda a la vista.
4. **Forma de pago del residente**: Recibo domiciliado · Transferencia · Efectivo · Tarjeta. Y
   siempre: **a nombre de quién va la factura** (el residente o uno de sus contactos; al elegir un
   contacto, ese contacto gana el papel «recibe las facturas»), su NIF, día de cobro y envío de la
   factura (email / papel).
5. **Si es recibo domiciliado, el bloque SEPA**:
   - **IBAN**: se valida al escribirlo (longitud por país y dígito de control mod 97, sin espacios
     al guardar, con espacios cada cuatro al enseñarlo) y **el banco sale solo** del código de
     entidad para los IBAN españoles (tabla de entidades del Banco de España en el repo).
   - Titular de la cuenta (por defecto, a nombre de quien va la factura) y su NIF.
   - **Mandato SEPA**: referencia única generada por el sistema y fija (`<prefijo del centro>-<nº>`),
     fecha de firma y el PDF firmado, que es un elemento del **ingreso guiado** («Mandato SEPA
     firmado») y sale en «Ingreso y documentos» sólo cuando la forma de pago es recibo.
6. **El IBAN es un dato sensible**: cifrado en reposo con la clave del centro (como el DNI y la
   historia), **enseñado enmascarado** (`ES12 •••• •••• •••• •••• 4567`) salvo que se pulse «Ver»,
   que deja línea en el registro de accesos. Nunca en logs, nunca en la lista, nunca fuera del rol
   de administración. Cambiar el IBAN escribe una versión nueva (el anterior se conserva con su
   fecha): una remesa ya enviada tiene que poder explicarse.
7. **Lo que cuenta como pendiente** (alta-minima): la **tarifa aplicada** y la **forma de pago**
   cuentan como datos que faltan; si la forma es recibo, **el IBAN es imprescindible** (rojo) y el
   mandato firmado, normal. La pestaña lleva su número, como «Datos y familia».

## Respeta

- Nada de facturar, remesas, cierres de mes ni Verifactu: eso es `facturacion-1`.
- Holded opcional: nada de esto depende de Holded ni se le envía.
- Comercios, clínicas y bares no notan nada; la tabla de tarifas del centro sólo existe con
  `residencia` encendida.
- Sistema visual y metodología de front de Mi Piace; el mockup manda en disposición y jerarquía.

## Fuera de alcance (declarado)

Facturas y recibos, remesa SEPA, ingresos del residente (régimen anterior), servicios extra,
factoring, el IVA de las privadas (hasta que conteste la asesoría), carga masiva de IBAN desde un
Excel (si Carmen lo pide, es otro bloque pequeño).

## Cómo se cierra

- Tests: el IBAN se valida y rechaza los mal escritos; el banco sale del código de entidad; el IBAN
  se guarda cifrado y no aparece en ninguna respuesta de la lista ni en ningún log; un rol sin
  permiso no ve la pestaña ni recibe los datos de la API; «Ver» deja línea en el registro de
  accesos; cambiar de privada a concertada cierra la plaza anterior; el precio pactado exige
  motivo; lo que falta cuenta tarifa, forma de pago e IBAN (imprescindible sólo con recibo); el
  mandato aparece en el ingreso guiado sólo con recibo.
- Captura de la pestaña (1366 y 390) en `docs/qa/`, junto al mockup.
- CI verde (`ci`, `smoke`, `e2e`).
- `docs/blocks/residencia-plaza-y-pago-done.md` con la estructura de la metodología. Dice si la
  rama está pusheada y si hay PR.
- Commits pequeños en español, push y **PR contra `master`**. Ni merges ni despliegues.
