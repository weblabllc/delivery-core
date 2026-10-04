import { describe, expect, it } from 'vitest';
import { NovaPoshtaClient } from '../src/novaposhta-client.js';
import { getDocumentPrice } from '../src/novaposhta-pricing.js';
import { buildShipment, buildShipmentFromSeats, fitsPoint, MAX_SHIPMENT_UNITS, ShipmentFromSeatsInput, ShipmentInput } from '../src/novaposhta-shipment.js';
import { createWaybill, WaybillInput } from '../src/novaposhta-waybill.js';
import { Warehouse } from '../src/novaposhta-directories.js';
import { mockFetch, npOk } from './helpers.js';

const line = (patch: Partial<ShipmentInput['lines'][number]> = {}) => ({ weightGrams: 400, widthCm: 15, lengthCm: 22, heightCm: 3, quantity: 1, ...patch });

const input = (patch: Partial<ShipmentInput> = {}): ShipmentInput => ({
    lines: [line()],
    declaredValueMinor: 50000,
    point: { kind: 'warehouse' },
    ...patch,
});

const validation = { name: 'NovaPoshtaError', kind: 'validation' };

const warehouse = (patch: Partial<Warehouse> = {}): Warehouse => ({
    ref: 'r',
    number: '1',
    description: 'Відділення №1',
    shortAddress: null,
    cityRef: 'c',
    cityDescription: 'Київ',
    settlementRef: null,
    settlementDescription: null,
    typeRef: null,
    category: 'Branch',
    kind: 'warehouse',
    index: null,
    maxWeightKg: null,
    denyToSelect: false,
    receivingLimits: null,
    ...patch,
});

