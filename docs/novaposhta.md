# Nova Poshta API v2.0 — verified against developers.novaposhta.ua (2026-10-04)

Endpoint: POST https://api.novaposhta.ua/v2.0/json/
Envelope: { apiKey, modelName, calledMethod, methodProperties }
Response: { success, data[], errors[], warnings[], info, messageCodes[], errorCodes[], warningCodes[], infoCodes[] }
HTTP is always 200, even for logical errors: check `success` and `errors`.
All scalar params are strings in docs ("string[36]").

Official docs use *General model names: AddressGeneral, InternetDocumentGeneral, TrackingDocumentGeneral, CounterpartyGeneral.
Third-party SDKs still use Address / InternetDocument / TrackingDocument / Counterparty — verify live which ones the key accepts.

## AddressGeneral.searchSettlements
req: CityName*, Limit*, Page*
res: data[0] = { TotalCount, Addresses: [{ Present, Warehouses, MainDescription, Area, Region, SettlementTypeCode, Ref (settlement ref), DeliveryCity (city ref for getWarehouses/CityRecipient), AddressDeliveryAllowed, StreetsAvailability, ParentRegionTypes, ParentRegionCode, RegionTypes, RegionTypesCode }] }

## AddressGeneral.getWarehouses
req: FindByString, CityName, CityRef, SettlementRef, Ref, Page, Limit (max 500/page), Language (UA|RU), TypeOfWarehouseRef, WarehouseId, PostFinance, BicycleParking, POSTerminal
May answer HTTP 303 redirect to a cached file (city-dependent). Live probe 2026-10-04 with redirect:'manual': getWarehouses without filters and without Page/Limit answered 200, and with CityName 'Київ' answered 200, so no redirect was observed and no extra host. Redirect allowlist = api.novaposhta.ua only. The client follows 301/302/303 itself, at most 3 hops, with a body-less GET to https on that host; 307/308 and other hosts are refused.
Max 6500 records per response; paginate until empty data; NP recommends nightly refresh.
res: SiteKey, Description, ShortAddress, Phone, TypeOfWarehouse, Ref, Number, CityRef, CityDescription, SettlementRef, SettlementDescription, SettlementAreaDescription, SettlementRegionsDescription, SettlementTypeDescription, Longitude, Latitude, PostFinance, BicycleParking, PaymentAccess, POSTerminal, InternationalShipping, TotalMaxWeightAllowed, PlaceMaxWeightAllowed, SendingLimitationsOnDimensions{Width,Height,Length}, ReceivingLimitationsOnDimensions{...}, Reception{}, Delivery{}, Schedule{}, WarehouseStatus ("Working"), CategoryOfWarehouse ("Branch" | "Postomat" | ...), MaxDeclaredCost, DenyToSelect ("1" = cannot create document to/from it), PostMachineType, PostalCodeUA, OnlyReceivingParcel, WarehouseIndex ("101/102")

## AddressGeneral.getWarehouseTypes
req: {} ; res: [{ Ref, Description, DescriptionRu }]

## InternetDocumentGeneral.getDocumentPrice
req: CitySender*, CityRecipient*, Weight* (min 0.1), ServiceType*, Cost* (int, default min 300), CargoType* (Cargo|Documents|TiresWheels|Pallet; Parcel for postomat), SeatsAmount*, RedeliveryCalculate{CargoType,Amount}, PackCount, PackRef, Amount, CargoDetails[], OptionsSeat[{weight, volumetricWidth, volumetricLength, volumetricHeight, packRef}]
res: [{ AssessedCost, Cost, CostRedelivery, TZoneInfo{TzoneName,TzoneID}, CostPack }]

## InternetDocumentGeneral.save (by refs)
req: PayerType* (Sender|Recipient|ThirdPerson), PaymentMethod* (Cash|NonCash), DateTime (dd.mm.yyyy, ≤ +3 months), CargoType*, VolumeGeneral (m³, min 0.0004, required if no OptionsSeat), Weight* (min 0.1), ServiceType* (DoorsDoors|DoorsWarehouse|WarehouseWarehouse|WarehouseDoors), SeatsAmount*, Description*, Cost*, CitySender*, Sender*, SenderAddress* (ref from counterparty addresses — for warehouse sending: sender warehouse ref), ContactSender*, SendersPhone*, CityRecipient*, Recipient*, RecipientAddress* (warehouse/postomat ref), ContactRecipient*, RecipientsPhone*, SenderWarehouseIndex, RecipientWarehouseIndex
Documents cargo: Weight only 0.1 | 0.5 | 1.
res: [{ Ref, CostOnSite, EstimatedDeliveryDate, IntDocNumber, TypeDocument }]

