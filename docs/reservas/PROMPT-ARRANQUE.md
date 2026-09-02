# Prompt de arranque · vertical agenda con lo aprendido en Raquel Torres

> Pegar tal cual en una sesión nueva del proyecto. **Esta pasada NO escribe código.**

---

Lee `docs/reservas/00-koibox-ingenieria-inversa-y-modelo.md`. Son dos meses de ingeniería inversa
sobre **Koibox** (el CRM de un spa real en producción, plan Platinum, centro 1288) convertidos en
requisitos de agenda. Viene del proyecto Raquel Torres Spa.

**Cómo tratarlo:**

- Cada afirmación va marcada: **[M]** medido contra la cuenta real · **[D]** documentado o dicho por
  Koibox · **[H]** hipótesis nuestra **sin verificar** · **[X]** decisión nuestra.
- **Nada marcado [H] se convierte en hecho ni en código.** El §1.8 entero (el esquema de BD de
  Koibox) es [H]: sirve para entender por qué su producto tiene los defectos que tiene, no para
  construir sobre ello.
- Es un documento de **entrada**. No es la spec de este proyecto ni sustituye a ningún ADR de aquí.

**Contexto que ya sabes y él no del todo:** la agenda de este proyecto ya existe. `B-reservas-1` a
`B-reservas-4` están cerrados y `bloque-reservas-5-cita-caja.md` está escrito. Su §8.3 dice esto y
retira el roadmap que traía, pero **lo escribió alguien leyendo el repo desde fuera**: hay que
verificarlo desde dentro.

## Tarea 1 · El cruce (primero, y sin saltárselo)

Lee `docs/blocks/B-reservas-4-done.md`, `docs/code-prompts/bloque-reservas-4-agenda.md`,
`packages/db/prisma/schema.prisma` y la migración que crea los `EXCLUDE USING gist`.

Escribe `docs/reservas/01-cruce-con-b-reservas-4.md` que conteste, punto por punto:

1. **Qué de ese documento ya está resuelto aquí**, y si nuestra solución es mejor, igual o peor que
   la que propone. Cuando sea mejor, dilo y explica por qué — sirve para no "corregir" hacia atrás.
2. **Confirma o desmiente los 8 huecos de su §8.3** (H1 yield · H2 ventana reservable ≠ turno ·
   H3 programa multisesión · H4 panel de salud · H5 suite de invariantes · H6 importación desde
   Koibox · H7 auditoría UX · H8 datos reales). Con la ruta y la línea que lo prueba, no de memoria.
3. **Qué contradice** lo que ya tenemos decidido. Ahí manda **este** proyecto: no se reabre un ADR
   cerrado porque un documento externo diga otra cosa. Anótalo como divergencia y sigue.
4. **Los 14 invariantes de su Parte 5**: cuáles cubre ya la suite de B4 y cuáles no. Los que falten
   son deuda de test, no de producto.

## Tarea 2 · Los prompts de bloque

Solo para los huecos que **hayas confirmado** en la Tarea 1, y con la numeración de aquí:

| Bloque | Qué | De dónde sale |
|---|---|---|
| `B-reservas-6` | Capa de yield sobre `BookingPolicy` | §3.5 y el ADR-001 que cita |
| `B-reservas-7` | Ventana reservable separada del turno contratado | §1.5 |
| `B-reservas-8` | Programa multisesión: saldo y consumo atómico con la cita | §1.6 |
| `B-reservas-9` | Panel de salud de la agenda | §7.5 |
| `B-reservas-10` | Importación / adaptador desde Koibox | Partes 1, 9 y 10 |

Usa la **plantilla canónica** de `metodologia-front-mipiace` (`references/plantillas.md`):
contexto, alcance, restricciones, entregables y **fuera de alcance explícito**. Ese último apartado
no es burocracia: es lo que evita que B-6 se coma a B-8.

Tres cosas que deben aparecer en los prompts que lo requieran:

- **B-6**: las reglas se aplican **al listar la disponibilidad Y al reservar**. Si solo filtran al
  listar, basta con adivinar la hora y llamar al endpoint. Y toda regla es **apagable** y
  **explicable a una clienta**: si no se puede explicar por teléfono, no entra.
- **B-8**: crear la cita y descontar la sesión son **una sola transacción**. Un programa no es un
  cheque regalo: el cheque se canjea una vez, el programa tiene saldo.
- **B-9**: cada cifra del panel documenta la consulta que la produce (principio de auditabilidad).

## Tarea 3 · Roadmap

Actualiza `docs/roadmap-master.md` (o el que corresponda) con los bloques confirmados, sus
prerrequisitos, y **qué queda explícitamente fuera de la versión**.

## Restricciones

- **Esta pasada no toca código ni migraciones.** Solo `docs/`.
- No reabras decisiones cerradas de este proyecto.
- **F1 y F2 de su Parte 10 son datos que no existen todavía** — la matriz servicio×profesional y el
  inventario de cabinas/aparatos del spa. No inventes semillas con ellos: déjalo como prerrequisito
  del bloque que los necesite.
- Su Parte 7 es una auditoría de la interfaz de **Koibox**, no de la nuestra. Úsala como lista de
  contraste contra la UI que ya tiene B4, no como spec para rehacerla.
- Si algo del documento te parece que no encaja aquí, **no lo adaptes en silencio**: anótalo en el
  cruce como decisión pendiente.

## Cierre

Termina con un resumen de una pantalla: qué está cubierto, qué bloques quedan abiertos y en qué
orden los abrirías. **Espera revisión antes de implementar nada.**
