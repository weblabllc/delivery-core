import type { DeliveryPointKind } from './delivery.js';

export interface RecipientName {
    lastName: string;
    firstName: string;
    middleName: string;
}

export interface RecipientNameHint {
    firstName?: string | null;
    lastName?: string | null;
}

export interface PointReference {
    kind: DeliveryPointKind;
    number: string;
}

const words = (value: unknown): string[] => (typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []);

const same = (a: string, b: string): boolean => a.toLocaleLowerCase('uk') === b.toLocaleLowerCase('uk');

const clean = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '');

export function splitRecipientName(fullName: string | null | undefined, hint?: RecipientNameHint | null): RecipientName {
    const parts = words(fullName);
    const hintFirst = clean(hint?.firstName);
    const hintLast = clean(hint?.lastName);
    if (!parts.length) {
        return { lastName: hintLast, firstName: hintFirst, middleName: '' };
    }
    if (hintFirst && hintLast) {
        const firstIndex = parts.findIndex(part => same(part, hintFirst));
        const lastIndex = parts.findIndex(part => same(part, hintLast));
        if (firstIndex >= 0 && lastIndex >= 0 && firstIndex !== lastIndex) {
            const rest = parts.filter((_, index) => index !== firstIndex && index !== lastIndex);
            return { lastName: parts[lastIndex], firstName: parts[firstIndex], middleName: rest.join(' ') };
        }
    }
    const [lastName, firstName = '', ...rest] = parts;
    return { lastName, firstName, middleName: rest.join(' ') };
}

const POSTOMAT = /(?:поштомат|postomat)\s*(?:№|#|n)?\s*(\d+)/i;
const WAREHOUSE = /(?:в[іi]дд[іi]лення|в[іi]дд\.?|warehouse|branch|нова\s+пошта)\s*(?:№|#|n)?\s*(\d+)/i;

export function parsePointFromAddress(text: string | null | undefined | ReadonlyArray<string | null | undefined>): PointReference | null {
    const lines = typeof text === 'string' ? [text] : Array.isArray(text) ? text : [];
    const texts = lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
    for (const line of texts) {
        const postomat = POSTOMAT.exec(line);
        if (postomat) return { kind: 'postomat', number: postomat[1] };
    }
    for (const line of texts) {
        const warehouse = WAREHOUSE.exec(line);
        if (warehouse) return { kind: 'warehouse', number: warehouse[1] };
    }
    return null;
}
