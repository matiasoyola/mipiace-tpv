# Cómo se pone en marcha un comercio

_Desde `puesta-en-marcha` (ADR-021). **Sustituye a la regla del 06-10** («después de activar,
nadie prueba en la cuenta»), que existía porque no había otra salida: cualquier cobro en una
cuenta activada era una factura real, y una factura no se borra._

Ahora el orden es: **se prueba → se resetea → se arranca.** Y las tres cosas se hacen en la cuenta
de verdad del cliente, en su terminal, con su catálogo y su sala.

---

## 0 · Lo que hay que tener claro antes de empezar

| | Activada | Facturando |
|---|---|---|
| Qué significa | Tiene propietario: puede entrar al panel y cambiar sus cosas | Lo que cobra son FACTURAS, con número y con registro |
| Quién lo hace | «Activar» en la ficha del super-admin | «Empezar a facturar», en la visita |
| Se deshace | No (se bloquea y se da de alta otra) | **No. Nunca.** |

Entre las dos hay un **ENSAYO**: el TPV funciona entero —mesas, comanda, cobro, vuelta,
devolución, arqueo, cierre, cocina— y **nada de lo que cobra es una factura**. Los tickets nacen
marcados como de prueba, no suben a Holded, no se mandan por email y no llevan registro fiscal.

Se ve en tres sitios, y los tres a la vez:

- **El TPV**, con una banda azul arriba: «ENSAYO · estos cobros no son facturas». No se puede
  cerrar.
- **El papel y el PDF**, con `*** TICKET DE PRUEBA *** / SIN VALIDEZ FISCAL` en cabecera y sin
  número de factura.
- **El panel del propietario**, con una banda que le explica qué puede hacer y qué no cuenta para
  Hacienda.

---

## 1 · Antes de la visita: el ensayo

1. **Alta y activación como siempre.** Catálogo, sala, cajeros, impresoras, terminal emparejado.
   La cuenta queda **en ensayo** al activarse: ya no hace falta esperar a nada.
2. **Prueba con el aparato del cliente.** Entra con el PIN de un cajero de verdad en el terminal
   de verdad. Vende, cobra en efectivo con vuelta, imprime, devuelve, arquea y cierra. Tócalo
   todo: lo que se descubra aquí es gratis.
   - Si prefieres probar desde el navegador, «Probar TPV» sigue existiendo y ahora funciona en
     cualquier cuenta que esté en ensayo (antes sólo en DRAFT).
3. **Enséñaselo al cliente.** Es el momento de que la dueña toque su propio TPV con su propia
   carta y diga «esto no está donde yo lo busco». Lo que pida se cambia y se vuelve a probar.
4. **Resetea cuando quieras.** Super-admin → ficha → **Puesta en marcha** → «Resetear ensayo»
   (hay que teclear el nombre del comercio). Se lleva:
   - **TODOS los tickets de la cuenta**, sea cual sea su estado —de prueba, anulados, borradores—
     y lo que cuelga de ellos (líneas, pagos, devoluciones, comandas de cocina, envíos de email).
     En una cuenta en ensayo no hay ninguna venta real, así que no se queda nada por ahí: una
     anulada de la demostración en el arqueo del cliente es exactamente lo que no queremos.
   - los turnos, con sus arqueos y sus informes Z,
   - las mesas que quedaron unidas,
   - y el contador de referencia interna, que vuelve a 000000.

   **Conserva** el catálogo, la sala, los cajeros, los terminales, las impresoras, los datos
   fiscales y los contactos. La pantalla los cuenta antes de que pulses, **y enseña cuántos
   tickets hay de cada estado**: lee los números.

   Si la pantalla dice **«Aquí hay algo que no debería estar»** y nombra un ticket, PARA. Significa
   que esa cuenta tiene una venta que llegó a Holded o que tiene factura emitida — algo que en una
   cuenta en ensayo no puede pasar. No se borra nada hasta saber de dónde salió.

---

## 2 · En la visita: arrancar

Esto se hace **en el local, con el cliente delante**, y no se deshace.

