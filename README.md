# @weblabllc/delivery-core

[![npm](https://img.shields.io/npm/v/@weblabllc/delivery-core)](https://www.npmjs.com/package/@weblabllc/delivery-core) [![ci](https://github.com/weblabllc/delivery-core/actions/workflows/ci.yml/badge.svg)](https://github.com/weblabllc/delivery-core/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/@weblabllc/delivery-core)](LICENSE)

Framework-free delivery layer for Ukrainian e-commerce: a carrier-neutral `DeliveryCarrier` interface and a complete Nova Poshta client (directories, pricing, waybills, tracking). All carrier rules live in the package: phone normalization, grams to kilograms, postomat limits, status mapping. Zero framework imports.

## Install

```bash
npm install @weblabllc/delivery-core
```

Pure ESM, Node >= 22.12. CommonJS consumers can `require()` it, which relies on `require(esm)` and therefore needs Node >= 22.12 (the package has no top-level await).

## Enable only what you need

```ts
import { CarrierRegistry } from '@weblabllc/delivery-core/registry'

const carriers = CarrierRegistry.create({ carriers: [{ type: 'novaposhta', apiKey: '...' }] })
carriers.get('novaposhta').track([{ number: '20450000000000' }])
carriers.get('dhl') // throws: not enabled
```

Custom carriers implementing `DeliveryCarrier` are passed as `{ type: 'custom', carrier }` next to builtin ones. The `type` tag selects the carrier; unknown builtin types throw.

## Nova Poshta

```ts
import { NovaPoshtaCarrier } from '@weblabllc/delivery-core/novaposhta'

const np = new NovaPoshtaCarrier({ apiKey: '...' })
```

Inputs use raw units: grams, centimetres, kopiyky (minor units). The package converts: weight is rounded up to 0.1 kg (never below the real weight), declared value is rounded up to whole hryvnia, money in replies is returned as integer kopiyky without float errors.

### Directories

```ts
const [kyiv] = await np.searchSettlements('київ', { page: 1, limit: 20 })
const points = await np.getWarehouses({ cityRef: kyiv.cityRef!, query: '12' })
points[0].kind // 'warehouse' | 'postomat'
await np.getWarehouseTypes()
const [sender] = await np.getSenderCounterparties()
const [contact] = await np.getContactPersons(sender.ref)
```

Optional fields are `string | null` (and `number | null`), never `''` or `0` placeholders: `Warehouse.cityRef`, `cityDescription`, `settlementRef`, `settlementDescription`, `typeRef`, `category`, `index`, `shortAddress`; `Settlement.present`, `area`, `region`, `type`, `warehouses`; `ContactPerson` names and `email`.

`getWarehouses` without `page` and `limit` pages through the whole result (500 per page, at most 50 pages; more throws a `limit` error instead of truncating). Entries are deduplicated by `Ref`. `maxWeightKg` is `PlaceMaxWeightAllowed` when it is above 0, else `TotalMaxWeightAllowed` when above 0, else `null` (no known limit); `receivingLimits` is in centimetres. Entries without `Ref`, `Number` or `Description` fail with a `parse` error naming the field.

`pickSettlement(text, candidates)` resolves a city name to one settlement: case, spacing and apostrophe variants (`'`, `’`, `ʼ`, backtick) are ignored, only an exact name match counts, candidates without a `cityRef` are skipped, and when several match the one that has warehouses wins. It returns `null` when nothing matches or the match is ambiguous.

### Recipient helpers

```ts
splitRecipientName('Петренко Іван Іванович')
splitRecipientName('Іван Петренко', { firstName: 'Іван', lastName: 'Петренко' })
parsePointFromAddress(['вул. Шевченка 1', 'Відділення №12'])
parsePointFromAddress('Поштомат 1234')
```

The results are `{ lastName: 'Петренко', firstName: 'Іван', middleName: 'Іванович' }`, the same object for the hinted `'Іван Петренко'` (the hint fixes the order), `{ kind: 'warehouse', number: '12' }` and `{ kind: 'postomat', number: '1234' }`.

`splitRecipientName` uses Ukrainian order (last, first, middle); the optional hint is matched case-insensitively and also supplies the names when the text is empty. `parsePointFromAddress` takes a string or a list of lines, understands `Відділення №12`, `відд. 3`, `Поштомат 1234`, `Postomat #55`, `Branch N 9`, and prefers a postomat mention over a warehouse one.

### Shipment

```ts
const shipment = buildShipment({
  lines: [{ weightGrams: 400, widthCm: 15, lengthCm: 22, heightCm: 3, quantity: 2 }],
  declaredValueMinor: 50000,
  point: { kind: 'postomat' },
})
await np.getDocumentPrice({ citySender, cityRecipient, ...shipment })
await np.createWaybill({ payerType, paymentMethod, description, sender, recipient, ...shipment })
fitsPoint(warehouse, shipment)

const edited = buildShipmentFromSeats({
  seats: shipment.optionsSeat,
  declaredValueMinor: 50000,
  point: { kind: 'warehouse' },
})
```

`buildShipment` returns `{ cargoType: 'Parcel', serviceType: 'WarehouseWarehouse', weightGrams: 800, seatsAmount: 1, optionsSeat, declaredValueMinor: 50000 }`; `fitsPoint` returns for example `{ fits: false, reasons: ['weight'] }`.

`buildShipment` is the one source for the tariff and the waybill, so both are computed from identical weight, seats and dimensions. Units are expanded from the lines (`weightGrams` and the dimensions are per unit) and spread over `seats` (default 1, at most the number of units; the largest units first onto the lowest stack). A seat takes the widest footprint of its units and the sum of their heights (units are stacked); its weight is the sum of the unit weights, so the seat weights always add up to `weightGrams`. For `point.kind: 'postomat'` the rules are applied up front: one seat, at most 20 kg, declared value at most 29000 UAH, and the seat must fit 40 x 60 x 30 cm in some orientation, in which case it is oriented as width <= 40, length <= 60, height <= 30. Anything invalid throws `kind: 'validation'` before any request. Line weights are whole grams, dimensions whole centimetres, quantities positive integers, the declared value a positive integer in kopiyky. The sum of the quantities is capped at 1000 (`MAX_SHIPMENT_UNITS`) and checked before the units are expanded; `seats` is validated against that sum.

`buildShipmentFromSeats({ seats, declaredValueMinor, point })` builds the same `Shipment` from explicit seats (`{ weightGrams, widthCm, lengthCm, heightCm }`, whole grams and centimetres, 1 to 1000 seats) without splitting anything, for a form where an operator edits the seats. The seats are kept as given, the postomat rules and orientation are applied exactly as in `buildShipment`, and the result is accepted by `getDocumentPrice` and `createWaybill`, so the waybill seats equal the tariff seats.

`fitsPoint(point, shipment)` checks a built shipment against a concrete directory entry and returns `{ fits, reasons }` with reasons from `'weight' | 'dimensions' | 'seats' | 'declaredValue'`. Each seat is compared with `maxWeightKg` (rounded up to 0.1 kg like the waybill) and with `receivingLimits` in any orientation; limits that are `null` are not checked. A postomat is additionally held to the built-in postomat rules, so the stricter of the two applies. `maxWeightKg` is the per-place limit when the API gives one and the total limit otherwise; it is applied per seat.

### Pricing

```ts
const price = await np.getDocumentPrice({
  citySender: kyivCityRef, cityRecipient: lvivCityRef, weightGrams: 1200,
  serviceType: 'WarehouseWarehouse', declaredValueMinor: 50000, seatsAmount: 1, cargoType: 'Cargo',
})
price.costMinor // 9000
```

Spread the result of `buildShipment` into the input to keep the tariff identical to the waybill. To price a postomat shipment use `serviceType: 'WarehouseWarehouse'` (or `'DoorsWarehouse'`) with `cargoType: 'Parcel'` and `optionsSeat`; there is no `WarehousePostomat` service type and it is rejected with a `validation` error.

### Waybills

```ts
const recipient = await np.createPrivateRecipient({ firstName: 'Іван', middleName: 'Іванович', lastName: 'Петренко', phone: '+380 50 111 22 33' })
const waybill = await np.createWaybill({
  payerType: 'Recipient', paymentMethod: 'Cash', cargoType: 'Parcel', serviceType: 'WarehouseWarehouse',
  weightGrams: 2000, seatsAmount: 1, description: 'Книги', declaredValueMinor: 50000,
  optionsSeat: [{ weightGrams: 2000, widthCm: 30, lengthCm: 40, heightCm: 10 }],
  sender: { cityRef, counterpartyRef, addressRef: senderWarehouseRef, contactRef, phone },
  recipient: { cityRef, ...recipient, counterpartyRef: recipient.counterpartyRef, addressRef: postomat.ref, phone, pointKind: postomat.kind },
})
await np.deleteWaybill(waybill.ref)
```

`recipient.pointKind` (`'warehouse'` or `'postomat'`) is required. `createWaybill` returns `{ ref, number, costMinor, estimatedDeliveryDate, warnings }`. The shipment date must be today or later (Kyiv time) and at most three calendar months ahead; pass `{ now }` as the third argument to fix the clock in tests. Volume is sent exactly (`cm3 / 1e6`, six decimals), with a floor of 0.0004 m3 for `VolumeGeneral`. Dimensions are whole centimetres and `declaredValueMinor` must be positive. `deleteWaybill` fails with an `api` error unless the reply echoes the deleted `Ref`. A document that is already deleted or does not exist is treated as deleted: Nova Poshta answers `No document changed DeletionMark` with error code `20000201173` (observed live), and when that is the only error code `deleteWaybill` resolves with the ref, so a retried cancellation is idempotent. Other errors, including `20000200564` (`There are only invalid DocumentBarcodes and/or DocumentRefs`, an invalid ref), still throw.

Validation runs before any request, in this order: generic fields, seats and options, postomat rules. Phone normalized to `380XXXXXXXXX`, weight at least 0.1 kg, `Documents` weight only 0.1 / 0.5 / 1 kg. With `pointKind: 'postomat'`: cargo `Parcel` or `Documents`, exactly one seat with `optionsSeat`, width <= 40, length <= 60, height <= 30 cm, <= 20 kg, declared value <= 29000 UAH.

### Limits and failures

```ts
const fitted = fitRecipientName({ lastName: 'Петренко', firstName: 'Іван', middleName: 'Іванович' })
validateShipmentDescription('Книги')
try { await np.createWaybill(input) } catch (error) { if (mayHaveCreatedWaybill(error)) { /* look the waybill up before retrying */ } }
```

Nova Poshta limits, measured live: first and middle name up to 25 characters, full name `last first middle` up to 50 characters, description up to 120. `fitRecipientName` never truncates the last or first name (a `validation` error if they do not fit) and drops the middle name when it does not fit, reporting `middleNameDropped`; `createPrivateRecipient` applies it. `createWaybill` validates the description (1..120 after trim and whitespace collapsing). `mayHaveCreatedWaybill(error)` is true for `timeout`, `aborted`, `network`, `parse` and any `http` error except status 400-499, when the waybill may exist despite the failure; `validation`, `api` and `limit` are false. Constants: `NP_FIRST_NAME_MAX`, `NP_MIDDLE_NAME_MAX`, `NP_FULL_NAME_MAX`, `NP_DESCRIPTION_MAX`.

### Tracking

```ts
const [status] = await np.track([{ number: '20450000000000', phone: '0501112233' }])
status.status // 'created' | 'in_transit' | 'arrived' | 'delivered' | 'refused' | 'returning' | 'cancelled' | 'lost' | 'not_found' | 'unknown'
```

`track(documents, { signal })` accepts an abort signal, on the carrier and on the carrier-neutral `DeliveryCarrier` interface alike. Up to 100 documents per request; longer lists are batched automatically. Results come back in input order with one entry per requested number; a number the API does not answer gets `status: 'unknown'` with an empty `statusCode`. An invalid `phone` is dropped for that document only. Without `phone` Nova Poshta returns reduced data. Date fields are the carrier's raw strings (formats differ per field). The status table is also available on its own:

```ts
import { mapNovaPoshtaStatus } from '@weblabllc/delivery-core/novaposhta-status'
```

### Errors

Every failure is a `NovaPoshtaError` with `kind` (`'validation' | 'http' | 'network' | 'api' | 'timeout' | 'aborted' | 'parse' | 'limit'`), `errors`, `errorCodes`, `warnings`, `modelName` and `calledMethod`. Input validation throws `kind: 'validation'`. The API key never appears in an error, and error text is truncated to 2000 characters.

Client options:

| Option | Default | Rule |
| --- | --- | --- |
| `baseUrl` | `https://api.novaposhta.ua/v2.0/json/` | only `https://api.novaposhta.ua/...`, plus `http://localhost` and `http://127.0.0.1` for tests; anything else throws |
| `timeoutMs` | 20000 | per attempt; on reads a timed out attempt is retried |
| `deadlineMs` | 45000 | bounds all attempts and sleeps together |
| `maxRetries` | 2 | integer 0..5 |
| `retryDelayMs` | 600 | integer 0..10000, doubled per attempt with jitter, capped at 10 s |
| `maxResponseBytes` | 20 MiB | larger replies fail with `http` |

Every operation accepts `{ signal }`. An external abort gives `kind: 'aborted'`, the deadline or a request timeout gives `kind: 'timeout'`.

Retries: the rate-limit reply (code `20000401501`) is retried for every method. Reads (directories, pricing, tracking) are also retried on 5xx, network errors and per-attempt timeouts (the overall `deadlineMs` still ends everything, and an external abort is never retried). `InternetDocumentGeneral.save`, `CounterpartyGeneral.save` and `delete` are never retried on 5xx or network errors. If a write reply has `success: true` but a non-empty `errors` list it is an `api` error; for reads the data is kept and the errors are appended to `warnings`.

Redirects are never followed automatically. In read mode a 301, 302 or 303 is followed (at most 3 hops) with a body-less GET only to an `https:` URL on `api.novaposhta.ua`, so the key never leaves; 307, 308 and any other host or protocol fail with `kind: 'http'`. In write mode (`InternetDocumentGeneral.save`, `CounterpartyGeneral.save`, `delete`) any redirect fails with `kind: 'http'` and is not followed, so a write is never replayed.

A custom `fetch` option must honour `redirect: 'manual'` (return the 3xx response instead of following it); the client relies on that for both rules above. A `fetch` that follows redirects on its own would bypass them.

## Subpaths

| Import | Contents |
| --- | --- |
| `@weblabllc/delivery-core` | everything |
| `@weblabllc/delivery-core/delivery` | carrier-neutral types and statuses |
| `@weblabllc/delivery-core/registry` | `CarrierRegistry` |
| `@weblabllc/delivery-core/novaposhta` | Nova Poshta client, carrier and operations |
| `@weblabllc/delivery-core/novaposhta-status` | status code mapping only (lightweight import) |

The verified Nova Poshta API reference is in `docs/novaposhta.md` (repository only).

## Live test

```bash
NOVAPOSHTA_API_KEY_FILE=/path/to/key.txt npx vitest run test/live.test.ts
NOVAPOSHTA_LIVE_WAYBILL=1 ...   # also creates one waybill and deletes it in a finally block
```
