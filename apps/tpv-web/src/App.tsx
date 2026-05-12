// Esqueleto del TPV PWA — sin venta todavía.
//
// El emparejamiento de dispositivo (B3), el login del cajero por PIN y la
// pantalla de venta (B4) entrarán aquí. De momento sólo confirmamos que
// el shell PWA arranca y el SW se registra. Para flujos de venta reales
// mientras tanto, sigue funcionando `apps/tpv-web-spike/` (puerto 5175).

export function App() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0f172a",
        color: "#f8fafc",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.75rem", margin: 0 }}>mipiacetpv</h1>
        <p style={{ marginTop: "1rem", opacity: 0.7 }}>
          PWA cargada. La pantalla de emparejamiento llega en B3 y la
          pantalla de venta en B4.
        </p>
        <p style={{ marginTop: "1rem", opacity: 0.5, fontSize: "0.875rem" }}>
          Mientras tanto, el spike de venta sigue accesible en{" "}
          <code>localhost:5175</code>.
        </p>
      </div>
    </main>
  );
}
