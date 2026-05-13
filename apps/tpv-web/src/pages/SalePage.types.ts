// Tipos compartidos entre SalePage y CheckoutPage. Mantenerlos aquí
// reduce el coupling: SalePage no necesita conocer la API interna del
// checkout y viceversa.

export type CashierState =
  | { kind: "selling" }
  | { kind: "checkout" }
  | { kind: "synced"; ticketId: string };
