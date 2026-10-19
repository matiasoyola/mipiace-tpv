# Pasada en el hierro · APK 1.27.0 · Sirope en ensayo (18-10-2026, 23:30–23:47)

D8 (Kozen, `192.168.5.138:5555`) en **Sirope · Caja 2** (creada hoy; la Caja 1 la tiene el N1 y no se ha tocado) con `soporte+sirope@mipiace.es`. AP11-1006 (`192.168.5.76:5555`, **1920×1200 físico**, no 1280×800) como KDS «Cocina · Barra». Producción `a3e8a10`. Capturas `01`–`52` en esta carpeta.

## Lo que pasa (los arreglos de auditoria-sirope funcionan)

| # | Qué | Captura |
|---|---|---|
| Cambio | «CAMBIO A DEVOLVER 7,00 €» grande **antes** de Cobrar, y 48 px en el ticket emitido | 15, 17 |
| Enviar en venta rápida | Aparece y manda; toast «Comanda nº 1 enviada · COCINA: 1 línea» | 09, 10 |
| Mostrador nº N | Llega al AP11 como «Mostrador nº 1»; aviso en el TPV; al cobrar se va solo de la cocina | 11, 13b, 18 |
| Reparto por sección | M3: croissant → COCINA, café → BARRA | 23 |
| Por recoger | M3 cobrada → «POR RECOGER · hace menos de 1 min» | 27 |
| Devolución en ensayo | Botón visible, devolución hecha, «1 devol.» en la lista | 31–34 |
| Vaciar con motivo | Hoja de motivo obligatoria (Invitación / Error / Se fueron / Otro) | 36 |
| Cuadrar caja | Empieza en 50 €, billetes grandes plegados, «Cuadra», descuadre +0,00 € | 45–50 |
| Otros | Banda ENSAYO, nombres de producto centrados, mapa de 23 mesas cabe entero | 07, 08 |

## Hallazgos nuevos

### 🔴 1 · Comandas huérfanas: se siguen fabricando
Vaciar M5 con un café **sin marcar Lista** → la mesa queda libre, la tarjeta sigue en el AP11. Cuando cocina pulsa «Lista», M5 sale con **LISTO en el mapa estando libre**, la tarjeta espera en «Listas» y el aviso «M5 · listo para servir» se queda en el TPV. Es exactamente el estado de la T6 (9 h) — reproducido (capturas 37–41).
- Causa: `servirComandasListas` (cobro y `void-draft.ts`) sólo sirve lo que ya tiene `readyAt`; lo no listo se deja a propósito («un plato en la plancha sigue en la plancha»). Bien. Pero cuando ese plato se marca Lista, nadie lo sirve nunca: su ticket ya no existe.
- Además, las huérfanas de antes del arreglo (T6, LISTA; M1, sin listar, del N1) no las barre nada.
- Arreglo propuesto: al marcar Lista, si el ticket ya no está vivo (no DRAFT) → se sirve en la misma transacción y se emite `kitchen.order_served`; el corte de día sirve/archiva las comandas de tickets muertos; limpieza única de las que hay hoy.

### 🔴 2 · La app queda en blanco al reiniciarla (D8)
`am force-stop` + abrir → pantalla blanca indefinida. logcat: `Unable to launch app es.mipiace.tpv … SandboxedProcessService0: process is bad`. WebView del sistema `com.android.webview 101.0.4951.61`. El vigilante de arranque (#21) no puede actuar: es JS y el renderer nunca arranca. Mismo síntoma que el N1. Hace falta detección **nativa** (MainActivity) o actualizar el WebView; hoy sólo lo saca un reinicio del aparato.

### 🟡 3 · Las mesas vaciadas sólo salen en el PDF del Z
`contarMesasVaciadas` va a `generateZReportPdf`, pero ni «Cerrar el día» ni «Turno cerrado» (pantalla) lo muestran. Quien cierra no ve los 1,50 € de M5 (capturas 43, 44, 50).

### 🟡 4 · Avisos de «listo» por sección, duplicados y sin sección
M3 con cocina y barra → dos bandas «M3 · listo para servir» idénticas; en «Listas» del AP11, dos «M3». Y las bandas se apilan encima del ticket: con tres, la segunda línea queda bajo «Urgente» (captura 25).

### 🟡 5 · «Mostrador nº 1» no cabe en el KDS
Cabecera de la tarjeta partida a mitad de palabra («Mostra / dor nº 1») y cortada en la columna «Listas» («Mostrado») (capturas 11, 12c).

### 🟡 6 · Cuadrar caja cambia de tamaño con el teclado
Al tocar un casillero el modal se ensancha (sale el teclado propio); al pulsar «Listo» se estrecha. Los casilleros se mueven bajo el dedo (capturas 46–47).

### 🟡 7 · Numeración por caja sin prefijo
Caja 2 empieza en #000001 y la Caja 1 va por #000028, en la misma lista y sin distinguirse salvo por el texto pequeño. Con dos cajas habrá dos #000001 (captura 30).

### ⚪ 8–11 · Detalles
- Precios de línea del detalle de ticket y cantidad en la devolución en gris casi invisible (31, 32).
- El chip «×1» tapa el nombre del producto («Tostada York y» / «Café Americano») (09, 21).
- Retardo de 15–30 s en el aviso «listo» del TPV y en quitar el LISTO del mapa tras cobrar (sondeo, no evento) (13, 27→29).
- La línea sigue diciendo «EN COCINA» cuando ya está lista (13b).

## Estado al terminar
- Turno de Caja 2 cerrado (6,00 €; 2 tickets TEST #000001–2 de Caja 2; 1 devolución; M5 vaciada como Invitación).
- AP11: siguen M1 (BARRA, del N1), T6 y M5 en «Listas» — huérfanas.
- M3 en «Por recoger».
- **D8 en blanco** tras el reinicio de la app: necesita reinicio del aparato.
