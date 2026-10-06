# Bucle visual · clinica-2 · la valoración inicial

Capturas contra el mockup validado por Matías el 05-10-2026
(`docs/mockups/clinica-2-valoracion.html`), sacadas de la aplicación de
verdad: API y PWA levantadas sobre la base del banco
(`mipiacetpv_clinica2_banco_e2e`), con el tenant «Clínica Podológica Demo»
que siembra `apps/e2e-ui/seed/clinica-demo.ts`.

Nada de esto es un render del mockup: son las pantallas que va a ver una
paciente de 78 años y la podóloga que la atiende.

## El test del paciente, en los tres anchos

| Fichero | Qué enseña |
| ------- | ---------- |
| `01-test-320-a-bienvenida` · `-b-pregunta` · `-c-siguiente` | 320 px, el suelo del bucle visual. |
| `02-test-390-…` | 390 px, el móvil desde el enlace del email. |
| `03-test-1024-…` | 1024 px, la tablet de la sala. |

Lo que hay que mirar en las tres:

- **Una pregunta por pantalla**, sin scroll y sin formulario.
- **«Sí» / «No» a 96 px** (80 en móvil), fuera de la escala táctil de la
  casa y con token propio (`tap-valoracion`, `docs/design/tokens.md` §4).
  A 320 px los dos caben con su hueco y sus márgenes sin tocarse.
- **«No lo sé» siempre**, a ancho completo y punteado: es una salida, no
  una tercera opción al mismo nivel.
- La ayuda en palabras de la calle («Lo que la gente llama "tener
  azúcar"»), y el hueco de la ayuda se mantiene aunque la pregunta no la
  tenga — si no, la pregunta salta de sitio entre pantallas.

**Hallazgo del bucle a 320 px:** la cabecera parte en dos líneas
(«Clínica Podológica / Demo» a la izquierda y «Antes de su primera /
visita» a la derecha). Se deja así: las dos siguen legibles, no empujan la
pregunta y la alternativa —esconder una— quita el contexto que le dice a
la paciente dónde está.

## La pantalla final

| Fichero | Qué enseña |
| ------- | ---------- |
| `04-final-sin-no-lo-se` | «Gracias, Carmen. Ya está.» sin nada pendiente. |
| `05-final-con-no-lo-se` | Lo mismo contando los «No lo sé»: «no se preocupe, las mirarán juntos». |

Las dos dicen «Ya puede cerrar esta página» porque el canal es el email;
por la tablet dicen «Puede devolver la tablet en el mostrador».

**Y lo que NO se ve aquí porque dura lo que tarda el servidor:** entre la
última pregunta y esta pantalla hay un paso más, «Estamos guardando sus
respuestas… No cierre esta página». Lo encontró el banco con navegador: la
primera versión decía «Ya está» antes de guardar nada. Ver el done, §11.

## La pantalla del sanitario

| Fichero | Qué enseña |
| ------- | ---------- |
| `06-sanitario-por-validar` | Pill ámbar «Valoración por validar», franja de alertas, y «Validar» desactivado porque quedan dos «No lo sé». |
| `07-sanitario-con-correccion` | **La pieza visual del bloque**: la respuesta del paciente en coral relleno, la corrección en oscuro, y la original con borde coral — las dos a la vez. Filas con «Sí» con el fondo coral suave. Leyenda arriba. |
| `08-validar-desactivado-con-motivo` | El botón gris CON EL MOTIVO escrito al lado. |
| `09-validar-activado` | Las tres confirmaciones marcadas y el botón vivo. |
| `10-sanitario-validada` | Tras firmar: el aviso verde con autora, colegiado y hora, y la frase de lo que queda en la historia. |

Lo que hay que mirar:

- En `07`, la fila de «Circulación»: debajo del nombre pone **«Paciente: No
  lo sé · corregido por Lucía Martín»**. Lo que contestó la paciente no se
  ha borrado y se lee al lado de lo que vale hoy.
- En `06`, el motivo es el «No lo sé» y NO «marca las tres
  confirmaciones»: resolverlo con la paciente delante va primero, porque
  las casillas son un gesto de dos segundos y preguntarle algo otra vez no.
- En `10`, «Este paciente tiene 5 valoraciones en su historia»: el script
  de capturas tuvo que validar y abrir una nueva cada vez para sacar las
  diez pantallas, porque **la base no deja dos valoraciones abiertas a la
  vez**. Las cinco son el camino de la decisión de producto 7 (la
  valoración se repasa con una nueva) ejercido cinco veces.

## Cómo se repiten

```bash
# 1 · la stack del banco, con su base y su Redis
pnpm --filter @mipiacetpv/e2e-ui run stack
pnpm --filter @mipiacetpv/api dev                      # :3105 (apps/api/.env)
MIPIACETPV_API_PROXY=http://127.0.0.1:3105 \
  MIPIACETPV_DEV_PORT=5276 pnpm --filter @mipiacetpv/tpv-web dev

# 2 · el script de capturas (vive fuera del repo: es de usar y tirar)
node <scratchpad>/capturas.mjs docs/qa/2026-10-06-clinica-2
```
