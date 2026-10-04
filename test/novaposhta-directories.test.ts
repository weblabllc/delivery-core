import { describe, expect, it } from 'vitest';
import { NovaPoshtaClient, NovaPoshtaError } from '../src/novaposhta-client.js';
import {
    getContactPersons,
    getSenderCounterparties,
    getWarehouses,
    getWarehouseTypes,
    searchSettlements,
} from '../src/novaposhta-directories.js';
import { fixture, mockFetch, npOk } from './helpers.js';

const wh = (ref: string, extra: Record<string, unknown> = {}) => ({ Ref: ref, Number: '1', Description: `Відділення ${ref}`, CategoryOfWarehouse: 'Branch', ...extra });

const clientFor = (...replies: Parameters<typeof mockFetch>) => {
    const mock = mockFetch(...replies);
    return { client: new NovaPoshtaClient({ apiKey: 'k', fetch: mock.fetch, retryDelayMs: 0 }), calls: mock.calls };
};

describe('searchSettlements', () => {
    it('maps settlements and sends paging', async () => {
        const { client, calls } = clientFor({ body: fixture('search-settlements-kyiv') });
        const result = await searchSettlements(client, 'київ', { page: 2, limit: 3 });
        expect(calls[0].body).toMatchObject({
            modelName: 'AddressGeneral',
            calledMethod: 'searchSettlements',
            methodProperties: { CityName: 'київ', Page: '2', Limit: '3' },
        });
        expect(result.length).toBeGreaterThan(1);
        expect(result[0]).toEqual({
            settlementRef: 'e718a680-4b33-11e4-ab6d-005056801329',
            cityRef: '8d5a980d-391c-11dd-90d9-001a92567626',
            name: 'Київ',
            present: 'м. Київ, Київська обл.',
            area: 'Київська',
            region: null,
            type: 'м.',
            warehouses: 12666,
        });
    });

    it('defaults to page 1 and limit 20', async () => {
        const { client, calls } = clientFor({ body: npOk([{ TotalCount: 0, Addresses: [] }]) });
        expect(await searchSettlements(client, ' львів ')).toEqual([]);
        expect(calls[0].body.methodProperties).toEqual({ CityName: 'львів', Page: '1', Limit: '20' });
    });

    it('returns nothing without calling the api for a blank query', async () => {
        const { client, calls } = clientFor();
        expect(await searchSettlements(client, '   ')).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it('returns an empty list when data is empty', async () => {
        const { client } = clientFor({ body: npOk([]) });
        expect(await searchSettlements(client, 'x')).toEqual([]);
    });

    it('keeps settlements without a delivery city with a null city ref', async () => {
        const { client } = clientFor({ body: npOk([{ Addresses: [{ Ref: 'a', MainDescription: 'A' }] }]) });
        const [s] = await searchSettlements(client, 'a');
        expect(s).toEqual({ settlementRef: 'a', cityRef: null, name: 'A', present: null, area: null, region: null, type: null, warehouses: null });
    });

    it('fails with a parse error on a malformed address entry', async () => {
        const { client } = clientFor({ body: npOk([{ Addresses: ['oops'] }]) });
        await expect(searchSettlements(client, 'a')).rejects.toMatchObject({ kind: 'parse' });
    });

    it('returns nothing for a blank query before validating paging', async () => {
        const { client, calls } = clientFor();
        expect(await searchSettlements(client, '  ', { page: 0, limit: 9999 })).toEqual([]);
        expect(await searchSettlements(client, '')).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it('rejects a non-string query as a validation error', async () => {
        const { client } = clientFor();
        await expect(searchSettlements(client, undefined as never)).rejects.toMatchObject({ kind: 'validation' });
    });

    it('fails with a parse error naming the field when a settlement has no ref or name', async () => {
        const { client } = clientFor({ body: npOk([{ Addresses: [{ MainDescription: 'A' }] }]) }, { body: npOk([{ Addresses: [{ Ref: 'a' }] }]) });
        const first = await searchSettlements(client, 'a').catch(e => e);
        expect(first).toMatchObject({ kind: 'parse', modelName: 'AddressGeneral', calledMethod: 'searchSettlements' });
        expect(first.message).toContain('Ref');
        const second = await searchSettlements(client, 'a').catch(e => e);
        expect(second.message).toContain('MainDescription');
    });

    it('retries a 5xx because it is a read', async () => {
        const { client, calls } = clientFor({ status: 500, body: '' }, { body: npOk([]) });
        expect(await searchSettlements(client, 'a')).toEqual([]);
        expect(calls).toHaveLength(2);
    });

    it('is cancelled by an abort signal', async () => {
        const { client, calls } = clientFor({ body: npOk([]) });
        await expect(searchSettlements(client, 'a', { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
        expect(calls).toHaveLength(0);
    });

    it('rejects out of range paging', async () => {
        const { client } = clientFor();
        await expect(searchSettlements(client, 'a', { page: 0 })).rejects.toMatchObject({ name: 'NovaPoshtaError', kind: 'validation' });
        await expect(searchSettlements(client, 'a', { page: 0 })).rejects.toThrow(/page/);
        await expect(searchSettlements(client, 'a', { limit: 0 })).rejects.toThrow(/limit/);
        await expect(searchSettlements(client, 'a', { limit: 501 })).rejects.toThrow(/limit/);
    });
});

describe('getWarehouses', () => {
    it('normalizes a branch', async () => {
        const { client, calls } = clientFor({ body: fixture('warehouses-kyiv') });
        const result = await getWarehouses(client, { cityRef: 'city', page: 1, limit: 3 });
        expect(calls[0].body.methodProperties).toEqual({ CityRef: 'city', Page: '1', Limit: '3' });
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({
            ref: expect.any(String),
            number: '1',
            cityRef: expect.any(String),
            settlementRef: expect.any(String),
            typeRef: '9a68df70-0267-42a8-bb5c-37f427e36ee4',
            category: 'Branch',
            kind: 'warehouse',
            index: '11/1',
            cityDescription: 'Київ',
            settlementDescription: 'Київ',
            maxWeightKg: 1100,
            denyToSelect: false,
            receivingLimits: { width: 220, height: 220, length: 600 },
        });
    });

    it('uses null instead of empty defaults for fields the api omits', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'r', Number: '5', Description: 'Відділення №5', CityRef: '', SettlementRef: '  ', PlaceMaxWeightAllowed: '0', TotalMaxWeightAllowed: '0' }]) });
        const [w] = await getWarehouses(client, { cityRef: 'c', page: 1, limit: 1 });
        expect(w).toEqual({
            ref: 'r',
            number: '5',
            description: 'Відділення №5',
            shortAddress: null,
            cityRef: null,
            cityDescription: null,
            settlementRef: null,
            settlementDescription: null,
            typeRef: null,
            category: null,
            kind: 'warehouse',
            index: null,
            maxWeightKg: null,
            denyToSelect: false,
            receivingLimits: null,
        });
    });

    it('normalizes a postomat', async () => {
        const { client } = clientFor({ body: fixture('postomats-kyiv') });
        const [postomat] = await getWarehouses(client, { cityRef: 'city', page: 1, limit: 2 });
        expect(postomat).toMatchObject({
            kind: 'postomat',
            category: 'Postomat',
            number: '1001',
            index: '11/1001',
            maxWeightKg: 20,
            receivingLimits: { width: 40, height: 30, length: 60 },
            shortAddress: expect.stringContaining('Київ'),
            denyToSelect: false,
        });
    });

    it('maps every filter to its api field', async () => {
        const { client, calls } = clientFor({ body: npOk([]) });
        await getWarehouses(client, { cityRef: 'c', settlementRef: 's', query: 'q', number: '5', typeRef: 't', page: 3, limit: 10 });
        expect(calls[0].body.methodProperties).toEqual({
            CityRef: 'c',
            SettlementRef: 's',
            FindByString: 'q',
            WarehouseId: '5',
            TypeOfWarehouseRef: 't',
            Page: '3',
            Limit: '10',
        });
    });

    it('marks warehouses that cannot be selected', async () => {
        const { client } = clientFor({ body: npOk([wh('w', { DenyToSelect: '1' })]) });
        const [w] = await getWarehouses(client, { page: 1 });
        expect(w.denyToSelect).toBe(true);
        expect(w.maxWeightKg).toBeNull();
        expect(w.receivingLimits).toBeNull();
    });

    it('paginates by 500 until a short page when no page is requested', async () => {
        const full = Array.from({ length: 500 }, (_, i) => (wh(`a${i}`)));
        const tail = Array.from({ length: 7 }, (_, i) => (wh(`b${i}`)));
        const { client, calls } = clientFor({ body: npOk(full) }, { body: npOk(tail) });
        const result = await getWarehouses(client, { cityRef: 'c' });
        expect(result).toHaveLength(507);
        expect(calls.map(c => c.body.methodProperties.Page)).toEqual(['1', '2']);
        expect(calls[0].body.methodProperties.Limit).toBe('500');
    });

    it('stops on an empty page', async () => {
        const full = Array.from({ length: 500 }, (_, i) => (wh(`a${i}`)));
        const { client, calls } = clientFor({ body: npOk(full) }, { body: npOk([]) });
        expect(await getWarehouses(client, {})).toHaveLength(500);
        expect(calls).toHaveLength(2);
    });

    it('does not loop when the api answers with a cached file larger than the page', async () => {
        const file = Array.from({ length: 800 }, (_, i) => (wh(`a${i}`)));
        const { client, calls } = clientFor({ body: npOk(file) });
        expect(await getWarehouses(client, {})).toHaveLength(800);
        expect(calls).toHaveLength(1);
    });

    it.each([
        ['Ref', { Number: '1', Description: 'd' }],
        ['Number', { Ref: 'r', Description: 'd' }],
        ['Description', { Ref: 'r', Number: '1' }],
        ['Ref', { Ref: '', Number: '1', Description: 'd' }],
    ])('fails with a parse error naming %s when it is missing', async (field, entry) => {
        const { client } = clientFor({ body: npOk([entry]) });
        const error = await getWarehouses(client, { page: 1 }).catch(e => e);
        expect(error).toMatchObject({ kind: 'parse', modelName: 'AddressGeneral', calledMethod: 'getWarehouses' });
        expect(error.message).toContain(field);
    });

    it.each([
        [{ PlaceMaxWeightAllowed: '0', TotalMaxWeightAllowed: '0' }, null],
        [{ PlaceMaxWeightAllowed: '0', TotalMaxWeightAllowed: '30' }, 30],
        [{ PlaceMaxWeightAllowed: '20', TotalMaxWeightAllowed: '30' }, 20],
        [{ PlaceMaxWeightAllowed: '-5', TotalMaxWeightAllowed: '30' }, 30],
        [{ PlaceMaxWeightAllowed: '20' }, 20],
        [{}, null],
    ])('derives maxWeightKg from %j as %s', async (extra, expected) => {
        const { client } = clientFor({ body: npOk([wh('w', extra)]) });
        const [w] = await getWarehouses(client, { page: 1 });
        expect(w.maxWeightKg).toBe(expected);
    });

    it('throws a limit error instead of truncating at the page cap', async () => {
        const page = (n: number) => ({ body: npOk(Array.from({ length: 500 }, (_, i) => wh(`p${n}-${i}`))) });
        const { client, calls } = clientFor(...Array.from({ length: 60 }, (_, n) => page(n)));
        const error = await getWarehouses(client, {}).catch(e => e);
        expect(error).toMatchObject({ name: 'NovaPoshtaError', kind: 'limit' });
        expect(calls).toHaveLength(50);
    });

    it('stops without looping when the api repeats the same page', async () => {
        const same = { body: npOk(Array.from({ length: 500 }, (_, i) => wh(`a${i}`))) };
        const { client, calls } = clientFor(same, same, same);
        const result = await getWarehouses(client, {});
        expect(result).toHaveLength(500);
        expect(calls).toHaveLength(2);
    });

    it('passes the signal to every page', async () => {
        const { client, calls } = clientFor({ body: npOk([]) });
        await expect(getWarehouses(client, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
        expect(calls).toHaveLength(0);
    });

    it('rejects a limit above 500', async () => {
        const { client } = clientFor();
        await expect(getWarehouses(client, { limit: 501 })).rejects.toThrow(/limit/);
    });

    it('fails with a parse error on an entry without ref', async () => {
        const { client } = clientFor({ body: npOk([{ Number: '1' }]) });
        await expect(getWarehouses(client, { page: 1 })).rejects.toBeInstanceOf(NovaPoshtaError);
    });

    it('tolerates numeric strings with odd values', async () => {
        const { client } = clientFor({ body: npOk([wh('w', { PlaceMaxWeightAllowed: 'abc', TotalMaxWeightAllowed: '30', ReceivingLimitationsOnDimensions: { Width: 'x' } })]) });
        const [w] = await getWarehouses(client, { page: 1 });
        expect(w.maxWeightKg).toBe(30);
        expect(w.receivingLimits).toBeNull();
    });
});

describe('getWarehouseTypes', () => {
    it('maps types', async () => {
        const { client, calls } = clientFor({ body: fixture('warehouse-types') });
        const types = await getWarehouseTypes(client);
        expect(calls[0].body).toMatchObject({ modelName: 'AddressGeneral', calledMethod: 'getWarehouseTypes', methodProperties: {} });
        expect(types).toHaveLength(5);
        expect(types).toContainEqual({ ref: 'f9316480-5f2d-425d-bc2c-ac7cd29decf0', description: 'Поштомат' });
    });
});

describe('getWarehouseTypes extras', () => {
    it('fails with a parse error when a type has no ref or description', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'r' }]) });
        const error = await getWarehouseTypes(client).catch(e => e);
        expect(error).toMatchObject({ kind: 'parse', calledMethod: 'getWarehouseTypes' });
        expect(error.message).toContain('Description');
    });

    it('is cancelled by an abort signal', async () => {
        const { client } = clientFor({ body: npOk([]) });
        await expect(getWarehouseTypes(client, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
    });
});

