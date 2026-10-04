import { afterEach, describe, expect, it, vi } from 'vitest';
import { NovaPoshtaClient } from '../src/novaposhta-client.js';
import {
    createPrivateRecipient,
    createWaybill,
    CreateWaybillOptions,
    deleteWaybill,
    formatNovaPoshtaDate,
    WaybillInput,
} from '../src/novaposhta-waybill.js';
import { fixture, mockFetch, npFail, npOk } from './helpers.js';

const clientFor = (...replies: Parameters<typeof mockFetch>) => {
    const mock = mockFetch(...replies);
    return { client: new NovaPoshtaClient({ apiKey: 'k', fetch: mock.fetch, retryDelayMs: 0 }), calls: mock.calls };
};

const input = (patch: Partial<WaybillInput> = {}): WaybillInput => ({
    payerType: 'Recipient',
    paymentMethod: 'Cash',
    cargoType: 'Cargo',
    serviceType: 'WarehouseWarehouse',
    weightGrams: 1000,
    seatsAmount: 1,
    description: 'Книги',
    declaredValueMinor: 50000,
    sender: { cityRef: 'sc', counterpartyRef: 'scp', addressRef: 'sw', contactRef: 'sct', phone: '0501112233' },
    recipient: { cityRef: 'rc', counterpartyRef: 'rcp', addressRef: 'rw', contactRef: 'rct', phone: '+38 (067) 111-22-33', pointKind: 'warehouse' },
    ...patch,
});

const postomatInput = (patch: Partial<WaybillInput> = {}) =>
    input({
        cargoType: 'Parcel',
        recipient: { cityRef: 'rc', counterpartyRef: 'rcp', addressRef: 'rp', contactRef: 'rct', phone: '380671112233', pointKind: 'postomat' },
        optionsSeat: [{ weightGrams: 2000, widthCm: 40, lengthCm: 60, heightCm: 30 }],
        ...patch,
    });

const saved = { Ref: 'doc-ref', CostOnSite: '95', EstimatedDeliveryDate: '07.10.2026', IntDocNumber: '20450000000001', TypeDocument: 'InternetDocument' };

const NOW = new Date('2026-10-04T09:00:00Z');
const create = (client: NovaPoshtaClient, waybill: WaybillInput, options: CreateWaybillOptions = {}) => createWaybill(client, waybill, { now: NOW, ...options });
const validation = { name: 'NovaPoshtaError', kind: 'validation' };

afterEach(() => vi.useRealTimers());

describe('formatNovaPoshtaDate', () => {
    it('formats dd.mm.yyyy in Kyiv time', () => {
        expect(formatNovaPoshtaDate(new Date('2026-10-04T09:00:00Z'))).toBe('04.10.2026');
        expect(formatNovaPoshtaDate(new Date('2026-12-31T22:30:00Z'))).toBe('01.01.2027');
        expect(formatNovaPoshtaDate(new Date('2026-03-05T00:00:00Z'))).toBe('05.03.2026');
    });
});

