import { describe, expect, it } from 'vitest';
import { normalizePhone, tryNormalizePhone } from '../src/novaposhta-phone.js';

describe('normalizePhone', () => {
    it.each([
        ['380501112233', '380501112233'],
        ['+380501112233', '380501112233'],
        ['0501112233', '380501112233'],
        ['80501112233', '380501112233'],
        ['501112233', '380501112233'],
        ['+38 (050) 111-22-33', '380501112233'],
        ['38-050-111-22-33', '380501112233'],
    ])('%s -> %s', (raw, expected) => {
        expect(normalizePhone(raw)).toBe(expected);
        expect(tryNormalizePhone(raw)).toBe(expected);
    });

    it.each(['', 'abc', '12345', '3805011122334', '+1 202 555 0100', null, undefined, 42, {}])('rejects %j', raw => {
        expect(() => normalizePhone(raw as never)).toThrow(expect.objectContaining({ name: 'NovaPoshtaError', kind: 'validation', message: expect.stringMatching(/phone/i) }));
        expect(tryNormalizePhone(raw)).toBeNull();
    });

    it('never echoes the rejected number in the error', () => {
        let message = '';
        try {
            normalizePhone('+1 202 555 0100');
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toMatch(/phone/i);
        expect(message).not.toContain('202');
    });
});
