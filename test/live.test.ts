import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NovaPoshtaCarrier } from '../src/novaposhta.js';

const keyFile = process.env.NOVAPOSHTA_API_KEY_FILE;
const waybillEnabled = process.env.NOVAPOSHTA_LIVE_WAYBILL === '1';

describe.skipIf(!keyFile)('Nova Poshta live', () => {
    const carrier = new NovaPoshtaCarrier({ apiKey: keyFile ? readFileSync(keyFile, 'utf8').trim() : 'unused', maxRetries: 5 });

    const kyiv = async () => {
        const [city] = await carrier.searchSettlements('київ', { limit: 1 });
        return city.cityRef as string;
    };

    it('searches settlements', async () => {
        const result = await carrier.searchSettlements('київ');
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]).toMatchObject({ name: 'Київ', type: 'м.' });
        expect(result[0].cityRef).toBeTruthy();
    });

    it('lists Kyiv warehouses including a postomat', async () => {
        const cityRef = await kyiv();
        const branches = await carrier.getWarehouses({ cityRef, page: 1, limit: 20 });
        expect(branches.length).toBe(20);
        const types = await carrier.getWarehouseTypes();
        const postomatType = types.find(t => t.description === 'Поштомат');
        expect(postomatType).toBeDefined();
        const postomats = await carrier.getWarehouses({ cityRef, typeRef: postomatType?.ref, page: 1, limit: 5 });
        expect(postomats.some(w => w.kind === 'postomat')).toBe(true);
        expect(postomats[0].receivingLimits).toEqual({ width: 40, height: 30, length: 60 });
    });

    it('prices Kyiv to Lviv', async () => {
        const [lviv] = await carrier.searchSettlements('львів', { limit: 1 });
        const price = await carrier.getDocumentPrice({
            citySender: await kyiv(),
            cityRecipient: lviv.cityRef as string,
            weightGrams: 1000,
            serviceType: 'WarehouseWarehouse',
            declaredValueMinor: 50000,
            seatsAmount: 1,
            cargoType: 'Cargo',
        });
        expect(Number.isInteger(price.costMinor)).toBe(true);
        expect(price.costMinor).toBeGreaterThan(0);
        expect(price.assessedCostMinor).toBe(50000);
    });

    it('reads the sender counterparty and its contact persons', async () => {
        const counterparties = await carrier.getSenderCounterparties();
        expect(counterparties).toHaveLength(1);
        const contacts = await carrier.getContactPersons(counterparties[0].ref);
        expect(contacts.length).toBeGreaterThan(0);
        expect(contacts[0].phones.length).toBeGreaterThan(0);
    });

    it('tracks an unknown number as not found', async () => {
        const [result] = await carrier.track([{ number: '20400000000000' }]);
        expect(result.status).toBe('not_found');
    });

    it('keeps input order when tracking several unknown numbers', async () => {
        const numbers = ['20400000000002', '20400000000001', '20400000000003'];
        const results = await carrier.track(numbers.map(number => ({ number })));
        expect(results.map(r => r.number)).toEqual(numbers);
    });

    it('pages through every Kyiv point and parses required fields', async () => {
        const points = await carrier.getWarehouses({ cityRef: await kyiv() });
        expect(points.length).toBeGreaterThan(500);
        expect(new Set(points.map(p => p.ref)).size).toBe(points.length);
    }, 60_000);

    it.skipIf(!waybillEnabled)('creates a waybill to a Lviv warehouse and deletes it immediately', async () => {
        const [counterparty] = await carrier.getSenderCounterparties();
        const [contact] = await carrier.getContactPersons(counterparty.ref);
        const kyivRef = await kyiv();
        const kyivWarehouse = (await carrier.getWarehouses({ cityRef: kyivRef, page: 1, limit: 20 })).find(w => w.kind === 'warehouse' && !w.denyToSelect);
        const [lviv] = await carrier.searchSettlements('львів', { limit: 1 });
        const lvivWarehouse = (await carrier.getWarehouses({ cityRef: lviv.cityRef as string, page: 1, limit: 20 })).find(w => w.kind === 'warehouse' && !w.denyToSelect);
        expect(kyivWarehouse).toBeDefined();
        expect(lvivWarehouse).toBeDefined();

        const recipient = await carrier.createPrivateRecipient({ firstName: 'Тест', middleName: 'Тестович', lastName: 'Тестенко', phone: '380501112233' });
        let waybill: Awaited<ReturnType<typeof carrier.createWaybill>> | undefined;
        try {
            waybill = await carrier.createWaybill({
                payerType: 'Recipient',
                paymentMethod: 'Cash',
                cargoType: 'Cargo',
                serviceType: 'WarehouseWarehouse',
                weightGrams: 500,
                seatsAmount: 1,
                description: 'Тестове відправлення',
                declaredValueMinor: 30000,
                sender: {
                    cityRef: kyivRef,
                    counterpartyRef: counterparty.ref,
                    addressRef: kyivWarehouse!.ref,
                    contactRef: contact.ref,
                    phone: contact.phones[0],
                },
                recipient: {
                    cityRef: lviv.cityRef as string,
                    counterpartyRef: recipient.counterpartyRef,
                    addressRef: lvivWarehouse!.ref,
                    contactRef: recipient.contactRef,
                    phone: '380501112233',
                    pointKind: 'warehouse',
                },
            });
            expect(waybill.number).toMatch(/^\d{14}$/);
            expect(waybill.costMinor).toBeGreaterThan(0);
            console.info(`live waybill ${waybill.number} created, cost ${waybill.costMinor} kopiyky`);
        } finally {
            if (waybill) {
                const deleted = await carrier.deleteWaybill(waybill.ref);
                expect(deleted).toBe(waybill.ref);
                console.info(`live waybill ${waybill.number} deletion confirmed`);
            }
        }
    });
});
