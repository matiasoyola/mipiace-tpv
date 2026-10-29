export default [
  // B-reservas-8 · lo puro de los bonos (estados, libro, calendario y
  // porQueNoDevolvible), compartido por la API, el TPV y el panel.
  "packages/bonos",
  "packages/clinica-sesion",
  "packages/clinica-valoracion",
  "packages/consentimientos",
  "packages/contrato-encargado",
  "packages/escpos-builder",
  "packages/holded-client",
  "packages/kitchen-lan",
  // personal-1 · el paquete puro del cuadrante (`comprobarCuadrante`), la
  // ficha de personal y la importación CSV.
  "packages/cuadrante",
  // residencia-2 · el paquete puro del plan de cuidados (`queToca`).
  "packages/residencia-plan",
  // clinica-11 · el saneado de Sentry, compartido por la API, el TPV y el
  // panel. Puro y sin dependencias de ningún SDK.
  "packages/sentry-limpio",
  "packages/ticket-model",
  "packages/ticket-pdf",
  "packages/util-validation",
  "packages/verifactu",
  "apps/api",
  // A3-distribución: los guardias de los scripts de build y de publicación.
  // No son de ningún paquete —build-release-apk.sh vive en apps/tpv-android y
  // publicar-apk.sh en infra— pero guardan el MISMO invariante en dos puntos
  // de la misma cadena, así que van juntos en su propio proyecto.
  {
    test: {
      name: "infra",
      include: ["infra/test/**/*.test.ts"],
    },
  },
  // v1.5-consistencia-A §4.b: tests de frontends (ErrorBoundary y
  // lógica pura). Proyectos inline para no cargar los vite.config de
  // las apps (el plugin PWA de tpv-web no aporta nada en tests).
  {
    test: {
      name: "tpv-web",
      environment: "jsdom",
      include: ["apps/tpv-web/test/**/*.test.{ts,tsx}"],
    },
  },
  {
    test: {
      name: "admin",
      environment: "jsdom",
      include: ["apps/admin/test/**/*.test.{ts,tsx}"],
    },
  },
];