describe('createPrivateRecipient', () => {
    it('saves a private person recipient and returns refs', async () => {
        const { client, calls } = clientFor({
            body: npOk([{ Ref: 'cp-ref', Description: 'x', ContactPerson: { success: true, data: [{ Ref: 'ct-ref', Description: 'x' }] } }]),
        });
        const result = await createPrivateRecipient(client, { firstName: 'Тест', middleName: 'Тестович', lastName: 'Тестенко', phone: '0671112233', email: 'a@b.ua' });
        expect(calls[0].body).toMatchObject({ modelName: 'CounterpartyGeneral', calledMethod: 'save' });
        expect(calls[0].body.methodProperties).toEqual({
            FirstName: 'Тест',
            MiddleName: 'Тестович',
            LastName: 'Тестенко',
            Phone: '380671112233',
            Email: 'a@b.ua',
            CounterpartyType: 'PrivatePerson',
            CounterpartyProperty: 'Recipient',
        });
        expect(result).toEqual({ counterpartyRef: 'cp-ref', contactRef: 'ct-ref' });
    });

    it('is cancelled by an abort signal and never retries a server error', async () => {
        const { client, calls } = clientFor({ status: 500, body: '' }, { body: npOk([{ Ref: 'a', ContactPerson: { data: [{ Ref: 'b' }] } }]) });
        const input = { firstName: 'A', middleName: 'B', lastName: 'C', phone: '0671112233' };
        await expect(createPrivateRecipient(client, input)).rejects.toMatchObject({ kind: 'http' });
        expect(calls).toHaveLength(1);
        await expect(createPrivateRecipient(client, input, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('drops the middle name when the full name exceeds 50 characters', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Ref: 'a', ContactPerson: { data: [{ Ref: 'b' }] } }]) });
        await createPrivateRecipient(client, { firstName: 'Т'.repeat(16), middleName: 'Т'.repeat(16), lastName: 'Т'.repeat(17), phone: '0671112233' });
        expect(calls[0].body.methodProperties).toMatchObject({ FirstName: 'Т'.repeat(16), MiddleName: '', LastName: 'Т'.repeat(17) });
    });

    it('rejects an over-long first name before any request', async () => {
        const { client, calls } = clientFor({ body: npOk([]) });
        await expect(createPrivateRecipient(client, { firstName: 'Т'.repeat(26), middleName: '', lastName: 'Ли', phone: '0671112233' })).rejects.toMatchObject({ kind: 'validation' });
        expect(calls).toHaveLength(0);
    });

    it('omits email when absent', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Ref: 'a', ContactPerson: { data: [{ Ref: 'b' }] } }]) });
        await createPrivateRecipient(client, { firstName: 'A', middleName: 'B', lastName: 'C', phone: '0671112233' });
        expect(calls[0].body.methodProperties).not.toHaveProperty('Email');
    });

    it('fails with a parse error when the contact ref is missing', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'a' }]) });
        await expect(createPrivateRecipient(client, { firstName: 'A', middleName: 'B', lastName: 'C', phone: '0671112233' })).rejects.toMatchObject({ kind: 'parse' });
    });

    it('fails with a parse error on an empty reply', async () => {
        const { client } = clientFor({ body: npOk([]) });
        await expect(createPrivateRecipient(client, { firstName: 'A', middleName: 'B', lastName: 'C', phone: '0671112233' })).rejects.toMatchObject({ kind: 'parse' });
    });

    it.each([
        { firstName: '' },
        { lastName: '  ' },
        { phone: 'bad' },
    ])('validates %j before calling the api', async patch => {
        const { client, calls } = clientFor();
        await expect(createPrivateRecipient(client, { firstName: 'A', middleName: 'B', lastName: 'C', phone: '0671112233', ...patch })).rejects.toMatchObject(validation);
        expect(calls).toHaveLength(0);
    });
});

