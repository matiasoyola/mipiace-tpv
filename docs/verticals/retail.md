# Vertical · Retail

Funcionalidades específicas para comercios minoristas (libros, ropa,
papelería, regalo, pequeño electrodoméstico, etc.) que se montan **encima**
de `docs/07-nucleo-comun.md`.

> Caso real de referencia: **Librería Thalia**, primer cliente del MVP.

> **Aplica a productos Y servicios indistintamente.** Todo lo descrito en
> este documento (apartado, vales, devoluciones, cambios, ticket regalo,
> comisión por vendedor, etc.) funciona igual para productos físicos y
> para servicios sin almacén (envoltorio de regalo, envío a domicilio,
> reserva, suplemento, lo que sea). Sólo cambia que los servicios no
> muestran stock ni semáforo, como define el núcleo §6.

---

## 1. Catálogo

### 1.1 Variantes

Aplica a categorías con talla/color (ropa, calzado) o formato (libro tapa
dura/blanda).

- El TPV muestra el producto y, si tiene variantes, abre un selector de
  variante antes de añadir al ticket.
- Cada variante tiene su propio **barcode**, **stock**, y opcionalmente
  **price_override**.
- En Holded las variantes viven dentro del producto padre (`variants`).
- En el ticket, el nombre impreso incluye la variante: `"Camiseta XL
  azul"`.

### 1.2 Códigos de barras

- **Lector USB-HID** es el método principal de entrada (el cajero rara vez
  busca por nombre).
- Aceptamos múltiples barcodes por producto/variante (ej. el de fabricante
  + el interno reetiquetado).
- **ISBN** se trata como barcode estándar (libros). Validación opcional de
  checksum ISBN-13 antes de aceptar.
- Si el barcode no existe en catálogo, el TPV ofrece: a) buscar manual, b)
  línea libre con ese código en `notes`.

### 1.3 Impresión de etiquetas

Funcionalidad de admin, no del cajero:

- Pantalla "Imprimir etiquetas" → selecciona productos o variantes.
- Genera plantilla con barcode + nombre + precio.
- Imprime en una **etiquetadora térmica** distinta de la de tickets (Zebra,
  Brother) vía el mismo print agent local (puerto distinto).
- Útil al recibir mercancía sin etiquetar.

> v2: lectura masiva desde lista de albarán para etiquetar lote completo.

---

## 2. Venta

### 2.1 Búsqueda

- Por barcode (input principal con foco permanente).
- Por nombre / SKU / **ISBN** (autocompletado).
- Por **autor / editorial** en caso de catálogo de libros (es un campo
  custom de Holded para Thalia que extraemos en sync).

### 2.2 Apartado de venta

Pattern típico de retail: cliente quiere algo, paga señal, vuelve en X
días a recogerlo y completar el pago.

- Botón **"Apartar"** durante la venta → en lugar de cobrar el total, se
  pide **señal mínima** (% configurable, default 20 %).
- Se genera ticket de "Apartado" con número propio, no fiscal.
- El producto queda **reservado de stock** (se descuenta del stock visible,
  pero no se envía a Holded todavía).
- El cliente vuelve → buscar apartado por número o nombre → cobrar resto →
  ahora sí se emite el `salesreceipt` completo en Holded.
- Si el cliente no vuelve en N días (configurable, default 30):
  - Aviso al encargado.
  - Opción de **liberar stock** y convertir la señal en saldo a favor del
    cliente (vale) o, según política, retenerla como ingreso.

### 2.3 Vales de compra (saldo cliente)

Patrón común en retail tras una devolución sin ticket o por temporada:

- El cliente tiene un **saldo** asociado a su ficha de contacto Holded.
- Se puede usar como método de pago "Vale" en cualquier venta futura.
- El TPV mantiene el balance localmente y lo refleja en Holded como
  contacto con campo custom o nota.

> Decisión a tomar: ¿el vale es nominativo (ligado a contacto Holded) o
> al portador (código de 8 dígitos en papel)? Recomendación: nominativo
> en MVP, al portador en v2.

### 2.4 Ticket regalo

Hereda del núcleo (§11). Particularidades retail:

- **Imprimir ticket regalo masivo por temporada**: en campañas (Navidad,
  rebajas) el comercio puede querer reimprimir tickets regalo de los
  últimos N días en lote, para meterlos en bolsas.
