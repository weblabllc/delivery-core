import type { DeliveryPointKind } from './delivery.js';
import type { Warehouse } from './novaposhta-directories.js';
import { validationError } from './novaposhta-fields.js';
import { assertSeatsAmount, gramsToKg, NovaPoshtaCargoType, NovaPoshtaServiceType, SeatInput } from './novaposhta-units.js';
import {
    POSTOMAT_MAX_DECLARED_MINOR,
    POSTOMAT_MAX_HEIGHT_CM,
    POSTOMAT_MAX_LENGTH_CM,
    POSTOMAT_MAX_WEIGHT_KG,
    POSTOMAT_MAX_WIDTH_CM,
} from './novaposhta-waybill.js';

export interface ShipmentLine {
    weightGrams: number;
    widthCm: number;
    lengthCm: number;
    heightCm: number;
    quantity: number;
}

export interface ShipmentInput {
    lines: ShipmentLine[];
    declaredValueMinor: number;
    point: { kind: DeliveryPointKind };
    seats?: number;
}

export interface ShipmentFromSeatsInput {
    seats: SeatInput[];
    declaredValueMinor: number;
    point: { kind: DeliveryPointKind };
}

export const MAX_SHIPMENT_UNITS = 1000;

export interface Shipment {
    cargoType: Extract<NovaPoshtaCargoType, 'Parcel'>;
    serviceType: Extract<NovaPoshtaServiceType, 'WarehouseWarehouse'>;
    weightGrams: number;
    seatsAmount: number;
    optionsSeat: SeatInput[];
    declaredValueMinor: number;
}

export type PointMisfit = 'weight' | 'dimensions' | 'seats' | 'declaredValue';

export interface PointFit {
    fits: boolean;
    reasons: PointMisfit[];
}

interface Unit {
    weightGrams: number;
    widthCm: number;
    lengthCm: number;
    heightCm: number;
}

const POINT_KINDS: readonly DeliveryPointKind[] = ['warehouse', 'postomat'];
const POSTOMAT_SORTED_LIMITS: readonly number[] = [POSTOMAT_MAX_HEIGHT_CM, POSTOMAT_MAX_WIDTH_CM, POSTOMAT_MAX_LENGTH_CM].sort((a, b) => a - b);

function positiveNumber(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw validationError(`Invalid ${name}: ${String(value)} (expected a positive number)`);
    }
    return value;
}

function positiveInteger(value: unknown, name: string): number {
    const number = positiveNumber(value, name);
    if (!Number.isSafeInteger(number)) {
        throw validationError(`Invalid ${name}: ${String(value)} (expected a positive integer)`);
    }
    return number;
}

function recordOf(entry: unknown, label: string): Record<string, unknown> {
    if (typeof entry !== 'object' || entry === null) {
        throw validationError(`Invalid ${label}: expected an object`);
    }
    return { ...entry };
}

function validateSeatFields(record: Record<string, unknown>, label: string): SeatInput {
    return {
        weightGrams: positiveInteger(record.weightGrams, `${label}.weightGrams`),
        widthCm: positiveInteger(record.widthCm, `${label}.widthCm`),
        lengthCm: positiveInteger(record.lengthCm, `${label}.lengthCm`),
        heightCm: positiveInteger(record.heightCm, `${label}.heightCm`),
    };
}

function validateLine(entry: unknown, index: number): ShipmentLine {
    const label = `lines[${index}]`;
    const record = recordOf(entry, label);
    return { ...validateSeatFields(record, label), quantity: positiveInteger(record.quantity, `${label}.quantity`) };
}

function expand(lines: ShipmentLine[]): Unit[] {
    return lines.flatMap(line => Array.from({ length: line.quantity }, (): Unit => ({ weightGrams: line.weightGrams, widthCm: line.widthCm, lengthCm: line.lengthCm, heightCm: line.heightCm })));
}

function distribute(units: Unit[], seats: number): Unit[][] {
    const groups: Unit[][] = Array.from({ length: seats }, () => []);
    const stacked = Array.from({ length: seats }, () => 0);
    for (const unit of [...units].sort((a, b) => b.heightCm - a.heightCm || b.weightGrams - a.weightGrams)) {
        let target = 0;
        for (let i = 1; i < seats; i++) {
            if (stacked[i] < stacked[target]) target = i;
        }
        groups[target].push(unit);
        stacked[target] += unit.heightCm;
    }
    return groups;
}

function seatOf(units: Unit[]): SeatInput {
    return {
        weightGrams: units.reduce((sum, unit) => sum + unit.weightGrams, 0),
        widthCm: Math.max(...units.map(unit => unit.widthCm)),
        lengthCm: Math.max(...units.map(unit => unit.lengthCm)),
        heightCm: units.reduce((sum, unit) => sum + unit.heightCm, 0),
    };
}

const sortedDimensions = (seat: SeatInput): number[] => [seat.heightCm, seat.widthCm, seat.lengthCm].sort((a, b) => a - b);

const dimensionsFit = (seat: SeatInput, limits: readonly number[]): boolean => sortedDimensions(seat).every((value, index) => value <= limits[index]);

const weightFits = (seat: SeatInput, maxKg: number): boolean => Number(gramsToKg(seat.weightGrams)) <= maxKg;

