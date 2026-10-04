import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES } from '../src/http.js';
import { NOVAPOSHTA_BASE_URL, NovaPoshtaClient, NovaPoshtaError } from '../src/novaposhta-client.js';
import { mockFetch, npFail, npOk, recordedDelays } from './helpers.js';

const KEY = 'secret-key-0123456789';
const LIMIT = { body: npFail(['To many requests'], ['20000401501']) };
const read = { mode: 'read' } as const;

describe('NovaPoshtaClient', () => {
    it('posts the envelope to the fixed https endpoint', async () => {
        const { fetch, calls } = mockFetch({ body: npOk([{ a: 1 }]) });
        const client = new NovaPoshtaClient({ apiKey: KEY, fetch });
        const res = await client.call('AddressGeneral', 'getWarehouseTypes', { X: '1' });
        expect(NOVAPOSHTA_BASE_URL).toBe('https://api.novaposhta.ua/v2.0/json/');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://api.novaposhta.ua/v2.0/json/');
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.redirect).toBe('manual');
        expect(calls[0].body).toEqual({ apiKey: KEY, modelName: 'AddressGeneral', calledMethod: 'getWarehouseTypes', methodProperties: { X: '1' } });
        expect(res.data).toEqual([{ a: 1 }]);
    });

    it('defaults methodProperties to an empty object', async () => {
        const { fetch, calls } = mockFetch({ body: npOk([]) });
        await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm');
        expect(calls[0].body.methodProperties).toEqual({});
    });

    it('exposes warnings and warning codes', async () => {
        const { fetch } = mockFetch({ body: npOk([], { warnings: ['careful'], warningCodes: ['w1'] }) });
        const res = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm');
        expect(res.warnings).toEqual(['careful']);
        expect(res.warningCodes).toEqual(['w1']);
    });

    it('tolerates a response without optional arrays', async () => {
        const { fetch } = mockFetch({ body: { success: true, data: [{ x: 1 }] } });
        const res = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm');
        expect(res).toMatchObject({ data: [{ x: 1 }], warnings: [], warningCodes: [] });
    });

    it('flattens object warnings into strings', async () => {
        const { fetch } = mockFetch({ body: npOk([], { warnings: [{ ID_204: 'Please enter a valid phone number' }] }) });
        const res = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm');
        expect(res.warnings).toEqual(['Please enter a valid phone number']);
    });

    it('maps success:false to an api error with messages and codes', async () => {
        const { fetch } = mockFetch({ body: npFail(['Bad city', 'Bad weight'], ['20000100', '20000200']) });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('InternetDocumentGeneral', 'save').catch(e => e);
        expect(error).toBeInstanceOf(NovaPoshtaError);
        expect(error.kind).toBe('api');
        expect(error.errors).toEqual(['Bad city', 'Bad weight']);
        expect(error.errorCodes).toEqual(['20000100', '20000200']);
        expect(error.calledMethod).toBe('save');
        expect(error.modelName).toBe('InternetDocumentGeneral');
        expect(error.message).toContain('Bad city');
    });

    it('reads errors given as an object keyed by index or ref', async () => {
        const body = { ...npFail([], ['1']), errors: { '0': 'No document changed', 'ref-1': 'Document already deleted 1' } };
        const { fetch } = mockFetch({ body });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error).toMatchObject({ kind: 'api', errors: ['No document changed', 'Document already deleted 1'], errorCodes: ['1'] });
    });

    it('maps a non-2xx status to an http error', async () => {
        const { fetch } = mockFetch({ status: 502, body: 'bad gateway' });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error).toMatchObject({ kind: 'http', status: 502 });
    });

    it('maps a network failure to a network error', async () => {
        const { fetch } = mockFetch(new TypeError('fetch failed'));
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error).toMatchObject({ kind: 'network' });
        expect(error.message).toContain('fetch failed');
    });

    it('maps a timeout to a timeout error', async () => {
        const { fetch } = mockFetch(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error).toMatchObject({ kind: 'timeout' });
    });

    it('maps an abort without an external signal to a timeout error', async () => {
        const { fetch } = mockFetch(new DOMException('aborted', 'AbortError'));
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error.kind).toBe('timeout');
    });

    it('maps a non-JSON reply to a parse error', async () => {
        const { fetch } = mockFetch({ body: '<html>oops</html>' });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error).toMatchObject({ kind: 'parse' });
    });

    it('maps a non-object reply to a parse error', async () => {
        const { fetch } = mockFetch({ body: '[1]' });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error).toMatchObject({ kind: 'parse' });
    });

    it('maps a reply without data array to a parse error', async () => {
        const { fetch } = mockFetch({ body: { success: true } });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error.kind).toBe('parse');
    });

    it('maps an empty body to a parse error', async () => {
        const { fetch } = mockFetch({ body: '' });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error.kind).toBe('parse');
    });

    it('never leaks the api key through error fields', async () => {
        const echoes = [
            { body: npFail([`invalid key ${KEY}`], [KEY]) },
            { status: 500, body: `upstream said ${KEY}` },
            new TypeError(`fetch failed for ${KEY}`),
            { body: `not json ${KEY}` },
            { body: npOk([], { errors: [KEY] }) },
        ];
        for (const reply of echoes) {
            const { fetch } = mockFetch(reply);
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
            expect(error).toBeInstanceOf(NovaPoshtaError);
            expect(error.message).not.toContain(KEY);
            expect(error.stack).not.toContain(KEY);
            expect(JSON.stringify(error)).not.toContain(KEY);
            expect(JSON.stringify({ ...error })).not.toContain(KEY);
            expect(error.cause).toBeUndefined();
        }
    });

    it('never leaks a key straddling the truncation boundary', async () => {
        const text = `${'a'.repeat(1990)}${KEY}`;
        const { fetch } = mockFetch({ body: npFail([text]) });
        const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
        expect(error.errors[0]).not.toContain(KEY.slice(0, 5));
    });

    describe('options', () => {
        it('rejects an empty api key up front', () => {
            const error = (() => {
                try {
                    new NovaPoshtaClient({ apiKey: '' });
                } catch (e) {
                    return e;
                }
            })();
            expect(error).toBeInstanceOf(NovaPoshtaError);
            expect(error).toMatchObject({ kind: 'validation' });
            expect((error as Error).message).toMatch(/apiKey/);
        });

        it.each([
            ['https://api.novaposhta.ua/v2.0/json/'],
            ['https://api.novaposhta.ua/'],
            ['http://localhost:3000/json/'],
            ['http://localhost/json/'],
            ['http://127.0.0.1:8080/json/'],
            ['HTTPS://API.NOVAPOSHTA.UA/v2.0/json/'],
            ['https://Api.NovaPoshta.Ua:443/'],
        ])('accepts baseUrl %s', baseUrl => {
            expect(() => new NovaPoshtaClient({ apiKey: KEY, baseUrl })).not.toThrow();
        });

        it.each([
            ['http://api.novaposhta.ua/v2.0/json/'],
            ['https://evil.example/v2.0/json/'],
            ['https://api.novaposhta.ua.evil.example/'],
            ['https://api.novaposhta.ua@evil.example/'],
            ['https://user:pw@api.novaposhta.ua/'],
            ['https://api.novaposhta.ua:8443/'],
            ['https://localhost/'],
            ['http://evil.example/'],
            ['http://localhost.evil.example/'],
            ['https://api.novaposhta.ua./'],
            ['https://api.novaposhta.ua.:443/'],
            ['https://\u0430pi.novaposhta.ua/'],
            ['https://api.novaposhta.\u0443a/'],
            ['https://\u0430pi.\u043dovaposhta.ua/'],
            ['http://[::1]/'],
            ['http://[::1]:3000/json/'],
            ['http://[::ffff:127.0.0.1]/'],
            ['http://localhost./'],
            ['ftp://api.novaposhta.ua/'],
            ['not a url'],
            [''],
        ])('rejects baseUrl %j', baseUrl => {
            expect(() => new NovaPoshtaClient({ apiKey: KEY, baseUrl })).toThrowError(expect.objectContaining({ name: 'NovaPoshtaError', kind: 'validation' }));
        });

        it.each([[-1], [6], [1.5], [NaN], [Infinity]])('rejects maxRetries %s', maxRetries => {
            expect(() => new NovaPoshtaClient({ apiKey: KEY, maxRetries })).toThrow(expect.objectContaining({ kind: 'validation' }));
        });

        it.each([[0], [5]])('accepts maxRetries %s', maxRetries => {
            expect(() => new NovaPoshtaClient({ apiKey: KEY, maxRetries })).not.toThrow();
        });

        it.each([[-1], [10_001], [0.5], [NaN]])('rejects retryDelayMs %s', retryDelayMs => {
            expect(() => new NovaPoshtaClient({ apiKey: KEY, retryDelayMs })).toThrow(expect.objectContaining({ kind: 'validation' }));
        });

        it.each([[0], [10_000]])('accepts retryDelayMs %s', retryDelayMs => {
            expect(() => new NovaPoshtaClient({ apiKey: KEY, retryDelayMs })).not.toThrow();
        });

        it.each([
            ['timeoutMs', 0],
            ['timeoutMs', -5],
            ['timeoutMs', 1.5],
            ['deadlineMs', 0],
            ['deadlineMs', NaN],
            ['maxResponseBytes', 0],
            ['maxResponseBytes', 1.5],
        ])('rejects %s %s', (name, value) => {
            expect(() => new NovaPoshtaClient({ apiKey: KEY, [name]: value })).toThrow(expect.objectContaining({ kind: 'validation' }));
        });

        it('exposes the default response size limit', () => {
            expect(MAX_RESPONSE_BYTES).toBe(20 * 1024 * 1024);
        });
    });

    describe('retries', () => {
        it('retries a rate limited write and then succeeds', async () => {
            const { fetch, calls } = mockFetch(LIMIT, { body: npOk([{ ok: true }]) });
            const res = await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0 }).call('M', 'm');
            expect(res.data).toEqual([{ ok: true }]);
            expect(calls).toHaveLength(2);
        });

        it('gives up on a persistent rate limit after the retry budget', async () => {
            const { fetch, calls } = mockFetch(LIMIT, LIMIT, LIMIT, LIMIT, LIMIT);
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0, maxRetries: 2 }).call('M', 'm').catch(e => e);
            expect(error).toMatchObject({ kind: 'api', errorCodes: ['20000401501'] });
            expect(calls).toHaveLength(3);
        });

        it('does not retry when maxRetries is 0', async () => {
            const { fetch, calls } = mockFetch(LIMIT, { body: npOk([]) });
            await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0, maxRetries: 0 }).call('M', 'm', {}, read).catch(e => e);
            expect(calls).toHaveLength(1);
        });

        it('does not retry other api errors', async () => {
            const { fetch, calls } = mockFetch({ body: npFail(['nope'], ['1']) }, { body: npOk([]) });
            await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0 }).call('M', 'm', {}, read).catch(e => e);
            expect(calls).toHaveLength(1);
        });

        it('retries a read on 5xx', async () => {
            const { fetch, calls } = mockFetch({ status: 503, body: '' }, { status: 502, body: '' }, { body: npOk([{ ok: 1 }]) });
            const res = await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0 }).call('M', 'm', {}, read);
            expect(res.data).toEqual([{ ok: 1 }]);
            expect(calls).toHaveLength(3);
        });

        it('retries a read on a network error', async () => {
            const { fetch, calls } = mockFetch(new TypeError('fetch failed'), { body: npOk([{ ok: 1 }]) });
            await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0 }).call('M', 'm', {}, read);
            expect(calls).toHaveLength(2);
        });

        it('retries a read after a per-attempt timeout while the deadline still holds', async () => {
            let attempt = 0;
            const fetch = ((_url: string, init: RequestInit) => {
                attempt++;
                if (attempt === 1) {
                    return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
                }
                return Promise.resolve(new Response(JSON.stringify(npOk([{ ok: 1 }]))));
            }) as unknown as typeof globalThis.fetch;
            const res = await new NovaPoshtaClient({ apiKey: KEY, fetch, timeoutMs: 30, retryDelayMs: 0, deadlineMs: 5000 }).call('M', 'm', {}, read);
            expect(res.data).toEqual([{ ok: 1 }]);
            expect(attempt).toBe(2);
        });

        it('never retries a write after a per-attempt timeout', async () => {
            let attempt = 0;
            const fetch = ((_url: string, init: RequestInit) => {
                attempt++;
                return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
            }) as unknown as typeof globalThis.fetch;
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch, timeoutMs: 20, retryDelayMs: 0 }).call('M', 'm', {}, { mode: 'write' }).catch(e => e);
            expect(error.kind).toBe('timeout');
            expect(attempt).toBe(1);
        });

        it('stops retrying timeouts of a read when the deadline passes', async () => {
            let attempt = 0;
            const fetch = ((_url: string, init: RequestInit) => {
                attempt++;
                return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
            }) as unknown as typeof globalThis.fetch;
            const started = Date.now();
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch, timeoutMs: 20, retryDelayMs: 0, deadlineMs: 70, maxRetries: 5 }).call('M', 'm', {}, read).catch(e => e);
            expect(error.kind).toBe('timeout');
            expect(attempt).toBeGreaterThan(1);
            expect(attempt).toBeLessThan(6);
            expect(Date.now() - started).toBeLessThan(2000);
        });

        it('does not retry an external abort of a read', async () => {
            let attempt = 0;
            const fetch = ((_url: string, init: RequestInit) => {
                attempt++;
                return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
            }) as unknown as typeof globalThis.fetch;
            const controller = new AbortController();
            const pending = new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0 }).call('M', 'm', {}, { ...read, signal: controller.signal });
            setTimeout(() => controller.abort(), 20);
            await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
            expect(attempt).toBe(1);
        });

        it('stops retrying a read after the budget', async () => {
            const down = { status: 500, body: '' };
            const { fetch, calls } = mockFetch(down, down, down, down);
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0, maxRetries: 1 }).call('M', 'm', {}, read).catch(e => e);
            expect(error).toMatchObject({ kind: 'http', status: 500 });
            expect(calls).toHaveLength(2);
        });

        it('never retries a write on 5xx or a network error', async () => {
            const a = mockFetch({ status: 500, body: '' }, { body: npOk([]) });
            await new NovaPoshtaClient({ apiKey: KEY, fetch: a.fetch, retryDelayMs: 0 }).call('InternetDocumentGeneral', 'save', {}, { mode: 'write' }).catch(e => e);
            expect(a.calls).toHaveLength(1);
            const b = mockFetch(new TypeError('fetch failed'), { body: npOk([]) });
            await new NovaPoshtaClient({ apiKey: KEY, fetch: b.fetch, retryDelayMs: 0 }).call('InternetDocumentGeneral', 'save', {}, { mode: 'write' }).catch(e => e);
            expect(b.calls).toHaveLength(1);
        });

        it('does not retry client errors, redirects or oversized replies on reads', async () => {
            for (const reply of [{ status: 404, body: '' }, { status: 307, body: '', headers: { location: '/x' } }, { body: 'x'.repeat(200) }]) {
                const { fetch, calls } = mockFetch(reply, { body: npOk([]) });
                await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 0, maxResponseBytes: 100 }).call('M', 'm', {}, read).catch(e => e);
                expect(calls).toHaveLength(1);
            }
        });

        it('backs off exponentially with jitter', async () => {
            const recorder = recordedDelays();
            try {
                const down = { status: 500, body: '' };
                const full = mockFetch(down, down, down, { body: npOk([]) });
                await new NovaPoshtaClient({ apiKey: KEY, fetch: full.fetch, retryDelayMs: 100, maxRetries: 3, random: () => 1 }).call('M', 'm', {}, read);
                expect(recorder.delays).toEqual([100, 200, 400]);
                recorder.delays.length = 0;
                const half = mockFetch(down, down, { body: npOk([]) });
                await new NovaPoshtaClient({ apiKey: KEY, fetch: half.fetch, retryDelayMs: 100, random: () => 0 }).call('M', 'm', {}, read);
                expect(recorder.delays).toEqual([50, 100]);
            } finally {
                recorder.restore();
            }
        });

        it('caps the backoff at 10 seconds', async () => {
            const recorder = recordedDelays();
            try {
                const down = { status: 500, body: '' };
                const { fetch } = mockFetch(down, down, { body: npOk([]) });
                await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 10_000, random: () => 1 }).call('M', 'm', {}, read);
                expect(recorder.delays).toEqual([10_000, 10_000]);
            } finally {
                recorder.restore();
            }
        });
    });

    describe('success with errors', () => {
        const mixed = () => ({ body: npOk([{ Ref: 'x' }], { errors: ['partly failed'], errorCodes: ['E1'], warnings: ['w'] }) });

        it('treats errors on a successful write as an api error', async () => {
            const { fetch } = mockFetch(mixed());
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('InternetDocumentGeneral', 'save', {}, { mode: 'write' }).catch(e => e);
            expect(error).toMatchObject({ kind: 'api', errors: ['partly failed'], errorCodes: ['E1'], warnings: ['w'] });
        });

        it('treats the default mode as a write', async () => {
            const { fetch } = mockFetch(mixed());
            await expect(new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm')).rejects.toMatchObject({ kind: 'api' });
        });

        it('keeps the data of a read and surfaces the errors in warnings', async () => {
            const { fetch } = mockFetch(mixed());
            const res = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm', {}, read);
            expect(res.data).toEqual([{ Ref: 'x' }]);
            expect(res.warnings).toEqual(['w', 'partly failed']);
        });
    });

    describe('truncation and size', () => {
        it('truncates long error and warning text to 2000 characters', async () => {
            const long = 'e'.repeat(5000);
            const { fetch } = mockFetch({ body: npFail([long, 'short'], [long]) });
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm').catch(e => e);
            expect(error.errors[0]).toHaveLength(2000);
            expect(error.errors[1]).toBe('short');
            expect(error.errorCodes[0]).toHaveLength(2000);
            expect(error.message.length).toBeLessThan(2200);
            const warned = mockFetch({ body: npOk([], { warnings: [long] }) });
            const res = await new NovaPoshtaClient({ apiKey: KEY, fetch: warned.fetch }).call('M', 'm');
            expect(res.warnings[0]).toHaveLength(2000);
        });

        it('rejects a reply above the size limit as an http error', async () => {
            const { fetch } = mockFetch({ body: npOk([{ pad: 'x'.repeat(500) }]) });
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch, maxResponseBytes: 100 }).call('M', 'm').catch(e => e);
            expect(error).toMatchObject({ kind: 'http' });
            expect(error.message).toMatch(/large/);
        });
    });

    describe('redirects', () => {
        it('follows a 303 from the api to its own host with a body-less GET on a read', async () => {
            const { fetch, calls } = mockFetch(
                { status: 303, body: '', headers: { location: 'https://api.novaposhta.ua/cache/file.json' } },
                { body: npOk([{ a: 1 }]) },
            );
            const res = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm', {}, read);
            expect(res.data).toEqual([{ a: 1 }]);
            expect(calls).toHaveLength(2);
            expect(calls[1].init.method).toBe('GET');
            expect(calls[1].init.body).toBeUndefined();
            expect(JSON.stringify(calls[1])).not.toContain(KEY);
        });

        it.each([301, 302, 303])('never follows a %i on a write', async status => {
            for (const mode of ['write', undefined] as const) {
                const { fetch, calls } = mockFetch(
                    { status, body: '', headers: { location: 'https://api.novaposhta.ua/cache/file.json' } },
                    { body: npOk([{ a: 1 }]) },
                );
                const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('InternetDocumentGeneral', 'save', {}, mode ? { mode } : {}).catch(e => e);
                expect(error).toMatchObject({ name: 'NovaPoshtaError', kind: 'http', status });
                expect(error.message).not.toContain(KEY);
                expect(calls).toHaveLength(1);
            }
        });

        it.each([
            ['another host', 303, 'https://evil.example/file.json'],
            ['plain http', 302, 'http://api.novaposhta.ua/file.json'],
            ['a 307', 307, 'https://api.novaposhta.ua/file.json'],
            ['a 308', 308, 'https://api.novaposhta.ua/file.json'],
        ])('refuses %s without following', async (_name, status, location) => {
            const { fetch, calls } = mockFetch({ status, body: '', headers: { location } }, { body: npOk([{ a: 1 }]) });
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm', {}, read).catch(e => e);
            expect(error).toMatchObject({ kind: 'http', status });
            expect(error.message).not.toContain(KEY);
            expect(calls).toHaveLength(1);
        });

        it('refuses more than three hops', async () => {
            const hop = { status: 302, body: '', headers: { location: '/next' } };
            const { fetch, calls } = mockFetch(hop, hop, hop, hop, { body: npOk([]) });
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm', {}, read).catch(e => e);
            expect(error.kind).toBe('http');
            expect(calls).toHaveLength(4);
        });
    });

    describe('local server', () => {
        let server: Server | undefined;
        afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));

        it('follows a 303 redirect to a cached file on a local base url', async () => {
            const seen: Array<{ method?: string; body: string }> = [];
            server = createServer((req, res) => {
                let body = '';
                req.on('data', chunk => (body += chunk));
                req.on('end', () => {
                    seen.push({ method: req.method, body });
                    if (req.url === '/json/') {
                        res.writeHead(303, { location: '/cache/file.json' }).end();
                        return;
                    }
                    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(npOk([{ Ref: 'w1' }])));
                });
            });
            await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
            const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/json/`;
            const res = await new NovaPoshtaClient({ apiKey: KEY, baseUrl }).call('AddressGeneral', 'getWarehouses', {}, read);
            expect(res.data).toEqual([{ Ref: 'w1' }]);
            expect(seen[0].method).toBe('POST');
            expect(seen[1]).toEqual({ method: 'GET', body: '' });
        });
    });

    describe('cancellation and deadline', () => {
        const hanging = (() => ((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
            })) as unknown as typeof globalThis.fetch)();

        it('passes an abort signal to fetch', async () => {
            let signal: AbortSignal | null | undefined;
            const fetch = (async (_url: string, init: RequestInit) => {
                signal = init.signal;
                return new Response(JSON.stringify(npOk([])));
            }) as unknown as typeof globalThis.fetch;
            await new NovaPoshtaClient({ apiKey: KEY, fetch, timeoutMs: 5 }).call('M', 'm');
            expect(signal).toBeInstanceOf(AbortSignal);
        });

        it('aborts a hanging request after timeoutMs', async () => {
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch: hanging, timeoutMs: 20 }).call('M', 'm').catch(e => e);
            expect(error.kind).toBe('timeout');
        });

        it('aborts with kind aborted when the external signal fires mid-flight', async () => {
            const controller = new AbortController();
            const pending = new NovaPoshtaClient({ apiKey: KEY, fetch: hanging }).call('M', 'm', {}, { signal: controller.signal });
            setTimeout(() => controller.abort(), 10);
            await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
        });

        it('rejects immediately with kind aborted for an already aborted signal', async () => {
            const { fetch, calls } = mockFetch({ body: npOk([]) });
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm', {}, { signal: AbortSignal.abort() }).catch(e => e);
            expect(error).toMatchObject({ kind: 'aborted' });
            expect(calls).toHaveLength(0);
        });

        it('bounds all attempts by the deadline', async () => {
            const started = Date.now();
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch: hanging, timeoutMs: 10_000, deadlineMs: 40 }).call('M', 'm', {}, read).catch(e => e);
            expect(error.kind).toBe('timeout');
            expect(Date.now() - started).toBeLessThan(2000);
        });

        it('interrupts a backoff sleep when the deadline passes', async () => {
            const { fetch } = mockFetch(new TypeError('x'), new TypeError('x'), { body: npOk([]) });
            const started = Date.now();
            const error = await new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 10_000, deadlineMs: 40, random: () => 1 }).call('M', 'm', {}, read).catch(e => e);
            expect(error.kind).toBe('timeout');
            expect(Date.now() - started).toBeLessThan(2000);
        });

        it('interrupts a backoff sleep when the external signal fires', async () => {
            const controller = new AbortController();
            const { fetch } = mockFetch(new TypeError('x'), { body: npOk([]) });
            const pending = new NovaPoshtaClient({ apiKey: KEY, fetch, retryDelayMs: 10_000, random: () => 1 }).call('M', 'm', {}, { ...read, signal: controller.signal });
            setTimeout(() => controller.abort(), 20);
            const started = Date.now();
            await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
            expect(Date.now() - started).toBeLessThan(2000);
        });

        it('has a 45 s default deadline', async () => {
            let signal: AbortSignal | null | undefined;
            const fetch = (async (_url: string, init: RequestInit) => {
                signal = init.signal;
                return new Response(JSON.stringify(npOk([])));
            }) as unknown as typeof globalThis.fetch;
            await new NovaPoshtaClient({ apiKey: KEY, fetch }).call('M', 'm');
            expect(signal?.aborted).toBe(false);
        });
    });
});