describe('buildShipment', () => {
    it('builds one parcel seat from a single line', () => {
        expect(buildShipment(input())).toEqual({
            cargoType: 'Parcel',
            serviceType: 'WarehouseWarehouse',
            weightGrams: 400,
            seatsAmount: 1,
            optionsSeat: [{ weightGrams: 400, widthCm: 15, lengthCm: 22, heightCm: 3 }],
            declaredValueMinor: 50000,
        });
    });

    it('multiplies weight by quantity and stacks units along the height', () => {
        const shipment = buildShipment(input({ lines: [line({ quantity: 3 })] }));
        expect(shipment.weightGrams).toBe(1200);
        expect(shipment.optionsSeat).toEqual([{ weightGrams: 1200, widthCm: 15, lengthCm: 22, heightCm: 9 }]);
    });

    it('sums lines, takes the widest footprint and stacks heights', () => {
        const shipment = buildShipment(
            input({ lines: [line({ weightGrams: 300, widthCm: 10, lengthCm: 30, heightCm: 2, quantity: 2 }), line({ weightGrams: 700, widthCm: 20, lengthCm: 25, heightCm: 5 })] }),
        );
        expect(shipment.weightGrams).toBe(1300);
        expect(shipment.optionsSeat).toEqual([{ weightGrams: 1300, widthCm: 20, lengthCm: 30, heightCm: 9 }]);
    });

    it('splits units over the requested seats keeping the total weight', () => {
        const shipment = buildShipment(input({ lines: [line({ weightGrams: 333, quantity: 4 })], seats: 3 }));
        expect(shipment.seatsAmount).toBe(3);
        expect(shipment.optionsSeat).toHaveLength(3);
        expect(shipment.optionsSeat!.reduce((sum, seat) => sum + seat.weightGrams, 0)).toBe(shipment.weightGrams);
        expect(shipment.weightGrams).toBe(1332);
        for (const seat of shipment.optionsSeat!) {
            expect(seat.weightGrams).toBeGreaterThan(0);
            expect(seat.heightCm).toBeGreaterThanOrEqual(3);
        }
    });

    it('keeps the same input producing the same output', () => {
        const a = buildShipment(input({ lines: [line({ quantity: 5 }), line({ weightGrams: 90, heightCm: 1 })], seats: 2 }));
        const b = buildShipment(input({ lines: [line({ quantity: 5 }), line({ weightGrams: 90, heightCm: 1 })], seats: 2 }));
        expect(a).toEqual(b);
    });

    it('rejects more seats than units', () => {
        expect(() => buildShipment(input({ seats: 2 }))).toThrow(expect.objectContaining(validation));
    });

    it.each([
        ['no lines', { lines: [] }],
        ['lines that are not an array', { lines: undefined as never }],
        ['a zero quantity', { lines: [line({ quantity: 0 })] }],
        ['a negative quantity', { lines: [line({ quantity: -1 })] }],
        ['a fractional quantity', { lines: [line({ quantity: 1.5 })] }],
        ['a zero weight', { lines: [line({ weightGrams: 0 })] }],
        ['a NaN weight', { lines: [line({ weightGrams: NaN })] }],
        ['a negative weight', { lines: [line({ weightGrams: -5 })] }],
        ['a zero width', { lines: [line({ widthCm: 0 })] }],
        ['a fractional weight', { lines: [line({ weightGrams: 400.5 })] }],
        ['an infinite weight', { lines: [line({ weightGrams: Infinity })] }],
        ['a fractional length', { lines: [line({ lengthCm: 2.5 })] }],
        ['a negative height', { lines: [line({ heightCm: -1 })] }],
        ['a string weight', { lines: [line({ weightGrams: '400' as never })] }],
        ['a null line', { lines: [null as never] }],
        ['a zero declared value', { declaredValueMinor: 0 }],
        ['a fractional declared value', { declaredValueMinor: 10.5 }],
        ['a NaN declared value', { declaredValueMinor: NaN }],
        ['an unknown point kind', { point: { kind: 'door' as never } }],
        ['a missing point', { point: undefined as never }],
        ['zero seats', { seats: 0 }],
        ['fractional seats', { seats: 1.5 }],
    ])('rejects %s before any request', (_name, patch) => {
        expect(() => buildShipment(input(patch))).toThrow(expect.objectContaining(validation));
    });

    it('rejects a null input', () => {
        expect(() => buildShipment(null as never)).toThrow(expect.objectContaining(validation));
    });

    it('caps the total units before expanding them', () => {
        expect(MAX_SHIPMENT_UNITS).toBe(1000);
        expect(buildShipment(input({ lines: [line({ weightGrams: 1, heightCm: 1, quantity: 1000 })] })).optionsSeat[0].heightCm).toBe(1000);
        expect(() => buildShipment(input({ lines: [line({ quantity: 1001 })] }))).toThrow(expect.objectContaining({ ...validation, message: expect.stringMatching(/1000/) }));
        expect(() => buildShipment(input({ lines: [line({ quantity: 600 }), line({ quantity: 401 })] }))).toThrow(expect.objectContaining(validation));
        expect(() => buildShipment(input({ lines: [line({ quantity: Number.MAX_SAFE_INTEGER })] }))).toThrow(expect.objectContaining(validation));
    });

    it('checks seats against the total units, counting quantities', () => {
        expect(buildShipment(input({ lines: [line({ quantity: 3 })], seats: 3 })).seatsAmount).toBe(3);
        expect(() => buildShipment(input({ lines: [line({ quantity: 3 })], seats: 4 }))).toThrow(expect.objectContaining(validation));
    });

    describe('postomat', () => {
        const postomat = (patch: Partial<ShipmentInput> = {}) => input({ point: { kind: 'postomat' }, ...patch });

        it('accepts the exact limits and orients the seat to fit', () => {
            const shipment = buildShipment(postomat({ lines: [line({ weightGrams: 20000, widthCm: 60, lengthCm: 30, heightCm: 40 })] }));
            expect(shipment.optionsSeat).toEqual([{ weightGrams: 20000, widthCm: 40, lengthCm: 60, heightCm: 30 }]);
            expect(shipment.seatsAmount).toBe(1);
        });

        it('keeps a seat that already fits unchanged in size', () => {
            const shipment = buildShipment(postomat());
            expect(shipment.optionsSeat![0]).toEqual({ weightGrams: 400, widthCm: 15, lengthCm: 22, heightCm: 3 });
        });

        it.each([
            ['two seats', { lines: [line({ quantity: 2 })], seats: 2 }],
            ['a seat too long', { lines: [line({ lengthCm: 61 })] }],
            ['a seat too wide for any orientation', { lines: [line({ widthCm: 41, lengthCm: 41, heightCm: 5 })] }],
            ['a stack too tall', { lines: [line({ heightCm: 10, quantity: 10 })] }],
            ['a seat above 20 kg', { lines: [line({ weightGrams: 20001 })] }],
            ['a declared value above 29000 UAH', { declaredValueMinor: 2_900_001 }],
        ])('rejects %s', (_name, patch) => {
            expect(() => buildShipment(postomat(patch))).toThrow(expect.objectContaining({ ...validation, message: expect.stringMatching(/ostomat/) }));
        });

        it('accepts a declared value of exactly 29000 UAH', () => {
            expect(buildShipment(postomat({ declaredValueMinor: 2_900_000 })).declaredValueMinor).toBe(2_900_000);
        });

        it('does not apply postomat limits to a warehouse', () => {
            expect(buildShipment(input({ lines: [line({ weightGrams: 25000, lengthCm: 90 })] })).weightGrams).toBe(25000);
        });
    });

    describe('shared by tariff and waybill', () => {
        const party = { cityRef: 'c', counterpartyRef: 'cp', addressRef: 'a', contactRef: 'ct', phone: '0501112233' };

        it.each(['warehouse', 'postomat'] as const)('feeds getDocumentPrice and createWaybill the same shipment for a %s', async kind => {
            const shipment = buildShipment(input({ lines: [line({ quantity: 2 })], point: { kind } }));
            const mock = mockFetch({ body: npOk([{ Cost: '95' }]) }, { body: npOk([{ Ref: 'doc', IntDocNumber: '1' }]) });
            const client = new NovaPoshtaClient({ apiKey: 'k', fetch: mock.fetch });
            await getDocumentPrice(client, { citySender: 's', cityRecipient: 'r', ...shipment });
            const waybill: WaybillInput = {
                payerType: 'Sender',
                paymentMethod: 'Cash',
                description: 'Книги',
                sender: party,
                recipient: { ...party, pointKind: kind },
                ...shipment,
            };
            await createWaybill(client, waybill);
            const [price, save] = mock.calls.map(call => call.body.methodProperties);
            expect(price.CargoType).toBe('Parcel');
            expect(save.CargoType).toBe('Parcel');
            for (const key of ['Weight', 'ServiceType', 'SeatsAmount', 'Cost']) {
                expect(price[key]).toEqual(save[key]);
            }
            expect(price.OptionsSeat).toEqual(
                save.OptionsSeat.map(({ volumetricVolume: _volume, ...seat }: Record<string, string>) => seat),
            );
        });
    });
});

