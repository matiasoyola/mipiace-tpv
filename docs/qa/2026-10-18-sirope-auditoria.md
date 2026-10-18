# Auditoría de uso real · Cafetería Sirope en ensayo · 18-10-2026

D8 (caja, Caja 1, APK 1.26.0, 1920×1080 a densidad 213 → viewport ~1442×811) + AP11-1006 (pantalla de cocina «Cocina · Barra»).
Capturas en `docs/qa/2026-10-18-sirope/`. Producción `2d64745`.

Estado: hallazgo 1 validado por Matías (el cambio va en la hoja de cobro, ANTES de pulsar Cobrar). El resto, pendiente de repasar uno a uno.

## Cobro
1. ✅ Cambio en segundo plano en la hoja de cobro (`CheckoutPage.tsx` 1349-1366: cambio 15 px coral vs TOTAL 30 px). Tras cobrar, la pantalla «Ticket emitido» lo pinta a 48 px: ese es el modelo, pero llega tarde. → 02, 03
2. Pasar de Efectivo a Tarjeta arrastra el importe tecleado (10 € sobre 3 €) → «Sobran 7 € · baja el importe» y Cobrar gris (`pickMethod` 444-452). → 16, 17
3. Los billetes sustituyen, no suman (5 + 10 = 10).
4. Jerarquía de la hoja: Subtotal/IVA arriba, «Importe exacto» enorme en coral, título «Total a cobrar» sin cifra; «sobran» en la franja verde.
17. 🔴 No hay «Iniciar devolución» para tickets PAID (cuentas sin Holded) ni TEST en ensayo (`TicketsHistoryPage.tsx` 1079-1080). El servidor sí acepta PAID/TEST (`tickets/routes.ts` 1996-2000); su mensaje aún dice «sincronizado con Holded». El banner de ensayo del panel promete «devolver». → 31

## Venta
5. Productos con texto a la izquierda y familias centradas (`ProductButton` `text-left justify-between`).
6. «Croissantysandwich» se sale del botón de familia (sin padding ni recorte); nombres de familia sin tildes/espacios (dato).
7. Dos «Desayuno 1 · Café + Tostada…» idénticos: el `line-clamp-2` corta justo lo que los distingue («(Sin glúten)»).
8. Línea del ticket: botón «Espera» dobla la altura, nombre cortado («Café con l…»), caben 3 líneas.
9. Ocho iconos sin rótulo en la barra de venta.
10. «Más acciones → Cancelar» vacía el ticket (pide confirmación; el riesgo es el nombre).
11. Venta rápida aparcada (3,00 €) invisible desde el mapa.
12. Con Cocina apagada: «EN COCINA», «Comanda nº 1 enviada» y «Reenviar (nº 2)» sin destino ni nada nuevo.
18. «Vaciar mesa» con consumo no pide motivo ni deja rastro visible.

## Mesas
13. Mapa no responsive: mesa fija 144 px (`roomGrid.ts` `TABLE_SHAPE_SIZE`), hueco a la derecha.
14. Falta el estado «pagada, por recoger»: la mesa pasa a Libre al cobrar (estados `FREE|OPEN|BILLING`).
15. El aviso «Mesa cobrada» empuja el mapa y corta la leyenda.
16. Aro amarillo de «+45 min» se confunde con «Pide la cuenta».

## Cocina (D8 + AP11)
19. Encender Cocina sin mapa etiqueta→sección manda todo a SALÓN (`resolverSeccion`): la 1ª comanda de T6 se perdió y el D8 dijo «enviada». «Comanderas» pide el «slug Holded» a mano sin listar etiquetas. Configurado hoy: COCINA = tostadas, desayunos, singluten, croissantysandwich, suplemento; BARRA = cafe, bebidas, infusiones, licores, vinos, helados, bolleria.
20. El D8 no ve Cocina encendida hasta reiniciar la app (`useDeviceBootstrap` cachea `/devices/me`).
21. Reiniciar la app del D8 la deja en blanco; sólo arregla reiniciar el aparato (2ª vez: 17-10 y hoy). WebView 101 de sistema; logcat sin errores de consola.
22. Cobrar la mesa no sirve lo «Listo»: T6 libre con LISTO y el AP11 la sigue «esperando»; la banda «T6 · listo para servir» persiste en otras ventas.
23. Sin interruptor de Cocina en super-admin (sólo API) y las secciones de una pantalla no se editan tras emparejar.
24. Franja muerta en la pantalla de cocina entre comandas y «Listas».
25. 🔴 Venta rápida: «Enviar» no hace nada (`SalePage.tsx` 1804-1806 `if (!tableContext?.activeTicketId) return;`), sin aviso; cobrar no avisa de platos sin enviar. Sirope es mostrador.
26. En pantalla compartida, Cocina y Barra sólo se distinguen por una palabra pequeña.

## Cierre del día (turno 13:34-14:53, 21,10 € · ef. 12,40 · tarj. 8,70 — cuadra)
27. El botón principal es «Cerrar turno» sin contar; «Cuadrar caja» es un enlace.
28. Cuadrar caja empieza en 500/200/100 €; las monedas quedan bajo scroll; el teclado deja medio panel vacío; «descuadre +0,00 €» en gris sin señal de «cuadra».
29. «Cancelar» de «Cerrar el día» asoma por debajo de la hoja, casi invisible.

## Cambios hechos en la cuenta de Sirope durante la prueba
- `kitchenDisplayEnabled = true` (apagar antes de «Empezar a facturar» si no lo usan).
- 12 mapeos etiqueta→sección (arriba).
- AP11 emparejado como pantalla de cocina (Cocina + Barra) en Caja 1.
- Mesas B4, M1, M2, M6, T3 vaciadas; venta rápida de 3 € cancelada; turno cerrado a las 14:53.
- Tickets de prueba #000021-#000025 (se van con «Resetear ensayo»).
