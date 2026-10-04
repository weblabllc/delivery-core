import { describe, expect, it } from 'vitest';
import { DELIVERY_STATUSES, DeliveryStatus } from '../src/delivery.js';
import { mapNovaPoshtaStatus } from '../src/novaposhta-status.js';

const TABLE: Array<[string, DeliveryStatus]> = [
    ['1', 'created'],
    ['2', 'cancelled'],
    ['3', 'not_found'],
    ['4', 'in_transit'],
    ['41', 'in_transit'],
    ['5', 'in_transit'],
    ['6', 'in_transit'],
    ['7', 'arrived'],
    ['8', 'arrived'],
    ['9', 'delivered'],
    ['10', 'delivered'],
    ['11', 'delivered'],
    ['12', 'in_transit'],
    ['15', 'in_transit'],
    ['101', 'in_transit'],
    ['102', 'refused'],
    ['103', 'refused'],
    ['104', 'in_transit'],
    ['105', 'returning'],
    ['106', 'delivered'],
    ['107', 'in_transit'],
    ['111', 'in_transit'],
    ['112', 'in_transit'],
    ['124', 'lost'],
];

describe('mapNovaPoshtaStatus', () => {
    it.each(TABLE)('code %s -> %s', (code, status) => {
        expect(mapNovaPoshtaStatus(code)).toBe(status);
    });

    it.each(TABLE)('numeric code %s -> %s', (code, status) => {
        expect(mapNovaPoshtaStatus(Number(code))).toBe(status);
    });

    it.each(['0', '13', '14', '100', '108', '109', '110', '113', '999', '', 'abc', ' 9', '09'])('unknown code %j -> unknown', code => {
        expect(mapNovaPoshtaStatus(code)).toBe('unknown');
    });

    it.each([null, undefined, {}, NaN])('non-code %j -> unknown', value => {
        expect(mapNovaPoshtaStatus(value as never)).toBe('unknown');
    });

    it('only yields declared carrier-neutral statuses', () => {
        for (const [, status] of TABLE) {
            expect(DELIVERY_STATUSES).toContain(status);
        }
    });
});
