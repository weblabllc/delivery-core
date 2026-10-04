import { describe, expect, it } from 'vitest';
import {
    assertCargoType,
    assertSeat,
    assertSeatsAmount,
    assertServiceType,
    buildShipment,
    buildShipmentFromSeats,
    createPrivateRecipient,
    createWaybill,
    deleteWaybill,
    fitRecipientName,
    getContactPersons,
    getDocumentPrice,
    getWarehouses,
    gramsToKg,
    kopiykyToUah,
    kopiykyToWholeUahCeil,
    NOVAPOSHTA_VALIDATION_CODES,
    normalizePhone,
    NovaPoshtaClient,
    NovaPoshtaError,
    searchSettlements,
    seatToApi,
    track,
    uahToKopiyky,
    validateShipmentDescription,
    WaybillInput,
} from '../src/novaposhta.js';
import { mockFetch } from './helpers.js';

type Expected = { field: string; code: (typeof NOVAPOSHTA_VALIDATION_CODES)[number]; limit?: number };
type Case = [string, () => unknown, Expected];

const client = new NovaPoshtaClient({ apiKey: 'k', fetch: mockFetch().fetch, retryDelayMs: 0 });
const NOW = new Date('2026-10-04T09:00:00Z');

const waybill = (patch: Partial<WaybillInput> = {}): WaybillInput => ({
    payerType: 'Recipient',
    paymentMethod: 'Cash',
    cargoType: 'Cargo',
    serviceType: 'WarehouseWarehouse',
    weightGrams: 1000,
    seatsAmount: 1,
    description: 'Книги',
    declaredValueMinor: 50000,
    sender: { cityRef: 'sc', counterpartyRef: 'scp', addressRef: 'sw', contactRef: 'sct', phone: '0501112233' },
    recipient: { cityRef: 'rc', counterpartyRef: 'rcp', addressRef: 'rw', contactRef: 'rct', phone: '0671112233', pointKind: 'warehouse' },
    ...patch,
});

const postomat = (patch: Partial<WaybillInput> = {}) =>
    waybill({
        cargoType: 'Parcel',
        recipient: { cityRef: 'rc', counterpartyRef: 'rcp', addressRef: 'rp', contactRef: 'rct', phone: '380671112233', pointKind: 'postomat' },
        optionsSeat: [{ weightGrams: 2000, widthCm: 40, lengthCm: 60, heightCm: 30 }],
        ...patch,
    });

const line = { weightGrams: 500, widthCm: 10, lengthCm: 20, heightCm: 5, quantity: 1 };
const seat = { weightGrams: 500, widthCm: 10, lengthCm: 20, heightCm: 5 };
const point = { kind: 'warehouse' as const };
const priceBase = {
    citySender: 'a',
    cityRecipient: 'b',
    weightGrams: 1000,
    serviceType: 'WarehouseWarehouse' as const,
    declaredValueMinor: 50000,
    seatsAmount: 1,
    cargoType: 'Cargo' as const,
};
const anyValue = (value: unknown) => value as never;

