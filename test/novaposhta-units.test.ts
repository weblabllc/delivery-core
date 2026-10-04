import { describe, expect, it } from 'vitest';
import { assertCargoType, assertSeat, assertSeatsAmount, assertServiceType, gramsToKg, seatToApi } from '../src/novaposhta-units.js';

describe('gramsToKg', () => {
    it.each([
        [1, '0.1'],
        [100, '0.1'],
        [101, '0.2'],
        [450, '0.5'],
        [500, '0.5'],
        [1000, '1'],
        [1001, '1.1'],
        [19999, '20'],
        [20000, '20'],
        [20001, '20.1'],
        [1234, '1.3'],
        [300, '0.3'],
        [700, '0.7'],
        [2300, '2.3'],
        [0.5, '0.1'],
    ])('%d g -> %s kg without rounding below the real weight', (grams, kg) => {
        expect(gramsToKg(grams)).toBe(kg);
    });

    it.each([0, -1, NaN, Infinity, '5' as never, null as never])('rejects %j', grams => {
        expect(() => gramsToKg(grams)).toThrow(expect.objectContaining({ name: 'NovaPoshtaError', kind: 'validation', message: expect.stringMatching(/weight/i) }));
    });
});

const validation = expect.objectContaining({ name: 'NovaPoshtaError', kind: 'validation' });

describe('unit assertions', () => {
    it('rejects an unknown service type, including WarehousePostomat', () => {
        expect(() => assertServiceType('WarehousePostomat')).toThrow(validation);
        expect(() => assertServiceType('WarehouseWarehouse')).not.toThrow();
    });

    it('rejects an unknown cargo type', () => {
        expect(() => assertCargoType('Gold')).toThrow(validation);
        expect(() => assertCargoType('Parcel')).not.toThrow();
    });

    it.each([0, 1.5, -1, NaN])('rejects seatsAmount %s', value => {
        expect(() => assertSeatsAmount(value)).toThrow(validation);
    });

    it.each([
        [{ weightGrams: 0, widthCm: 1, lengthCm: 1, heightCm: 1 }],
        [{ weightGrams: 1, widthCm: 0, lengthCm: 1, heightCm: 1 }],
        [{ weightGrams: 1, widthCm: 1.5, lengthCm: 1, heightCm: 1 }],
        [{ weightGrams: 1, widthCm: 1, lengthCm: 1.2, heightCm: 1 }],
        [{ weightGrams: 1, widthCm: 1, lengthCm: 1, heightCm: -1 }],
        [{ weightGrams: 1, widthCm: '1' as never, lengthCm: 1, heightCm: 1 }],
    ])('rejects seat %j', seat => {
        expect(() => assertSeat(seat)).toThrow(validation);
    });

    it('maps a seat to api fields in whole centimetres', () => {
        expect(seatToApi({ weightGrams: 1500, widthCm: 10, lengthCm: 20, heightCm: 30 })).toEqual({
            weight: '1.5',
            volumetricWidth: '10',
            volumetricLength: '20',
            volumetricHeight: '30',
        });
    });
});
