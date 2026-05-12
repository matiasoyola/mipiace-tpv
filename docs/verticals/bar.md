# Vertical · Bar

Funcionalidades específicas para bares y cafeterías que se montan
**encima** del `docs/07-nucleo-comun.md` y reutilizan los patrones de
`docs/verticals/retail.md` cuando aplican (variantes, contacto Holded,
devoluciones). Todo lo de cocina/KDS, cobros parciales y reservas vive
en una futura `restaurante.md` (F2) — este doc cubre F1 hostelería.

> **Premisa F1 bar.** Mesas + barra + venta rápida convivientes,
> multi-terminal en tiempo real, cobro siempre del ticket completo (sin
> parcial/dividido), sin envío a cocina. Lo que da bar.

> **Caso real de referencia.** Pendiente de cerrar cliente bar piloto.
> El TPV de Holded es referencia negativa — todo lo que él hace mal,
> nosotros lo hacemos al revés. Ver `docs/ux-principles.md`.

---

## 1. Mapa de sala

### 1.1 Creación de mesas (admin)

Pantalla del admin con dos sub-pantallas:

**Crear mesa.** Formulario simple: nombre + capacidad + zona
(salón / terraza / barra / reservado). En segundos se dan de alta 10
mesas. La capacidad es informativa (no bloquea ventas).

**Distribuir mesas (opcional).** Canvas drag-and-drop sobre fondo
blanco. El propietario arrastra las mesas que ya creó y las posiciona
físicamente. Posiciones se guardan. **Si no se distribuyen**, el TPV
muestra las mesas en grid automático por zona. Esto **no es
bloqueante** para empezar a vender.

### 1.2 Visualización en el TPV

Pantalla "Mapa de sala" con cada mesa en su posición (o en grid). Cada
mesa muestra:

- **Color de estado**: libre (gris) / ocupada (azul) / cobrando
  (ámbar) / sync pendiente (rojo).
- **Tiempo abierta**: contador "23 min" (principio UX 3.2 — detectar
  mesas olvidadas).
- **Importe acumulado**: total actual.
- **Comensales** (opcional, si se introduce al abrir): "2p".
- **Inicial del camarero** que la abrió (si turno permite varios
  camareros simultáneos).

Tap sobre una mesa libre → diálogo rápido "Comensales: ___ · Abrir" o
salta directo al ticket de la mesa si está ocupada.

---

## 2. Barra como array de mini-mesas

### 2.1 Configuración

En el admin, al crear una zona "Barra", el propietario indica cuántos
**puestos** tiene (ej. 8 taburetes). El sistema crea automáticamente
`B1, B2, B3 … B8` como mini-mesas de capacidad 1.

### 2.2 UI

En el mapa de sala, la **zona Barra** se renderiza como una **fila
horizontal de N celdas pequeñas** numeradas, separada visualmente del
salón. Mismos estados de color que las mesas normales.

### 2.3 Comportamiento

Cada puesto de barra **es una mesa más** — se abre, se le añaden
líneas en una o varias rondas, se cierra y se cobra exactamente igual.
No hay subcuentas dentro de un puesto (un puesto = un cliente). La
ventaja: el camarero sabe que la caña que sirvió va al puesto B3 sin
tener que memorizar qué tomó cada cliente.

---

## 3. Venta rápida (sin mesa)

Botón **"Venta rápida"** siempre visible en el header del TPV junto al
"Mapa de sala". Abre un ticket nuevo **sin mesa asociada**: flujo
retail puro. Casos típicos:

- **Café para llevar** — cliente entra, pide, paga, se va.
- **Encargo telefónico** — cliente recoge sin sentarse.
- **Take away** — comida para llevar (sin la separación
  local/take-away todavía — eso es evolutivo, §10).
- **Cliente en barra que no se queda** — sin asignar a puesto.

El ticket de venta rápida funciona offline (cola local + sync en
background), igual que el flujo retail estándar.

---

## 4. Operativa de mesa

### 4.1 Añadir líneas

Una vez abierta la mesa, pantalla de venta con:

- **Botonera principal** con los top productos del bar configurados
  desde admin (UX §2.1). Default: 12-20 botones grandes.