const syncCases: Case[] = [
    ['fitRecipientName empty lastName', () => fitRecipientName({ lastName: '  ', firstName: 'Іван' }), { field: 'lastName', code: 'required' }],
    ['fitRecipientName missing firstName', () => fitRecipientName({ lastName: 'Шевченко', firstName: anyValue(undefined) }), { field: 'firstName', code: 'required' }],
    ['fitRecipientName long firstName', () => fitRecipientName({ lastName: 'Ш', firstName: 'І'.repeat(26) }), { field: 'firstName', code: 'too_long', limit: 25 }],
    ['fitRecipientName long full name', () => fitRecipientName({ lastName: 'Ш'.repeat(30), firstName: 'І'.repeat(21) }), { field: 'fullName', code: 'too_long', limit: 50 }],
    ['description empty', () => validateShipmentDescription('   '), { field: 'description', code: 'required' }],
    ['description not a string', () => validateShipmentDescription(42), { field: 'description', code: 'required' }],
    ['description too long', () => validateShipmentDescription('а'.repeat(121)), { field: 'description', code: 'too_long', limit: 120 }],
    ['phone garbage', () => normalizePhone('12345'), { field: 'phone', code: 'invalid_format' }],
    ['phone empty', () => normalizePhone(' '), { field: 'phone', code: 'required' }],
    ['phone number', () => normalizePhone(anyValue(380501112233)), { field: 'phone', code: 'invalid_type' }],
    ['phone undefined', () => normalizePhone(anyValue(undefined)), { field: 'phone', code: 'invalid_type' }],
    ['phone custom field', () => normalizePhone('x', 'sender.phone'), { field: 'sender.phone', code: 'invalid_format' }],
    ['uah garbage', () => uahToKopiyky('abc'), { field: 'amount', code: 'invalid_format' }],
    ['uah huge', () => uahToKopiyky('9'.repeat(30), 'price'), { field: 'price', code: 'too_large' }],
    ['minor negative', () => kopiykyToUah(-1), { field: 'amountMinor', code: 'too_small', limit: 0 }],
    ['minor too large', () => kopiykyToUah(2 ** 60), { field: 'amountMinor', code: 'too_large' }],
    ['minor fractional', () => kopiykyToWholeUahCeil(1.5, 'declaredValueMinor'), { field: 'declaredValueMinor', code: 'not_integer' }],
    ['minor not a number', () => kopiykyToWholeUahCeil(anyValue('1')), { field: 'amountMinor', code: 'invalid_type' }],
    ['grams zero', () => gramsToKg(0), { field: 'weightGrams', code: 'too_small', limit: 0 }],
    ['grams infinity', () => gramsToKg(Infinity), { field: 'weightGrams', code: 'invalid_type' }],
    ['grams negative infinity', () => gramsToKg(-Infinity), { field: 'weightGrams', code: 'invalid_type' }],
    ['grams NaN', () => gramsToKg(NaN), { field: 'weightGrams', code: 'invalid_type' }],
    ['seatsAmount infinity', () => assertSeatsAmount(Infinity), { field: 'seatsAmount', code: 'invalid_type' }],
    ['seat width infinity', () => assertSeat({ ...seat, widthCm: -Infinity }), { field: 'widthCm', code: 'invalid_type' }],
    ['minor infinity', () => kopiykyToUah(Infinity), { field: 'amountMinor', code: 'invalid_type' }],
    ['shipment quantity infinity', () => buildShipment({ lines: [{ ...line, quantity: Infinity }], declaredValueMinor: 100, point }), { field: 'lines[0].quantity', code: 'invalid_type' }],
    ['client timeout infinity', () => new NovaPoshtaClient({ apiKey: 'k', timeoutMs: Infinity }), { field: 'timeoutMs', code: 'invalid_type' }],
    ['grams string', () => gramsToKg(anyValue('1')), { field: 'weightGrams', code: 'invalid_type' }],
    ['serviceType', () => assertServiceType('x'), { field: 'serviceType', code: 'not_allowed' }],
    ['cargoType', () => assertCargoType('x'), { field: 'cargoType', code: 'not_allowed' }],
    ['seatsAmount fractional', () => assertSeatsAmount(1.5), { field: 'seatsAmount', code: 'not_integer' }],
    ['seatsAmount zero', () => assertSeatsAmount(0), { field: 'seatsAmount', code: 'too_small', limit: 1 }],
    ['seatsAmount custom field', () => assertSeatsAmount(0, 'seats'), { field: 'seats', code: 'too_small', limit: 1 }],
    ['seat width fractional', () => assertSeat({ ...seat, widthCm: 1.5 }), { field: 'widthCm', code: 'not_integer' }],
    ['seat length zero', () => assertSeat({ ...seat, lengthCm: 0 }, 'optionsSeat[2]'), { field: 'optionsSeat[2].lengthCm', code: 'too_small', limit: 1 }],
    ['seat weight', () => seatToApi({ ...seat, weightGrams: -1 }, 'optionsSeat[1]'), { field: 'optionsSeat[1].weightGrams', code: 'too_small', limit: 0 }],
    ['shipment no input', () => buildShipment(anyValue(null)), { field: 'input', code: 'invalid_type' }],
    ['shipment no lines', () => buildShipment({ lines: [], declaredValueMinor: 100, point }), { field: 'lines', code: 'too_short', limit: 1 }],
    ['shipment lines not an array', () => buildShipment({ lines: anyValue('x'), declaredValueMinor: 100, point }), { field: 'lines', code: 'invalid_type' }],
    ['shipment line not an object', () => buildShipment({ lines: [anyValue(1)], declaredValueMinor: 100, point }), { field: 'lines[0]', code: 'invalid_type' }],
    ['shipment line weight', () => buildShipment({ lines: [{ ...line, weightGrams: 0 }], declaredValueMinor: 100, point }), { field: 'lines[0].weightGrams', code: 'too_small', limit: 1 }],
    ['shipment line weight type', () => buildShipment({ lines: [{ ...line, weightGrams: anyValue('1') }], declaredValueMinor: 100, point }), { field: 'lines[0].weightGrams', code: 'invalid_type' }],
    ['shipment line height fractional', () => buildShipment({ lines: [line, { ...line, heightCm: 1.5 }], declaredValueMinor: 100, point }), { field: 'lines[1].heightCm', code: 'not_integer' }],
    ['shipment line quantity', () => buildShipment({ lines: [{ ...line, quantity: 0 }], declaredValueMinor: 100, point }), { field: 'lines[0].quantity', code: 'too_small', limit: 1 }],
    ['shipment declared value', () => buildShipment({ lines: [line], declaredValueMinor: 0, point }), { field: 'declaredValueMinor', code: 'too_small', limit: 1 }],
    ['shipment declared value fractional', () => buildShipment({ lines: [line], declaredValueMinor: 1.5, point }), { field: 'declaredValueMinor', code: 'not_integer' }],
    ['shipment point kind', () => buildShipment({ lines: [line], declaredValueMinor: 100, point: anyValue({ kind: 'x' }) }), { field: 'point.kind', code: 'not_allowed' }],
    ['shipment seats fractional', () => buildShipment({ lines: [line], declaredValueMinor: 100, point, seats: 1.5 }), { field: 'seats', code: 'not_integer' }],
    ['shipment seats zero', () => buildShipment({ lines: [line], declaredValueMinor: 100, point, seats: 0 }), { field: 'seats', code: 'too_small', limit: 1 }],
    ['shipment seats above units', () => buildShipment({ lines: [{ ...line, quantity: 2 }], declaredValueMinor: 100, point, seats: 3 }), { field: 'seats', code: 'mismatch', limit: 2 }],
    ['shipment too many units', () => buildShipment({ lines: [{ ...line, quantity: 1001 }], declaredValueMinor: 100, point }), { field: 'lines', code: 'too_many', limit: 1000 }],
    ['shipment postomat seats', () => buildShipment({ lines: [{ ...line, quantity: 2 }], declaredValueMinor: 100, point: { kind: 'postomat' }, seats: 2 }), { field: 'seats', code: 'does_not_fit', limit: 1 }],
    ['shipment postomat dimensions', () => buildShipment({ lines: [{ ...line, widthCm: 70, lengthCm: 70, heightCm: 70 }], declaredValueMinor: 100, point: { kind: 'postomat' } }), { field: 'dimensions', code: 'does_not_fit' }],
    ['shipment postomat weight', () => buildShipment({ lines: [{ ...line, weightGrams: 20001 }], declaredValueMinor: 100, point: { kind: 'postomat' } }), { field: 'weightGrams', code: 'does_not_fit', limit: 20000 }],
    ['shipment postomat value', () => buildShipment({ lines: [line], declaredValueMinor: 2_900_001, point: { kind: 'postomat' } }), { field: 'declaredValueMinor', code: 'does_not_fit', limit: 2_900_000 }],
    ['seats no input', () => buildShipmentFromSeats(anyValue(undefined)), { field: 'input', code: 'invalid_type' }],
    ['seats empty', () => buildShipmentFromSeats({ seats: [], declaredValueMinor: 100, point }), { field: 'seats', code: 'too_short', limit: 1 }],
    ['seats not an array', () => buildShipmentFromSeats({ seats: anyValue({}), declaredValueMinor: 100, point }), { field: 'seats', code: 'invalid_type' }],
    ['seats too many', () => buildShipmentFromSeats({ seats: Array.from({ length: 1001 }, () => seat), declaredValueMinor: 100, point }), { field: 'seats', code: 'too_many', limit: 1000 }],
    ['seats entry width', () => buildShipmentFromSeats({ seats: [seat, { ...seat, widthCm: 0 }], declaredValueMinor: 100, point }), { field: 'seats[1].widthCm', code: 'too_small', limit: 1 }],
    ['seats entry type', () => buildShipmentFromSeats({ seats: [anyValue(null)], declaredValueMinor: 100, point }), { field: 'seats[0]', code: 'invalid_type' }],
    ['client apiKey', () => new NovaPoshtaClient({ apiKey: '' }), { field: 'apiKey', code: 'required' }],
    ['client baseUrl format', () => new NovaPoshtaClient({ apiKey: 'k', baseUrl: 'nope' }), { field: 'baseUrl', code: 'invalid_format' }],
    ['client baseUrl host', () => new NovaPoshtaClient({ apiKey: 'k', baseUrl: 'https://evil.example/' }), { field: 'baseUrl', code: 'not_allowed' }],
    ['client maxRetries fractional', () => new NovaPoshtaClient({ apiKey: 'k', maxRetries: 1.5 }), { field: 'maxRetries', code: 'not_integer' }],
    ['client maxRetries above', () => new NovaPoshtaClient({ apiKey: 'k', maxRetries: 1000 }), { field: 'maxRetries', code: 'too_large', limit: 5 }],
    ['client timeoutMs below', () => new NovaPoshtaClient({ apiKey: 'k', timeoutMs: 0 }), { field: 'timeoutMs', code: 'too_small', limit: 1 }],
];

