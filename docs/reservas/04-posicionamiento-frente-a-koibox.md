# Qué tenemos y qué nos falta para competir de verdad con Koibox

> Escrito en lenguaje de negocio, no de código. Los datos técnicos que lo sostienen están en
> `01-cruce-con-b-reservas-4.md` y el plan de desarrollo en `03-que-falta-para-la-agenda-del-informe.md`.
>
> **2026-09-02.**

---

## 1. Contra qué competimos, dicho con honestidad

Koibox no es una agenda: es **el sistema operativo de un centro de belleza**. Lleva años, lo usan
miles de centros, y un spa real lo tiene funcionando todos los días. Su interfaz es mala —la
auditamos dos meses y le pusimos un **4 sobre 10**— pero **funciona todos los días desde hace años**,
que es una ventaja que no se compra con buen diseño.

Su modelo de negocio también dice algo: **cobran por empleada** (36,30 €/año por asiento adicional).
Cada persona que contrata el centro les paga más.

---

## 2. Lo que ya tenemos, y es más de lo que parece

**Tenemos la parte difícil, que es la caja.** Y esto es lo que casi nadie ve:

> Koibox es una agenda con una caja pegada. Nosotros somos **una caja con una agenda pegada**. Y la
> caja es lo caro: facturación, IVA al céntimo, integración fiscal con Holded, impresión térmica,
> apertura y cierre de turno, arqueo, devoluciones, fiado, funcionamiento sin internet, terminal
> Android, multi-tienda. Todo eso está **en producción, cobrando dinero real, todos los días**.

Encima de eso, la agenda ya construida trae **tres cosas que ellos no pueden dar**, y no son opinión:

1. **Las pausas entre servicios existen de verdad.** Ellos no tienen ese campo, así que el centro se
   ve obligado a meter los 10 minutos de recogida *dentro* de la duración: publican 100 minutos y
   bloquean 110, y uno de los dos números miente. Nosotros publicamos uno y bloqueamos otro sin
   mentir en ninguno.
2. **Servicios a varias manos.** Un ritual a cuatro manos con dos terapeutas a la vez **no es
   expresable** en Koibox. En nuestro modelo sí. Es producto de carta que hoy no se puede vender
   online en ningún sitio.
3. **Es físicamente imposible reservar dos veces el mismo hueco.** En ellos, dos personas reservando
   a la vez es una carrera que resuelve la suerte. En nosotros lo impide la base de datos.

Y una cuarta que es la que de verdad se vende: **cobrar una cita sin volver a teclearla**. Su agenda y
su caja se hablan por dentro pero no por fuera —comprobado: desde su API no se puede ni tocar el
precio ni descontar una sesión—, así que **ellos no pueden ofrecer esto aunque quieran**. Nosotros sí,
porque es el mismo sistema.

---

## 3. Lo que nos falta, por orden de importancia real

### 🔴 1. Que alguien la use

**La agenda no ha estado encendida ni un minuto en un centro real.** Cero citas de verdad. Un producto
sin un negocio dentro no es un competidor: es una demo muy buena. Esto no se arregla programando más,
se arregla metiendo un centro.

**Sin esto, todo lo demás da igual.**

### 🔴 2. Que la clienta pueda reservar sola desde la web del centro

Hoy no puede. Y es literalmente lo que el centro cree que está comprando. Sin esto no hay conversación
comercial.

### 🔴 3. Los bonos y programas de sesiones

Es **el producto que más margen deja** en un spa: el bono de 10 sesiones que se cobra hoy y se gasta
en seis meses. Aquí hay una oportunidad concreta: **en Koibox existen en su panel pero son invisibles
para cualquier integración** —lo verificamos rastreando su documentación entera y probando 13 rutas
distintas, todas vacías—. Es decir: hoy quien vende un bono en Koibox lo gestiona a mano.

Nosotros lo tenemos diseñado, no construido.

### 🟠 4. Recordatorios de cita

Reducir plantones es la razón por la que muchos centros pagan un software. Se espera de serie. La
mitad de la fontanería ya existe (los avisos por email ya se envían desde el TPV); por WhatsApp hace
falta contratar un proveedor.

### 🟠 5. Poder traerse el histórico

**Nadie cambia de sistema si pierde sus fichas y su agenda.** Sin un importador, no hay venta a un
centro que ya esté en Koibox — que son todos los interesantes.

