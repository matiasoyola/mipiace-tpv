/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "-apple-system", "system-ui", "sans-serif"],
      },
      // La escala táctil de v1.12 (docs/design/tokens.md §4), medida sobre
      // el AP11 a 8,8 px/mm. Estaba sólo en tpv-web porque hasta ahora el
      // admin era de escritorio; la pantalla de fichar es de móvil y de
      // dedo, así que hereda la MISMA escala y no inventa otra.
      //   touch      48px ≈ 9 mm
      //   touch-pad  56px ≈ 10 mm
      //   touch-lg   64px ≈ 11 mm
      //
      // F1 añade un peldaño propio, fuera de la escala A PROPÓSITO:
      //   tap-fichar 208px ≈ 24 mm · el botón de Entrar/Salir.
      //
      // 208 y no 64: el botón de fichar no es "un control de uso diario",
      // es EL acto. Se pulsa entrando por una puerta con el bolso en la
      // otra mano, sin mirar, a veces con guantes. Está en el orden de la
      // tarjeta de producto del TPV (22-26 mm, que las pruebas físicas del
      // 27-08 dieron por sobradas) y no en el de una tecla. A 320 px de
      // ancho deja 56 px de margen a cada lado.
      spacing: {
        touch: "48px",
        "touch-pad": "56px",
        "touch-lg": "64px",
        "tap-fichar": "208px",
      },
      minHeight: {
        touch: "48px",
        "touch-pad": "56px",
        "touch-lg": "64px",
      },
      // Tokens canónicos de mipiace (docs/design/tokens.md §2).
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
