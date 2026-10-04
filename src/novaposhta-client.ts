import { isRecord } from './guards.js';
import { MAX_RESPONSE_BYTES, parseJson, postJson, PostJsonResult, REQUEST_TIMEOUT_MS, TransportError } from './http.js';
import { NovaPoshtaError, NovaPoshtaErrorDetails, NovaPoshtaErrorKind } from './novaposhta-error.js';
import { validationError } from './novaposhta-fields.js';

export { mayHaveCreatedWaybill, NovaPoshtaError } from './novaposhta-error.js';
export type { NovaPoshtaErrorDetails, NovaPoshtaErrorKind } from './novaposhta-error.js';

export const NOVAPOSHTA_BASE_URL = 'https://api.novaposhta.ua/v2.0/json/';

const API_HOST = 'api.novaposhta.ua';
const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1'];
const REDIRECT_HOSTS: readonly string[] = [API_HOST];
const RATE_LIMIT_CODE = '20000401501';
const MAX_TEXT_LENGTH = 2000;
const MAX_RETRIES_LIMIT = 5;
const MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_DEADLINE_MS = 45_000;

export interface RequestOptions {
    signal?: AbortSignal;
}

export interface CallOptions extends RequestOptions {
    mode?: 'read' | 'write';
}

export interface NovaPoshtaClientOptions {
    apiKey: string;
    timeoutMs?: number;
    deadlineMs?: number;
    baseUrl?: string;
    fetch?: typeof fetch;
    maxRetries?: number;
    retryDelayMs?: number;
    maxResponseBytes?: number;
    random?: () => number;
}

export interface NovaPoshtaResponse {
    data: unknown[];
    warnings: string[];
    warningCodes: string[];
    info: unknown;
}

function assertIntegerOption(name: string, value: number, min: number, max: number): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw validationError(`Invalid ${name}: ${String(value)} (expected integer ${min}..${max})`);
    }
}

function parseBaseUrl(baseUrl: string): { url: URL; local: boolean } {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        throw validationError('Invalid baseUrl: not a url');
    }
    const secure = url.protocol === 'https:' && url.host === API_HOST;
    const local = url.protocol === 'http:' && LOCAL_HOSTNAMES.includes(url.hostname);
    if (url.username || url.password || (!secure && !local)) {
        throw validationError(`Invalid baseUrl: only https://${API_HOST}/ is allowed`);
    }
    return { url, local };
}

const sleepFor = (ms: number, signal: AbortSignal, stopped: () => NovaPoshtaError): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(stopped());
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(stopped());
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });

const textOf = (entry: unknown): string => (isRecord(entry) ? Object.values(entry).map(String).join('; ') : String(entry));

export class NovaPoshtaClient {
    private readonly apiKey: string;
    private readonly timeoutMs: number;
    private readonly deadlineMs: number;
    private readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch | undefined;
    private readonly maxRetries: number;
    private readonly retryDelayMs: number;
    private readonly maxResponseBytes: number;
    private readonly random: () => number;
    private readonly isAllowedRedirect: (url: URL) => boolean;

    constructor(options: NovaPoshtaClientOptions) {
        if (!options.apiKey) {
            throw validationError('NovaPoshtaClient requires apiKey');
        }
        const { url, local } = parseBaseUrl(options.baseUrl ?? NOVAPOSHTA_BASE_URL);
        this.maxRetries = options.maxRetries ?? 2;
        this.retryDelayMs = options.retryDelayMs ?? 600;
        this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
        this.deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
        this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
        assertIntegerOption('maxRetries', this.maxRetries, 0, MAX_RETRIES_LIMIT);
        assertIntegerOption('retryDelayMs', this.retryDelayMs, 0, MAX_RETRY_DELAY_MS);
        assertIntegerOption('timeoutMs', this.timeoutMs, 1, Number.MAX_SAFE_INTEGER);
        assertIntegerOption('deadlineMs', this.deadlineMs, 1, Number.MAX_SAFE_INTEGER);
        assertIntegerOption('maxResponseBytes', this.maxResponseBytes, 1, Number.MAX_SAFE_INTEGER);
        this.apiKey = options.apiKey;
        this.baseUrl = url.href;
        this.fetchImpl = options.fetch;
        this.random = options.random ?? Math.random;
        const protocol = local ? 'http:' : 'https:';
        const hosts = local ? [url.host] : REDIRECT_HOSTS;
        this.isAllowedRedirect = target => target.protocol === protocol && hosts.includes(target.host);
    }

