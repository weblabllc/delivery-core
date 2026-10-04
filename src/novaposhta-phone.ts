import { validationError } from './novaposhta-fields.js';

export function tryNormalizePhone(raw: unknown): string | null {
    const digits = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
    if (/^380\d{9}$/.test(digits)) return digits;
    if (/^80\d{9}$/.test(digits)) return `3${digits}`;
    if (/^0\d{9}$/.test(digits)) return `38${digits}`;
    if (/^\d{9}$/.test(digits)) return `380${digits}`;
    return null;
}

export function normalizePhone(raw: string, field = 'phone'): string {
    const normalized = tryNormalizePhone(raw);
    if (normalized === null) {
        const message = 'Invalid phone number: expected a Ukrainian number (380XXXXXXXXX)';
        if (typeof raw !== 'string') throw validationError(message, field, 'invalid_type');
        throw validationError(message, field, raw.trim() === '' ? 'required' : 'invalid_format');
    }
    return normalized;
}