1. Último reseteo, para que el cliente empiece con la caja a cero.
2. Comprueba el **terminal**: que la APK esté al día. Desde el primer cobro, cada venta lleva su
   registro de facturación y **ese registro lo genera el terminal**: una APK anterior a
   verifactu-1 cobra igual, pero no manda registro, y ese comercio no estaría facturando conforme
   a ley hasta que actualice.
3. Super-admin → ficha → **Puesta en marcha** → **«Empezar a facturar»**. Teclea el nombre del
   comercio.

   Si algo lo impide, la pantalla lo dice **todo de una vez**:

   | Lo que dice | Qué hacer |
   |---|---|
   | La caja «X» ya tiene N registros de facturación | **Parar y mirar de dónde salieron.** Una cuenta no arranca dos veces. Es lo que pasó en La Maestranza el 06-10. |
   | Falta el NIF o la razón social | Ponerlos en los datos fiscales de la empresa. |
   | El NIF no es válido | Comprobarlo con el cliente: lo que se imprime en sus facturas sale de ahí. |
   | Ninguna caja tiene un terminal emparejado | Emparejar el terminal antes de arrancar. |
   | Es una cuenta de pruebas del equipo | No arranca nunca. Si hay que facturar, se da de alta una cuenta nueva. |

4. Desde ese momento, la siguiente venta de ese comercio es su **primera factura**: `C1/1`,
   referencia interna `000001`. La banda del TPV desaparece en el siguiente refresco del catálogo
   (o al volver a entrar con el PIN).
5. Haz **una venta real** con el cliente delante, de un euro si hace falta, y mira el papel: tiene
   que llevar su número de factura y ya no la marca de prueba. Esa venta es suya y cuenta.

---

## 3 · Después: lo que ya no se puede

- **Resetear.** Con la cuenta facturando, el reseteo contesta que no y dice por qué: su histórico
  es contabilidad. No hay forma de pedirlo «sólo esta vez».
- **Probar TPV.** También se cierra: no se prueba sobre la operación real de un cliente.
- **Volver a ensayo.** No existe, y no va a existir: una cuenta con facturas emitidas y en ensayo
  sería el único estado en el que el reseteo borraría facturación.

Si hace falta ensayar algo después de arrancar, se hace en **PRUEBAS MIPIACE** (que está en ensayo
para siempre y se resetea cuando quieras) o en una cuenta nueva.

---

## 4 · Si un cliente se va

Super-admin → ficha → **Eliminar cuenta**. Dos pasos y en este orden:

1. **Descargar el export** y entregárselo al titular. Es un ZIP con sus facturas (con la
   comprobación de que la cadena estaba íntegra), sus ventas, sus devoluciones y sus fichajes, más
   un LEEME con qué tiene que conservar y cuánto tiempo: cuatro años las facturas (arts. 66 y 70
   de la Ley General Tributaria) y cuatro el registro de jornada (art. 34.9 del Estatuto de los
   Trabajadores). **Después de eliminar la cuenta, esa copia es la única que existe.**
2. **Eliminar**, tecleando el nombre del comercio. El botón no se habilita hasta que el export
   está descargado, y eso lo comprueba el servidor.

Dos cosas que conviene saber:

- Sólo a **petición escrita del titular**. Es irreversible y se lleva sus facturas.
- Una cuenta con **historia clínica** o con **residentes** no se elimina desde aquí, y la pantalla
  lo dice: una historia clínica se conserva por la Ley 41/2002 y su destrucción tiene su propio
  procedimiento. El export sí se le puede entregar, y para una clínica existe además su
  devolución de datos completa (Ajustes → Contrato de tratamiento).

---

## 5 · Lo que el ensayo NO puede ensayar

Dos cosas, y están así a propósito:

- **Un fiado.** En ensayo el ticket nace de prueba antes de llegar a «a crédito», así que no
  aparece en Deudas. Si hay que enseñar el fiado, se enseña después de arrancar.
- **Un cobro sin red.** El papel sin conexión lo arma el propio terminal y necesita el registro de
  facturación, que en ensayo no existe: cobra, pero no sale papel. Para probar el cobro sin red,
  hazlo después de arrancar (y es una prueba que conviene hacer).
