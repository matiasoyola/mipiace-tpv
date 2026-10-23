# Bloque clinica-9 · lo que la pasada en hierro encontró antes de Rosario

Rama `clinica-9-antes-de-rosario`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-9`, desde
`origin/master`. Frente C. Escrito el 24-10-2026 a partir de la pasada en hierro de clinica-8.

Lee antes, en este orden:
1. `docs/qa/2026-10-24-clinica-8/PASADA.md` — **la pasada entera, con capturas (00…44).** Este bloque
   la cierra salvo lo que se dice abajo que queda fuera.
2. `docs/blocks/clinica-8-done.md` (fases A y B, sobre todo §1.2, §1.3, §9.11, §9.13, §15).
3. `docs/blocks/clinica-2-done.md` y `apps/api/src/clinica/actor-paciente.ts` (el actor de sistema).
4. `docs/blocks/clinica-5-done.md` (tipos de visita, tarjetas por tipo, `lineas-de-la-sesion.ts`).
5. `docs/implantaciones/rosario/` (el CSV y su README).

## Por qué existe

clinica-8 está desplegado (`091b67d`, APK 1.28.0). El 24-10 se recorrió el día de una consulta en la
«Clínica demo» con la Lenovo. Lo que clinica-8 arregló funciona. Pero hay seis cosas que hacen que **no se
pueda ir a Rosario**: una exploración clínica que se pierde, una primera consulta que no se cobra, fichas
duplicadas, sesiones con fecha falsa, el email en lugar del nombre y un usuario técnico en las listas.

¿Y qué?: el día que Rosario cargue sus historias, **lo que la sanitaria anota se queda, la primera visita
se cobra, cada paciente tiene una sola ficha y todo lo firmado lleva su nombre y la fecha real.**

## Fase única · bloqueantes primero, luego importantes

### Bloqueantes

1. **La exploración de pie de riesgo se pierde al cerrar la sesión.** Reproducir: sesión de una paciente
   con diabetes → «Marcar Pie de riesgo» → rellenar las cuatro comprobaciones (sale «Riesgo muy bajo») →
   cerrar y firmar. La sesión cerrada y la historia solo dicen «General»; Historia › Sensibilidad dice
   «ninguna exploración». Sospecha (verificarla en el dato, no en la pantalla): un tipo de visita **sin
   servicio en su categoría** se descarta al cerrar, y con él su tarjeta. Un tipo marcado se guarda
   **siempre**, cobre o no (regla 11 de clinica-5: lo que PASÓ queda escrito). Test que lo sabotee, y
   **consulta de producción** que detecte sesiones cerradas a las que les falte un tipo marcado, si el dato
   lo permite (va al `-done`, no se ejecuta).
2. **La primera consulta no se cobra.** `docs/implantaciones/rosario/catalogo-tpv.csv` marca «Consulta
   diagnóstico» `primera_valoracion=si, tratamiento_sesion=no` → no sale en «Qué se cobra» → sesión a 0 €
   en la primera visita de cada paciente. Corregir el CSV (las dos marcas) y su README. Y el check de
   onboarding «Catálogo clínico completo» exige que **la primera valoración sea también cobrable en la
   sesión**. (En la demo ya está corregido a mano.)
3. **El buscador de cliente de «Nueva cita» no encuentra pacientes existentes.** «Carmen Prueba» →
   «Sin coincidencias» existiendo «Carmen Prueba Demo» → se crea una ficha nueva → dos historias. Encontrar
   por qué (¿busca por nombre completo exacto?, ¿solo por un campo?) y que case por palabras, sin tildes ni
   mayúsculas, en nombre + apellidos + teléfono + email. Al crear, si hay alguien parecido, **avisar antes**
   («¿Es Carmen Prueba Demo, 600000001?»). Test.
4. **La sesión de una cita de otro día se abre como «Cita de hoy»** y se firma con la fecha de hoy (cita
   del lunes 26, firmada el sábado 24). La sesión solo se abre el día de la cita; fuera de ese día el botón
   no es «Sesión de hoy» y lo dice («La sesión se abre el día de la cita»). Test.
5. **El nombre no llega a la dueña.** Cajeros recientes, «Atiende», «Firmada por», «corregido por», hoja de
   cierre y aceptación del contrato pintan `m.oyola+clinica-demo`. Personal tiene «Nombre en la agenda»
   (Rosario), pero el TPV usa `users.alias` y la propietaria no tiene alias ni sale en Cajeros. Que **un solo
   nombre** mande: el de Personal se escribe también como `alias` del usuario (y viceversa), y la activación
   lo deja puesto. Para cuentas ya creadas, el guardado de Personal lo arregla. Test de las seis superficies.
6. **«Paciente (por enlace)» sale en Cajeros (con Editar/Cambiar PIN/Revocar) y en Personal.**
   `actor-paciente.ts` dice que cuatro listas filtran `isSystemActor: false`; no lo filtra ninguna. Añadirlo
   a `PERSONAL_DE_LA_CAJA` (las cuatro rutas de cajeros), a `GET /staff`, a los candidatos a PIN de encargado
   y a la colisión de alias. Cambiar su PIN debe dar el 404 limpio, no el 500 del CHECK. Test que lo sabotee
   (y que el comentario del fichero diga la verdad).

### Importantes

7. Valoración de un paciente **sin email**: no decir «el enlace que se le mandó»; decir que no tiene email y
   ofrecer el test en la tablet. «N respuestas sin resolver» no es una ALERTA roja antes de que conteste.
8. **(Matías)** «Devolver la tablet al centro»: botón de verdad, grande, no un enlace.
9. La próxima cita propuesta («la recepción elige el hueco al cobrar»): tras cobrar una sesión con próxima
   cita propuesta, ofrecer darla ahí mismo (con la fecha propuesta como punto de partida de «Buscar hueco»).
10. Fuera la nota interna «Pendiente de validar con Rosario» de la tarjeta de pie de riesgo. Ningún texto
    de la app nombra a un cliente.
11. Hoja «Revisa lo que se va a firmar» y sesión cerrada: **todos** los tipos marcados (no solo el que
    cobra) y la gravedad de cada lesión.
12. Al devolver la tablet o al volver de la valoración, la agenda vuelve **al día de la cita**, no a «Hoy».
13. Servicios en «Nueva cita»: la lista no es una caja de 4 líneas con scroll propio; ocupa el alto
    disponible, y las categorías se ordenan por uso (las más usadas arriba), no alfabéticamente.
14. Fotos con poca luz: la Lenovo M11 **no tiene flash** (`android.flash.info.available = FALSE`), así que
    «Luz» no sale y está bien. Cuando el visor está muy oscuro, aviso encima: «Poca luz · acerca la
    lámpara». Sin más.
15. Menores: ticket con el nombre de la clínica y no «Tienda principal» cuando solo hay una tienda;
    Catálogo de agenda sin la frase de Holded en cuentas sin Holded; «Atendido por» del cobro viene puesto
    con la sanitaria de la sesión; «Igual que la última vez» no se pinta en la primera visita.

## Lo que NO entra

- **«Abrir turno» con fondo de caja antes de la agenda en una clínica.** Es decisión de producto de Matías;
  no se toca hasta que la tome.
- La altura de las citas cortas en la agenda (`PX_PER_MIN`): se decide con Rosario delante.
- PIN personal y cambiable, roles, importador de COGECOP: sus propios bloques.

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, fichero entero y contra el fichero que de
  verdad ejecuta la línea. Como mínimo: el tipo sin servicio sobrevive al cierre; el check bloquea una
  primera valoración no cobrable; el buscador encuentra «Carmen Prueba» en «Carmen Prueba Demo»; la sesión
  no se abre fuera de su día; el nombre de Personal llega a las seis superficies; el actor de sistema no sale
  en ninguna de las cuatro listas.
- **Guion de pasada en hierro** en el `-done` (Clínica demo + Lenovo por adb), que repite los pasos 1–34 de
  `PASADA.md` y añade los que quedaron sin hacer el 24-10: informe (37), venta suelta (38), Personal (39-40),
  Dispositivos (41), sin «Comanderas» (42), sesión caída (43).
- `docs/blocks/clinica-9-done.md` con lo hecho, decisiones tomadas sin preguntar, sabotajes y **«Al
  desplegar»** (migraciones, APK nueva, y qué hay que retocar en la «Clínica demo», que ya tiene una ficha
  duplicada de «Carmen Prueba» y la consulta marcada a mano).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue. El e2e nunca de madrugada.