describe('getSenderCounterparties', () => {
    it('maps sender counterparties', async () => {
        const { client, calls } = clientFor({ body: fixture('sender-counterparties') });
        const list = await getSenderCounterparties(client);
        expect(calls).toHaveLength(1);
        expect(calls[0].body.methodProperties).toEqual({ CounterpartyProperty: 'Sender', Page: '1' });
        expect(list).toEqual([
            { ref: '11111111-1111-4111-8111-111111111111', description: 'Тестенко Тест Тестович', type: 'PrivatePerson' },
        ]);
    });

    it('pages until the reported total is reached', async () => {
        const one = (ref: string) => ({ Ref: ref, Description: ref, CounterpartyType: 'PrivatePerson' });
        const { client, calls } = clientFor(
            { body: npOk([one('a'), one('b')], { info: { totalCount: 3 } }) },
            { body: npOk([one('c')], { info: { totalCount: 3 } }) },
        );
        const list = await getSenderCounterparties(client);
        expect(list.map(c => c.ref)).toEqual(['a', 'b', 'c']);
        expect(calls).toHaveLength(2);
    });

    it('dedupes counterparties by ref across pages', async () => {
        const one = (ref: string) => ({ Ref: ref, Description: ref, CounterpartyType: 'PrivatePerson' });
        const { client } = clientFor({ body: npOk([one('a'), one('b')]) }, { body: npOk([one('b'), one('c')]) }, { body: npOk([]) });
        expect((await getSenderCounterparties(client)).map(c => c.ref)).toEqual(['a', 'b', 'c']);
    });

    it('fails with a parse error when a counterparty has no ref or description', async () => {
        const { client } = clientFor({ body: npOk([{ Description: 'x' }]) }, { body: npOk([]) }, { body: npOk([{ Ref: 'x' }]) }, { body: npOk([]) });
        await expect(getSenderCounterparties(client)).rejects.toMatchObject({ kind: 'parse', modelName: 'CounterpartyGeneral', calledMethod: 'getCounterparties' });
        const error = await getSenderCounterparties(client).catch(e => e);
        expect(error.message).toContain('Description');
    });

    it('is cancelled by an abort signal', async () => {
        const { client } = clientFor({ body: npOk([]) });
        await expect(getSenderCounterparties(client, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('pages until an empty page when the total is unknown', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Ref: 'a', Description: 'A' }]) }, { body: npOk([]) });
        expect(await getSenderCounterparties(client)).toHaveLength(1);
        expect(calls).toHaveLength(2);
    });
});

