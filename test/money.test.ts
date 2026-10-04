import { describe, expect, it } from 'vitest';
import { kopiykyToUah, kopiykyToWholeUahCeil, uahToKopiyky } from '../src/money.js';

describe('uahToKopiyky', () => {
    it.each([
        ['12.5', 1250],
        ['45', 4500],
        ['0.1', 10],
        ['300.01', 30001],
        ['0', 0],
        ['0.00', 0],
        ['19.99', 1999],
        ['1,5', 150],
        ['12.345', 1235],
        ['12.344', 1234],
        ['0.005', 1],
        ['0.004', 0],
        [' 7 ', 700],
        [90, 9000],
        [0.1, 10],
        [0.29, 29],
        [1.005, 101],
        [4.35, 435],
        [300.01, 30001],
    ])('%j -> %i', (input, expected) => {
        expect(uahToKopiyky(input)).toBe(expected);
    });

    it.each(['', 'abc', '-1', '1e3', '1.2.3', '.', ' ', null, undefined, NaN, Infinity, -5, {}])('rejects %j', input => {
        expect(() => uahToKopiyky(input)).toThrow(expect.objectContaining({ name: 'NovaPoshtaError', kind: 'validation', message: expect.stringMatching(/amount/i) }));
    });

    it.each(['90071992547409.92', '99999999999999999', 1e21, Number.MAX_SAFE_INTEGER])('rejects %j beyond the safe integer range', input => {
        expect(() => uahToKopiyky(input)).toThrow(expect.objectContaining({ kind: 'validation' }));
    });

    it('handles very large amounts without losing precision', () => {
        expect(uahToKopiyky('9007199254740.99')).toBe(900719925474099);
    });
});

describe('kopiykyToUah', () => {
    it.each([
        [1250, '12.50'],
        [4500, '45.00'],
        [10, '0.10'],
        [30001, '300.01'],
        [0, '0.00'],
        [5, '0.05'],
    ])('%i -> %s', (minor, expected) => {
        expect(kopiykyToUah(minor)).toBe(expected);
    });

    it.each([1.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects %j', minor => {
        expect(() => kopiykyToUah(minor)).toThrow(expect.objectContaining({ kind: 'validation', message: expect.stringMatching(/minor/i) }));
    });

    it('formats the largest safe amount exactly', () => {
        expect(kopiykyToUah(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    });
});

describe('kopiykyToWholeUahCeil', () => {
    it.each([
        [50000, '500'],
        [50001, '501'],
        [1, '1'],
        [30000, '300'],
        [0, '0'],
        [99, '1'],
        [101, '2'],
        [Number.MAX_SAFE_INTEGER, '90071992547410'],
    ])('%i -> %s rounding up', (minor, expected) => {
        expect(kopiykyToWholeUahCeil(minor)).toBe(expected);
    });
});

describe('kopiykyToWholeUahCeil validation', () => {
    it.each([1.5, -1, NaN])('rejects %j', minor => {
        expect(() => kopiykyToWholeUahCeil(minor)).toThrow(expect.objectContaining({ kind: 'validation' }));
    });
});