- **Categorías** en cinta superior (Cafés / Refrescos / Cervezas / Vinos
  / Tapas / Cocina / Otros). Tap cambia el contenido de la botonera.
- **Búsqueda fuzzy** siempre disponible en el input lateral con foco
  permanente.
- **Lector de barcode** alimenta el input igual que en retail (para
  refrescos embotellados, productos de tienda en cafetería-pastelería).

### 4.2 Variantes obligatorias

Productos con variantes (tamaño café, tipo de pan, ración) muestran
**selector inline** al pulsar:

- Café → `Solo / Cortado / Con leche / Americano / Bombón`.
- Tostada → `Pequeña / Mediana / Grande`.
- Pulpo → `Ración / Media ración`.

Modelado con el sistema de variantes de Holded (igual que retail
§1.1). Si la variante tiene precio distinto, lo respeta.

### 4.3 Modificadores

Modificadores **predefinidos por producto** desde el admin, sin texto
libre. Ejemplos:

- Tostada → `[Sin gluten, Con tomate, Doble, Sin sal]`.
- Café → `[Sin azúcar, Sacarina, Doble leche, Descafeinado, Para
  llevar]`.
- Cerveza → `[Sin alcohol, Bien fría, Sin espuma]`.

Aparecen como **chips clicables debajo de la línea recién añadida**
durante 3 segundos (luego se ocultan). Cero fricción: si el camarero
no toca ninguno, no pasa nada. Si toca uno o varios, salen impresos
en el ticket del cliente como notas.

**En F1 los modificadores son informativos y sin precio.** Viven sólo
en el TPV (`ticket_line.modifiers` jsonb) y se imprimen en el ticket.
**No se envían a Holded** — la línea va limpia (`"Tostada · 3,50 €"`).
En F2 (cocina) los modificadores se imprimirán también en la comanda
de cocina.

### 4.4 Editar líneas y operaciones

Igual que el núcleo §6.2:

- Modificar cantidad (tap + / -).
- Eliminar línea (swipe izquierda + DESHACER 4 s).
- Aplicar descuento por línea o global (con permisos por rol §15
  del núcleo).
- Notas de venta a nivel ticket (texto libre, se imprimen).
- Cancelar mesa (vacía el carrito, motivo registrado en log).
- Suspender — **no aplica en bar**: la mesa abierta ya es "suspendida"
  por naturaleza. Se queda con sus líneas hasta cobrar.

---

## 5. Mover líneas entre mesas y agrupar mesas

### 5.1 Mover línea(s) entre mesas

Caso real: el camarero tomó una caña pensando que era para la mesa 4
y resulta que era para la 5. O el grupo grande se reparte líneas
entre las dos mesas que ocupan.

Flujo: en el ticket de origen → seleccionar línea(s) → "Mover a otra
mesa" → seleccionar destino en el mapa → confirmar. Las líneas
desaparecen del origen y aparecen en el destino con su tiempo de
añadido original conservado (importante si más adelante hay cocina).

### 5.2 Agrupar (juntar) mesas

Caso real: grupo de 6 que se sienta en dos mesas de 4. Cobran juntos.

Flujo: seleccionar 2+ mesas en el mapa → botón "Juntar" → indicar
**mesa principal** (default: la primera seleccionada). Las líneas de
las otras mesas se mueven a la principal. Las absorbidas vuelven a
estar libres en el mapa. La principal se marca con badge "agrupada
×3" para que se vea de un vistazo.

**Operación reversible** mientras la principal no se haya cobrado:
botón "Desagrupar" devuelve cada línea a su mesa de origen
(`ticket_line.original_table_id` guardado al absorber).

Al cobrar la mesa principal, todo se cierra a la vez y se emite un
único `salesreceipt` en Holded por el total agrupado.

---

## 6. Multi-terminal en tiempo real

**Imprescindible** en bar: el camarero A toma comanda en mesa 5 desde
su tablet en el salón, el cliente de esa misma mesa pide una caña en
la barra al camarero B desde otro terminal, y los dos ven la mesa 5
actualizada al instante. Sin esto, no es un TPV de bar.

### 6.1 Arquitectura

- La **mesa abierta vive en el backend**, no en IndexedDB del device.
  Es un documento compartido entre todos los terminales de la tienda.
