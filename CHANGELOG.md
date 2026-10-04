# Changelog

## 0.3.0 — 2026-10-04

- `NovaPoshtaError` gains optional `field`, `code` (`NovaPoshtaValidationCode`) and `limit`, set on every `validation` error the package throws (limits, units, money, phone, waybill input, shipment builders, pricing input, directories paging and query, client options). English messages are unchanged.
- New exports `NOVAPOSHTA_VALIDATION_CODES` and the `NovaPoshtaValidationCode` type: `required`, `too_long`, `too_short`, `too_small`, `too_large`, `invalid_type`, `invalid_format`, `not_integer`, `not_allowed`, `too_many`, `does_not_fit`, `mismatch`. `limit` is an own property only when meaningful: never for `required`, `invalid_type`, `invalid_format`, `not_integer`, `not_allowed`; the inclusive bound in the unit of the field for the rest (see the README table).
- Optional trailing parameters for the field name: `normalizePhone(raw, field)`, `uahToKopiyky(value, field)`, `kopiykyToUah(minor, field)`, `kopiykyToWholeUahCeil(minor, field)`, `gramsToKg(grams, field)`, `assertSeatsAmount(value, field)`, `assertSeat(seat, path)`, `seatToApi(seat, path)`. Existing calls behave as before, but do not pass these helpers directly as `Array` callbacks (`forEach(assertSeat)`, `map(seatToApi)`): the index would be taken as the new parameter.
- Waybill and pricing seat errors now name the seat (`optionsSeat[1].widthCm`).

## 0.2.0 — 2026-10-04

- `mayHaveCreatedWaybill(error)`: true for `timeout`, `aborted`, `network`, `parse` and any `http` error except status 400-499 (a 2xx with an unreadable body, a refused 3xx, a missing status or a 5xx all mean the request may have reached Nova Poshta); false for `validation`, `api` and `limit` (`limit` is only thrown by read-only directory pagination).
- `fitRecipientName` trims and collapses spaces and drops the middle name when it is over 25 characters or the full name is over 50; last and first names are never truncated (`validation` error if they do not fit). Returns `middleNameDropped`. `createPrivateRecipient` applies it before the request.
- `validateShipmentDescription` (1..120 characters after trim and whitespace collapsing, returns the normalized text), applied by `createWaybill` before any request.
- Constants `NP_FIRST_NAME_MAX` (25), `NP_MIDDLE_NAME_MAX` (25), `NP_FULL_NAME_MAX` (50), `NP_DESCRIPTION_MAX` (120), measured against the live API.
- Behaviour change: descriptions over 120 characters and names whose last and first parts exceed 50 characters together now fail locally with a `validation` error.

## 0.1.1 — 2026-10-04

- Republished from CI with npm provenance. No code changes since 0.1.0.

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
