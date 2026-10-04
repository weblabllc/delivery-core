import { describe, expect, it } from 'vitest';
import { fitRecipientName, NovaPoshtaError, validateShipmentDescription } from '../src/novaposhta.js';
import * as root from '../src/index.js';

const word = (length: number) => 'Т' + 'е'.repeat(length - 1);

describe('fitRecipientName', () => {
    it.each([
        ['keeps a short name', 'Петренко', 'Іван', 'Іванович', 'Іванович', false],
        ['accepts 16+16+16', word(16), word(16), word(16), word(16), false],
        ['accepts 25 middle with a short rest', 'Ли', 'Ян', word(25), word(25), false],
        ['drops 17+16+16', word(17), word(16), word(16), '', true],
        ['drops 30+15+4', word(30), word(15), word(4), '', true],
        ['drops 36+10+4', word(36), word(10), word(4), '', true],
        ['drops a 26 middle name', 'Ли', 'Ян', word(26), '', true],
        ['keeps an empty middle name', 'Петренко', 'Іван', '', '', false],
        ['treats a missing middle name as empty', 'Петренко', 'Іван', undefined, '', false],
        ['treats null middle name as empty', 'Петренко', 'Іван', null, '', false],
        ['treats blank middle name as empty', 'Петренко', 'Іван', '   ', '', false],
        ['collapses internal spaces of the middle name', 'Петренко', 'Іван', 'Іванович   Петрович', 'Іванович Петрович', false],
        ['accepts last+first exactly 50 without middle', word(24), word(25), '', '', false],
    ])('%s', (_name, lastName, firstName, middleName, expectedMiddle, dropped) => {
        const fitted = fitRecipientName({ lastName, firstName, middleName });
        expect(fitted).toEqual({ lastName, firstName, middleName: expectedMiddle, middleNameDropped: dropped });
    });

    it('trims and collapses spaces before measuring', () => {
        expect(fitRecipientName({ lastName: '  Петренко  ', firstName: 'Іван   Петрович', middleName: ' Іванович ' })).toEqual({
            lastName: 'Петренко',
            firstName: 'Іван Петрович',
            middleName: 'Іванович',
            middleNameDropped: false,
        });
    });

    it.each([
        ['empty last name', '', 'Іван'],
        ['blank first name', 'Петренко', '   '],
        ['first name over 25', 'Петренко', word(26)],
        ['last+first over 50', word(26), word(25)],
        ['non-string last name', undefined as unknown as string, 'Іван'],
    ])('rejects %s', (_name, lastName, firstName) => {
        expect(() => fitRecipientName({ lastName, firstName, middleName: 'Іванович' })).toThrow(NovaPoshtaError);
        try {
            fitRecipientName({ lastName, firstName, middleName: 'Іванович' });
        } catch (error) {
            expect(error).toMatchObject({ kind: 'validation' });
        }
    });

    it('never truncates the last name', () => {
        const fitted = fitRecipientName({ lastName: word(30), firstName: word(15), middleName: word(4) });
        expect(fitted.lastName).toBe(word(30));
        expect(fitted.firstName).toBe(word(15));
    });

    it('is exported from the package root', () => {
        expect(root.fitRecipientName).toBe(fitRecipientName);
    });
});

describe('validateShipmentDescription', () => {
    it.each([
        ['Книги', 'Книги'],
        ['  Книги  ', 'Книги'],
        ['Книги   для  школи', 'Книги для школи'],
        [word(120), word(120)],
        [`${'К'.repeat(59)}   ${'К'.repeat(60)}`, `${'К'.repeat(59)} ${'К'.repeat(60)}`],
        [`  ${word(120)}  `, word(120)],
        ['📚', '📚'],
    ])('accepts %s', (input, expected) => {
        expect(validateShipmentDescription(input)).toBe(expected);
    });

    it('counts collapsed whitespace, so 121 characters after collapsing is rejected', () => {
        expect(() => validateShipmentDescription(`${'К'.repeat(60)}   ${'К'.repeat(60)}`)).toThrow(NovaPoshtaError);
    });

    it.each([['empty', ''], ['blank', '   '], ['121 chars', word(121)], ['undefined', undefined], ['null', null], ['number', 5]])('rejects %s', (_name, input) => {
        expect(() => validateShipmentDescription(input)).toThrow(NovaPoshtaError);
        try {
            validateShipmentDescription(input);
        } catch (error) {
            expect(error).toMatchObject({ kind: 'validation' });
        }
    });
});