    async call(modelName: string, calledMethod: string, methodProperties: Record<string, unknown> = {}, options: CallOptions = {}): Promise<NovaPoshtaResponse> {
        const mode = options.mode ?? 'write';
        const deadline = AbortSignal.timeout(this.deadlineMs);
        const overall = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
        const stopped = () => this.failure(modelName, calledMethod, options.signal?.aborted ? 'aborted' : 'timeout', options.signal?.aborted ? 'request aborted' : 'request timed out');
        for (let attempt = 0; ; attempt++) {
            try {
                if (overall.aborted) {
                    throw stopped();
                }
                return await this.callOnce(modelName, calledMethod, methodProperties, mode, overall, options.signal);
            } catch (error) {
                if (!(error instanceof NovaPoshtaError) || attempt >= this.maxRetries || !this.isRetryable(error, mode)) {
                    throw error;
                }
                await sleepFor(this.backoff(attempt), overall, stopped);
            }
        }
    }

    private isRetryable(error: NovaPoshtaError, mode: 'read' | 'write'): boolean {
        if (error.kind === 'api') {
            return error.errorCodes.includes(RATE_LIMIT_CODE);
        }
        if (mode !== 'read') {
            return false;
        }
        return error.kind === 'network' || error.kind === 'timeout' || (error.kind === 'http' && error.status !== undefined && error.status >= 500);
    }

    private backoff(attempt: number): number {
        const exponential = Math.min(MAX_RETRY_DELAY_MS, this.retryDelayMs * 2 ** attempt);
        return Math.round(exponential * (0.5 + 0.5 * this.random()));
    }

    private async callOnce(
        modelName: string,
        calledMethod: string,
        methodProperties: Record<string, unknown>,
        mode: 'read' | 'write',
        overall: AbortSignal,
        external: AbortSignal | undefined,
    ): Promise<NovaPoshtaResponse> {
        const fail = (kind: NovaPoshtaErrorKind, message: string, details: NovaPoshtaErrorDetails = {}): never => {
            throw this.failure(modelName, calledMethod, kind, message, details);
        };

        let res: PostJsonResult;
        try {
            res = await postJson(
                this.baseUrl,
                { apiKey: this.apiKey, modelName, calledMethod, methodProperties },
                {
                    signal: AbortSignal.any([overall, AbortSignal.timeout(this.timeoutMs)]),
                    fetch: this.fetchImpl,
                    maxBytes: this.maxResponseBytes,
                    isAllowedRedirect: this.isAllowedRedirect,
                    followRedirects: mode === 'read',
                },
            );
        } catch (error) {
            if (!(error instanceof TransportError)) {
                throw error;
            }
            if (error.kind === 'abort') {
                return fail(external?.aborted ? 'aborted' : 'timeout', external?.aborted ? 'request aborted' : 'request timed out');
            }
            return fail(error.kind, error.message, { status: error.status });
        }

        if (!res.ok) {
            return fail('http', `HTTP ${res.status}`, { status: res.status });
        }
        let parsed: unknown;
        try {
            parsed = parseJson(res.text);
        } catch {
            return fail('parse', 'reply is not valid JSON', { status: res.status });
        }
        if (!isRecord(parsed)) {
            return fail('parse', 'reply is not a JSON object', { status: res.status });
        }
        const errors = this.strings(parsed.errors);
        const errorCodes = this.strings(parsed.errorCodes);
        const warnings = this.strings(parsed.warnings);
        if (parsed.success === false || (mode === 'write' && errors.length > 0)) {
            return fail('api', errors.join('; ') || 'request rejected', { errors, errorCodes, warnings, status: res.status });
        }
        if (!Array.isArray(parsed.data)) {
            return fail('parse', 'reply has no data array', { status: res.status });
        }
        return {
            data: parsed.data,
            warnings: [...warnings, ...errors],
            warningCodes: this.strings(parsed.warningCodes),
            info: parsed.info ?? null,
        };
    }

    private failure(modelName: string, calledMethod: string, kind: NovaPoshtaErrorKind, message: string, details: NovaPoshtaErrorDetails = {}): NovaPoshtaError {
        return new NovaPoshtaError(kind, this.clean(`NovaPoshta ${modelName}.${calledMethod}: ${message}`), modelName, calledMethod, {
            errors: details.errors?.map(text => this.clean(text)),
            errorCodes: details.errorCodes?.map(text => this.clean(text)),
            warnings: details.warnings?.map(text => this.clean(text)),
            status: details.status,
        });
    }

    private strings(value: unknown): string[] {
        const entries = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];
        return entries.map(entry => this.clean(textOf(entry)));
    }

    private clean(text: string): string {
        return text.split(this.apiKey).join('***').slice(0, MAX_TEXT_LENGTH);
    }
}
