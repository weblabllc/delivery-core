import type { DeliveryStatus } from './delivery.js';

const STATUS_BY_CODE = new Map<string, DeliveryStatus>([
    ['1', 'created'],
    ['2', 'cancelled'],
    ['3', 'not_found'],
    ...['4', '41', '5', '6', '12', '15', '101', '104', '107', '111', '112'].map((code): [string, DeliveryStatus] => [code, 'in_transit']),
    ...['7', '8'].map((code): [string, DeliveryStatus] => [code, 'arrived']),
    ...['9', '10', '11', '106'].map((code): [string, DeliveryStatus] => [code, 'delivered']),
    ...['102', '103'].map((code): [string, DeliveryStatus] => [code, 'refused']),
    ['105', 'returning'],
    ['124', 'lost'],
]);

export function mapNovaPoshtaStatus(statusCode: string | number): DeliveryStatus {
    if (typeof statusCode !== 'string' && typeof statusCode !== 'number') {
        return 'unknown';
    }
    return STATUS_BY_CODE.get(String(statusCode)) ?? 'unknown';
}
