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
