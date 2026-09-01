# Auditoría front · mipiacetpv · pantalla de venta (SalePage) · 2026-09-01

**Auditor:** sesión de QA física de la ronda 2. **No construí esta pantalla** (es de v1.10.3 y
v1.12), así que emito nota oficial. Declaro implicación: he pasado el día probándola y **propuse
arreglos antes de auditarla**, con el sesgo de confirmación que eso implica. Y mi mirada sobre ella
ya falló una vez — no detecté el hallazgo C1, lo detectó Matías.

**Evidencia:** 50 capturas del **terminal físico AP11-1006** a 1280×800 CSS (densidad 240), no un
render de réplica. Medidas tomadas sobre píxel, no a ojo.

---

## Nota: 6,5/10

| Dimensión | Nota | Evidencia clave |
|---|---|---|
| Ejecución visual | 8 | Marca coherente, DM Sans, coral con intención, densidad correcta para tablet |
| Calidad técnica | 7 | Contraste 4,76:1 (AA ✓), `ConfirmSheet` propio, error boundary. Pero el `CashPad` queda inerte en campos pre-rellenos |
| Usabilidad en el terminal | **5** | **20 px visibles** del desglose de artículos; fila de categorías cortada sin affordance |
| Fidelidad al sistema | 7 | Tokens y radios correctos; CTA primaria a 56 px con el sistema mandando 64-72; los seis tonos de categoría sin usar |
| Proceso | 8 | Bloque, done-doc y criterios existen. Pero el criterio de tap targets se declaró cumplido sin medir en el terminal |

La global no es la media (7): **pondera hacia abajo por un fallo crítico en el camino principal**.

---

## Lo que está bien

- **Contraste verificado AA**: etiquetas, precios y meta del ticket a **4,76:1** sobre blanco. No es
  una pantalla descuidada.
- **Tap targets holgados**: chips de categoría **60 px**, teclas del `CashPad` **95×56 px**, tarjetas
  de producto muy por encima del mínimo. El criterio de 48 px se cumple casi en todas partes.
- **El `CashPad` es la decisión correcta y está bien resuelta**: `mInputShown=false` verificado por
  el propio Android en cuatro pantallas. El layout se reorganiza en vez de taparse — lo contrario
  de lo que hacía el teclado del sistema.
- **`ConfirmSheet` con la consecuencia explicada** ("Lo consumido no se cobra"), no un `confirm()`
  nativo. Es acabado de verdad.

---

## Hallazgos

### CRÍTICO

**C1 · El desglose de artículos vive fuera del pliegue.**
Panel del ticket: 360 × 573 px CSS. Reparto medido: cabecera ~90, siete acciones secundarias ~135,
totales ~120, "Enviar comanda" ~67, "Cobrar" ~67 → **a los artículos les quedan 20 px visibles**.
Con dos productos, la primera línea ya sale cortada por el borde.

*Por qué importa, y no es estético:* al tocar un producto **no hay confirmación visible** de que se
ha añadido — la línea nace fuera de la vista. Sólo cambian un contador discreto y el total. En hora
punta eso produce doble pulsación: no lo veo, lo vuelvo a tocar, y el cliente paga dos cafés. Es un
fallo de dinero, no de diseño.

*La jerarquía está invertida:* lo que más se mira (¿qué llevo apuntado?) está al fondo y truncado;
lo que se usa una de cada veinte veces (Cliente, Descuento, Observaciones, Mover mesa, Partir
cuenta, Agrupar) ocupa el mejor sitio de la pantalla.

*Arreglo:* líneas justo bajo la cabecera ocupando el espacio flexible; totales y "Cobrar" anclados
abajo en sticky; las siete acciones tras un botón "Más" que abra un sheet.

### MEDIO

**M1 · La fila de categorías se corta sin ninguna señal.**
Ocho chips medidos; el último termina en x=1876 de 1920 — **toca el borde**. No hay gradiente, ni
flecha, ni chip partido a propósito. Un camarero nuevo no sabe que hay más ni que aquello se
desliza. Un scroll horizontal sin affordance en táctil es una función que no existe.

