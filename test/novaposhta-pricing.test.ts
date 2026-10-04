import { describe, expect, it } from 'vitest';
import { NovaPoshtaClient } from '../src/novaposhta-client.js';
import { getDocumentPrice } from '../src/novaposhta-pricing.js';
import { fixture, mockFetch, npOk } from './helpers.js';

const clientFor = (...replies: Parameters<typeof mockFetch>) => {
    const mock = mockFetch(...replies);
    return { client: new NovaPoshtaClient({ apiKey: 'k', fetch: mock.fetch, retryDelayMs: 0 }), calls: mock.calls };
};

const base = {
    citySender: 'kyiv',
    cityRecipient: 'lviv',
    weightGrams: 1000,
    serviceType: 'WarehouseWarehouse' as const,
    declaredValueMinor: 50000,
    seatsAmount: 1,
    cargoType: 'Cargo' as const,
};

describe('getDocumentPrice', () => {
    it('sends api fields and returns money in kopiyky', async () => {
        const { client, calls } = clientFor({ body: fixture('document-price-kyiv-lviv') });
        const price = await getDocumentPrice(client, base);
        expect(calls[0].body).toMatchObject({ modelName: 'InternetDocumentGeneral', calledMethod: 'getDocumentPrice' });
        expect(calls[0].body.methodProperties).toEqual({
            CitySender: 'kyiv',
            CityRecipient: 'lviv',
            Weight: '1',
            ServiceType: 'WarehouseWarehouse',
            Cost: '500',
            CargoType: 'Cargo',
            SeatsAmount: '1',
        });
        expect(price).toEqual({
            costMinor: 9000,
            assessedCostMinor: 50000,
            costRedeliveryMinor: null,
            costPackMinor: null,
            warnings: ['DateTime is set to current', 'CargoType is changed to Parcel'],
        });
    });

    it('converts grams up to tenths of kg and sends option seats in cm', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Cost: '45.50', AssessedCost: '300', CostRedelivery: '12', CostPack: 0 }]) });
        const price = await getDocumentPrice(client, {
            ...base,
            weightGrams: 20001,
            cargoType: 'Parcel',
            optionsSeat: [{ weightGrams: 20001, widthCm: 40, lengthCm: 60, heightCm: 30 }],
        });
        expect(calls[0].body.methodProperties.Weight).toBe('20.1');
        expect(calls[0].body.methodProperties.OptionsSeat).toEqual([
            { weight: '20.1', volumetricWidth: '40', volumetricLength: '60', volumetricHeight: '30' },
        ]);
        expect(price).toMatchObject({ costMinor: 4550, assessedCostMinor: 30000, costRedeliveryMinor: 1200, costPackMinor: 0 });
    });

    it('rounds the declared value up to whole hryvnia', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Cost: 1, AssessedCost: 1 }]) });
        await getDocumentPrice(client, { ...base, declaredValueMinor: 30001 });
        expect(calls[0].body.methodProperties.Cost).toBe('301');
    });

    it.each([
        ['weight', { weightGrams: 0 }],
        ['seats', { seatsAmount: 0 }],
        ['seats', { seatsAmount: 1.5 }],
        ['declared', { declaredValueMinor: -1 }],
        ['service', { serviceType: 'Teleport' as never }],
        ['cargo', { cargoType: 'Gold' as never }],
        ['seat', { optionsSeat: [{ weightGrams: 0, widthCm: 1, lengthCm: 1, heightCm: 1 }] }],
        ['postomat service type', { serviceType: 'WarehousePostomat' as never }],
        ['fractional dimension', { optionsSeat: [{ weightGrams: 1, widthCm: 1.5, lengthCm: 1, heightCm: 1 }] }],
        ['dimension', { optionsSeat: [{ weightGrams: 1, widthCm: 0, lengthCm: 1, heightCm: 1 }] }],
    ])('rejects invalid %s before calling the api', async (_name, patch) => {
        const { client, calls } = clientFor();
        await expect(getDocumentPrice(client, { ...base, ...patch })).rejects.toMatchObject({ name: 'NovaPoshtaError', kind: 'validation' });
        expect(calls).toHaveLength(0);
    });

    it('fails with a parse error when the reply has no price', async () => {
        const { client } = clientFor({ body: npOk([]) });
        await expect(getDocumentPrice(client, base)).rejects.toMatchObject({ kind: 'parse' });
    });

    it('prices a postomat shipment as WarehouseWarehouse with option seats', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Cost: '80', AssessedCost: '500' }]) });
        await getDocumentPrice(client, { ...base, cargoType: 'Parcel', optionsSeat: [{ weightGrams: 1000, widthCm: 20, lengthCm: 30, heightCm: 10 }] });
        expect(calls[0].body.methodProperties).toMatchObject({ ServiceType: 'WarehouseWarehouse', CargoType: 'Parcel' });
        expect(calls[0].body.methodProperties.OptionsSeat).toHaveLength(1);
    });

    it('retries a 5xx because it is a read', async () => {
        const { client, calls } = clientFor({ status: 500, body: '' }, { body: npOk([{ Cost: '10' }]) });
        expect((await getDocumentPrice(client, base)).costMinor).toBe(1000);
        expect(calls).toHaveLength(2);
    });

    it('is cancelled by an abort signal', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Cost: '10' }]) });
        await expect(getDocumentPrice(client, base, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
        expect(calls).toHaveLength(0);
    });

    it.each([{ AssessedCost: 1 }, { Cost: '', AssessedCost: 1 }, { Cost: null }])('fails with a parse error naming Cost for %j', async entry => {
        const { client } = clientFor({ body: npOk([entry]) });
        const error = await getDocumentPrice(client, base).catch(e => e);
        expect(error).toMatchObject({ kind: 'parse', modelName: 'InternetDocumentGeneral', calledMethod: 'getDocumentPrice' });
        expect(error.message).toContain('Cost');
    });

    it('fails with a parse error naming an optional field that is malformed', async () => {
        const { client } = clientFor({ body: npOk([{ Cost: '10', CostPack: 'x' }]) });
        const error = await getDocumentPrice(client, base).catch(e => e);
        expect(error).toMatchObject({ kind: 'parse' });
        expect(error.message).toContain('CostPack');
    });

    it('fails with a parse error when the cost is not a number', async () => {
        const { client } = clientFor({ body: npOk([{ Cost: 'abc', AssessedCost: 1 }]) });
        await expect(getDocumentPrice(client, base)).rejects.toMatchObject({ kind: 'parse' });
    });
});