describe('getContactPersons', () => {
    it('maps contact persons and splits phones', async () => {
        const { client, calls } = clientFor({ body: fixture('contact-persons') });
        const list = await getContactPersons(client, 'cp');
        expect(calls[0].body).toMatchObject({ modelName: 'CounterpartyGeneral', calledMethod: 'getCounterpartyContactPersons', methodProperties: { Ref: 'cp', Page: '1' } });
        expect(list).toEqual([
            {
                ref: '22222222-2222-4222-8222-222222222222',
                name: 'Тестенко Тест Тестович',
                firstName: 'Тест',
                middleName: 'Тестович',
                lastName: 'Тестенко',
                phones: ['380501112233'],
                email: 'test@example.com',
            },
        ]);
    });

    it('uses null for contact fields the api omits', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'r' }], { info: { totalCount: 1 } }) });
        expect(await getContactPersons(client, 'cp')).toEqual([{ ref: 'r', name: null, firstName: null, middleName: null, lastName: null, phones: [], email: null }]);
    });

    it('splits several phones', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'r', Phones: '380501112233, 380671112233;380931112233' }], { info: { totalCount: 1 } }) });
        const [p] = await getContactPersons(client, 'cp');
        expect(p.phones).toEqual(['380501112233', '380671112233', '380931112233']);
    });

    it('dedupes contact persons by ref across pages', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'a' }, { Ref: 'b' }]) }, { body: npOk([{ Ref: 'a' }]) });
        expect((await getContactPersons(client, 'cp')).map(p => p.ref)).toEqual(['a', 'b']);
    });

    it('fails with a parse error when a contact has no ref', async () => {
        const { client } = clientFor({ body: npOk([{ Phones: '1' }]) }, { body: npOk([]) });
        const error = await getContactPersons(client, 'cp').catch(e => e);
        expect(error).toMatchObject({ kind: 'parse' });
        expect(error.message).toContain('Ref');
    });

    it('is cancelled by an abort signal', async () => {
        const { client } = clientFor({ body: npOk([]) });
        await expect(getContactPersons(client, 'cp', { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('requires a counterparty ref', async () => {
        const { client } = clientFor();
        await expect(getContactPersons(client, '')).rejects.toMatchObject({ kind: 'validation', message: expect.stringMatching(/counterpartyRef/) });
    });
});
