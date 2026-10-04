export type NovaPoshtaErrorKind = 'http' | 'network' | 'api' | 'timeout' | 'aborted' | 'parse' | 'validation' | 'limit';

export interface NovaPoshtaErrorDetails {
    errors?: string[];
    errorCodes?: string[];
    warnings?: string[];
    status?: number;
}

export class NovaPoshtaError extends Error {
    readonly errors: string[];
    readonly errorCodes: string[];
    readonly warnings: string[];
    readonly status: number | undefined;

    constructor(
        readonly kind: NovaPoshtaErrorKind,
        message: string,
        readonly modelName: string,
        readonly calledMethod: string,
        details: NovaPoshtaErrorDetails = {},
    ) {
        super(message);
        this.name = 'NovaPoshtaError';
        this.errors = details.errors ?? [];
        this.errorCodes = details.errorCodes ?? [];
        this.warnings = details.warnings ?? [];
        this.status = details.status;
    }
}

const NEVER_CREATED_KINDS: ReadonlySet<NovaPoshtaErrorKind> = new Set(['validation', 'api', 'limit']);

export function mayHaveCreatedWaybill(error: unknown): boolean {
    if (!(error instanceof NovaPoshtaError)) return false;
    if (NEVER_CREATED_KINDS.has(error.kind)) return false;
    if (error.kind !== 'http') return true;
    return error.status === undefined || error.status < 400 || error.status > 499;
}
