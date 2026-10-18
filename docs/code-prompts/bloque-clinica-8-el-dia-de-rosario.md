# Bloque clinica-8 · el día de Rosario funciona

Rama `clinica-8-el-dia-de-rosario`, worktree `~/Developer/Claude/Projects/mipiacetpv-clinica-8`, desde
`origin/master`. Frente C. Escrito el 18-10-2026 a partir de la auditoría en hierro de ese día.

Lee antes, en este orden:
1. `docs/qa/2026-10-18-auditoria-clinica/AUDITORIA.md` — **la auditoría entera, con capturas.** Este
   bloque la cierra salvo lo que se dice abajo que queda fuera.
2. `docs/blocks/clinica-3-done.md`, `clinica-5-done.md` y `clinica-6-done.md` — sesión, tipos de
   visita, niveles, `lineas-de-la-sesion.ts`, historia viva.
3. `docs/blocks/catalogo-servicios-csv-done.md` y `apps/api/src/catalog/csv-catalogo.ts`.
4. `docs/blocks/puesta-en-marcha-done.md` (cuenta en ensayo, activación).
5. `docs/clinica/decisiones.md` y `docs/implantaciones/rosario/`.

## Por qué existe

El 18-10 se recorrió el día entero de una clínica en una cuenta de demo de producción
(«Clínica demo»), en una tablet Android con la APK 1.26.0 instalada desde `/apk`. Las piezas
clínicas (valoración, sesión, historia viva, consentimiento, fotos, informe) están bien. **Lo que las
rodea rompe**: una cita desaparece y su hora vuelve a ofrecerse, la sesión no cobra nada, la parte
clínica no se ve si no se conoce un truco, y el contrato lleva el nombre de una sociedad que no existe.

¿Y qué?: cuando Matías vaya a la clínica de Rosario a cargar sus historias, **la primera consulta
tiene que poder darse, firmarse y cobrarse sin que nadie de Mi Piace toque nada**.

## Decisión de producto (Matías, 18-10) — no se re-debate

**En una clínica se entra por la agenda, no por la caja.** Todo va con cita previa. Al cerrar la
sesión **el ticket sale hecho** con lo que se hizo en la consulta y quien cobra solo lo confirma. A la
vista de cajero se va **solo para añadir algo aparte** (plantillas, un producto). La venta suelta
sigue existiendo, pero no es la entrada.

## Fase A · el día funciona (parar al terminar y escribir `-done` parcial)

1. **La cita que desaparece.** Reproducir: crear cita → marcar a la propietaria «Es sanitario» en
   Personal (y guardar perfil/servicios/turno) → cerrar sesión de la cajera en la app → volver a entrar.
   La cita sigue en Clientes → Historial pero **no sale en la agenda ni ocupa su hueco** (`Buscar
   hueco` la ofrece libre). Encontrar la causa en el dato, no en la pantalla, arreglarla y **escribir
   la consulta que detecta citas en ese estado en producción** (va al `-done`, no se ejecuta).
2. **Una sola verdad en el cobro.** El ticket de una cita con sesión cerrada sale **siempre** de
   `lineasDeLaSesionCerrada`. Si la sesión cerrada no tiene líneas cobrables, **no se cae en silencio
   a los servicios reservados**: el cobro lo dice («la sesión no tiene nada que cobrar: añade el
   servicio») y deja añadirlo. Test que lo sabotea.
3. **El alta deja la clínica lista para cobrar.** Hoy el CSV carga los servicios pero no las marcas de
   clínica (especialidad en la categoría, `primeraValoracion`, `tratamientoSesion`, nivel de
   quiropodia 1-3), y la sesión dice «sin servicio» → 0,00 €. El CSV gana las columnas necesarias, la
   vista previa las enseña, y `docs/implantaciones/rosario/catalogo-tpv.csv` se actualiza con las de
   Rosario. Además, **check de onboarding en super-admin**: «Catálogo clínico completo» (cada tipo de
   visita con su servicio, los tres niveles de quiropodia, una primera valoración). No se activa una
   clínica sin él.
4. **Entrar por la agenda.** En un tenant con historia clínica, el TPV abre en la agenda del día, no
   en la pantalla de venta. En el detalle de la cita, «Sesión de hoy» es el botón principal y «Cobrar»
   aparece **después** de cerrar la sesión, con el ticket hecho. La venta suelta sigue accesible
   desde el menú.
5. **«Es sanitario» guarda o avisa.** Hoy, con colegiado «45-0123», el guardado falla sin decir nada
   (con «45/0123» guarda). Aceptar ambos formatos o validar en el campo con mensaje claro. Ningún
   guardado de Personal falla en silencio (test).
