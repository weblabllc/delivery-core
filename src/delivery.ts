export const DELIVERY_STATUSES = [
    'created',
    'in_transit',
    'arrived',
    'delivered',
    'refused',
    'returning',
    'cancelled',
    'lost',
    'not_found',
    'unknown',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type DeliveryPointKind = 'warehouse' | 'postomat';

export type CarrierDateString = string;

export interface TrackingRequest {
    number: string;
    phone?: string;
}

export interface TrackingResult {
    number: string;
    statusCode: string;
    status: DeliveryStatus;
    statusText: string;
    scheduledDeliveryDate: CarrierDateString | null;
    actualDeliveryDate: CarrierDateString | null;
    receivedAt: CarrierDateString | null;
    updatedAt: CarrierDateString | null;
}

export interface TrackOptions {
    signal?: AbortSignal;
}

export interface DeliveryCarrier {
    readonly code: string;
    track(documents: TrackingRequest[], options?: TrackOptions): Promise<TrackingResult[]>;
}