### to postomat
Same + OptionsSeat* [{volumetricVolume, volumetricWidth, volumetricLength, volumetricHeight, weight}].
Limits: CargoType Parcel|Documents only; Cost ≤ 29000; max 40×60×30 cm; ≤ 20 kg; exactly one seat. There is no WarehousePostomat service type: price and create with WarehouseWarehouse/DoorsWarehouse plus OptionsSeat.

### to warehouse "by string" (no recipient refs needed)
Sender refs as above + RecipientsPhone*, NewAddress* ("1"), RecipientCityName*, RecipientArea*, RecipientAreaRegions*, RecipientAddressName* (warehouse number), RecipientName* (full name), RecipientType* (PrivatePerson|Organization), SettlementType* (SettlementTypeCode from searchSettlements, e.g. "м."), OwnershipForm, RecipientContactName, EDRPOU (orgs).

Description limit observed live: <= 120 chars (120 accepted, 121 "Description too long"); the package enforces 1..120 after trim and whitespace collapsing (`validateShipmentDescription`, which returns the normalized text sent in the request).

Orphan rule (`mayHaveCreatedWaybill`): after a failed `InternetDocumentGeneral.save` a waybill may exist for `timeout`, `aborted`, `network`, `parse` and `http` with any status except 400-499; `validation`, `api` and `limit` mean none was created.

## InternetDocumentGeneral.delete
req: DocumentRefs* ; res: [{ Ref }]

## TrackingDocumentGeneral.getStatusDocuments
req: Documents*: [{ DocumentNumber, Phone? }] — up to 100 per call; Phone (sender or recipient) unlocks full data.
res fields used: Number, StatusCode, Status, ScheduledDeliveryDate, ActualDeliveryDate, RecipientDateTime, TrackingUpdateDate, WarehouseRecipient, DocumentCost, RefEW, ...
StatusCode:
 1 created by sender, not handed over
 2 deleted
 3 number not found
 4 in sender city (interregional) · 41 in city (local services)
 5 en route to recipient city
 6 in recipient city, expected at warehouse
 7 arrived at warehouse · 8 arrived (loaded into postomat)
 9 received · 10 received, money transfer pending · 11 received, money transfer paid out
 12 being packed by NP · 15 en route to Ukraine
 101 en route to recipient (courier)
 102 refused (sender created return) · 103 refused · 104 address changed · 105 storage terminated
 106 received and backward-delivery waybill created · 107 moved from PUDO to main warehouse
 111 failed delivery attempt · 112 delivery rescheduled by recipient · 124 destroyed by enemy attack

## CounterpartyGeneral.save (recipient, private person)
req: FirstName*, MiddleName*, LastName*, Phone*, Email, CounterpartyType* (PrivatePerson), CounterpartyProperty* (Recipient). Ukrainian only.
Limits observed live (2026-10-04, probes with an invalid phone so nothing was created): FirstName <= 25 chars ("FirstName too long" from 26), MiddleName <= 25 ("MiddleName too long" from 26), LastName has its own limit above 50 ("LastName too long" at 64). The binding constraint is the full name `${LastName} ${FirstName} ${MiddleName}` (single spaces) <= 50 chars: 16+16+16 (=50) accepted; 17+16+16, 30+15+4 and 36+10+4 rejected with "String too long". The docs' generic `string[36]` is wrong. Accepted counterparties cannot be deleted via API.
Package rule: last name first, then first name, then middle name; the middle name is dropped when it is over 25 or the full name is over 50, last and first names are never truncated (`fitRecipientName`).
res: [{ Ref, Description, FirstName, MiddleName, LastName, Counterparty, OwnershipForm, EDRPOU, CounterpartyType, ContactPerson: { data: [{ Ref, Description, ... }] } }]

## CounterpartyGeneral.getCounterparties
req: CounterpartyProperty* (Sender|Recipient|ThirdPerson), Page, FindByString
res: [{ Description, Ref, City, Counterparty, FirstName, LastName, MiddleName, OwnershipFormRef, OwnershipFormDescription, EDRPOU, CounterpartyType }]

## CounterpartyGeneral.getCounterpartyContactPersons
req: Ref* (counterparty), Page (≤100/page)
res: [{ Description, Ref, Phones, Email, LastName, FirstName, MiddleName }]