describe('createWaybill', () => {
    it('sends the normalized description', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Ref: 'r', IntDocNumber: '20400000000000' }]) });
        await createWaybill(client, input({ description: '  Книги   для  школи ' }));
        expect(calls[0].body.methodProperties).toMatchObject({ Description: 'Книги для школи' });
    });

    it('sends a warehouse to warehouse document', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        const result = await create(client, input());
        expect(calls[0].body).toMatchObject({ modelName: 'InternetDocumentGeneral', calledMethod: 'save' });
        expect(calls[0].body.methodProperties).toEqual({
            PayerType: 'Recipient',
            PaymentMethod: 'Cash',
            DateTime: '04.10.2026',
            CargoType: 'Cargo',
            VolumeGeneral: '0.0004',
            Weight: '1',
            ServiceType: 'WarehouseWarehouse',
            SeatsAmount: '1',
            Description: 'Книги',
            Cost: '500',
            CitySender: 'sc',
            Sender: 'scp',
            SenderAddress: 'sw',
            ContactSender: 'sct',
            SendersPhone: '380501112233',
            CityRecipient: 'rc',
            Recipient: 'rcp',
            RecipientAddress: 'rw',
            ContactRecipient: 'rct',
            RecipientsPhone: '380671112233',
        });
        expect(result).toEqual({ ref: 'doc-ref', number: '20450000000001', costMinor: 9500, estimatedDeliveryDate: '07.10.2026', warnings: [] });
    });

    it('sends the exact volume in m3 and never below the minimum', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) }, { body: npOk([saved]) }, { body: npOk([saved]) }, { body: npOk([saved]) });
        await create(client, input({ volumeCm3: 12_345 }));
        await create(client, input({ volumeCm3: 10 }));
        await create(client, input({ volumeCm3: 100_000 }));
        await create(client, input({ volumeCm3: 400 }));
        expect(calls.map(c => c.body.methodProperties.VolumeGeneral)).toEqual(['0.012345', '0.0004', '0.1', '0.0004']);
    });

    it.each([0, -5, NaN, Infinity, '10' as never])('rejects volumeCm3 %j', async volumeCm3 => {
        const { client, calls } = clientFor();
        await expect(create(client, input({ volumeCm3 }))).rejects.toMatchObject(validation);
        expect(calls).toHaveLength(0);
    });

    it('sends exact option seat volumes with six decimals', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        await create(client, input({ optionsSeat: [{ weightGrams: 100, widthCm: 3, lengthCm: 7, heightCm: 11 }] }));
        expect(calls[0].body.methodProperties.OptionsSeat[0].volumetricVolume).toBe('0.000231');
    });

    it('returns the api warnings', async () => {
        const { client } = clientFor({ body: npOk([saved], { warnings: ['CargoType is changed to Parcel'] }) });
        expect((await create(client, input())).warnings).toEqual(['CargoType is changed to Parcel']);
    });

    it('sends option seats instead of the volume and passes warehouse indexes', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        await create(
            client,
            input({
                seatsAmount: 2,
                weightGrams: 3000,
                optionsSeat: [
                    { weightGrams: 1000, widthCm: 10, lengthCm: 20, heightCm: 30 },
                    { weightGrams: 2000, widthCm: 10, lengthCm: 20, heightCm: 30 },
                ],
                sender: { cityRef: 'sc', counterpartyRef: 'scp', addressRef: 'sw', contactRef: 'sct', phone: '0501112233', warehouseIndex: '11/1' },
                recipient: { cityRef: 'rc', counterpartyRef: 'rcp', addressRef: 'rw', contactRef: 'rct', phone: '0671112233', warehouseIndex: '46/7', pointKind: 'warehouse' },
            }),
        );
        const props = calls[0].body.methodProperties;
        expect(props).not.toHaveProperty('VolumeGeneral');
        expect(props.OptionsSeat).toEqual([
            { volumetricVolume: '0.006', volumetricWidth: '10', volumetricLength: '20', volumetricHeight: '30', weight: '1' },
            { volumetricVolume: '0.006', volumetricWidth: '10', volumetricLength: '20', volumetricHeight: '30', weight: '2' },
        ]);
        expect(props.SenderWarehouseIndex).toBe('11/1');
        expect(props.RecipientWarehouseIndex).toBe('46/7');
    });

    it('honours an explicit date and payment options', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        await create(client, input({ date: new Date('2026-11-15T10:00:00Z'), payerType: 'Sender', paymentMethod: 'NonCash' }));
        expect(calls[0].body.methodProperties).toMatchObject({ DateTime: '15.11.2026', PayerType: 'Sender', PaymentMethod: 'NonCash' });
    });

    it('rejects a date further than three months ahead', async () => {
        const { client, calls } = clientFor();
        await expect(create(client, input({ date: new Date('2027-02-01T00:00:00Z') }))).rejects.toMatchObject({ ...validation, message: expect.stringMatching(/date/i) });
        await expect(create(client, input({ date: new Date('2027-01-05T09:00:00Z') }))).rejects.toMatchObject(validation);
        expect(calls).toHaveLength(0);
    });

    it('accepts the three month boundary', async () => {
        const { client } = clientFor({ body: npOk([saved]) });
        await expect(create(client, input({ date: new Date('2027-01-04T09:00:00Z') }))).resolves.toBeDefined();
    });

    it('rejects a date before today in Kyiv and accepts earlier hours of today', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        await expect(create(client, input({ date: new Date('2026-10-03T08:00:00Z') }))).rejects.toMatchObject(validation);
        expect(calls).toHaveLength(0);
        await create(client, input({ date: new Date('2026-10-03T22:00:00Z') }));
        expect(calls[0].body.methodProperties.DateTime).toBe('04.10.2026');
    });

    it('judges today by Kyiv time around midnight', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        const now = new Date('2026-10-03T22:30:00Z');
        await expect(createWaybill(client, input({ date: new Date('2026-10-03T20:00:00Z') }), { now })).rejects.toMatchObject(validation);
        expect(calls).toHaveLength(0);
        await createWaybill(client, input({ date: new Date('2026-10-04T05:00:00Z') }), { now });
        expect(calls[0].body.methodProperties.DateTime).toBe('04.10.2026');
    });

    it.each([
        ['2026-11-30T12:00:00Z', '2027-02-28T12:00:00Z', true],
        ['2026-11-30T12:00:00Z', '2027-03-01T12:00:00Z', false],
        ['2027-11-30T12:00:00Z', '2028-02-29T12:00:00Z', true],
        ['2027-11-30T12:00:00Z', '2028-03-01T12:00:00Z', false],
        ['2027-01-31T12:00:00Z', '2027-04-30T12:00:00Z', true],
        ['2027-01-31T12:00:00Z', '2027-05-01T12:00:00Z', false],
        ['2026-12-31T12:00:00Z', '2027-03-31T12:00:00Z', true],
        ['2026-12-31T12:00:00Z', '2027-04-01T12:00:00Z', false],
    ])('three months from %s: %s allowed is %s', async (nowIso, dateIso, allowed) => {
        const { client } = clientFor({ body: npOk([saved]) });
        const result = createWaybill(client, input({ date: new Date(dateIso) }), { now: new Date(nowIso) });
        if (allowed) {
            await expect(result).resolves.toBeDefined();
        } else {
            await expect(result).rejects.toMatchObject(validation);
        }
    });

    it('rejects an invalid or non-date value', async () => {
        const { client, calls } = clientFor();
        await expect(create(client, input({ date: new Date('nope') }))).rejects.toMatchObject(validation);
        await expect(create(client, input({ date: '2026-10-05' as never }))).rejects.toMatchObject(validation);
        expect(calls).toHaveLength(0);
    });

    it('uses the real clock when no now is given', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-04T09:00:00Z'));
        const { client, calls } = clientFor({ body: npOk([saved]) });
        await createWaybill(client, input());
        expect(calls[0].body.methodProperties.DateTime).toBe('04.10.2026');
    });

    it('accepts third party payer', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        await create(client, input({ payerType: 'ThirdPerson' }));
        expect(calls[0].body.methodProperties.PayerType).toBe('ThirdPerson');
    });

    it.each([
        ['payer', { payerType: 'Nobody' as never }],
        ['payment', { paymentMethod: 'Card' as never }],
        ['service', { serviceType: 'Teleport' as never }],
        ['cargo', { cargoType: 'Gold' as never }],
        ['weight zero', { weightGrams: 0 }],
        ['seats zero', { seatsAmount: 0 }],
        ['empty description', { description: '  ' }],
        ['description over 120', { description: 'К'.repeat(121) }],
        ['negative declared value', { declaredValueMinor: -1 }],
        ['zero declared value', { declaredValueMinor: 0 }],
        ['fractional declared value', { declaredValueMinor: 100.5 }],
        ['missing pointKind', { recipient: { cityRef: 'a', counterpartyRef: 'b', addressRef: 'c', contactRef: 'd', phone: '0671112233' } }],
        ['unknown pointKind', { recipient: { cityRef: 'a', counterpartyRef: 'b', addressRef: 'c', contactRef: 'd', phone: '0671112233', pointKind: 'locker' } }],
        ['fractional seat dimension', { optionsSeat: [{ weightGrams: 100, widthCm: 10.5, lengthCm: 10, heightCm: 10 }] }],
        ['empty option seats', { optionsSeat: [] }],
        ['non-numeric dimension', { optionsSeat: [{ weightGrams: 100, widthCm: '10', lengthCm: 10, heightCm: 10 }] }],
        ['bad sender phone', { sender: { cityRef: 'a', counterpartyRef: 'b', addressRef: 'c', contactRef: 'd', phone: '123' } }],
        ['bad recipient phone', { recipient: { cityRef: 'a', counterpartyRef: 'b', addressRef: 'c', contactRef: 'd', phone: '123' } }],
        ['seat count mismatch', { seatsAmount: 2, optionsSeat: [{ weightGrams: 100, widthCm: 1, lengthCm: 1, heightCm: 1 }] }],
        ['empty ref', { recipient: { cityRef: '', counterpartyRef: 'b', addressRef: 'c', contactRef: 'd', phone: '0671112233' } }],
    ])('rejects %s before calling the api', async (_name, patch) => {
        const { client, calls } = clientFor();
        await expect(create(client, input(patch as Partial<WaybillInput>))).rejects.toMatchObject(validation);
        expect(calls).toHaveLength(0);
    });

    describe('documents cargo', () => {
        it.each([1, 100, 450, 500, 1000])('allows %d g', async grams => {
            const { client } = clientFor({ body: npOk([saved]) });
            await expect(create(client, input({ cargoType: 'Documents', weightGrams: grams }))).resolves.toBeDefined();
        });

        it.each([101, 600, 1001, 2000])('rejects %d g', async grams => {
            const { client, calls } = clientFor();
            await expect(create(client, input({ cargoType: 'Documents', weightGrams: grams }))).rejects.toMatchObject({ ...validation, message: expect.stringMatching(/Documents/) });
            expect(calls).toHaveLength(0);
        });
    });

    describe('postomat rules', () => {
        it('sends a valid postomat document with option seats', async () => {
            const { client, calls } = clientFor({ body: npOk([saved]) });
            await create(client, postomatInput());
            const props = calls[0].body.methodProperties;
            expect(props.RecipientAddress).toBe('rp');
            expect(props.OptionsSeat).toEqual([
                { volumetricVolume: '0.072', volumetricWidth: '40', volumetricLength: '60', volumetricHeight: '30', weight: '2' },
            ]);
            expect(props).not.toHaveProperty('VolumeGeneral');
        });

        it('allows Documents to a postomat', async () => {
            const { client } = clientFor({ body: npOk([saved]) });
            await expect(
                create(client, postomatInput({ cargoType: 'Documents', weightGrams: 500, optionsSeat: [{ weightGrams: 500, widthCm: 20, lengthCm: 30, heightCm: 2 }] })),
            ).resolves.toBeDefined();
        });

        it('allows exactly 20 kg and exactly 29000 UAH', async () => {
            const { client } = clientFor({ body: npOk([saved]) });
            await expect(
                create(
                    client,
                    postomatInput({ weightGrams: 20_000, declaredValueMinor: 2_900_000, optionsSeat: [{ weightGrams: 20_000, widthCm: 40, lengthCm: 60, heightCm: 30 }] }),
                ),
            ).resolves.toBeDefined();
        });

        it.each([
            ['cargo type', { cargoType: 'Cargo' as const }],
            ['pallet', { cargoType: 'Pallet' as const }],
            ['two seats', { seatsAmount: 2, optionsSeat: [{ weightGrams: 1000, widthCm: 10, lengthCm: 10, heightCm: 10 }, { weightGrams: 1000, widthCm: 10, lengthCm: 10, heightCm: 10 }] }],
            ['missing option seats', { optionsSeat: undefined }],
            ['width 41', { optionsSeat: [{ weightGrams: 1000, widthCm: 41, lengthCm: 60, heightCm: 30 }] }],
            ['length 61', { optionsSeat: [{ weightGrams: 1000, widthCm: 40, lengthCm: 61, heightCm: 30 }] }],
            ['height 31', { optionsSeat: [{ weightGrams: 1000, widthCm: 40, lengthCm: 60, heightCm: 31 }] }],
            ['rotated 60x40x30 (width over 40)', { optionsSeat: [{ weightGrams: 1000, widthCm: 60, lengthCm: 40, heightCm: 30 }] }],
            ['20001 g seat', { weightGrams: 20_001, optionsSeat: [{ weightGrams: 20_001, widthCm: 10, lengthCm: 10, heightCm: 10 }] }],
            ['20001 g total', { weightGrams: 20_001 }],
            ['declared value 29000.01 UAH', { declaredValueMinor: 2_900_001 }],
        ])('rejects %s', async (_name, patch) => {
            const { client, calls } = clientFor();
            await expect(create(client, postomatInput(patch as Partial<WaybillInput>))).rejects.toMatchObject({ ...validation, message: expect.stringMatching(/postomat/i) });
            expect(calls).toHaveLength(0);
        });

        it('does not apply postomat limits to a warehouse', async () => {
            const { client } = clientFor({ body: npOk([saved]) });
            await expect(
                create(client, input({ weightGrams: 30_000, declaredValueMinor: 5_000_000, seatsAmount: 2, optionsSeat: [{ weightGrams: 15_000, widthCm: 80, lengthCm: 80, heightCm: 80 }, { weightGrams: 15_000, widthCm: 80, lengthCm: 80, heightCm: 80 }] })),
            ).resolves.toBeDefined();
        });
    });

    it('checks seat counts before postomat rules and generic fields before both', async () => {
        const { client } = clientFor();
        const mismatch = await create(client, postomatInput({ seatsAmount: 2, optionsSeat: [{ weightGrams: 100, widthCm: 99, lengthCm: 1, heightCm: 1 }] })).catch(e => e);
        expect(mismatch.message).toMatch(/optionsSeat length/);
        const generic = await create(client, postomatInput({ description: ' ', seatsAmount: 2 })).catch(e => e);
        expect(generic.message).toMatch(/description/);
    });

    it('never retries a write on a server error', async () => {
        const { client, calls } = clientFor({ status: 500, body: '' }, { body: npOk([saved]) });
        await expect(create(client, input())).rejects.toMatchObject({ kind: 'http', status: 500 });
        expect(calls).toHaveLength(1);
    });

    it('treats errors next to success as an api error', async () => {
        const { client } = clientFor({ body: npOk([saved], { errors: ['partly failed'] }) });
        await expect(create(client, input())).rejects.toMatchObject({ kind: 'api', errors: ['partly failed'] });
    });

    it('is cancelled by an abort signal', async () => {
        const { client, calls } = clientFor({ body: npOk([saved]) });
        await expect(create(client, input(), { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
        expect(calls).toHaveLength(0);
    });

    it('surfaces api errors', async () => {
        const { client } = clientFor({ body: npFail(['RecipientAddress is invalid'], ['20000200']) });
        await expect(create(client, input())).rejects.toMatchObject({ kind: 'api', errors: ['RecipientAddress is invalid'] });
    });

    it.each([
        ['IntDocNumber', { Ref: 'x' }],
        ['Ref', { IntDocNumber: '1' }],
    ])('fails with a parse error naming %s when it is missing', async (field, entry) => {
        const { client } = clientFor({ body: npOk([entry]) });
        const error = await create(client, input()).catch(e => e);
        expect(error).toMatchObject({ kind: 'parse', modelName: 'InternetDocumentGeneral', calledMethod: 'save' });
        expect(error.message).toContain(field);
    });

    it('fails with a parse error on an empty reply', async () => {
        const { client } = clientFor({ body: npOk([]) });
        await expect(create(client, input())).rejects.toMatchObject({ kind: 'parse' });
    });

    it('fails with a parse error on an invalid cost on site', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'x', IntDocNumber: '1', CostOnSite: 'abc' }]) });
        await expect(create(client, input())).rejects.toMatchObject({ kind: 'parse' });
    });

    it('tolerates a missing cost on site and delivery date', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'x', IntDocNumber: '1' }]) });
        expect(await create(client, input())).toEqual({ ref: 'x', number: '1', costMinor: null, estimatedDeliveryDate: null, warnings: [] });
    });
});

