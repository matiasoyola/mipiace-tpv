/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "-apple-system", "system-ui", "sans-serif"],
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
