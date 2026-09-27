# holded-desconectar · bucle visual

23 capturas con Playwright (`playwright-core` vive en el scratchpad y **no entra en el
repositorio**), contra la API y los dos front-ends de verdad corriendo sobre una base de **datos
de DEMO**, no sobre la copia de producción: dos comercios inventados, catálogo inventado y
clientas inventadas. El ensayo general sí se hizo sobre la copia real, y de ahí sólo salen
agregados al done-doc.

## Los dos anchos

- **`-320`** · el móvil más estrecho que soportamos. Vale para el panel del cliente y para el TPV.
- **`-ap12`** · el AP11/AP12 en horizontal = **1280×800 CSS a `deviceScaleFactor` 1,5**, medido en
  `reservas-mostrador-done.md` §6. Los ficheros salen a 1920×1200 y se pueden poner al lado de los
  de los bloques anteriores.
- **`-util320`** · sólo para la consola super-admin. Ver abajo.

## El hallazgo del ancho: la consola super-admin no cabe a 320, y no es de este bloque

`00-consola-a-320-no-cabe.png`. `SuperAdminShell.tsx:126` monta un `aside` de `w-[240px]
shrink-0` y el `main` lleva `px-8`. A 320 px de ventana al contenido le quedan
**320 − 240 − 64 = 16 px**: no se lee nada, ni esta pantalla ni ninguna otra de la consola. Es
anterior a este bloque —la consola es la herramienta de Matías en su escritorio— y hacerla
responsive es otro bloque.

Así que el ancho estrecho de la consola se mide donde se puede medir algo: **624 px de ventana =
320 px de ancho útil** para el panel, que es lo que el criterio quiere saber. Ésas son las
`-util320`.

## Las capturas

| Captura | Qué enseña |
|---|---|
| `00-consola-a-320-no-cabe` | El hallazgo de arriba |
| `01-detalle-con-boton` | «Dejar Holded» en rojo, junto a «Apagar Holded» **deshabilitado**: el toggle de siempre sigue siendo para quien no ha conectado nada |
| `02-previsualizacion-lista` | El plan entero de un comercio que SÍ puede: 9 fichas, las 9 conservan su enlace, los 3 SKU que se acuñan con su nombre y su valor nuevo, 118 ventas facturadas por Holded, los contactos que se conservan, el suelo fiscal en verde y el aviso del APK con la versión de cada terminal |
| `03-confirmacion-sin-cuadrar` | El nombre a medio escribir: «Dejar Holded» deshabilitado. No es teatro — es la confirmación de un `DROP DATABASE` |
| `04-previsualizacion-bloqueada` | Los CINCO bloqueos a la vez, cada uno con qué hacer: venta en vuelo, abono roto, subida pendiente, fiado vivo y `SKU215` repetido con los dos productos nombrados. Y **no hay botón de confirmar**: hay «Volver a comprobar» |
| `05-confirmacion-lista` | El nombre completo y el botón vivo |
| `06-cortado` | El banner verde con los números de lo que acaba de pasar, y el detalle ya sin Holded |
| `07-detalle-sin-holded` | La ficha del comercio después: «Holded · Lo dejó · 26/9/2026», «Resync Holded» y «Encender Holded» **deshabilitados**, «Dejar Holded» ya no está |
| `08-catalogo-editable` | **El criterio 1.** Las 9 fichas del cliente, todas con «Editar» y ninguna con «De Holded». Las dos que compartían `AUTO-68d66b32` llevan ya su `CORTE-…0001` y `…0002` |
| `09-catalogo-editar-precio` | El formulario abierto sobre la ficha que no tenía SKU: ahora tiene `CORTE-68D665F5…`, y el precio se edita |
| `10-devoluciones-asesor` | La pantalla que sólo existe en un comercio que dejó Holded, con la devolución de una venta que facturó Holded y qué hacer con ella. Y la barra lateral **sin** «Sync Holded», «Revisión de SKU» ni «Importar clientes» |
| `11-tpv-rejilla` | La rejilla después del corte: precios locales, **ni rastro de Holded**. Ni la barra roja «Holded desconectado», que es lo que se pintaba antes de este bloque |
| `12-tpv-vacio` | El estado vacío de una búsqueda sin resultados: «Sin resultados para «zzzzz». Prueba con otro nombre o escanea el código.» Ni una palabra de Holded |

## Cómo se reproduce

La base de demo, la semilla y los scripts de captura viven en el scratchpad de la sesión. La
semilla monta:

- **Peluquería Demo** — Holded conectado, 9 fichas (dos con el mismo `AUTO-<8>`, una sin SKU),
  118 ventas ya subidas, 3 contactos, 2 subidas huérfanas de hace cuatro meses, suelo fiscal
  completo. **Puede cortar.**
- **Cafetería Demo** — Holded conectado, con una venta en `PENDING_SYNC`, un abono en
  `SYNC_FAILED`, `SKU215` repetido en dos refrescos y un fiado de 42,50 € sin saldar.
  **No puede.**
