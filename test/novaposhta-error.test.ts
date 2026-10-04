import { describe, expect, it } from 'vitest';
import { mayHaveCreatedWaybill, NovaPoshtaError, NovaPoshtaErrorKind } from '../src/novaposhta.js';
import * as root from '../src/index.js';

const failure = (kind: NovaPoshtaErrorKind, status?: number) => new NovaPoshtaError(kind, 'failure', 'InternetDocumentGeneral', 'save', { status });

describe('mayHaveCreatedWaybill', () => {
    it.each([
        ['timeout', failure('timeout'), true],
        ['aborted', failure('aborted'), true],
        ['network', failure('network'), true],
        ['parse', failure('parse'), true],
        ['http 500', failure('http', 500), true],
        ['http 503', failure('http', 503), true],
        ['http 599', failure('http', 599), true],
        ['http 499', failure('http', 499), false],
        ['http 400', failure('http', 400), false],
        ['http 404', failure('http', 404), false],
        ['http without status', failure('http'), true],
        ['http 200 with an unreadable body', failure('http', 200), true],
        ['http 302 redirect refused in write mode', failure('http', 302), true],
        ['http 399', failure('http', 399), true],
        ['http 600', failure('http', 600), true],
        ['validation', failure('validation'), false],
        ['api', failure('api'), false],
        ['limit is only thrown by read-only directory pagination, never by a write', failure('limit'), false],
        ['plain Error', new Error('boom'), false],
        ['look-alike object', { kind: 'timeout', status: 500 }, false],
        ['string', 'timeout', false],
        ['null', null, false],
        ['undefined', undefined, false],
    ])('%s -> %s', (_name, error, expected) => {
        expect(mayHaveCreatedWaybill(error)).toBe(expected);
    });

    it('is exported from the package root', () => {
        expect(root.mayHaveCreatedWaybill).toBe(mayHaveCreatedWaybill);
    });
});
