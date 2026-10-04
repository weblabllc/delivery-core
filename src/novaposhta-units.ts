import { validationError } from './novaposhta-fields.js';

export const SERVICE_TYPES = ['DoorsDoors', 'DoorsWarehouse', 'WarehouseWarehouse', 'WarehouseDoors'] as const;
export type NovaPoshtaServiceType = (typeof SERVICE_TYPES)[number];

export const CARGO_TYPES = ['Cargo', 'Documents', 'TiresWheels', 'Pallet', 'Parcel'] as const;
export type NovaPoshtaCargoType = (typeof CARGO_TYPES)[number];

export interface SeatInput {
    weightGrams: number;
    widthCm: number;
    lengthCm: number;
    heightCm: number;
}

export interface ApiSeat {
    weight: string;
    volumetricWidth: string;
    volumetricLength: string;
    volumetricHeight: string;
}

export function gramsToKg(grams: number): string {
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) {
        throw validationError(`Invalid weight in grams: ${String(grams)}`);
    }
    return String(Math.ceil(grams / 100) / 10);
}

export function assertServiceType(value: string): asserts value is NovaPoshtaServiceType {
    if (!(SERVICE_TYPES as readonly string[]).includes(value)) {
        throw validationError(`Invalid serviceType: ${value}`);
    }
}

export function assertCargoType(value: string): asserts value is NovaPoshtaCargoType {
    if (!(CARGO_TYPES as readonly string[]).includes(value)) {
        throw validationError(`Invalid cargoType: ${value}`);
    }
}

export function assertSeatsAmount(value: number): void {
    if (!Number.isInteger(value) || value < 1) {
        throw validationError(`Invalid seatsAmount: ${String(value)}`);
    }
}

export function assertSeat(seat: SeatInput): void {
    for (const key of ['widthCm', 'lengthCm', 'heightCm'] as const) {
        const value = seat[key];
        if (!Number.isInteger(value) || value <= 0) {
            throw validationError(`Invalid seat ${key}: ${String(value)} (expected whole centimetres)`);
        }
    }
    gramsToKg(seat.weightGrams);
}

export function seatToApi(seat: SeatInput): ApiSeat {
    assertSeat(seat);
    return {
        weight: gramsToKg(seat.weightGrams),
        volumetricWidth: String(seat.widthCm),
        volumetricLength: String(seat.lengthCm),
        volumetricHeight: String(seat.heightCm),
    };
}
