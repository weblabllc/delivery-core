import { describe, expect, it } from 'vitest';
import * as barrel from '../src/index.js';
import { NovaPoshtaCarrier } from '../src/novaposhta.js';
import { fixture, mockFetch, npOk } from './helpers.js';

describe('NovaPoshtaCarrier', () => {
    it('passes the abort signal of every operation to the client', async () => {
        const carrier = new NovaPoshtaCarrier({ apiKey: 'k', fetch: mockFetch().fetch });
        const signal = AbortSignal.abort();
        const party = { cityRef: 'a', counterpartyRef: 'b', addressRef: 'c', contactRef: 'd', phone: '0671112233' };
        const operations = [
            carrier.searchSettlements('київ', { signal }),
            carrier.getWarehouses({ signal }),
            carrier.getWarehouseTypes({ signal }),
            carrier.getSenderCounterparties({ signal }),
            carrier.getContactPersons('cp', { signal }),
            carrier.getDocumentPrice({ citySender: 'a', cityRecipient: 'b', weightGrams: 500, serviceType: 'WarehouseWarehouse', declaredValueMinor: 50000, seatsAmount: 1, cargoType: 'Cargo' }, { signal }),
            carrier.createPrivateRecipient({ firstName: 'A', middleName: 'B', lastName: 'C', phone: '0671112233' }, { signal }),
            carrier.createWaybill({ payerType: 'Recipient', paymentMethod: 'Cash', cargoType: 'Cargo', serviceType: 'WarehouseWarehouse', weightGrams: 500, seatsAmount: 1, description: 'x', declaredValueMinor: 50000, sender: party, recipient: { ...party, pointKind: 'warehouse' } }, { signal }),
            carrier.deleteWaybill('doc', { signal }),
            carrier.track([{ number: '1' }], { signal }),
        ];
        for (const operation of operations) {
            await expect(operation).rejects.toMatchObject({ kind: 'aborted' });
        }
    });

    it('binds every operation to one client', async () => {
        const { fetch, calls } = mockFetch(
            { body: fixture('search-settlements-kyiv') },
            { body: fixture('warehouses-kyiv') },
            { body: fixture('warehouse-types') },
            { body: fixture('sender-counterparties') },
            { body: fixture('contact-persons') },
            { body: fixture('document-price-kyiv-lviv') },
            { body: npOk([{ Ref: 'a', ContactPerson: { data: [{ Ref: 'b' }] } }]) },
            { body: npOk([{ Ref: 'doc', IntDocNumber: '1' }]) },
            { body: npOk([{ Ref: 'doc' }]) },
            { body: npOk([{ Number: '20400000000000', StatusCode: '3' }]) },
        );
        const carrier = new NovaPoshtaCarrier({ apiKey: 'k', fetch, retryDelayMs: 0 });
        expect(carrier.code).toBe('novaposhta');
        expect(await carrier.searchSettlements('київ')).not.toHaveLength(0);
        expect(await carrier.getWarehouses({ cityRef: 'c', page: 1, limit: 3 })).toHaveLength(3);
        expect(await carrier.getWarehouseTypes()).toHaveLength(5);
        expect(await carrier.getSenderCounterparties()).toHaveLength(1);
        expect(await carrier.getContactPersons('cp')).toHaveLength(1);
        expect((await carrier.getDocumentPrice({ citySender: 'a', cityRecipient: 'b', weightGrams: 500, serviceType: 'WarehouseWarehouse', declaredValueMinor: 50000, seatsAmount: 1, cargoType: 'Cargo' })).costMinor).toBe(9000);
        expect(await carrier.createPrivateRecipient({ firstName: 'A', middleName: 'B', lastName: 'C', phone: '0671112233' })).toEqual({ counterpartyRef: 'a', contactRef: 'b' });
        const party = { cityRef: 'a', counterpartyRef: 'b', addressRef: 'c', contactRef: 'd', phone: '0671112233' };
        expect((await carrier.createWaybill({ payerType: 'Recipient', paymentMethod: 'Cash', cargoType: 'Cargo', serviceType: 'WarehouseWarehouse', weightGrams: 500, seatsAmount: 1, description: 'x', declaredValueMinor: 50000, sender: party, recipient: { ...party, pointKind: 'warehouse' } })).number).toBe('1');
        expect(await carrier.deleteWaybill('doc')).toBe('doc');
        expect((await carrier.track([{ number: '20400000000000' }]))[0].status).toBe('not_found');
        expect(calls).toHaveLength(10);
    });
});

describe('barrel', () => {
    it('exposes the whole public surface', () => {
        for (const name of ['NovaPoshtaClient', 'NovaPoshtaError', 'NovaPoshtaCarrier', 'CarrierRegistry', 'mapNovaPoshtaStatus', 'track', 'getDocumentPrice', 'createWaybill', 'uahToKopiyky', 'DELIVERY_STATUSES']) {
            expect(barrel).toHaveProperty(name);
        }
    });
});
