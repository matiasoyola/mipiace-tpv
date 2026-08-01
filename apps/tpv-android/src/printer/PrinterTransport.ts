// A0 dejó aquí el contrato de transporte de impresión como artefacto de
// diseño. A1 lo movió a su hogar CANÓNICO, dentro de `tpv-web`:
//
//   apps/tpv-web/src/platform/printer/PrinterTransport.ts
//
// Motivo: el código JS que implementa el contrato (registry + WebUsb /
// UsbNative / WifiBackend) viaja en el bundle de `tpv-web` y corre EN
// AMBOS entornos — el navegador y el WebView de Capacitor. `tpv-android`
// es sólo el shell nativo (Java) + el plugin USB Host; no consume este
// TS. Mantener una segunda copia del contrato aquí sólo invita a que
// ambas diverjan, así que este archivo queda como puntero.
//
// El plugin nativo (Java) que da acceso USB Host vive en:
//   apps/tpv-android/android/app/src/main/java/es/mipiace/tpv/UsbPrinterPlugin.java
// y se consume desde el lado JS en:
//   apps/tpv-web/src/platform/printer/UsbNativeTransport.ts

export {};
