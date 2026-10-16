# Pasada en el N1 (TPV portátil tipo móvil) · 2026-10-16

**Aparato:** N1 (fabricante `alps`, placa MediaTek `k61v1_64_bsp`), Android 14, pantalla 720×1440 en vertical, densidad 320. WebView 154. Lleva **impresora integrada** (servicio `com.iposprinter.iposprinterservice` 5.10, `/dev/printer_dev`) y la tienda `com.jicaipos.market`.
**App:** APK 1.26.0 (12600), instalada por el canal real (`mipiacetpv.com/apk` + código de 6 dígitos; SHA-256 verificado en el aparato).
**Cuenta:** PRUEBAS MIPIACE (Servicios, módulos Caja + Agenda), cajero `mipiacetpv-test-64a68dc7`. **No se cerró ninguna venta**: no hay documentos nuevos en Holded.
**Medidas:** con DevTools sobre el WebView (`webview_devtools_remote` vivo en la APK release). Capturas en `docs/qa/2026-10-16-n1/`.

## La causa de casi todo

La APK está fijada en horizontal (`android:screenOrientation="sensorLandscape"` en `AndroidManifest.xml`). En un aparato de 720×1440 eso deja un **viewport de 720×360 CSS px**. Solo aplica el breakpoint `sm`, así que sale el layout de móvil, pero con 360 px de alto. Ningún CSS del TPV mira la altura ni la orientación: no hay `max-height`, `landscape` ni `orientation` en todo `tpv-web/src`.

La cabecera de venta ocupa 129 px (estática) y la barra flotante del ticket otros 65 px (fija). Al catálogo le quedan unos 166 px.

**En vertical (emulado a 360×640 con DevTools) el problema principal desaparece:** la hoja del ticket mide 390 px y las líneas caben enteras, sin scroll. El arreglo de raíz es dejar que los móviles giren, no encajar el horizontal a la fuerza.

## Hallazgos, por prioridad

### Bloqueantes (sin esto el N1 no sirve para vender)

1. **Orientación fijada en horizontal.** Propuesta: en `MainActivity`, si `smallestScreenWidthDp < 600` (móvil), poner `SCREEN_ORIENTATION_USER_PORTRAIT` (o `USER`); si no, mantener `sensorLandscape`. Los terminales de 10" como el AP11 y el AP12 no cambian.
2. **Hoja del ticket: las líneas no se ven.** El contenedor de líneas (`SalePage.tsx:4774`, `flex-1 min-h-0 overflow-y-auto`) mide **24 px** con 80 px de contenido. Cabecera, totales y botones se lo comen todo. Captura `15-ticket-abierto`.
3. **Cobro: ventana de 70 px.** En `CheckoutPage.tsx:940`, el cuerpo desplazable mide 70 px de alto para 651 px de contenido. Los métodos de pago salen cortados por la mitad y el importe entregado está escondido debajo. Capturas `16-cobro`, `18-cobro-scroll2`.
4. **Búsqueda con teclado: cero resultados a la vista.** El teclado del sistema tapa la mitad de abajo y la barra del ticket ocupa el único hueco que queda entre el buscador y el teclado. Captura `27-busqueda-teclado`.
5. **Nueva cita: el formulario tiene 32 px** (`AgendaPage`, `flex-1 overflow-y-auto p-4 space-y-4`, con 304 px de contenido) y **la barra del ticket tapa el botón Reservar.** La barra (`lg:hidden fixed inset-x-0`) sale también en la agenda. Captura `22-nueva-cita`.
6. **La impresora integrada no está soportada.** La app imprime por `UsbPrinterPlugin` (USB) o por Wi-Fi (backend). La del N1 va por AIDL al servicio IPOS, así que hace falta un plugin nativo nuevo. El papel probablemente es de 58 mm (sin confirmar), y conviene revisar que el ticket se maqueta a 32 columnas.

### Importantes

7. **El menú lateral no hace scroll.** "Declaración responsable" se queda en y=354 px, fuera de pantalla e inalcanzable. Al deslizar se mueve la página de detrás. Capturas `23-menu`, `24-menu-scroll`.
8. **Login y PIN:** el teclado de PIN no cabe. La fila del 0 sale cortada y hay que bajar para llegar a Entrar. Con el PIN mal, **el aviso de error no se veía en pantalla**. El vínculo de 6 dígitos funciona, pero con el teclado del sistema el botón "Vincular dispositivo" queda medio tapado.
9. **Hora del aparato, no de la tienda.** El N1 venía en `Asia/Shanghai` de fábrica y el cierre de caja mostró "abierto 16:54" cuando en Madrid eran las 10:54. La Agenda sí fuerza `Europe/Madrid` y está bien. El corte del día lo calcula el servidor (`api/src/shift/day-cut.ts`, Madrid), así que **no hay riesgo en el dato**, pero hay unas 37 llamadas a `toLocale*`/`Intl.DateTimeFormat` sin `timeZone` en `tpv-web`. Arreglo: un formateador común con la zona de la tienda. Además, en el checklist de implantación: poner la zona horaria del terminal.

### Menores

10. **Tickets ("Servicios anteriores"):** la fila de filtros se sale por la derecha y el campo "Hasta" queda cortado. Captura `28-tickets`.
11. **Al añadir un servicio, la única señal es un borde rosa** en la tarjeta. Con la hoja del ticket inutilizable, el cajero no puede confirmar qué ha metido.
12. El aviso de Chrome "no es compatible con la última versión de Android" en `/apk` viene del Chrome que trae el aparato (32 bits), no de lo nuestro. La página `/apk` se ve bien en el móvil.

## Lo que funciona

- El canal de instalación de punta a punta: código, descarga de 8,69 MB, SHA-256 idéntico al publicado, instalación.
- La vinculación con código de 6 dígitos, la apertura de turno, la Agenda (vista de día, línea de "ahora" bien puesta en hora de Madrid), "Cerrar el día" (el overlay entero desplaza) y la lista de tickets.
- Los objetivos táctiles: todos los botones miden al menos 44–48 px.

## Sin probar

- Cerrar una venta e imprimir: no se pulsó "Cerrar servicio" para no crear documentos.
- El panel del propietario en la app: el cajero de pruebas es Encargado.
- El aspecto real en vertical. Las medidas de 360×640 son por emulación; hasta que la APK deje girar no hay captura real.

## Orden de arreglo propuesto

1. Orientación por tamaño en `MainActivity` (punto 1). Es pequeño y desbloquea casi todo.
2. Con la APK girando, nueva pasada en vertical en el N1, que es donde se usará.
3. Ocultar la barra flotante del ticket fuera de la venta y mientras el teclado está abierto (puntos 4 y 5).
4. Menú lateral con scroll y pantalla de PIN que quepa (puntos 7 y 8).
5. Plugin de impresora IPOS (punto 6). Es un bloque propio, con prueba física de papel.
6. Formateador de fechas con la zona de la tienda (punto 9).
7. Defensa para alturas cortas (`max-height: 500px`) en la hoja del ticket y el cobro, por si alguien gira el móvil en horizontal (puntos 2 y 3).