6. **El cambio de sanitaria llega a la app sin volver a entrar** (`isClinician` se toma hoy en el
   login de la cajera). Que se refresque al volver a la agenda o con el refresco de datos que ya existe.
7. **Contrato de encargado:** «Mi Piace Software, S.L.» → **Mi Piace Internet Solutions SL, NIF
   B45902186, domicilio Carretera CM-5100 km 30,500, Buenaventura, 45634 Toledo.** Sube de versión
   (la huella fijada por test cambia a propósito) y sigue marcado `pendienteDeValidar` hasta el abogado.
8. **El cajero técnico de «Probar TPV» se borra al activar** (hoy queda `mipiacetpv-test-…@internal…`
   en Cajeros con acceso a la caja). Y los cajeros revocados no se listan como `revoked-…` con
   acciones.
9. **La historia del paciente siempre a pantalla completa**, venga de la cita, de la ficha del cliente
   o de donde sea. Nunca dentro del cajón lateral (hoy sale cortada y el mapa de pies se desborda).

## Fase B · pulido (después de revisar la A)

10. **Fotos (Matías: «elegir la zona antes de disparar no es intuitivo»).** Se apunta y se dispara: la
    zona viene puesta con la de la sesión de hoy, o se elige después de la foto. El disparador nunca
    parece activo estando bloqueado. Fuera el póster de «play» mientras arranca la cámara. Revisar
    exposición con poca luz.
11. **Nombre, no email**, en «Atiende», «Firmada por», «Valoración pedida por», informe, cajeros
    recientes y barra inferior. El nombre que se pone al activar llega a Personal.
12. Cerrar la sesión pide confirmación con un resumen de lo que se va a firmar.
13. La sesión preselecciona el tipo de visita del servicio de la cita; con diabetes recomienda «Pie de
    riesgo». En la primera visita no se pregunta «desde la última visita». El «10» del dolor en la
    misma fila.
14. Test en la tablet: botón visible para devolver la tablet a la sanitaria (lleva al PIN); textos según
    la especialidad, no «la podóloga» fijo; nada resaltado antes de contestar; elegir quién responde
    avanza solo.
15. Historia → «Fotos» sin consentimiento: botón para firmarlo ahí. Consentimiento: se puede desplazar
    por encima del texto hasta la firma.
16. Personal: un solo guardado por tarjeta; «Todos los servicios»; «Válido desde» con hoy por defecto
    y aviso si falta.
17. Agenda: «Buscar hueco» enseña las horas a la vista; servicios ordenados por categoría y uso; columna
    ancha con una sola profesional; el estetoscopio no abre «Salud de la agenda» a la clienta (eso es de
    Mi Piace); nuevo cliente con lo tecleado en el buscador.
18. Panel: con la sesión caída, al login (no un menú equivocado); fuera «Comanderas» y menciones a Holded
    en una cuenta sin Holded; «Ver ticket» no en blanco en Android; dispositivos con nombre legible.
19. Venta: nombres de servicio sin cortar lo que los distingue; iconos de clínica, no tazas.
20. `/apk`: una frase antes de descargar que avise de los dos avisos de Android.

## Lo que NO entra

- **PIN personal y cambiable por el usuario**: su propio bloque, toca a todas las verticales.
- Roles (sanitaria sin caja, recepcionista): sin probar en la auditoría; se prueban en hierro después.
- Importador de COGECOP: se hace en la clínica de Rosario.

## Cómo se da por hecho

- Suite verde en local y CI. **Tabla de sabotajes en el `-done`**, cada test visto en rojo, fichero entero
  (no `-t`). Como mínimo: la cita del punto 1 sigue en la agenda y ocupa hueco tras el re-login; el
  cobro de una sesión cerrada sale de sus líneas y no cae a lo reservado; el check de catálogo clínico
  bloquea la activación; el CSV con las columnas nuevas deja la sesión cobrando; Personal no falla en
  silencio; el contrato lleva la razón social y el NIF; el cajero técnico no sobrevive a la activación.
- **Pasada en hierro** con la «Clínica demo» y la Lenovo (adb), repitiendo el recorrido de la auditoría:
  alta → cita → valoración → sesión → cobro con el ticket hecho → segunda visita → foto → informe.
  Capturas en `docs/qa/2026-10-xx-clinica-8/`.
- `docs/blocks/clinica-8-done.md` con lo hecho por fase, decisiones tomadas sin preguntar, sabotajes y
  **«Al desplegar»** (migraciones, APK nueva si cambia el front de la app, y si la «Clínica demo»
  necesita recargar su CSV).
- **Push de la rama y PR abierto: autorizados.** Ni merge ni despliegue.
