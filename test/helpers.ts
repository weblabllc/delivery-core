import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Envelope = { apiKey: string; modelName: string; calledMethod: string; methodProperties: Record<string, any> };

export type Call = { url: string; init: RequestInit; body: Envelope };

type Reply = { status?: number; body: unknown; headers?: Record<string, string> } | Error;

export function mockFetch(...replies: Reply[]) {
    const calls: Call[] = [];
    const queue = [...replies];
    const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(url), init, body: JSON.parse(String(init.body ?? 'null')) as Envelope });
        const next = queue.shift() ?? { status: 500, body: '' };
        if (next instanceof Error) {
            throw next;
        }
        const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
        return new Response(text, { status: next.status ?? 200, headers: next.headers });
    }) as typeof fetch;
    return { fetch: fetchImpl, calls };
}

export function npOk(data: unknown[], extra: Record<string, unknown> = {}) {
    return { success: true, data, errors: [], warnings: [], info: [], messageCodes: [], errorCodes: [], warningCodes: [], infoCodes: [], ...extra };
}

export function npFail(errors: string[], errorCodes: string[] = []) {
    return { success: false, data: [], errors, warnings: [], info: [], messageCodes: [], errorCodes, warningCodes: [], infoCodes: [] };
}

export function fixture(name: string): unknown {
    return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/novaposhta/${name}.json`, import.meta.url)), 'utf8'));
}

export function recordedDelays(): { delays: number[]; restore: () => void } {
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        return real(handler, 0);
    }) as unknown as typeof setTimeout;
    return { delays, restore: () => void (globalThis.setTimeout = real) };
}