**M2 · Categorías sin color ni icono: obligan a leer.**
Ocho rectángulos idénticos con texto. Para elegir en un segundo con una mano ocupada, el texto es
el peor canal. El sistema visual ya define seis tonos de categoría (`amber`, `sky`, `red`, `green`,
`rose`, `stone`) y **están sin usar aquí**. No hace falta perseguir fotos de producto —que dependen
de que Holded las tenga— para arreglar esto.

**M3 · La búsqueda ocupa el 60 % del ancho en una pantalla de hostelería.**
Medida: **768 × 56 px sobre 1280** de ancho, en la franja más valiosa. En un bar casi no se usa —se
toca categoría y producto— y encima es de los pocos campos que legítimamente abre el teclado del
sistema. En retail (Cachitos, Thalía) sí es primaria: **la barra debería ordenarse por
`businessType`**, que ya existe en el tenant.

**M4 · "Mapa" está enterrado y es la navegación más frecuente del turno.**
Hoy es un chip pequeño dentro del panel del ticket, compitiendo con el nombre de la mesa. Cada mesa
atendida termina volviendo al mapa. Debe ser ancla fija de la barra superior.

**M5 · El `CashPad` queda inerte en campos pre-rellenos.**
Ver `project_cashpad_campos_prerellenos`. El campo llega con `0,00` o `3,00`, `applyKey` no tiene
hueco decimal y devuelve el valor intacto: el teclado **parece roto**. Afecta a abrir turno y al
resto del cobro mixto, donde el propio texto de ayuda invita a "escribir encima".

**M6 · Nombres de categoría sucios heredados de Holded.**
`Croissantysandwich`, `Bolleria` sin tilde. Lo ve el cliente en su propio TPV. **La herramienta ya
existe** (`TagAliasesPage` en el admin) y nadie la ha usado para Sirope: es implantación, no código.

### MENOR

**m1 · "Cancelar" en zona premium.** La acción más destructiva del panel, en coral, aislada arriba
a la derecha, compitiendo visualmente con "Cobrar". Debe irse dentro del sheet de "Más": que cueste
un toque más es una feature.

**m2 · CTA primaria a 56 px.** El sistema visual manda 64-72 px para CTA primaria. Pasa el mínimo
genérico de 48 y falla la regla propia.

**m3 · El Atrás no cierra el diálogo de cierre de día.** Esa capa no está en la pila del
`useBackGuard`; hay que salir por "Cancelar".

**m4 · Copy del error boundary fuera de contexto.** Dice "La venta en curso no se pierde: el carrito
se restaura" incluso en la pantalla de vinculación, donde no hay ni venta ni carrito.

---

## Camino al 10

- **6,5 → 8 · una tarde.** C1 (reordenar el panel) y M1 (affordance del corte). Sólo C1 ya cambia la
  pantalla de cara: pasa de media línea visible a cuatro.
- **8 → 9 · un día.** M2 (color e icono por categoría), M3+M4 (barra superior por vertical, Mapa
  grande), m1 y m2.
- **9 → 10 · medio día, y es lo que genera negocio.** Hoy el panel del ticket **vacío no dice nada**.
  Una mesa recién abierta es el momento de mayor intención del turno: ahí caben los **cinco más
  vendidos del turno** o los favoritos de la casa. Acelera el 80 % de las comandas en hora punta y
  se paga solo en segundos por mesa. Es la única mejora de esta lista que no corrige un fallo:
  añade valor.

M5 y M6 van aparte: M5 es un bug de dinero con decisión de producto pendiente, M6 es implantación.

---

## Verificación pendiente

No he probado el panel con **un ticket largo (6-12 líneas)**, que es el caso real de un bar y donde
C1 se agrava. Debe entrar en la comprobación del bloque.
