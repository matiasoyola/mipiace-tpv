// Cliente Holded de mipiacetpv.
//
// Diseño: ver `docs/04-stack-y-decisiones.md` ADR-010 (GET-back tras toda
// escritura) y `docs/spike-holded.md` para el contexto empírico de cada
// peculiaridad de la API (envelope `{status,info}`, 200+HTML, PUT
// silencioso, etc.).

export {
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  HoldedSubscriptionSuspendedError,
  type SilentRejectMismatch,
} from "./errors.js";

export {
  ApiKeyClient,
  DEFAULT_HOLDED_BASE_URL,
  type HoldedClient,
  type HoldedClientOptions,
} from "./client.js";

export {
  HOLDED_PRODUCTS_PAGE_SIZE,
  createProduct,
  getProduct,
  iterateAllProducts,
  listProductsPage,
  updateProductWithGetBack,
  type CreateProductBody,
  type HoldedProduct,
  type HoldedProductVariant,
} from "./products.js";

export {
  iterateAllServices,
  listServicesPage,
  type HoldedService,
} from "./services.js";

export { listTaxes, parseTaxRateFromId, type HoldedTax } from "./taxes.js";

export {
  listWarehouses,
  type HoldedAddress,
  type HoldedWarehouse,
} from "./warehouses.js";

export {
  tryGetAccountInfo,
  type HoldedAccountInfo,
} from "./account.js";

export {
  createSalesreceiptApproved,
  getReceiptPdf,
  registerPaymentWithGetBack,
  type CreateSalesreceiptOptions,
  type CreateSalesreceiptResult,
  type PayPayload,
  type SalesreceiptItem,
  type SalesreceiptPayload,
  type SalesreceiptStored,
} from "./salesreceipt.js";