const asyncCases: Case[] = [
    ['recipient name', () => createPrivateRecipient(client, { lastName: '', firstName: 'a', phone: '0501112233' }), { field: 'lastName', code: 'required' }],
    ['recipient phone', () => createPrivateRecipient(client, { lastName: 'a', firstName: 'b', phone: '1' }), { field: 'phone', code: 'invalid_format' }],
    ['waybill payerType', () => createWaybill(client, waybill({ payerType: anyValue('x') }), { now: NOW }), { field: 'payerType', code: 'not_allowed' }],
    ['waybill paymentMethod', () => createWaybill(client, waybill({ paymentMethod: anyValue('x') }), { now: NOW }), { field: 'paymentMethod', code: 'not_allowed' }],
    ['waybill serviceType', () => createWaybill(client, waybill({ serviceType: anyValue('x') }), { now: NOW }), { field: 'serviceType', code: 'not_allowed' }],
    ['waybill cargoType', () => createWaybill(client, waybill({ cargoType: anyValue('x') }), { now: NOW }), { field: 'cargoType', code: 'not_allowed' }],
    ['waybill description', () => createWaybill(client, waybill({ description: '' }), { now: NOW }), { field: 'description', code: 'required' }],
    ['waybill description long', () => createWaybill(client, waybill({ description: 'a'.repeat(121) }), { now: NOW }), { field: 'description', code: 'too_long', limit: 120 }],
    ['waybill weight', () => createWaybill(client, waybill({ weightGrams: 0 }), { now: NOW }), { field: 'weightGrams', code: 'too_small', limit: 0 }],
    ['waybill declared value', () => createWaybill(client, waybill({ declaredValueMinor: 0 }), { now: NOW }), { field: 'declaredValueMinor', code: 'too_small', limit: 1 }],
    ['waybill declared value fractional', () => createWaybill(client, waybill({ declaredValueMinor: 1.5 }), { now: NOW }), { field: 'declaredValueMinor', code: 'not_integer' }],
    ['waybill seatsAmount', () => createWaybill(client, waybill({ seatsAmount: 0 }), { now: NOW }), { field: 'seatsAmount', code: 'too_small', limit: 1 }],
    ['waybill sender ref', () => createWaybill(client, waybill({ sender: { ...waybill().sender, cityRef: '' } }), { now: NOW }), { field: 'sender.cityRef', code: 'required' }],
    ['waybill recipient contact', () => createWaybill(client, waybill({ recipient: { ...waybill().recipient, contactRef: ' ' } }), { now: NOW }), { field: 'recipient.contactRef', code: 'required' }],
    ['waybill sender phone', () => createWaybill(client, waybill({ sender: { ...waybill().sender, phone: '1' } }), { now: NOW }), { field: 'sender.phone', code: 'invalid_format' }],
    ['waybill recipient phone', () => createWaybill(client, waybill({ recipient: { ...waybill().recipient, phone: '' } }), { now: NOW }), { field: 'recipient.phone', code: 'required' }],
    ['waybill pointKind', () => createWaybill(client, waybill({ recipient: { ...waybill().recipient, pointKind: anyValue('x') } }), { now: NOW }), { field: 'recipient.pointKind', code: 'not_allowed' }],
    ['waybill date type', () => createWaybill(client, waybill({ date: anyValue('2026-10-05') }), { now: NOW }), { field: 'date', code: 'invalid_format' }],
    ['waybill date invalid', () => createWaybill(client, waybill({ date: new Date(NaN) }), { now: NOW }), { field: 'date', code: 'invalid_format' }],
    ['waybill now invalid', () => createWaybill(client, waybill(), { now: new Date(NaN) }), { field: 'now', code: 'invalid_format' }],
    ['waybill date past', () => createWaybill(client, waybill({ date: new Date('2026-10-01T09:00:00Z') }), { now: NOW }), { field: 'date', code: 'too_small' }],
    ['waybill date far', () => createWaybill(client, waybill({ date: new Date('2027-02-01T09:00:00Z') }), { now: NOW }), { field: 'date', code: 'too_large', limit: 3 }],
    ['waybill volume', () => createWaybill(client, waybill({ volumeCm3: -1 }), { now: NOW }), { field: 'volumeCm3', code: 'too_small', limit: 0 }],
    ['waybill volume infinity', () => createWaybill(client, waybill({ volumeCm3: Infinity }), { now: NOW }), { field: 'volumeCm3', code: 'invalid_type' }],
    ['waybill volume type', () => createWaybill(client, waybill({ volumeCm3: anyValue('1') }), { now: NOW }), { field: 'volumeCm3', code: 'invalid_type' }],
    ['waybill documents weight', () => createWaybill(client, waybill({ cargoType: 'Documents', weightGrams: 700 }), { now: NOW }), { field: 'weightGrams', code: 'not_allowed' }],
    ['waybill optionsSeat empty', () => createWaybill(client, waybill({ optionsSeat: [] }), { now: NOW }), { field: 'optionsSeat', code: 'too_short', limit: 1 }],
    ['waybill optionsSeat type', () => createWaybill(client, waybill({ optionsSeat: anyValue('x') }), { now: NOW }), { field: 'optionsSeat', code: 'invalid_type' }],
    ['waybill optionsSeat entry', () => createWaybill(client, waybill({ seatsAmount: 2, optionsSeat: [seat, { ...seat, heightCm: 0 }] }), { now: NOW }), { field: 'optionsSeat[1].heightCm', code: 'too_small', limit: 1 }],
    ['waybill optionsSeat weight', () => createWaybill(client, waybill({ optionsSeat: [{ ...seat, weightGrams: 0 }] }), { now: NOW }), { field: 'optionsSeat[0].weightGrams', code: 'too_small', limit: 0 }],
    ['waybill optionsSeat length', () => createWaybill(client, waybill({ seatsAmount: 2, optionsSeat: [seat] }), { now: NOW }), { field: 'optionsSeat', code: 'mismatch', limit: 2 }],
    ['postomat cargoType', () => createWaybill(client, postomat({ cargoType: 'Cargo' }), { now: NOW }), { field: 'cargoType', code: 'not_allowed' }],
    ['postomat seatsAmount', () => createWaybill(client, postomat({ seatsAmount: 2, optionsSeat: [seat, seat] }), { now: NOW }), { field: 'seatsAmount', code: 'does_not_fit', limit: 1 }],
    ['postomat optionsSeat missing', () => createWaybill(client, postomat({ optionsSeat: undefined }), { now: NOW }), { field: 'optionsSeat', code: 'does_not_fit', limit: 1 }],
    ['postomat width', () => createWaybill(client, postomat({ optionsSeat: [{ ...seat, widthCm: 41 }] }), { now: NOW }), { field: 'optionsSeat[0].widthCm', code: 'does_not_fit', limit: 40 }],
    ['postomat length', () => createWaybill(client, postomat({ optionsSeat: [{ ...seat, lengthCm: 61 }] }), { now: NOW }), { field: 'optionsSeat[0].lengthCm', code: 'does_not_fit', limit: 60 }],
    ['postomat height', () => createWaybill(client, postomat({ optionsSeat: [{ ...seat, heightCm: 31 }] }), { now: NOW }), { field: 'optionsSeat[0].heightCm', code: 'does_not_fit', limit: 30 }],
    ['postomat total weight', () => createWaybill(client, postomat({ weightGrams: 20001 }), { now: NOW }), { field: 'weightGrams', code: 'does_not_fit', limit: 20000 }],
    ['postomat seat weight', () => createWaybill(client, postomat({ optionsSeat: [{ ...seat, weightGrams: 20001 }] }), { now: NOW }), { field: 'optionsSeat[0].weightGrams', code: 'does_not_fit', limit: 20000 }],
    ['postomat declared value', () => createWaybill(client, postomat({ declaredValueMinor: 2_900_001 }), { now: NOW }), { field: 'declaredValueMinor', code: 'does_not_fit', limit: 2_900_000 }],
    ['delete ref', () => deleteWaybill(client, ''), { field: 'ref', code: 'required' }],
    ['price serviceType', () => getDocumentPrice(client, { ...priceBase, serviceType: anyValue('x') }), { field: 'serviceType', code: 'not_allowed' }],
    ['price cargoType', () => getDocumentPrice(client, { ...priceBase, cargoType: anyValue('x') }), { field: 'cargoType', code: 'not_allowed' }],
    ['price seatsAmount', () => getDocumentPrice(client, { ...priceBase, seatsAmount: 0 }), { field: 'seatsAmount', code: 'too_small', limit: 1 }],
    ['price weight', () => getDocumentPrice(client, { ...priceBase, weightGrams: 0 }), { field: 'weightGrams', code: 'too_small', limit: 0 }],
    ['price declared value', () => getDocumentPrice(client, { ...priceBase, declaredValueMinor: -5 }), { field: 'declaredValueMinor', code: 'too_small', limit: 0 }],
    ['price seat', () => getDocumentPrice(client, { ...priceBase, optionsSeat: [seat, { ...seat, lengthCm: 1.5 }] }), { field: 'optionsSeat[1].lengthCm', code: 'not_integer' }],
    ['settlements query', () => searchSettlements(client, anyValue(1)), { field: 'query', code: 'invalid_type' }],
    ['settlements page', () => searchSettlements(client, 'Київ', { page: 0 }), { field: 'page', code: 'too_small', limit: 1 }],
    ['settlements page fractional', () => searchSettlements(client, 'Київ', { page: 1.5 }), { field: 'page', code: 'not_integer' }],
    ['settlements limit', () => searchSettlements(client, 'Київ', { limit: 501 }), { field: 'limit', code: 'too_large', limit: 500 }],
    ['warehouses limit', () => getWarehouses(client, { limit: 0 }), { field: 'limit', code: 'too_small', limit: 1 }],
    ['contact persons ref', () => getContactPersons(client, ''), { field: 'counterpartyRef', code: 'required' }],
    ['tracking number', () => track(client, [{ number: ' ' }]), { field: 'number', code: 'required' }],
];

