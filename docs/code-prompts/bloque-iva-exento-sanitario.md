# Bloque iva-exento-sanitario · el servicio sanitario sale exento, en el ticket y en el registro

Rama `iva-exento-sanitario`, worktree `~/Developer/Claude/Projects/mipiacetpv-iva-exento-sanitario`,
desde `origin/master` (2e1a19e o el que haya al lanzarlo). Frente C del tablero. Escrito por Dirección
el 07-10-2026.

Lee antes, en este orden:
1. `docs/mockups/iva-exento-sanitario.html` — **la spec visual, validada por Matías el 07-10**.
   Recórrela con los dos botones de arriba («Sólo sesión» y «Sesión + crema»). Se copia estructura,
   textos y estados; no se interpreta. El QR del mockup es un dibujo: el papel sigue sacando el QR y
   las leyendas que ya saca hoy según el modo del comercio; este bloque **no** cambia eso.
2. `docs/blocks/ticket-con-iva-done.md` — la regla de la base única (`cuadrarDesglose`) y la
   validación §15.7. Este bloque no puede romperla.
3. `docs/blocks/verifactu-1-done.md` y `verifactu-1b-done.md` — cómo nace el registro en el
   dispositivo (`apps/tpv-web/src/lib/fiscal.ts` → `packages/verifactu/src/registro.ts`).
4. `docs/clinica/00-decisiones.md` y `docs/blocks/clinica-3-done.md` — de dónde salen las líneas del
   cobro de una sesión.

## Por qué existe

Rosario, podóloga y dueña de la clínica piloto, va a cobrar con el TPV. Sus servicios sanitarios
están **exentos de IVA** (art. 20.Uno.3º Ley 37/1992) pero **sí obligan a facturar**: la AEAT lo
pone como excepción expresa a la regla de que lo exento no se factura («operaciones relacionadas con
los servicios sanitarios y de hospitalización»). Le vale la factura simplificada (≤ 400 € IVA
incluido).

Hoy el TPV no tiene forma de decir «exento»: un producto sólo tiene `taxRate`, y
`buildDesglose` declara **todo** como `S1` (sujeta y no exenta). Un ticket de Rosario saldría mal en
el papel y mal en el registro.

¿Y qué?: Rosario marca una vez «Exento · sanitario» en sus servicios y se olvida. Cada cobro sale con
el desglose correcto y la leyenda de la exención, y la crema que vende en el mostrador sigue llevando
su 21 % en el mismo ticket.

## Decisiones ya tomadas (Matías y Dirección, 07-10) — no se re-debaten

1. **La exención va en el PRODUCTO, no en el comercio.** Una clínica vende también productos con IVA
   (cremas, plantillas de serie). Un ticket puede mezclar tramos exentos y sujetos.
2. **Una sola causa por ahora: E1** (exenta por el art. 20), con la etiqueta «Exento · sanitario» y
   la referencia «art. 20.Uno.3º». Modéla el dato para que mañana quepan E2–E6 sin migración de
   esquema (enum o texto validado), pero en la UI sólo aparece esta.
3. **Exento ⇒ `taxRate = 0`** siempre, y lo garantiza la base (CHECK), no sólo el front. Un
   `taxRate = 0` **sin** causa de exención sigue siendo un 0 % sujeto, otra cosa distinta: no se
   confunden nunca, ni en el desglose ni en el registro.
4. **Precio = lo que paga el paciente.** Con exento no hay conversión neto/bruto que valga; el
   editor no puede mostrar «precio con IVA» distinto del precio.
5. **El selector del editor de catálogo** (`apps/admin/src/pages/CatalogoPage.tsx`, chips de
   `TAX_RATES`) gana una cuarta opción ancha «Exento · sanitario  art. 20.Uno.3º» y, al elegirla, el
   aviso verde «El precio es el que paga el paciente. Sin IVA.». **Sólo aparece si el comercio tiene
   `clinicalRecordsEnabled`.** Un bar no ve esa opción. Si un producto exento llega a un comercio sin
   clínica (no debería), se muestra igualmente marcado y se puede quitar.
6. **Lo que sale de Holded no se toca.** En comercios con Holded el IVA viene de Holded; este bloque
   no añade mapeo de exenciones hacia Holded. La clínica piloto va sin Holded.

## Alcance