- **WebSockets** (Fastify + plugin). Cada device emparejado a un
  `register` de la `store` se suscribe a los eventos de mesas de esa
  store.
- Cuando alguien hace una operación (añadir/modificar/quitar línea,
  abrir/cerrar mesa, mover líneas, agrupar), el backend persiste y
  hace **broadcast** a todos los devices suscritos. El TPV refresca
  la pantalla automáticamente.
- Conflictos simultáneos: **last-writer-wins** por operación. Si dos
  camareros añaden línea a la vez, las dos líneas se aceptan (son
  operaciones aditivas distintas, no chocan). Si uno modifica
  cantidad mientras otro elimina la línea, gana el último que llegó
  al backend.

### 6.2 Modo degradado online-only

Si la red se cae:

- Las **mesas abiertas pasan a read-only** en el device. El cajero
  puede ver el estado del último sync, **cobrar mesas que ya tiene
  cargadas localmente** (con la última vista conocida), pero **no
  puede añadir/modificar líneas** porque no puede sincronizar con el
  resto de terminales.
- **Venta rápida sigue funcionando 100 % local** (cola local + sync
  diferido), igual que retail offline.
- Cuando vuelve la red, las mesas se rehidratan desde el backend
  automáticamente, las ventas rápidas en cola se suben.

### 6.3 Resiliencia comercial

Como complemento al modo degradado, ofrecemos al cliente como parte
del paquete de instalación **router con 4G de respaldo** (~20-40 €
hardware + 5-10 €/mes SIM datos). Cubre el 99 % de cortes de fibra
reales sin tocar una línea de código del TPV. Diferenciador comercial
real ("contigo el bar no para").

Offline completo de mesas con CRDT queda para un futuro "plan plus"
si el mercado lo demanda.

---

## 7. Cobro

Hereda del núcleo §7 con simplificaciones de F1:

- **Cobro siempre del ticket completo** de la mesa o de la venta
  rápida. Sin cobros parciales (alguien se va antes), sin división
  por comensales, sin propinas en línea aparte. Todo eso va a F2
  restaurante.
- **Métodos**: efectivo, tarjeta, Bizum, vale, mixto (combinación).
- **Calculadora de cambio** con quick keys `+5 +10 +20 +50` (UX
  §2.5).
- Al confirmar el cobro: ticket pasa a `PAID`, se imprime ESC/POS
  según núcleo §8, se encola para Holded como `salesreceipt` con
  `approveDoc: true` y `notes: "TPV-uuid: <externalId>"`, con GET-back
  (ADR-010).
- Mesa vuelve a estado **libre** en el mapa al confirmar el cobro.

### 7.1 Pre-cuenta — no la hacemos en F1

No hay botón explícito "Imprimir pre-cuenta". Si el cliente pide ver
lo acumulado antes de pagar, el camarero gira el dispositivo y muestra
la pantalla. Si en F2 (restaurante) aparece la necesidad real de
imprimirla por costumbre del sector, la añadimos entonces.

### 7.2 Invitación / atención casa

**No se modela como funcionalidad propia del TPV.** Si la casa quiere
invitar a un cliente, se aplica un **descuento** sobre la línea o
sobre el total (descuento estándar del núcleo §6.3, con permiso de
encargado). Operativa nativa de Holded — Holded contabiliza el
descuento; el ticket sale al cliente con el importe rebajado o
cero.

---

## 8. UX específica del bar

Refuerza los principios de `docs/ux-principles.md` con los detalles
que más diferencian a un buen bar TPV:

- **Modo oscuro por defecto** en pantalla de venta (UX §1.6).
- **Botones grandes (80×80 px) para los productos top** (UX §2.1).
- **Mapa de sala como home** en perfiles de camarero (cajero en bar).
  El cajero entra y ve mesas, no la venta rápida.
- **Tiempo abierto visible** en cada mesa del mapa (UX §3.2).
- **Bottom bar con las últimas 3-4 mesas tocadas** para salto rápido
  (UX §2.6).
- **Sonido tick al añadir línea** opcional (UX §3.5).
- **Indicador de red permanente** en el header (UX §2.4).

---

## 9. Hardware típico de un bar

Notas operativas para el instalador. No es código pero condiciona
decisiones:

