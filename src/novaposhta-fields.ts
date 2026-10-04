import { isRecord } from './guards.js';
import { NovaPoshtaError } from './novaposhta-error.js';

export function validationError(message: string): NovaPoshtaError {
    return new NovaPoshtaError('validation', message, '', '');
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