describe('fitsPoint', () => {
    const shipment = (patch: Partial<ShipmentInput> = {}) => buildShipment(input(patch));

    it('fits a point without known limits', () => {
        expect(fitsPoint(warehouse(), shipment())).toEqual({ fits: true, reasons: [] });
    });

    it('rejects a seat heavier than the point allows, rounding up like the waybill', () => {
        const point = warehouse({ maxWeightKg: 1 });
        expect(fitsPoint(point, shipment({ lines: [line({ weightGrams: 1000 })] })).fits).toBe(true);
        expect(fitsPoint(point, shipment({ lines: [line({ weightGrams: 1001 })] }))).toEqual({ fits: false, reasons: ['weight'] });
    });

    it('compares dimensions in any orientation', () => {
        const point = warehouse({ receivingLimits: { width: 20, height: 10, length: 40 } });
        expect(fitsPoint(point, shipment({ lines: [line({ widthCm: 40, lengthCm: 10, heightCm: 20 })] })).fits).toBe(true);
        expect(fitsPoint(point, shipment({ lines: [line({ widthCm: 41, lengthCm: 10, heightCm: 5 })] }))).toEqual({ fits: false, reasons: ['dimensions'] });
    });

    it('reports every misfit at once', () => {
        const point = warehouse({ maxWeightKg: 1, receivingLimits: { width: 5, height: 5, length: 5 } });
        expect(fitsPoint(point, shipment({ lines: [line({ weightGrams: 5000 })] }))).toEqual({ fits: false, reasons: ['weight', 'dimensions'] });
    });

    it('checks every seat', () => {
        const point = warehouse({ maxWeightKg: 1 });
        const result = fitsPoint(point, shipment({ lines: [line({ weightGrams: 900, quantity: 2 }), line({ weightGrams: 1800 })], seats: 2 }));
        expect(result.fits).toBe(false);
    });

    it('applies the built-in postomat rules even without limits from the api', () => {
        const point = warehouse({ kind: 'postomat', category: 'Postomat' });
        expect(fitsPoint(point, shipment()).fits).toBe(true);
        expect(fitsPoint(point, shipment({ lines: [line({ weightGrams: 21000 })] }))).toEqual({ fits: false, reasons: ['weight'] });
        expect(fitsPoint(point, shipment({ lines: [line({ lengthCm: 70 })] }))).toEqual({ fits: false, reasons: ['dimensions'] });
        expect(fitsPoint(point, shipment({ lines: [line({ quantity: 2 })], seats: 2 }))).toEqual({ fits: false, reasons: ['seats'] });
        expect(fitsPoint(point, shipment({ declaredValueMinor: 2_900_001 }))).toEqual({ fits: false, reasons: ['declaredValue'] });
    });

    it('uses the stricter of the postomat rules and the api limits', () => {
        const point = warehouse({ kind: 'postomat', maxWeightKg: 5, receivingLimits: { width: 40, height: 30, length: 60 } });
        expect(fitsPoint(point, shipment({ lines: [line({ weightGrams: 6000 })] }))).toEqual({ fits: false, reasons: ['weight'] });
    });

    it('a branch is not limited by postomat rules', () => {
        expect(fitsPoint(warehouse(), shipment({ lines: [line({ weightGrams: 25000, lengthCm: 90 })], declaredValueMinor: 5_000_000 })).fits).toBe(true);
    });
});

