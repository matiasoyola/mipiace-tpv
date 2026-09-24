# V1-verifactu · el bucle visual

Piezas generadas con el código del bloque, no maquetadas a mano.

| Fichero | Qué es |
|---|---|
| `ticket-termico.txt` | Volcado legible de los bytes ESC/POS REALES que salen por la impresora, con los comandos quitados y el QR sustituido por una marca. Los 1.236 bytes son los que se mandan al térmico. |
| `ticket-escpos.bytes.txt` | El tamaño del trabajo, la URL exacta que va dentro del QR tributario y el número de factura. |
| `factura-simplificada.pdf` | El PDF tal y como lo recibe el cliente por email o al escanear el QR del ticket digital: QR tributario arriba a 33 mm, `QR tributario:` encima, `VERI*FACTU` debajo. |
| `ticket-sin-verifactu.pdf` | El MISMO documento sin parte fiscal, que es lo que sigue recibiendo un comercio que factura con Holded. Sirve para comparar: cero cambios. |
| `01-pdf-leyenda-pisaba-el-qr.png` | **El fallo que encontró este bucle visual.** La leyenda `VERI*FACTU` caía tan pegada al código que las mayúsculas se metían dentro. El documento técnico de la AEAT (§3) exige un mínimo de 2 mm de blanco alrededor del QR, recomendado 6. |
| `02-pdf-factura-simplificada.png` | El mismo PDF ya arreglado: 6 mm de aire por arriba y por abajo del código. |

## Lo que este bucle visual encontró

El QR tributario se pintaba con 4 puntos de separación de su leyenda, y a
33 mm de lado eso deja la línea base de `VERI*FACTU` dentro del propio
código. **Ningún test lo veía**: el texto estaba, la URL estaba, el nivel de
corrección era el correcto y los bytes del papel coincidían con los del
servidor. Lo que falla ahí no es un dato, es un milímetro, y un milímetro
sólo se ve mirando.

Arreglado en `packages/ticket-pdf/src/render.ts`: los 6 mm recomendados por
arriba y por abajo, y la altura de la página los cuenta.

## Lo que hay que mirar en el papel

1. El **QR tributario va el primero**, antes de la razón social. Es lo que
   exige el documento técnico de la AEAT (§3), y por eso el QR del ticket
   digital —que también está— queda al final.
2. `QR tributario:` encima y `VERI*FACTU` debajo, literales de la Orden.
3. El número que manda es **`Factura C1/000123`**; el interno baja a
   `(ref. 000123)`.
4. El **desglose por tipo de IVA** aparece siempre, no como opción: el art.
   7.1.f del RD 1619/2012 no lo deja opcional. `IVA 10% s/2,00` + `IVA 21%
   s/30,00` + `Subtotal 32,00` suman exactamente el `TOTAL 38,50`.

## Una nota sobre los símbolos del volcado

El `€` sale como `?` en `ticket-termico.txt`: el térmico imprime en **PC850**
y el volcado se lee como latin-1. En el papel de verdad sale el euro. Es
cosa del volcado, no del ticket — `escpos-builder` tiene su tabla PC850 y
`builder.test.ts` la cubre.
