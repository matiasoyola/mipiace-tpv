/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "-apple-system", "system-ui", "sans-serif"],
      },
      // v1.12-manos-de-camarero · escala táctil. Medida sobre el AP11
      // (8,8 px/mm físicos a densidad 240): lo que se toca cien veces al
      // día estaba a 5-7 mm y la mano del camarero falla. Tres peldaños,
      // y nada de `h-[52px]` sueltos: los bloques siguientes heredan
      // esta escala.
      //   touch     48px ≈ 9 mm  · mínimo de cualquier control diario
      //   touch-pad 56px ≈ 10 mm · teclas del CashPad y del keypad de PIN
      //   touch-lg  64px ≈ 11 mm · barra de cobro y acciones primarias
      //
      // Y dos FUERA DE LA ESCALA, con nombre propio y justificación (la
      // regla de docs/design/tokens.md §4):
      //   tap-fichar     208px ≈ 24 mm · el botón de Entrar/Salir (F1)
      //   tap-valoracion  96px ≈ 11 mm · el «Sí»/«No» del test del paciente
      //
      // El del test no es «un control de uso diario»: lo toca una persona
      // de 78 años, diez veces, en una tablet que a lo mejor sostiene con
      // una mano, y de lo que conteste depende que nadie la trate sin
      // saber que está anticoagulada. El mockup validado por Matías los
      // pone a 96 px (80 en móvil) y así se quedan — el prompt del bloque
      // lo dice literalmente. A 320 px de ancho, dos de 96 px con 12 px de
      // hueco entran de sobra.
      spacing: {
        touch: "48px",
        "touch-pad": "56px",
        "touch-lg": "64px",
        "tap-valoracion": "96px",
        "tap-valoracion-sm": "80px",
      },
      minHeight: {
        touch: "48px",
        "touch-pad": "56px",
        "touch-lg": "64px",
        "tap-valoracion": "96px",
        "tap-valoracion-sm": "80px",
      },
      colors: {
        mipiace: {
          coral: "#E97058",
          "coral-soft": "#FDEAE3",
          "coral-dark": "#C75A45",
          ink: "#1F2937",
          "ink-soft": "#374151",
          stone: "#F8F6F3",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