### 🟠 6. Fiabilidad de verdad, no fiabilidad de diseño

Nuestra pantalla está mejor pensada que la suya. Pero la suya ha aguantado diez mil sábados y la
nuestra ninguno. **Un sábado de 40 citas con tres personas tocando la misma pantalla** es el examen, y
no lo hemos hecho.

### 🟡 7. Todo lo que rodea a la agenda y ni hemos empezado

Esto es lo que más se subestima al comparar dos productos. Un CRM vertical maduro trae, y nosotros no:

| | Ellos | Nosotros |
|---|---|---|
| Ficha técnica con **fotos** de la clienta (antes/después, fórmulas de color) | Sí | Solo texto |
| **Campañas y marketing** (envíos masivos, recuperación de clientas) | Sí, con plantillas | No — solo una casilla de "acepta marketing" |
| **Fidelización por puntos** | Sí | No |
| **Informes** de agenda: ocupación, ranking, ingresos por franja | Sí | No (los de caja sí) |
| Consumo de producto por servicio (escandallo) | Sí | No |
| Firma digital de consentimientos | — | Fase 2 |
| Portal / app para la clienta | Sí | No |

Nada de esto es imprescindible el primer día. **Todo esto sale en la segunda reunión comercial.**

### 🟡 8. Lo que no es producto: confianza

Años en el mercado, referencias de otros centros, soporte con teléfono, formación, precio conocido.
Ellos lo tienen. Se compensa con implantación de la mano y con estar cerca — que es justo lo que
sabemos hacer— pero hay que saber que se está compensando algo.

---

## 4. Dónde ganamos si lo hacemos bien

No en "ser Koibox pero más bonito". En cuatro cosas concretas:

1. **Agenda y caja son el mismo sistema.** Reservar, atender, cobrar y facturar sin re-teclear ni
   cuadrar dos programas. Es la frontera que ellos no pueden cruzar.
2. **Proteger las horas buenas del centro.** Las franjas caras se llenan de servicios baratos y cortos
   porque el sistema ofrece todo hueco físicamente posible. Medido en un centro real: **cuatro franjas
   concentran el 42 % del ingreso del año**, y cada hueco ocupado por un servicio corto en vez de un
   tratamiento cuesta **41 € de diferencia**. Nosotros podemos aplicar esas reglas **en toda la casa**
   —mostrador y web—, y ahí está la diferencia entre proteger 4.000-10.000 € al año o 19.000-30.000 €.
   **Esto es consultoría convertida en software, y es lo que de verdad se vende.**
3. **Un solo sistema para varios sectores.** El mismo motor sirve a peluquería, spa, clínica y
   hostelería. Ellos son belleza y punto.
4. **Precio.** Ellos cobran por empleada. Crecer les cuesta dinero a los centros. Ahí hay un mensaje
   comercial evidente.

---

## 5. Dónde no vamos a ganar pronto, y conviene no pelear

Marketing masivo, informes profundos, catálogo de integraciones, ecosistema de años. Prometer eso es
perder la venta en el mes tres.

---

## 6. Traducción a decisiones

**Para poder salir a vender a un centro pequeño** (una peluquería, un centro de estética de 2-4
personas), hace falta:

- Cerrar el cobro de la cita · reglas de horarios y protección de franjas · separar el turno de lo
  reservable, con festivos · el panel que avisa de lo mal configurado · bonos y programas.
- **Y un piloto real que lo use un mes.**

**Para plantarle cara a Koibox en una comparativa abierta**, además:

- Reserva online en la web del centro · recordatorios · importar el histórico · tiempo real entre
  pantallas.

**Para ganarle a Koibox en un spa grande** (el caso Raquel Torres), además:

- Señal al reservar para frenar plantones — que hoy implica **construir el cobro online entero,
  porque no tenemos ninguna pasarela de pago**.
- Y el ecosistema del punto 7: fotos en la ficha, campañas, informes.

---

## 7. La frase que lo resume

> **Tenemos la mitad difícil hecha y sin estrenar.** Lo que nos falta para competir no es sobre todo
> tecnología: es **un centro dentro, la reserva online, los bonos y poder traerse el histórico**. Con
> eso somos una alternativa real para un centro pequeño o mediano. Sin un centro usándolo, no somos
> competencia: somos una demo muy buena.

---

*Mi Piace Internet Solutions · 2026-09-02.*
