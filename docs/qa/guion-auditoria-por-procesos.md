# Guion · auditoría de UX/UI por procesos (no por pantalla)

Escrito el 2026-09-02, con producción en `2705a3a` y el AP11 corriendo esa misma versión.

## Por qué por procesos

La auditoría del 01-09 fue **por pantalla**: midió el panel del ticket, y el bloque v1.14 arregló
exactamente lo medido. La pantalla real seguía siendo un muro de tazas grises, porque quien mandaba
en la percepción era el catálogo, que no se auditó. Hizo falta un segundo bloque (v1.14.1) para eso.

**El instrumento estaba mal, no la ejecución.** Un TPV no se usa por pantallas: se usa por
recorridos que se repiten cien veces al día. Lo que hay que medir es el recorrido.

## Los seis recorridos

Cubren el 95% de lo que pasa en un día de barra.

1. **Abrir turno y primer cobro.** El de Sole a las 7 de la mañana, con la caja recién abierta y
   sin datos de nada. (Ojo: es el caso donde v1.14.1 deja el panel más vacío.)
2. **Cobro rápido en barra**, sin mesa.
3. **Abrir mesa, añadir tres productos, enviar comanda.**
4. **Cobrar mesa, con pago mixto** tecleando los dos importes.
5. **Cierre de turno y arqueo por denominaciones.**
6. **Vincular un terminal nuevo.** Hoy no se puede hacer sin un segundo dispositivo con sesión de
   admin: entra en la auditoría precisamente por eso.

## Qué se mide en cada recorrido

- **Toques totales** y **toques evitables** (los que existen sólo porque la UI lo pide).
- **Dónde se para la mano**: cada punto en que hay que leer la pantalla antes de seguir.
- **Coste del error**: qué pasa si el camarero se equivoca ahí, y si el TPV lo deja arreglar.
- **Tiempo hasta la confirmación visual** de cada acción (principio §1.3: < 100 ms).

Sobre el **AP11 físico con el catálogo real** de Sirope, a 1280 × 800. **Nunca sobre una réplica**:
nos mintió dos veces en dos días — el muro de tazas y el bundle de producción.

## Salida

**No** una lista de mejoras. Un backlog partido en tres cajones, explícito:

| Cajón | Criterio |
|---|---|
| **Bloquea implantación** | sin esto no se puede entregar un terminal a un cliente |
| **Cuesta dinero en hora punta** | dobles pulsaciones, cobros de más, tiempo de camarero |
| **Estética** | se ve mal pero no cuesta ni bloquea |

Y **nada se construye hasta que el reparto esté hecho y Matías lo ordene.**

## Ya sabemos que entran en el reparto

- **Keystore de release** (A3 frente 7) — sin él no hay APK entregable. *Bloquea implantación.*
- **`PairScreen`**: el teclado del SO tapa "Vincular dispositivo". *Bloquea implantación.*
- **Vincular el terminal desde el propio terminal** (hoy hace falta un segundo dispositivo).
- **Bug del `CashPad` en campos pre-rellenos** — decisión pendiente: (a) campo vacío o
  (b) el pad reemplaza al primer dígito. Recomendado (b). *Cuesta dinero.*
- **El hueco del desglose no se llena nunca**: la fuente es "lo que más sale este turno" y en un
  turno recién abierto no hay datos. Propuesta: cascada turno → mismo tramo horario de días
  anteriores → catálogo. *Cuesta dinero.*
- **Rail vertical de categorías.** Con el catálogo real sólo se ven 4 y 7 quedan tras "Más (7)".
  Decidido: rail fijo a la izquierda en tablet, colapsado a iconos cuando hay pocas, fila
  horizontal **sólo** en handheld. **El layout puede depender del dispositivo y de una decisión
  nuestra, nunca de un dato que el cliente cambia sin saber lo que provoca** — por eso se descartó
  conmutar según el número de categorías.
- **Densidad del mapa de sala**: tarjetas gigantes casi vacías y la zona "Barra" cortada. Sin auditar.
- **`CartLineItem` con targets de 36 × 44 px** y el sistema mandando 48.
- **Tarjetas de producto con ~90 px de aire de sobra** entre nombre y precio.
- **Criterio 5 de v1.12** (pantalla de bloqueo sin `gap`): requiere revertir Chrome con
  `pm uninstall-system-updates com.android.chrome`.

## Protocolo, no negociable

Tenant **Sirope** + cajero `mipiacetpv-test-2e5c19f9`, en modo prueba. Al terminar, verificar que no
hay ni un documento en el Holded del cliente. **Matías teclea los PIN y las contraseñas; Claude no.**
Conexión adb sólo desde Terminal.app (ver `project_pruebas_fisicas_ap11`).