- **Validez del cambio**: 30 días por defecto, configurable. Si el cliente
  vuelve dentro del período, devolución estándar (§10 del núcleo).

---

## 3. Devoluciones

Hereda del núcleo (§10). Particularidades retail:

### 3.1 Devolución sin ticket

Frecuente en retail (cliente recibió regalo, no tiene ticket):

- El encargado autoriza con su PIN.
- El cajero selecciona los productos del catálogo (no del ticket original).
- El reembolso **siempre va a vale de compra** (saldo a favor del cliente),
  nunca a efectivo o tarjeta.
- Se genera un abono en Holded contra un **contacto especial "Devolución
  sin ticket"** o contra el contacto del cliente si está registrado.

### 3.2 Cambio (no devolución)

Cliente devuelve A y se lleva B:

- Una sola operación, el TPV calcula la diferencia.
- Si A > B, devolución del diferencial a vale.
- Si A < B, el cliente paga el diferencial.
- Se genera un único ticket combinado en Holded (líneas en negativo + en
  positivo).

---

## 4. Ficha de cliente

Hereda el contacto Holded del núcleo (§6.4). En retail añadimos:

- **Histórico de compras** del cliente (consulta desde el TPV, datos
  locales + on-demand a Holded).
- **Saldo de vales** acumulado.
- **Apartados activos** y caducados.
- Datos opcionales: fecha de cumpleaños (para campañas), idioma
  preferido, preferencia de canal (email vs WhatsApp).

> No es un CRM. Es la ficha mínima para que el cajero reconozca al cliente
> y aplique vales / consulte apartados.

---

## 5. Comisión por vendedor

Opcional por tenant. Si está activado:

- Cada línea del ticket lleva `seller_user_id` (por defecto el cajero, se
  puede cambiar a otro empleado).
- Informe mensual en admin: ventas por vendedor, comisión calculada según
  % configurado por producto / categoría / global.
- No se envía a Holded — vive en el TPV.

> Para Librería Thalia: probablemente desactivado en MVP, pero el modelo
> de datos lo contempla para no migrar después.

---

## 6. Reglas de negocio específicas retail

- **Stock** se muestra al cajero (en retail importa más que en bar):
  cantidad disponible en el almacén de la tienda, con semáforo (verde >5,
  ámbar 1-5, rojo 0). En offline, semáforo congelado al último sync.
- **Precio modificable** sólo por encargado (en retail no es habitual
  cambiar precio en caja).
- **Códigos de barras de regalo** (Thalia: tarjetas regalo numeradas) → se
  tratan como producto normal con barcode propio, pero al venderlas se
  activa el **saldo cliente** automáticamente.

---

## 7. Fuera de alcance retail MVP

- Listas de regalo / boda / nacimiento (compleja, segunda fase).
- Programa de fidelización con puntos.
- Reservas online (e-commerce ↔ TPV).
- Etiquetas RFID / antirrobo integrado.
- Multi-tienda con stock compartido en tiempo real (el sync vía Holded ya
  lo cubre con minutos de latencia, suficiente para MVP).

---

## 8. Caso Librería Thalia (peculiaridades)

Notas operativas del cliente concreto, para que Code y diseño tengan
contexto real:

- **Catálogo:** libros (ISBN), papelería, regalo, juguetes.
- **Volumen:** ~200-400 tickets/día en temporada alta.
- **Operativa:** 2 cajeras, propietario hace cierres.
- **Picos:** vuelta al cole (septiembre), Sant Jordi (23 abril), Navidad.
- **Hardware:** lector barcode USB, impresora térmica Epson TM-T20, cajón
  RJ11 conectado a la impresora.
- **Sin etiquetadora propia** en MVP (los libros vienen etiquetados de
  editorial).
- **Veri*factu:** OFF en pruebas, se activa cuando salgamos a producción.

---

## 9. Decisiones abiertas (retail)

1. **Apartado: días antes de liberar stock**. Default: 30. Configurable por
   tienda.
2. **Apartado caducado: señal devuelta como vale o retenida**. Default:
   vale (más amable al cliente).
3. **Vale: nominativo o al portador**. Recomendación: nominativo en MVP.
4. **Comisión por vendedor activable**: sí en modelo, default OFF.
5. **Devolución sin ticket: contacto "Anónimo devoluciones" en Holded** o
   crear contacto al vuelo. Recomendación: contacto Anónimo único por
   tenant.
