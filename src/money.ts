import { validationError } from './novaposhta-fields.js';

const AMOUNT_PATTERN = /^(\d+)(?:[.,](\d+))?$/;

export function uahToKopiyky(value: unknown): number {
    const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : null;
    const match = text === null ? null : AMOUNT_PATTERN.exec(text.trim());
    if (!match) {
        throw validationError(`Invalid UAH amount: ${String(value)}`);
    }
    const fraction = (match[2] ?? '').padEnd(3, '0');
    const kopiyky = Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
    const total = Number(match[1]) * 100 + kopiyky;
    if (!Number.isSafeInteger(total)) {
        throw validationError(`Invalid UAH amount: ${String(value)}`);
    }
    return total;
}

export function kopiykyToUah(minor: number): string {
    assertMinor(minor);
    const remainder = minor % 100;
    return `${(minor - remainder) / 100}.${String(remainder).padStart(2, '0')}`;
}

export function kopiykyToWholeUahCeil(minor: number): string {
    assertMinor(minor);
    const remainder = minor % 100;
    return String((minor - remainder) / 100 + (remainder > 0 ? 1 : 0));
}

function assertMinor(minor: number): void {
    if (!Number.isSafeInteger(minor) || minor < 0) {
        throw validationError(`Invalid minor units amount: ${String(minor)}`);
    }
}
