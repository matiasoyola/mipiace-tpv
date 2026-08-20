# Arranque · sesión de mejoras (post-validación del 2026-08-20)

Pega esto como primer mensaje de la conversación nueva.

---

## Mensaje para pegar

> Retomamos mipiacetpv. Lee primero el handoff de memoria y `claude/conclusiones-validacion-2026-08-20.md` del
> proyecto: ayer validé v1.10 en producción con una hora punta simulada sobre Cafetería Sirope y salieron siete
> fallos, todos de la misma familia — el motor calcula bien, pero el producto miente o calla cuando algo va mal.
>
> Hoy vamos a por las mejoras. El orden acordado:
>
> 1. **v1.10.2 · impresión honesta** — prompt en `docs/code-prompts/bloque-v1-10-2-impresion-honesta.md`
> 2. **v1.10.3 · barra en hora punta** — prompt en `docs/code-prompts/bloque-v1-10-3-barra-hora-punta.md`
> 3. **v1.11 · cierre de día automático** — prompt ya escrito, con addendum
> 4. **reservas-5 · cita→caja** — prompt ya escrito
>
> Empieza por dejarme los cuatro listos para lanzar a Claude Code: commitea los docs pendientes en master, crea
> los worktrees que falten y dame los comandos. Los worktrees de reservas-5 y v1-11 ya existen.
>
> Una pregunta a la vez, y actúa como CTO: si algo es bueno para el producto, hazlo, no preguntes.

---

## Estado exacto al arrancar

- `master` en **`1a24008`**, pusheado.
- `v1-10-1-ci-smoke` en `8313b6c`, **en verde**, pendiente de mergear a master.
- Worktrees existentes: `../mipiacetpv-reservas-5`, `../mipiacetpv-v1-11-cierre`. Faltan por crear los de
  v1.10.2 y v1.10.3.
- Sin commitear en master: los dos prompts nuevos, el guion de QA, el addendum de v1.11, las conclusiones. Y un
  fichero vacío llamado `master` en la raíz que hay que borrar.

## Lo primero que hay que hacer, en orden

```bash
cd ~/Developer/Claude/Projects/mipiacetpv
rm -f master
git add docs/ && git commit -m "docs · conclusiones de la validación, guion de hora punta y bloques v1.10.2 y v1.10.3"
git push

# el paso de humo, ya validado en verde, a master
git merge v1-10-1-ci-smoke && git push

# worktrees de los dos bloques nuevos
git worktree add ../mipiacetpv-v1-10-2-impresion -b v1-10-2-impresion-honesta
git worktree add ../mipiacetpv-v1-10-3-barra -b v1-10-3-barra-hora-punta

# alinear los cuatro con master
for w in reservas-5 v1-11-cierre v1-10-2-impresion v1-10-3-barra; do git -C ../mipiacetpv-$w merge master; done
```

Luego, una sesión de Claude Code por worktree con su prompt. Exigir a cada una que confirme su worktree con
`git worktree list` antes de la primera línea y que devuelva el **hash del commit** al cerrar.

## Los cuatro bloques, en una línea cada uno

| Bloque | Qué arregla | Por qué ahora |
|---|---|---|
| **v1.10.2** impresión honesta | Dice "Enviado a impresora" sin haber impresora | Miente sobre el ticket del cliente |
| **v1.10.3** barra en hora punta | Cobro mixto imposible, papelera de 1,5 s, líneas inalcanzables | Hoy no se puede cobrar mitad y mitad |
| **v1.11** cierre de día | Arqueo obligatorio antes de la primera venta | La palanca de adopción de Sole |
| **reservas-5** cita→caja | El cobro deja el DRAFT huérfano | Bloquea encender la agenda |

v1.10.2 y v1.10.3 tocan zonas distintas del front: **se pueden lanzar en paralelo**.

## Lo que sigue sin cerrar

El papel. Ninguna prueba de ayer demuestra que salga un ticket por una impresora física. Se cierra con el AP12 —
mejor espejado con `scrcpy` en el Mac y repitiendo la misma hora punta con la impresora enchufada.