### 1 · Datos

- Campo de causa de exención en `Product` (nullable) y su **snapshot en `TicketLine`** (lo que se
  cobró no cambia si mañana se edita el producto). CHECK en las dos: causa no nula ⇒ `tax_rate = 0`.
- Migración aditiva, sin tocar filas existentes. Test de migración con el patrón de los anteriores.

### 2 · Desglose (`packages/ticket-model`)

- El tramo deja de ser «por tasa» y pasa a ser **por (tasa, causa de exención)**. Un 0 % sujeto y
  un exento son tramos distintos aunque los dos sean 0.
- La base única de ticket-con-iva se mantiene: `subtotal = Σ bases`, el céntimo residual sólo en
  cuotas. Un tramo exento tiene cuota 0 y no recibe céntimos de reparto.
- `apps/api/src/tickets/totals.ts` y quien agregue por tasa en el servidor: misma clave.

### 3 · Registro VERI*FACTU (`packages/verifactu`)

- `DetalleDesglose` admite las dos formas: sujeta (`CalificacionOperacion` + `TipoImpositivo` +
  `CuotaRepercutida`) **o** exenta (`OperacionExenta = "E1"`, **sin** `CalificacionOperacion`, **sin**
  `TipoImpositivo` y **sin** `CuotaRepercutida`). Que el tipo de TS haga imposible mezclar las dos.
- `BaseImponibleOimporteNoSujeto` del tramo exento = su importe. `CuotaTotal` sigue siendo Σ cuotas
  (las exentas no suman).
- **Contrástalo con la fuente de la AEAT**, no con este prompt: el diseño de registro
  (`DsRegistroVeriFactu.xlsx`, lista L10 de `OperacionExenta`) y el documento de validaciones
  (`Validaciones_Errores_Veri-Factu`). Cita en el -done la fila o el código de error de cada regla
  que apliques. Si alguna regla contradice lo de arriba, manda la AEAT y lo escribes en el -done.
- La huella no cambia de fórmula (no depende del desglose); compruébalo con un test, no de palabra.

### 4 · Papel e impresión

- Igual que el mockup: tramo «Exento  35,00 €»; si no hay tramos sujetos, «IVA  0,00 €»; si los hay,
  su «Base X %» / «IVA X %» como hoy.
- Leyenda en recuadro: «Operación exenta de IVA / art. 20.Uno.3º Ley 37/1992». En venta mixta va
  precedida del nombre de lo exento («Quiropodia: operación exenta…»); con más de una línea exenta,
  «Servicios sanitarios: operación exenta…».
- Los tres caminos que pintan un ticket dicen lo mismo: ESC/POS (`apps/tpv-web/src/lib/escposPrint.ts`),
  PDF/email del worker y la vista del histórico (`TicketsHistoryPage`). Un test por camino.

### 5 · Cobro de la sesión y bonos

- Las líneas que la sesión de clinica-3 pasa a caja heredan la exención del producto. Compruébalo
  extremo a extremo: sesión cerrada → cobro → ticket exento → registro con E1.
- La venta de un bono de sesiones de un servicio exento también sale exenta. Localiza dónde se vende
  el bono y que la exención llegue a su línea.

## Lo que NO entra

- Factura completa (F1) con NIF y domicilio del paciente → bloque siguiente.
- Cualquier cambio en el modo VERI*FACTU del comercio, el QR o la remisión (V2).
- Mapeo de exenciones a Holded.
- Rectificativas.

## Cómo se da por hecho

- Suite verde en local y en CI. **Tabla de sabotajes en el -done**: cada test nuevo se ha visto en
  rojo rompiendo a propósito el código que dice cubrir (quitar el CHECK, agrupar sólo por tasa,
  declarar E1 con `TipoImpositivo`, perder la leyenda en un camino de impresión, que el bono pierda
  la exención). Un test que no se pone rojo no cuenta.
- Capturas del editor de catálogo (con y sin clínica) y de los dos tickets del mockup impresos por
  el camino real, en `docs/qa/2026-10-xx-iva-exento-sanitario/`.
- `docs/blocks/iva-exento-sanitario-done.md` con: qué cambia, las reglas AEAT citadas, sabotajes,
  y el «Al desplegar» (migración; no añade variables de entorno salvo que lo digas expresamente).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue: eso es de Dirección.