describe('deleteWaybill', () => {
    it('deletes by ref', async () => {
        const { client, calls } = clientFor({ body: npOk([{ Ref: 'doc-ref' }]) });
        await expect(deleteWaybill(client, 'doc-ref')).resolves.toBe('doc-ref');
        expect(calls[0].body).toMatchObject({ modelName: 'InternetDocumentGeneral', calledMethod: 'delete', methodProperties: { DocumentRefs: 'doc-ref' } });
    });

    it('requires a ref', async () => {
        const { client, calls } = clientFor();
        await expect(deleteWaybill(client, '')).rejects.toMatchObject({ ...validation, message: expect.stringMatching(/ref/) });
        expect(calls).toHaveLength(0);
    });

    it.each([
        ['another ref', { body: npOk([{ Ref: 'other' }]) }],
        ['an empty reply', { body: npOk([]) }],
        ['an entry without ref', { body: npOk([{}]) }],
        ['a non-object entry', { body: npOk(['doc-ref']) }],
    ])('fails with an api error when the reply has %s', async (_name, reply) => {
        const { client } = clientFor(reply);
        const error = await deleteWaybill(client, 'doc-ref').catch(e => e);
        expect(error).toMatchObject({ kind: 'api', modelName: 'InternetDocumentGeneral', calledMethod: 'delete' });
    });

    it('accepts the ref among several echoed refs', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'a' }, { Ref: 'doc-ref' }]) });
        await expect(deleteWaybill(client, 'doc-ref')).resolves.toBe('doc-ref');
    });

    it('never retries a delete on a server error', async () => {
        const { client, calls } = clientFor({ status: 500, body: '' }, { body: npOk([{ Ref: 'doc-ref' }]) });
        await expect(deleteWaybill(client, 'doc-ref')).rejects.toMatchObject({ kind: 'http' });
        expect(calls).toHaveLength(1);
    });

    it('is cancelled by an abort signal', async () => {
        const { client } = clientFor({ body: npOk([{ Ref: 'doc-ref' }]) });
        await expect(deleteWaybill(client, 'doc-ref', { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
    });

    it('treats a recorded "No document changed DeletionMark" reply as already deleted', async () => {
        const { client, calls } = clientFor({ body: fixture('internet-document-delete-not-found') });
        await expect(deleteWaybill(client, 'doc-ref')).resolves.toBe('doc-ref');
        expect(calls).toHaveLength(1);
    });

    it('treats the recorded "Document already deleted" reply, where errors is an object, as deleted', async () => {
        const { client } = clientFor({ body: fixture('internet-document-delete-already-deleted') });
        await expect(deleteWaybill(client, 'doc-ref')).resolves.toBe('doc-ref');
    });

    it('treats the not found error code as already deleted', async () => {
        const { client } = clientFor({ body: npFail(['anything'], ['20000201173']) });
        await expect(deleteWaybill(client, 'doc-ref')).resolves.toBe('doc-ref');
    });

    it('still fails for an invalid ref', async () => {
        const { client } = clientFor({ body: fixture('internet-document-delete-invalid-ref') });
        await expect(deleteWaybill(client, 'bad')).rejects.toMatchObject({ kind: 'api', errorCodes: ['20000200564'] });
    });

    it('does not mask not found when other error codes come with it', async () => {
        const { client } = clientFor({ body: npFail(['x', 'y'], ['20000201173', '1']) });
        await expect(deleteWaybill(client, 'doc-ref')).rejects.toMatchObject({ kind: 'api' });
    });

    it('surfaces api errors', async () => {
        const { client } = clientFor({ body: npFail(['not found']) });
        await expect(deleteWaybill(client, 'x')).rejects.toMatchObject({ kind: 'api' });
    });
});

describe('recorded Nova Poshta replies', () => {
    it('reads refs from a recorded recipient save', async () => {
        const { client } = clientFor({ body: fixture('counterparty-save-recipient') });
        expect(await createPrivateRecipient(client, { firstName: 'Тест', middleName: 'Тестович', lastName: 'Тестенко', phone: '0501112233' })).toEqual({
            counterpartyRef: '33333333-3333-4333-8333-333333333333',
            contactRef: '44444444-4444-4444-8444-444444444444',
        });
    });

    it('reads a recorded document save', async () => {
        const { client } = clientFor({ body: fixture('internet-document-save') });
        expect(await create(client, input())).toEqual({
            ref: '55555555-5555-4555-8555-555555555555',
            number: '20450000000000',
            costMinor: 9000,
            estimatedDeliveryDate: '05.10.2026',
            warnings: ['CargoType is changed to Parcel'],
        });
    });

    it('reads a recorded postomat document save', async () => {
        const { client } = clientFor({ body: fixture('internet-document-save-postomat') });
        expect((await create(client, postomatInput())).costMinor).toBe(8000);
    });

    it('reads a recorded delete', async () => {
        const { client } = clientFor({ body: fixture('internet-document-delete') });
        expect(await deleteWaybill(client, '55555555-5555-4555-8555-555555555555')).toBe('55555555-5555-4555-8555-555555555555');
    });

    it('turns a recorded validation failure into an api error with every message and code', async () => {
        const { client } = clientFor({ body: fixture('internet-document-save-error') });
        const error = await create(client, input()).catch(e => e);
        expect(error).toMatchObject({ kind: 'api' });
        expect(error.errors).toContain('CitySender is incorrect');
        expect(error.errorCodes).toHaveLength(error.errors.length);
    });
});
