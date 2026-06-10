export default [
  "packages/escpos-builder",
  "packages/holded-client",
  "packages/ticket-model",
  "packages/ticket-pdf",
  "packages/util-validation",
  "apps/api",
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
