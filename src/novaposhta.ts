import type { DeliveryCarrier, TrackingRequest, TrackingResult } from './delivery.js';
import { NovaPoshtaClient, NovaPoshtaClientOptions, RequestOptions } from './novaposhta-client.js';
import {
    ContactPerson,
    getContactPersons,
    getSenderCounterparties,
    getWarehouses,
    getWarehouseTypes,
    PageOptions,
    searchSettlements,
    SenderCounterparty,
    Settlement,
    Warehouse,
    WarehouseQuery,
    WarehouseType,
} from './novaposhta-directories.js';
import { DocumentPrice, DocumentPriceInput, getDocumentPrice } from './novaposhta-pricing.js';
import { track } from './novaposhta-tracking.js';
import {
    createPrivateRecipient,
    createWaybill,
    CreateWaybillOptions,
    deleteWaybill,
    PrivateRecipient,
    PrivateRecipientInput,
    Waybill,
    WaybillInput,
} from './novaposhta-waybill.js';

export * from './money.js';
export * from './novaposhta-client.js';
export * from './novaposhta-directories.js';
export * from './novaposhta-phone.js';
export * from './novaposhta-recipient.js';
export * from './novaposhta-shipment.js';
export * from './novaposhta-pricing.js';
export * from './novaposhta-status.js';
export * from './novaposhta-tracking.js';
export * from './novaposhta-units.js';
export * from './novaposhta-waybill.js';

export class NovaPoshtaCarrier implements DeliveryCarrier {
    readonly code = 'novaposhta';
    readonly client: NovaPoshtaClient;

    constructor(options: NovaPoshtaClientOptions) {
        this.client = new NovaPoshtaClient(options);
    }

    searchSettlements(query: string, options?: PageOptions): Promise<Settlement[]> {
        return searchSettlements(this.client, query, options);
    }

    getWarehouses(query?: WarehouseQuery): Promise<Warehouse[]> {
        return getWarehouses(this.client, query);
    }

    getWarehouseTypes(options?: RequestOptions): Promise<WarehouseType[]> {
        return getWarehouseTypes(this.client, options);
    }

    getSenderCounterparties(options?: RequestOptions): Promise<SenderCounterparty[]> {
        return getSenderCounterparties(this.client, options);
    }

    getContactPersons(counterpartyRef: string, options?: RequestOptions): Promise<ContactPerson[]> {
        return getContactPersons(this.client, counterpartyRef, options);
    }

    getDocumentPrice(input: DocumentPriceInput, options?: RequestOptions): Promise<DocumentPrice> {
        return getDocumentPrice(this.client, input, options);
    }

    createPrivateRecipient(input: PrivateRecipientInput, options?: RequestOptions): Promise<PrivateRecipient> {
        return createPrivateRecipient(this.client, input, options);
    }

    createWaybill(input: WaybillInput, options?: CreateWaybillOptions): Promise<Waybill> {
        return createWaybill(this.client, input, options);
    }

    deleteWaybill(ref: string, options?: RequestOptions): Promise<string> {
        return deleteWaybill(this.client, ref, options);
    }

    track(documents: TrackingRequest[], options?: RequestOptions): Promise<TrackingResult[]> {
        return track(this.client, documents, options);
    }
}
