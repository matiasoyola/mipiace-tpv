# Pasada en hierro de clinica-8 · 24-10-2026 (madrugada)

**Escenario:** producción `091b67d` (clinica-8 fases A+B), APK **1.28.0** instalada por adb en la **Lenovo TB311FU** (encima de la 1.26.0, sin perder vinculación), cuenta **«Clínica demo»** (propietaria Rosario, `m.oyola+clinica-demo@mipiace.es`).
**Antes:** contrato v2 aceptado por Matías a las 00:28 (huella `4aab2e6f…`). Catálogo clínico marcado a mano en Catálogo de agenda.
**Capturas:** esta carpeta (00…44).
**Recorrido:** PIN → abrir turno → agenda → nueva cita → valoración en tablet → validación con corrección → sesión (general + pie de riesgo) → fotos → cerrar y firmar → cobrar → ver ticket → historia desde la ficha.
**Sin hacer del guion §15:** informe (37), venta suelta a fondo (38), panel (39-43).

## Lo que clinica-8 arregló y funciona
- TPV abre en la agenda tras abrir turno; columna única a todo lo ancho; estetoscopio visible a la dueña.
- Nuevo cliente con nombre y apellido desde el buscador; servicios agrupados por categoría; huecos sin desplazar.
- En la cita, «Sesión de hoy» fuerte y «Cobrar» solo tras cerrar.
- Test en tablet: «primera visita de podología», «Devolver la tablet al centro».
- Validación con corrección con autor; pregunta de seguimiento al corregir diabetes.
- Banda que recomienda «Pie de riesgo»; tipo preseleccionado; el «10» en la fila del 6-9.
- Fotos con la zona de la sesión puesta; comparador antes/después.
- Hoja «Revisa lo que se va a firmar».
- Ticket hecho con lo de la sesión; acuse sin Holded; «Ver ticket» legible en Android; carrito vacío tras cobrar.
- Historia a pantalla completa desde la ficha.
- Venta con iconos de clínica.

## BLOQUEANTES
1. La exploración de pie de riesgo se pierde al cerrar la sesión (capturas 25-27, 33, 43-44).
2. La primera consulta no se cobra con el CSV de Rosario (`tratamiento_sesion=no` en «Consulta diagnóstico») (22-24).
3. El buscador de «Nueva cita» no encuentra pacientes existentes → fichas duplicadas (05, 40).
4. La sesión de una cita de otro día se abre como «Cita de hoy» y se firma con la fecha de hoy (22, 33).
5. El nombre no llega a la dueña: seis superficies con `m.oyola+clinica-demo` (00, 18, 22, 32, 33).
6. «Paciente (por enlace)» en Cajeros y Personal: el filtro `isSystemActor: false` que promete `actor-paciente.ts` no existe en ninguna lista. Sin agujero (CHECK en BD), pero «error inesperado» al cambiarle el PIN.

## IMPORTANTES
7. Valoración sin email dice que se mandó el enlace; «N respuestas sin resolver» como alerta antes de contestar (14).
8. (Matías) «Devolver la tablet al centro» como botón grande (15).
9. La próxima cita propuesta no se ofrece al cobrar (33, 36).
10. Nota interna «Pendiente de validar con Rosario» visible (27).
11. Hoja de cierre: solo el tipo que cobra y sin gravedad (32).
12. Al devolver la tablet la agenda vuelve a «Hoy» (16).
13. Lista de servicios de «Nueva cita» en caja de 4 líneas, orden alfabético (08-10).
14. Poca luz: la M11 no tiene flash (`android.flash.info.available = FALSE`); «Luz» no sale y está bien. Aviso de poca luz en el visor (30).
15. Decisión de producto pendiente: «Abrir turno» con fondo de caja antes de la agenda en una clínica (02).

## MENORES
- Ticket con «Tienda principal» en vez del nombre de la clínica (37).
- Catálogo de agenda habla de Holded en una cuenta sin Holded.
- «Atendido por» del cobro en texto libre (35).
- Cita de 20 min ≈ 33 px de alto (12).
- «Igual que la última vez» visible en la primera visita (23).
