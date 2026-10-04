export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

const FOLLOWED_STATUSES: ReadonlySet<number> = new Set([301, 302, 303]);

export type TransportErrorKind = 'http' | 'network' | 'abort';

export class TransportError extends Error {
    constructor(
        readonly kind: TransportErrorKind,
        message: string,
        readonly status?: number,
    ) {
        super(message);
        this.name = 'TransportError';
    }
}

export interface PostJsonOptions {
    headers?: Record<string, string>;
    fetch?: typeof fetch;
    signal?: AbortSignal;
    maxBytes: number;
    maxRedirects?: number;
    followRedirects?: boolean;
    isAllowedRedirect: (url: URL) => boolean;
}

export interface PostJsonResult {
    ok: boolean;
    status: number;
    text: string;
}

async function discard(res: Response): Promise<void> {
    await res.body?.cancel().catch(() => undefined);
}

async function readText(res: Response, maxBytes: number): Promise<string> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await discard(res);
        throw new TransportError('http', 'response too large', res.status);
    }
    const reader = res.body?.getReader();
    if (!reader) {
        return '';
    }
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        received += value.byteLength;
        if (received > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new TransportError('http', 'response too large', res.status);
        }
        text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
}

function nextTarget(res: Response, current: string, hop: number, options: PostJsonOptions): string {
    const refuse = (reason: string) => new TransportError('http', reason, res.status);
    const location = res.headers.get('location');
    if (!location) {
        throw refuse('redirect without location');
    }
    if (hop >= (options.maxRedirects ?? MAX_REDIRECTS)) {
        throw refuse('too many redirects');
    }
    let next: URL;
    try {
        next = new URL(location, current);
    } catch {
        throw refuse('invalid redirect target');
    }
    if (next.username || next.password || !options.isAllowedRedirect(next)) {
        throw refuse('unexpected redirect target');
    }
    return next.href;
}

function toTransportError(error: unknown, signal: AbortSignal | undefined): TransportError {
    if (error instanceof TransportError) {
        return error;
    }
    const name = error instanceof Error ? error.name : '';
    if (signal?.aborted || name === 'TimeoutError' || name === 'AbortError') {
        return new TransportError('abort', 'request aborted');
    }
    return new TransportError('network', `request failed: ${error instanceof Error ? error.message : String(error)}`);
}

export async function postJson(url: string, body: unknown, options: PostJsonOptions): Promise<PostJsonResult> {
    const fetchImpl = options.fetch ?? fetch;
    const first: RequestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...options.headers },
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: options.signal,
    };
    const followUp: RequestInit = { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual', signal: options.signal };
    try {
        let target = url;
        for (let hop = 0; ; hop++) {
            const res = await fetchImpl(target, hop === 0 ? first : followUp);
            if (FOLLOWED_STATUSES.has(res.status)) {
                await discard(res);
                if (options.followRedirects === false) {
                    throw new TransportError('http', 'unexpected redirect', res.status);
                }
                target = nextTarget(res, target, hop, options);
                continue;
            }
            if (!res.ok) {
                await discard(res);
                return { ok: false, status: res.status, text: '' };
            }
            return { ok: true, status: res.status, text: await readText(res, options.maxBytes) };
        }
    } catch (error) {
        throw toTransportError(error, options.signal);
    }
}

export function parseJson(text: string): unknown {
    return JSON.parse(text);
}