const capture = async (run: () => unknown): Promise<unknown> => {
    try {
        await run();
    } catch (error) {
        return error;
    }
    return undefined;
};

const expectValidation = (error: unknown, expected: Expected) => {
    expect(error).toBeInstanceOf(NovaPoshtaError);
    const failure = error as NovaPoshtaError;
    expect(failure.kind).toBe('validation');
    expect(failure.field).toBe(expected.field);
    expect(failure.code).toBe(expected.code);
    expect(failure.limit).toBe(expected.limit);
    expect(Object.hasOwn(failure, 'limit')).toBe(expected.limit !== undefined);
    expect(NOVAPOSHTA_VALIDATION_CODES).toContain(failure.code);
};

describe('validation error details', () => {
    it.each([...syncCases, ...asyncCases])('%s', async (_name, run, expected) => {
        expectValidation(await capture(run), expected);
    });

    it('every known invalid input yields a validation error with a field and a documented code', async () => {
        const errors = await Promise.all([...syncCases, ...asyncCases].map(([, run]) => capture(run)));
        expect(errors.length).toBeGreaterThan(90);
        for (const error of errors) {
            expect(error).toBeInstanceOf(NovaPoshtaError);
            const failure = error as NovaPoshtaError;
            expect(failure.kind).toBe('validation');
            expect(failure.field).toBeTruthy();
            expect(NOVAPOSHTA_VALIDATION_CODES).toContain(failure.code);
        }
    });

    it('uses every documented code at least once', async () => {
        const errors = await Promise.all([...syncCases, ...asyncCases].map(([, run]) => capture(run)));
        const used = new Set(errors.map(error => (error as NovaPoshtaError).code));
        expect([...NOVAPOSHTA_VALIDATION_CODES].filter(code => !used.has(code))).toEqual([]);
    });

    it('keeps field, code and limit passed to the constructor', () => {
        const failure = new NovaPoshtaError('validation', 'm', '', '', { field: 'f', code: 'too_long', limit: 7 });
        expect([failure.field, failure.code, failure.limit]).toEqual(['f', 'too_long', 7]);
        const bare = new NovaPoshtaError('validation', 'm', '', '', { field: 'f', code: 'required' });
        expect([bare.field, bare.code]).toEqual(['f', 'required']);
        expect(Object.hasOwn(bare, 'limit')).toBe(false);
    });

    it('never sets a limit for type, format, presence or integer codes', async () => {
        const errors = await Promise.all([...syncCases, ...asyncCases].map(([, run]) => capture(run)));
        for (const error of errors as NovaPoshtaError[]) {
            if (['required', 'invalid_type', 'invalid_format', 'not_integer', 'not_allowed'].includes(error.code ?? '')) {
                expect(Object.hasOwn(error, 'limit')).toBe(false);
            }
        }
    });

    it('leaves the details unset on non-validation errors', () => {
        const failure = new NovaPoshtaError('api', 'x', 'M', 'm');
        expect(failure.field).toBeUndefined();
        expect(failure.code).toBeUndefined();
        expect(failure.limit).toBeUndefined();
        expect(Object.keys(failure)).not.toContain('code');
    });

    it('keeps the English messages', () => {
        expect(() => fitRecipientName({ lastName: '', firstName: 'a' })).toThrow('lastName is required');
        expect(() => validateShipmentDescription('а'.repeat(121))).toThrow('description is longer than 120 characters');
    });
});
