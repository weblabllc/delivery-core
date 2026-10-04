import { isRecord } from './guards.js';
import { NovaPoshtaError, NovaPoshtaValidationCode } from './novaposhta-error.js';

export function validationError(message: string, field: string, code: NovaPoshtaValidationCode, limit?: number): NovaPoshtaError {
    return new NovaPoshtaError('validation', message, '', '', { field, code, limit });
}

const finiteBound = (bound: number): number | undefined => (Number.isFinite(bound) && Math.abs(bound) < Number.MAX_SAFE_INTEGER ? bound : undefined);

export function checkInteger(value: unknown, field: string, min: number, max: number, message: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw validationError(message, field, 'invalid_type');
    }
    if (!Number.isInteger(value)) {
        throw validationError(message, field, 'not_integer');
    }
    if (value < min) {
        throw validationError(message, field, 'too_small', finiteBound(min));
    }
    if (value > max) {
        throw validationError(message, field, 'too_large', finiteBound(max));
    }
}

export function checkNonEmptyArray(value: unknown, field: string, message: string): asserts value is readonly unknown[] {
    if (!Array.isArray(value)) {
        throw validationError(message, field, 'invalid_type');
    }
    if (value.length === 0) {
        throw validationError(message, field, 'too_short', 1);
    }
}

export function checkPositive(value: unknown, field: string, message: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw validationError(message, field, 'invalid_type');
    }
    if (value <= 0) {
        throw validationError(message, field, 'too_small', 0);
    }
}

export function parseError(modelName: string, calledMethod: string, message: string): NovaPoshtaError {
    return new NovaPoshtaError('parse', `NovaPoshta ${modelName}.${calledMethod}: ${message}`, modelName, calledMethod);
}

export function apiError(modelName: string, calledMethod: string, message: string, warnings: string[] = []): NovaPoshtaError {
    return new NovaPoshtaError('api', `NovaPoshta ${modelName}.${calledMethod}: ${message}`, modelName, calledMethod, { warnings });
}

export function asRecord(value: unknown, modelName: string, calledMethod: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw parseError(modelName, calledMethod, 'unexpected entry shape');
    }
    return value;
}

export function str(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function optStr(record: Record<string, unknown>, key: string): string | null {
    return str(record, key).trim() || null;
}

export function requireStr(record: Record<string, unknown>, key: string, modelName: string, calledMethod: string): string {
    const value = str(record, key);
    if (!value) {
        throw parseError(modelName, calledMethod, `entry has no ${key}`);
    }
    return value;
}

export function num(record: Record<string, unknown>, key: string): number | null {
    const value = record[key];
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function flag(record: Record<string, unknown>, key: string): boolean {
    const value = record[key];
    return value === '1' || value === 1 || value === true;
}
