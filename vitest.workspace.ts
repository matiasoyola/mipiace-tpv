export default [
  "packages/escpos-builder",
  "packages/holded-client",
  "packages/ticket-model",
  "packages/ticket-pdf",
  "packages/util-validation",
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