function orientForPostomat(seat: SeatInput): SeatInput {
    const [height, width, length] = sortedDimensions(seat);
    return { ...seat, widthCm: width, lengthCm: length, heightCm: height };
}

function postomatFail(reason: string): never {
    throw validationError(`Postomat delivery rejected: ${reason}`);
}

function totalUnits(lines: ShipmentLine[]): number {
    let total = 0;
    for (const line of lines) {
        total += line.quantity;
        if (total > MAX_SHIPMENT_UNITS) {
            throw validationError(`Too many units: at most ${MAX_SHIPMENT_UNITS} are allowed per shipment`);
        }
    }
    return total;
}

function pointKindOf(point: unknown): DeliveryPointKind {
    const kind = typeof point === 'object' && point !== null ? Object.entries(point).find(([key]) => key === 'kind')?.[1] : undefined;
    const found = POINT_KINDS.find(entry => entry === kind);
    if (!found) {
        throw validationError(`Invalid point.kind: ${String(kind)}`);
    }
    return found;
}

function finalize(seats: SeatInput[], declaredValueMinor: number, kind: DeliveryPointKind): Shipment {
    let optionsSeat = seats;
    const weightGrams = optionsSeat.reduce((sum, seat) => sum + seat.weightGrams, 0);
    if (kind === 'postomat') {
        if (optionsSeat.length !== 1) postomatFail('exactly one seat is allowed');
        if (!dimensionsFit(optionsSeat[0], POSTOMAT_SORTED_LIMITS)) postomatFail(`seat exceeds ${POSTOMAT_MAX_WIDTH_CM}x${POSTOMAT_MAX_LENGTH_CM}x${POSTOMAT_MAX_HEIGHT_CM} cm`);
        if (!weightFits(optionsSeat[0], POSTOMAT_MAX_WEIGHT_KG)) postomatFail(`weight exceeds ${POSTOMAT_MAX_WEIGHT_KG} kg`);
        if (declaredValueMinor > POSTOMAT_MAX_DECLARED_MINOR) postomatFail('declared value exceeds 29000 UAH');
        optionsSeat = [orientForPostomat(optionsSeat[0])];
    }
    return { cargoType: 'Parcel', serviceType: 'WarehouseWarehouse', weightGrams, seatsAmount: optionsSeat.length, optionsSeat, declaredValueMinor };
}

export function buildShipment(input: ShipmentInput): Shipment {
    if (typeof input !== 'object' || input === null) {
        throw validationError('buildShipment requires an input object');
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
        throw validationError('lines must contain at least one entry');
    }
    const lines = input.lines.map(validateLine);
    const declaredValueMinor = positiveInteger(input.declaredValueMinor, 'declaredValueMinor');
    const kind = pointKindOf(input.point);
    const seats = input.seats ?? 1;
    assertSeatsAmount(seats);
    const total = totalUnits(lines);
    if (seats > total) {
        throw validationError(`seats (${seats}) exceed the number of units (${total})`);
    }
    return finalize(distribute(expand(lines), seats).map(seatOf), declaredValueMinor, kind);
}

export function buildShipmentFromSeats(input: ShipmentFromSeatsInput): Shipment {
    if (typeof input !== 'object' || input === null) {
        throw validationError('buildShipmentFromSeats requires an input object');
    }
    if (!Array.isArray(input.seats) || input.seats.length === 0) {
        throw validationError('seats must contain at least one entry');
    }
    if (input.seats.length > MAX_SHIPMENT_UNITS) {
        throw validationError(`Too many seats: at most ${MAX_SHIPMENT_UNITS} are allowed per shipment`);
    }
    const seats = input.seats.map((entry, index) => validateSeatFields(recordOf(entry, `seats[${index}]`), `seats[${index}]`));
    const declaredValueMinor = positiveInteger(input.declaredValueMinor, 'declaredValueMinor');
    return finalize(seats, declaredValueMinor, pointKindOf(input.point));
}

export function fitsPoint(point: Pick<Warehouse, 'kind' | 'maxWeightKg' | 'receivingLimits'>, shipment: Shipment): PointFit {
    const reasons: PointMisfit[] = [];
    const seats = shipment.optionsSeat;
    if (point.kind === 'postomat') {
        if (shipment.seatsAmount !== 1 || seats.length !== 1) reasons.push('seats');
        if (seats.some(seat => !weightFits(seat, POSTOMAT_MAX_WEIGHT_KG))) reasons.push('weight');
    }
    const maxKg = point.maxWeightKg;
    if (maxKg !== null && !reasons.includes('weight') && seats.some(seat => !weightFits(seat, maxKg))) {
        reasons.push('weight');
    }
    const limits = point.receivingLimits ? [point.receivingLimits.width, point.receivingLimits.height, point.receivingLimits.length].sort((a, b) => a - b) : null;
    const dimensionsOutside =
        (point.kind === 'postomat' && seats.some(seat => !dimensionsFit(seat, POSTOMAT_SORTED_LIMITS))) ||
        (limits !== null && seats.some(seat => !dimensionsFit(seat, limits)));
    if (dimensionsOutside) reasons.push('dimensions');
    if (point.kind === 'postomat' && shipment.declaredValueMinor > POSTOMAT_MAX_DECLARED_MINOR) reasons.push('declaredValue');
    return { fits: reasons.length === 0, reasons };
}
