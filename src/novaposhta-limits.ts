import { validationError } from './novaposhta-fields.js';
import type { RecipientName } from './novaposhta-recipient.js';

export const NP_FIRST_NAME_MAX = 25;
export const NP_MIDDLE_NAME_MAX = 25;
export const NP_FULL_NAME_MAX = 50;
export const NP_DESCRIPTION_MAX = 120;

export interface FittedRecipientName extends RecipientName {
    middleNameDropped: boolean;
}

const squeeze = (value: unknown): string => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');

const size = (value: string): number => Array.from(value).length;

export interface RecipientNameInput {
    lastName: string;
    firstName: string;
    middleName?: string | null | undefined;
}

export function fitRecipientName(name: RecipientNameInput): FittedRecipientName {
    const lastName = squeeze(name.lastName);
    const firstName = squeeze(name.firstName);
    const middleName = squeeze(name.middleName);
    if (!lastName) throw validationError('lastName is required');
    if (!firstName) throw validationError('firstName is required');
    if (size(firstName) > NP_FIRST_NAME_MAX) {
        throw validationError(`firstName is longer than ${NP_FIRST_NAME_MAX} characters`);
    }
    if (size(`${lastName} ${firstName}`) > NP_FULL_NAME_MAX) {
        throw validationError(`lastName and firstName together are longer than ${NP_FULL_NAME_MAX} characters`);
    }
    if (middleName && (size(middleName) > NP_MIDDLE_NAME_MAX || size(`${lastName} ${firstName} ${middleName}`) > NP_FULL_NAME_MAX)) {
        return { lastName, firstName, middleName: '', middleNameDropped: true };
    }
    return { lastName, firstName, middleName, middleNameDropped: false };
}

export function validateShipmentDescription(description: unknown): string {
    const text = squeeze(description);
    if (!text) {
        throw validationError('description is required');
    }
    if (size(text) > NP_DESCRIPTION_MAX) {
        throw validationError(`description is longer than ${NP_DESCRIPTION_MAX} characters`);
    }
    return text;
}