- **iPad / tablet Android** en barra y mesas, conectados por WiFi a
  un router del local.
- **Lector de barcode USB-HID** opcional (cafetería-pastelería con
  productos embotellados sí, bar puro sin barcode no lo necesita).
- **Impresora térmica ESC/POS** en barra (Epson TM-T20, TM-T88, o
  equivalente compatible). Cajón portamonedas conectado por RJ11 a
  la impresora.
- **Router del local con 4G de respaldo** (recomendado del paquete
  comercial, §6.3).
- **Print agent local** del núcleo (ADR-006) corriendo en uno de los
  dispositivos del local (mac mini, Windows en barra, Raspberry Pi).
  Las tablets le hablan a `localhost` vía la red del local.

---

## 10. Evolutivo (F2 restaurante y más allá)

Funcionalidades fuera de F1 bar. Algunas se desbloquean en F2
restaurante; otras son v2/v3 a evaluar según demanda.

### 10.1 F2 — Restaurante

- **Envío a cocina / KDS** (Kitchen Display System). Las líneas se
  imprimen en estación de cocina (caliente, frío, postre) o aparecen
  en pantalla. Estados por línea: pendiente, en preparación, lista,
  servida. Llamada al camarero cuando algo está listo.
- **Cobros parciales** (alguien se va antes).
- **División de cuenta**: equitativo entre N comensales o por consumo
  individual.
- **Propinas en línea aparte**. Decisión fiscal pendiente: ¿se mete
  en `salesreceipt` o se queda fuera de Holded?
- **Cambiar de mesa entera** (cliente se cambia al fondo).
- **Reservas**. Libreta digital con hora, comensales, nombre,
  teléfono. Al llegar el cliente, "sentar reserva" en mesa concreta.
- **Menú del día compuesto** (entrante + principal + postre + bebida
  con elecciones).
- **Pre-cuenta** explícita con impresión separada.

### 10.2 v2 — Independientes de F2

- **Take away / local con IVA diferenciado** y eventual etiquetado en
  comanda. Implica variantes en producto Holded.
- **Doble vertical bar + tienda** (cafetería-pastelería). Pantalla
  con dos puertas en el home — "Mesa/Barra" y "Venta rápida/Tienda".
  Configuración de tenant multi-vertical.
- **Generación de mapa de mesas via IA desde foto**. El propietario
  sube foto de la sala desde el cenital y la IA detecta mesas, sillas
  y posiciones. Factible (CV + homografía).
- **Comandar por voz**. "Café solo y dos cañas para la mesa 5" → el
  reconocimiento añade líneas. APIs de Whisper, Deepgram o Web Speech.
- **Plan plus offline completo de mesas** con CRDT (Y.js / Automerge)
  o edge backend local en Raspberry Pi del bar. Sólo si el mercado
  lo demanda.
- **Reconocimiento de cliente fiel por NFC** (toca el móvil en el
  TPV).
- **Pantalla compañera para clientes** mostrando el ticket en
  construcción.

---

## 11. Decisiones abiertas bar F1

Pocas, todas con default razonable:

1. **Capacidad de la mesa como bloqueo o información**. Default:
   informativo (no bloquea si el cajero abre la mesa con más
   comensales que capacidad).
2. **Default del modo home del cajero**. Para perfiles de cajero en
   bar: empezar en mapa de sala (recomendado) o en venta rápida.
3. **Reagrupación automática al desagrupar**. Tras desagrupar mesas,
   ¿el TPV vuelve al estado previo (con tiempos originales) o las
   mesas se quedan recién-abiertas? Recomendación: estado previo
   completo (tiempos conservados).
4. **TTL del feedback de modificadores en chip**. Default: 3
   segundos visibles tras añadir una línea.
5. **Cierre del badge "agrupada"**. ¿Se quita el badge cuando se
   cobra, o se conserva en el histórico del ticket? Recomendación:
   conservar en histórico para auditoría.

---

## 12. Referencias

- `docs/07-nucleo-comun.md` — contrato funcional general.
- `docs/ux-principles.md` — principios UX transversales.
- `docs/verticals/retail.md` — patrones que bar reutiliza (variantes,
  contacto, devoluciones).
- `docs/verticals/restaurante.md` — F2, se escribe cuando bar esté
  operativo en producción.
