export type NovaPoshtaErrorKind = 'http' | 'network' | 'api' | 'timeout' | 'aborted' | 'parse' | 'validation' | 'limit';

export const NOVAPOSHTA_VALIDATION_CODES = [
    'required',
    'too_long',
    'too_short',
    'invalid_type',
    'invalid_format',
    'too_small',
    'too_large',
    'not_integer',
    'not_allowed',
    'too_many',
    'does_not_fit',
    'mismatch',
] as const;

export type NovaPoshtaValidationCode = (typeof NOVAPOSHTA_VALIDATION_CODES)[number];

export interface NovaPoshtaErrorDetails {
    errors?: string[];
    errorCodes?: string[];
    warnings?: string[];
    status?: number;
    field?: string;
    code?: NovaPoshtaValidationCode;
    limit?: number;
}

export class NovaPoshtaError extends Error {
    readonly errors: string[];
    readonly errorCodes: string[];
    readonly warnings: string[];
    readonly status: number | undefined;
    declare readonly field?: string;
    declare readonly code?: NovaPoshtaValidationCode;
    declare readonly limit?: number;

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
        if (details.field !== undefined) this.field = details.field;
        if (details.code !== undefined) this.code = details.code;
        if (details.limit !== undefined) this.limit = details.limit;
    }
}

const NEVER_CREATED_KINDS: ReadonlySet<NovaPoshtaErrorKind> = new Set(['validation', 'api', 'limit']);

export function mayHaveCreatedWaybill(error: unknown): boolean {
    if (!(error instanceof NovaPoshtaError)) return false;
    if (NEVER_CREATED_KINDS.has(error.kind)) return false;
    if (error.kind !== 'http') return true;
    return error.status === undefined || error.status < 400 || error.status > 499;
}