describe('buildShipmentFromSeats', () => {
    const seat = (patch: Partial<ShipmentFromSeatsInput['seats'][number]> = {}) => ({ weightGrams: 400, widthCm: 15, lengthCm: 22, heightCm: 3, ...patch });
    const fromSeats = (patch: Partial<ShipmentFromSeatsInput> = {}): ShipmentFromSeatsInput => ({
        seats: [seat()],
        declaredValueMinor: 50000,
        point: { kind: 'warehouse' },
        ...patch,
    });

    it('keeps the given seats as they are', () => {
        const seats = [seat({ weightGrams: 700 }), seat({ weightGrams: 301, heightCm: 5 })];
        expect(buildShipmentFromSeats(fromSeats({ seats }))).toEqual({
            cargoType: 'Parcel',
            serviceType: 'WarehouseWarehouse',
            weightGrams: 1001,
            seatsAmount: 2,
            optionsSeat: seats,
            declaredValueMinor: 50000,
        });
    });

    it('does not share seat objects with the input', () => {
        const seats = [seat()];
        const shipment = buildShipmentFromSeats(fromSeats({ seats }));
        expect(shipment.optionsSeat[0]).not.toBe(seats[0]);
    });

    it('reproduces the seats of buildShipment', () => {
        const built = buildShipment(input({ lines: [line({ quantity: 5 }), line({ weightGrams: 90, heightCm: 1 })], seats: 2 }));
        const rebuilt = buildShipmentFromSeats({ seats: built.optionsSeat, declaredValueMinor: built.declaredValueMinor, point: { kind: 'warehouse' } });
        expect(rebuilt).toEqual(built);
    });

    it('applies the postomat rules and orients the seat', () => {
        const shipment = buildShipmentFromSeats(fromSeats({ seats: [seat({ weightGrams: 20000, widthCm: 60, lengthCm: 30, heightCm: 40 })], point: { kind: 'postomat' } }));
        expect(shipment.optionsSeat).toEqual([{ weightGrams: 20000, widthCm: 40, lengthCm: 60, heightCm: 30 }]);
    });

    it.each([
        ['two seats', { seats: [seat(), seat()] }],
        ['a seat above 20 kg', { seats: [seat({ weightGrams: 20001 })] }],
        ['a seat too long', { seats: [seat({ lengthCm: 61 })] }],
        ['a declared value above 29000 UAH', { declaredValueMinor: 2_900_001 }],
    ])('rejects %s for a postomat', (_name, patch) => {
        expect(() => buildShipmentFromSeats(fromSeats({ point: { kind: 'postomat' }, ...patch }))).toThrow(expect.objectContaining({ ...validation, message: expect.stringMatching(/ostomat/) }));
    });

    it.each([
        ['no seats', { seats: [] }],
        ['seats that are not an array', { seats: undefined as never }],
        ['a null seat', { seats: [null as never] }],
        ['more than 1000 seats', { seats: Array.from({ length: 1001 }, () => seat()) }],
        ['a zero weight', { seats: [seat({ weightGrams: 0 })] }],
        ['a fractional weight', { seats: [seat({ weightGrams: 10.5 })] }],
        ['a string weight', { seats: [seat({ weightGrams: '400' as never })] }],
        ['a zero width', { seats: [seat({ widthCm: 0 })] }],
        ['a fractional length', { seats: [seat({ lengthCm: 2.5 })] }],
        ['a negative height', { seats: [seat({ heightCm: -1 })] }],
        ['a zero declared value', { declaredValueMinor: 0 }],
        ['an unknown point kind', { point: { kind: 'door' as never } }],
        ['a missing point', { point: undefined as never }],
    ])('rejects %s', (_name, patch) => {
        expect(() => buildShipmentFromSeats(fromSeats(patch))).toThrow(expect.objectContaining(validation));
    });

    it('rejects a null input', () => {
        expect(() => buildShipmentFromSeats(null as never)).toThrow(expect.objectContaining(validation));
    });
});
