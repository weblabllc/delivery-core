import { describe, expect, it } from 'vitest';
import { pickSettlement, Settlement } from '../src/novaposhta-directories.js';
import { parsePointFromAddress, splitRecipientName } from '../src/novaposhta-recipient.js';

const settlement = (overrides: Partial<Settlement> = {}): Settlement => ({
    settlementRef: 'sref',
    cityRef: 'lviv-city',
    name: 'Львів',
    present: 'м. Львів, Львівська обл.',
    area: 'Львівська',
    region: null,
    type: 'м.',
    warehouses: 40,
    ...overrides,
});

describe('pickSettlement', () => {
    it('matches case-insensitively with apostrophe and spacing differences', () => {
        const match = pickSettlement(' кам’янець-подільський ', [settlement({ name: "Кам'янець-Подільський", cityRef: 'kp' })]);
        expect(match?.cityRef).toBe('kp');
        expect(pickSettlement("КАМ`ЯНЕЦЬ-ПОДІЛЬСЬКИЙ", [settlement({ name: 'Кам’янець-Подільський', cityRef: 'kp' })])?.cityRef).toBe('kp');
        expect(pickSettlement('Камʼянець-Подільський', [settlement({ name: "Кам'янець-Подільський", cityRef: 'kp' })])?.cityRef).toBe('kp');
    });

    it('requires an exact name, not a prefix', () => {
        expect(pickSettlement('Львів', [settlement({ name: 'Львівка' })])).toBeNull();
    });

    it('ignores entries without a city ref', () => {
        expect(pickSettlement('Львів', [settlement({ cityRef: null })])).toBeNull();
    });

    it('prefers the only entry that has warehouses', () => {
        const match = pickSettlement('Липники', [settlement({ name: 'Липники', cityRef: 'a', warehouses: 0 }), settlement({ name: 'Липники', cityRef: 'b', warehouses: 3 })]);
        expect(match?.cityRef).toBe('b');
    });

    it('treats a null warehouse count as none', () => {
        const match = pickSettlement('Липники', [settlement({ name: 'Липники', cityRef: 'a', warehouses: null }), settlement({ name: 'Липники', cityRef: 'b', warehouses: 3 })]);
        expect(match?.cityRef).toBe('b');
    });

    it('returns null when several candidates remain ambiguous', () => {
        expect(pickSettlement('Львів', [settlement({ cityRef: 'a' }), settlement({ cityRef: 'b', settlementRef: 'other' })])).toBeNull();
        expect(pickSettlement('Львів', [settlement({ cityRef: 'a', warehouses: 0 }), settlement({ cityRef: 'b', warehouses: 0 })])).toBeNull();
    });

    it('returns null for no candidates, blank or non-string text', () => {
        expect(pickSettlement('Львів', [])).toBeNull();
        expect(pickSettlement('   ', [settlement()])).toBeNull();
        expect(pickSettlement(undefined as never, [settlement()])).toBeNull();
    });
});

describe('splitRecipientName', () => {
    it('splits a three part name as last, first, middle', () => {
        expect(splitRecipientName('Петренко Іван Іванович')).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: 'Іванович' });
    });

    it('two parts default to last and first', () => {
        expect(splitRecipientName('Петренко Іван')).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: '' });
    });

    it('a single word becomes the last name', () => {
        expect(splitRecipientName('Петренко')).toEqual({ lastName: 'Петренко', firstName: '', middleName: '' });
    });

    it('extra words go to the middle name', () => {
        expect(splitRecipientName('Петренко Іван Іванович Оглы')).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: 'Іванович Оглы' });
    });

    it('collapses whitespace', () => {
        expect(splitRecipientName('  Петренко   Іван  ')).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: '' });
    });

    it('uses the hint to detect first name first order', () => {
        const hint = { firstName: 'Іван', lastName: 'Петренко' };
        expect(splitRecipientName('Іван Петренко', hint)).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: '' });
        expect(splitRecipientName('Іван Іванович Петренко', hint)).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: 'Іванович' });
    });

    it('matches the hint case-insensitively', () => {
        expect(splitRecipientName('ІВАН петренко', { firstName: 'Іван', lastName: 'Петренко' })).toEqual({ lastName: 'петренко', firstName: 'ІВАН', middleName: '' });
    });

    it('ignores a hint that does not match the text', () => {
        expect(splitRecipientName('Коваль Марія', { firstName: 'Іван', lastName: 'Петренко' })).toEqual({ lastName: 'Коваль', firstName: 'Марія', middleName: '' });
    });

    it('ignores a hint whose names are the same word', () => {
        expect(splitRecipientName('Іван Іванович', { firstName: 'Іван', lastName: 'Іван' })).toEqual({ lastName: 'Іван', firstName: 'Іванович', middleName: '' });
    });

    it('falls back to the hint for an empty name', () => {
        const hint = { firstName: 'Іван', lastName: 'Петренко' };
        expect(splitRecipientName('', hint)).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: '' });
        expect(splitRecipientName(undefined, hint)).toEqual({ lastName: 'Петренко', firstName: 'Іван', middleName: '' });
        expect(splitRecipientName('   ', { firstName: ' Іван ', lastName: null })).toEqual({ lastName: '', firstName: 'Іван', middleName: '' });
    });

    it('returns empty names for nothing', () => {
        expect(splitRecipientName(null)).toEqual({ lastName: '', firstName: '', middleName: '' });
        expect(splitRecipientName(undefined, null)).toEqual({ lastName: '', firstName: '', middleName: '' });
        expect(splitRecipientName(42 as never)).toEqual({ lastName: '', firstName: '', middleName: '' });
    });
});

describe('parsePointFromAddress', () => {
    it('parses a warehouse number from text or lines', () => {
        expect(parsePointFromAddress('Відділення №12')).toEqual({ kind: 'warehouse', number: '12' });
        expect(parsePointFromAddress(['вул. Шевченка 1', 'Відділення №12'])).toEqual({ kind: 'warehouse', number: '12' });
    });

    it('parses a postomat number', () => {
        expect(parsePointFromAddress('Поштомат 1234')).toEqual({ kind: 'postomat', number: '1234' });
    });

    it('parses variants with Latin letters and punctuation', () => {
        expect(parsePointFromAddress('Нова пошта, Вiддiлення # 7')).toEqual({ kind: 'warehouse', number: '7' });
        expect(parsePointFromAddress('Postomat №55')).toEqual({ kind: 'postomat', number: '55' });
        expect(parsePointFromAddress('відд. 3')).toEqual({ kind: 'warehouse', number: '3' });
        expect(parsePointFromAddress('Branch N 9')).toEqual({ kind: 'warehouse', number: '9' });
    });

    it('postomat wins over a warehouse mention in another line', () => {
        expect(parsePointFromAddress(['Відділення №1', 'Поштомат №2'])).toEqual({ kind: 'postomat', number: '2' });
    });

    it('returns null without a recognizable number', () => {
        expect(parsePointFromAddress('вул. Шевченка 10, кв. 5')).toBeNull();
        expect(parsePointFromAddress([])).toBeNull();
        expect(parsePointFromAddress([undefined, null, ''])).toBeNull();
        expect(parsePointFromAddress(null)).toBeNull();
        expect(parsePointFromAddress(undefined)).toBeNull();
        expect(parsePointFromAddress('   ')).toBeNull();
    });
});
