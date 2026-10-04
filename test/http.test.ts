import { describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, parseJson, postJson, TransportError } from '../src/http.js';
import { mockFetch } from './helpers.js';

const allow = (url: URL) => url.protocol === 'https:' && url.host === 'api.novaposhta.ua';
const base = { maxBytes: 1000, isAllowedRedirect: allow };
const redirect = (status: number, location?: string) => ({ status, body: '', headers: location ? { location } : undefined });

describe('postJson', () => {
    it('has a 20 s default timeout and a 20 MiB default size limit', () => {
        expect(REQUEST_TIMEOUT_MS).toBe(20_000);
        expect(MAX_RESPONSE_BYTES).toBe(20 * 1024 * 1024);
    });

    it('posts json with manual redirect handling', async () => {
        const { fetch, calls } = mockFetch({ body: 'plain' });
        const res = await postJson('https://api.novaposhta.ua/x', { a: 1 }, { ...base, fetch });
        expect(res).toEqual({ ok: true, status: 200, text: 'plain' });
        expect(calls[0].init.redirect).toBe('manual');
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.body).toBe('{"a":1}');
    });

    it.each([301, 302, 303])('follows %i with a body-less GET to an allowed https host', async status => {
        const { fetch, calls } = mockFetch(redirect(status, 'https://api.novaposhta.ua/cache/f.json'), { body: 'file' });
        const res = await postJson('https://api.novaposhta.ua/json/', { apiKey: 'SECRET' }, { ...base, fetch });
        expect(res.text).toBe('file');
        expect(calls).toHaveLength(2);
        expect(calls[1].url).toBe('https://api.novaposhta.ua/cache/f.json');
        expect(calls[1].init.method).toBe('GET');
        expect(calls[1].init.body).toBeUndefined();
        expect(calls[1].init.redirect).toBe('manual');
        expect(JSON.stringify([calls[1].url, calls[1].init])).not.toContain('SECRET');
    });

    it.each([301, 302, 303])('refuses %i without following when redirects are off', async status => {
        const { fetch, calls } = mockFetch(redirect(status, 'https://api.novaposhta.ua/cache/f.json'), { body: 'file' });
        const error = await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch, followRedirects: false }).catch(e => e);
        expect(error).toBeInstanceOf(TransportError);
        expect(error).toMatchObject({ kind: 'http', status });
        expect(calls).toHaveLength(1);
    });

    it('resolves a relative location against the current url', async () => {
        const { fetch, calls } = mockFetch(redirect(303, '/cache/f.json'), { body: 'file' });
        await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch });
        expect(calls[1].url).toBe('https://api.novaposhta.ua/cache/f.json');
    });

    it.each([307, 308, 300, 305])('does not follow %i', async status => {
        const { fetch, calls } = mockFetch(redirect(status, 'https://api.novaposhta.ua/x'), { body: 'file' });
        const res = await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch });
        expect(res.ok).toBe(false);
        expect(res.status).toBe(status);
        expect(calls).toHaveLength(1);
    });

    it.each([
        ['another host', 'https://evil.example/f.json'],
        ['a lookalike host', 'https://api.novaposhta.ua.evil.example/f.json'],
        ['plain http', 'http://api.novaposhta.ua/f.json'],
        ['credentials', 'https://user:pw@api.novaposhta.ua/f.json'],
        ['another port', 'https://api.novaposhta.ua:8443/f.json'],
        ['a non-url', 'https://'],
    ])('refuses a redirect to %s without following', async (_name, location) => {
        const { fetch, calls } = mockFetch(redirect(303, location), { body: 'file' });
        const error = await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch }).catch(e => e);
        expect(error).toBeInstanceOf(TransportError);
        expect(error).toMatchObject({ kind: 'http', status: 303 });
        expect(calls).toHaveLength(1);
    });

    it('refuses a redirect without location', async () => {
        const { fetch } = mockFetch(redirect(303));
        await expect(postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch })).rejects.toMatchObject({ kind: 'http', status: 303 });
    });

    it('follows at most three hops', async () => {
        const hop = redirect(302, '/next');
        const ok = mockFetch(hop, hop, hop, { body: 'done' });
        expect((await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch: ok.fetch })).text).toBe('done');
        expect(ok.calls).toHaveLength(4);
        const tooMany = mockFetch(hop, hop, hop, hop, { body: 'done' });
        await expect(postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch: tooMany.fetch })).rejects.toMatchObject({ kind: 'http' });
        expect(tooMany.calls).toHaveLength(4);
    });

    it('rejects a body above the limit', async () => {
        const { fetch } = mockFetch({ body: 'x'.repeat(1001) });
        await expect(postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch })).rejects.toMatchObject({ kind: 'http' });
    });

    it('accepts a body exactly at the limit', async () => {
        const { fetch } = mockFetch({ body: 'x'.repeat(1000) });
        expect((await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch })).text).toHaveLength(1000);
    });

    it('rejects an oversized content-length before reading', async () => {
        const { fetch } = mockFetch({ body: 'x', headers: { 'content-length': '5000' } });
        const error = await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch }).catch(e => e);
        expect(error).toMatchObject({ kind: 'http' });
        expect(error.message).toMatch(/large/);
    });

    it('decodes multibyte text split across chunks', async () => {
        const bytes = new TextEncoder().encode('Київ');
        const fetch = (async () =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(bytes.slice(0, 3));
                        controller.enqueue(bytes.slice(3));
                        controller.close();
                    },
                }),
            )) as unknown as typeof globalThis.fetch;
        expect((await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch })).text).toBe('Київ');
    });

    it('handles a response without a body', async () => {
        const fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch;
        expect((await postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch })).text).toBe('');
    });

    it('reports network failures and aborts', async () => {
        const net = mockFetch(new TypeError('fetch failed'));
        await expect(postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch: net.fetch })).rejects.toMatchObject({ kind: 'network' });
        const abort = mockFetch(new DOMException('x', 'AbortError'));
        await expect(postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch: abort.fetch })).rejects.toMatchObject({ kind: 'abort' });
        const timeout = mockFetch(new DOMException('x', 'TimeoutError'));
        await expect(postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch: timeout.fetch })).rejects.toMatchObject({ kind: 'abort' });
    });

    it('reports an already aborted signal as abort', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetch = (async () => {
            throw new TypeError('boom');
        }) as unknown as typeof globalThis.fetch;
        await expect(postJson('https://api.novaposhta.ua/json/', {}, { ...base, fetch, signal: controller.signal })).rejects.toMatchObject({ kind: 'abort' });
    });

    it('parseJson parses valid json and rejects invalid json', () => {
        expect(parseJson('{"a":1}')).toEqual({ a: 1 });
        expect(() => parseJson('<html>')).toThrow(SyntaxError);
        expect(() => parseJson('')).toThrow(SyntaxError);
    });
});
