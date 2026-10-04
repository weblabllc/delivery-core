# Changelog

## 0.1.0 — 2026-10-04

Initial release.

- Carrier-neutral `DeliveryCarrier`, `DeliveryStatus` and `CarrierRegistry`.
- Nova Poshta client with typed `NovaPoshtaError` (`validation`, `http`, `network`, `api`, `timeout`, `aborted`, `parse`, `limit`), per-attempt timeout and overall deadline, abort signals, manual redirect handling with an allowlist, response size limit, rate-limit retry, read-only retries with backoff and jitter, and API key scrubbing.
- Directories: settlements, warehouses and postomats (normalized, paginated), warehouse types, sender counterparties, contact persons.
- Pricing in kopiyky with exact hryvnia conversion.
- Waybills: private recipient, create and delete, with phone, weight, Documents and postomat validation.
- Tracking with 100-document batching, input-ordered results and status code mapping.
- `buildShipment` builds one consistent shipment (`Parcel`, `WarehouseWarehouse`, weight, seats, `optionsSeat`, declared value) for both `getDocumentPrice` and `createWaybill`, with postomat rules applied and validation before any request.
- `buildShipment` caps the total units (sum of quantities) at `MAX_SHIPMENT_UNITS` (1000) before expanding them, validates `seats` against that total, and rejects non-integer grams.
- `buildShipmentFromSeats` builds a shipment from explicit seats with the same validation and postomat rules, so an edited seat list stays identical for the tariff and the waybill.
- `fitsPoint` checks a shipment against a warehouse or postomat (weight, dimensions in any orientation, seats, declared value).
- `pickSettlement`, `splitRecipientName` and `parsePointFromAddress` move into the package.
- `Warehouse` gains `cityDescription` and `settlementDescription`; optional directory fields are `string | null` / `number | null` instead of `''` / `0`.
- Reads retry a per-attempt timeout (the deadline still bounds everything).
- Write mode never follows a redirect; a custom `fetch` must honour `redirect: 'manual'`.
- `DeliveryCarrier.track(documents, options?)` takes an abort signal.
- `deleteWaybill` treats Nova Poshta error `20000201173` (document not found or already deleted) as success.
- `errors` given by the API as an object (keyed by index or document ref, as in the already-deleted reply) are read like a list.
