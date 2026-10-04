import type { DeliveryPointKind } from './delivery.js';
import { isRecord } from './guards.js';
import { kopiykyToWholeUahCeil, uahToKopiyky } from './money.js';
import { NovaPoshtaClient, NovaPoshtaError, RequestOptions } from './novaposhta-client.js';
import { apiError, asRecord, parseError, requireStr, str, validationError } from './novaposhta-fields.js';
import { fitRecipientName, RecipientNameInput, validateShipmentDescription } from './novaposhta-limits.js';
import { normalizePhone } from './novaposhta-phone.js';
import {
    assertCargoType,
    assertSeat,
    assertSeatsAmount,
    assertServiceType,
    gramsToKg,
    NovaPoshtaCargoType,
    NovaPoshtaServiceType,
    SeatInput,
    seatToApi,
} from './novaposhta-units.js';

export const PAYER_TYPES = ['Sender', 'Recipient', 'ThirdPerson'] as const;
export type NovaPoshtaPayerType = (typeof PAYER_TYPES)[number];

export const PAYMENT_METHODS = ['Cash', 'NonCash'] as const;
export type NovaPoshtaPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const POSTOMAT_MAX_WIDTH_CM = 40;
export const POSTOMAT_MAX_LENGTH_CM = 60;
export const POSTOMAT_MAX_HEIGHT_CM = 30;
export const POSTOMAT_MAX_WEIGHT_KG = 20;
export const POSTOMAT_MAX_DECLARED_MINOR = 2_900_000;
export const MIN_VOLUME_M3 = 0.0004;
export const DOCUMENTS_WEIGHTS_KG = ['0.1', '0.5', '1'] as const;
export const WAYBILL_MAX_MONTHS_AHEAD = 3;
export const DOCUMENT_NOT_FOUND_CODE = '20000201173';

const POINT_KINDS: readonly DeliveryPointKind[] = ['warehouse', 'postomat'];
const INTERNET_DOCUMENT = 'InternetDocumentGeneral';
const COUNTERPARTY = 'CounterpartyGeneral';

export interface PrivateRecipientInput extends RecipientNameInput {
    phone: string;
    email?: string;
}

export interface PrivateRecipient {
    counterpartyRef: string;
    contactRef: string;
}

export interface WaybillParty {
    cityRef: string;
    counterpartyRef: string;
    addressRef: string;
    contactRef: string;
    phone: string;
    warehouseIndex?: string;
}

export interface WaybillRecipient extends WaybillParty {
    pointKind: DeliveryPointKind;
}

export interface WaybillInput {
    payerType: NovaPoshtaPayerType;
    paymentMethod: NovaPoshtaPaymentMethod;
    cargoType: NovaPoshtaCargoType;
    serviceType: NovaPoshtaServiceType;
    weightGrams: number;
    seatsAmount: number;
    description: string;
    declaredValueMinor: number;
    sender: WaybillParty;
    recipient: WaybillRecipient;
    date?: Date;
    volumeCm3?: number;
    optionsSeat?: SeatInput[];
}

export interface Waybill {
    ref: string;
    number: string;
    costMinor: number | null;
    estimatedDeliveryDate: string | null;
    warnings: string[];
}

export interface CreateWaybillOptions extends RequestOptions {
    now?: Date;
}

interface DayParts {
    year: number;
    month: number;
    day: number;
}

const KYIV_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric' });

function kyivDay(date: Date): DayParts {
    const parts = KYIV_DAY.formatToParts(date);
    const pick = (type: string) => Number(parts.find(part => part.type === type)?.value);
    return { year: pick('year'), month: pick('month'), day: pick('day') };
}

const dayKey = ({ year, month, day }: DayParts): number => year * 10_000 + month * 100 + day;

function addMonths({ year, month, day }: DayParts, months: number): DayParts {
    const index = year * 12 + (month - 1) + months;
    const targetYear = Math.floor(index / 12);
    const targetMonth = (index % 12) + 1;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return { year: targetYear, month: targetMonth, day: Math.min(day, lastDay) };
}

export function formatNovaPoshtaDate(date: Date): string {
    const { year, month, day } = kyivDay(date);
    return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

function requireText(value: unknown, name: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        throw validationError(`${name} is required`);
    }
    return text;
}

function assertOneOf(value: unknown, allowed: readonly string[], name: string): void {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw validationError(`Invalid ${name}: ${String(value)}`);
    }
}

function assertValidDate(value: unknown, name: string): asserts value is Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw validationError(`Invalid ${name}: expected a valid date`);
    }
}

function assertDeclaredValue(minor: number): void {
    if (!Number.isSafeInteger(minor) || minor <= 0) {
        throw validationError(`Invalid declaredValueMinor: ${String(minor)} (expected a positive integer)`);
    }
}

function assertVolume(cm3: number | undefined): void {
    if (cm3 !== undefined && (typeof cm3 !== 'number' || !Number.isFinite(cm3) || cm3 <= 0)) {
        throw validationError(`Invalid volumeCm3: ${String(cm3)}`);
    }
}

function assertWaybillDate(date: Date, now: Date): void {
    assertValidDate(date, 'waybill date');
    const today = kyivDay(now);
    const day = dayKey(kyivDay(date));
    if (day < dayKey(today) || day > dayKey(addMonths(today, WAYBILL_MAX_MONTHS_AHEAD))) {
        throw validationError(`Invalid waybill date: must be from today to ${WAYBILL_MAX_MONTHS_AHEAD} months ahead (Kyiv time)`);
    }
}

function assertParty(party: WaybillParty, name: string): string {
    for (const key of ['cityRef', 'counterpartyRef', 'addressRef', 'contactRef'] as const) {
        requireText(party[key], `${name}.${key}`);
    }
    return normalizePhone(party.phone);
}

function volumeM3(cm3: number): number {
    return Number((cm3 / 1_000_000).toFixed(6));
}

interface Checked {
    description: string;
    weightKg: string;
    declared: string;
    sendersPhone: string;
    recipientsPhone: string;
    date: Date;
}

function assertGeneric(input: WaybillInput, now: Date): Checked {
    assertOneOf(input.payerType, PAYER_TYPES, 'payerType');
    assertOneOf(input.paymentMethod, PAYMENT_METHODS, 'paymentMethod');
    assertServiceType(input.serviceType);
    assertCargoType(input.cargoType);
    const description = validateShipmentDescription(input.description);
    const weightKg = gramsToKg(input.weightGrams);
    assertDeclaredValue(input.declaredValueMinor);
    const declared = kopiykyToWholeUahCeil(input.declaredValueMinor);
    assertSeatsAmount(input.seatsAmount);
    const sendersPhone = assertParty(input.sender, 'sender');
    const recipientsPhone = assertParty(input.recipient, 'recipient');
    assertOneOf(input.recipient.pointKind, POINT_KINDS, 'recipient.pointKind');
    const date = input.date ?? now;
    assertWaybillDate(date, now);
    assertVolume(input.volumeCm3);
    return { description, weightKg, declared, sendersPhone, recipientsPhone, date };
}

function assertSeats(input: WaybillInput, weightKg: string): void {
    if (input.cargoType === 'Documents' && !DOCUMENTS_WEIGHTS_KG.some(allowed => allowed === weightKg)) {
        throw validationError('Documents cargo weight must be 0.1, 0.5 or 1 kg');
    }
    if (!input.optionsSeat) {
        return;
    }
    if (!Array.isArray(input.optionsSeat) || input.optionsSeat.length === 0) {
        throw validationError('optionsSeat must contain at least one seat');
    }
    input.optionsSeat.forEach(assertSeat);
    if (input.optionsSeat.length !== input.seatsAmount) {
        throw validationError('optionsSeat length must equal seatsAmount');
    }
}

function postomatFail(reason: string): never {
    throw validationError(`Postomat delivery rejected: ${reason}`);
}

function assertPostomat(input: WaybillInput, weightKg: string): void {
    if (input.cargoType !== 'Parcel' && input.cargoType !== 'Documents') postomatFail('cargoType must be Parcel or Documents');
    if (input.seatsAmount !== 1) postomatFail('exactly one seat is allowed');
    const seats = input.optionsSeat;
    if (!seats || seats.length !== 1) postomatFail('optionsSeat with exactly one seat is required');
    const [seat] = seats;
    if (seat.widthCm > POSTOMAT_MAX_WIDTH_CM) postomatFail(`width exceeds ${POSTOMAT_MAX_WIDTH_CM} cm`);
    if (seat.lengthCm > POSTOMAT_MAX_LENGTH_CM) postomatFail(`length exceeds ${POSTOMAT_MAX_LENGTH_CM} cm`);
    if (seat.heightCm > POSTOMAT_MAX_HEIGHT_CM) postomatFail(`height exceeds ${POSTOMAT_MAX_HEIGHT_CM} cm`);
    if (Number(weightKg) > POSTOMAT_MAX_WEIGHT_KG || Number(gramsToKg(seat.weightGrams)) > POSTOMAT_MAX_WEIGHT_KG) postomatFail(`weight exceeds ${POSTOMAT_MAX_WEIGHT_KG} kg`);
    if (input.declaredValueMinor > POSTOMAT_MAX_DECLARED_MINOR) postomatFail('declared value exceeds 29000 UAH');
}

export async function createPrivateRecipient(client: NovaPoshtaClient, input: PrivateRecipientInput, options: RequestOptions = {}): Promise<PrivateRecipient> {
    const name = fitRecipientName(input);
    const properties: Record<string, unknown> = {
        FirstName: name.firstName,
        MiddleName: name.middleName,
        LastName: name.lastName,
        Phone: normalizePhone(input.phone),
        CounterpartyType: 'PrivatePerson',
        CounterpartyProperty: 'Recipient',
    };
    if (input.email) {
        properties.Email = input.email;
    }
    const response = await client.call(COUNTERPARTY, 'save', properties, { mode: 'write', signal: options.signal });
    if (response.data.length === 0) {
        throw parseError(COUNTERPARTY, 'save', 'empty reply');
    }
    const entry = asRecord(response.data[0], COUNTERPARTY, 'save');
    const contacts = isRecord(entry.ContactPerson) && Array.isArray(entry.ContactPerson.data) ? entry.ContactPerson.data : [];
    if (contacts.length === 0) {
        throw parseError(COUNTERPARTY, 'save', 'reply has no contact person');
    }
    return {
        counterpartyRef: requireStr(entry, 'Ref', COUNTERPARTY, 'save'),
        contactRef: requireStr(asRecord(contacts[0], COUNTERPARTY, 'save'), 'Ref', COUNTERPARTY, 'save'),
    };
}

export async function createWaybill(client: NovaPoshtaClient, input: WaybillInput, options: CreateWaybillOptions = {}): Promise<Waybill> {
    const now = options.now ?? new Date();
    assertValidDate(now, 'now');
    const { description, weightKg, declared, sendersPhone, recipientsPhone, date } = assertGeneric(input, now);
    assertSeats(input, weightKg);
    if (input.recipient.pointKind === 'postomat') {
        assertPostomat(input, weightKg);
    }

    const properties: Record<string, unknown> = {
        PayerType: input.payerType,
        PaymentMethod: input.paymentMethod,
        DateTime: formatNovaPoshtaDate(date),
        CargoType: input.cargoType,
        Weight: weightKg,
        ServiceType: input.serviceType,
        SeatsAmount: String(input.seatsAmount),
        Description: description,
        Cost: declared,
        CitySender: input.sender.cityRef,
        Sender: input.sender.counterpartyRef,
        SenderAddress: input.sender.addressRef,
        ContactSender: input.sender.contactRef,
        SendersPhone: sendersPhone,
        CityRecipient: input.recipient.cityRef,
        Recipient: input.recipient.counterpartyRef,
        RecipientAddress: input.recipient.addressRef,
        ContactRecipient: input.recipient.contactRef,
        RecipientsPhone: recipientsPhone,
    };
    if (input.optionsSeat) {
        properties.OptionsSeat = input.optionsSeat.map(seat => ({
            volumetricVolume: String(volumeM3(seat.widthCm * seat.lengthCm * seat.heightCm)),
            ...seatToApi(seat),
        }));
    } else {
        properties.VolumeGeneral = String(Math.max(MIN_VOLUME_M3, input.volumeCm3 === undefined ? 0 : volumeM3(input.volumeCm3)));
    }
    if (input.sender.warehouseIndex) properties.SenderWarehouseIndex = input.sender.warehouseIndex;
    if (input.recipient.warehouseIndex) properties.RecipientWarehouseIndex = input.recipient.warehouseIndex;

    const response = await client.call(INTERNET_DOCUMENT, 'save', properties, { mode: 'write', signal: options.signal });
    if (response.data.length === 0) {
        throw parseError(INTERNET_DOCUMENT, 'save', 'empty reply');
    }
    const entry = asRecord(response.data[0], INTERNET_DOCUMENT, 'save');
    return {
        ref: requireStr(entry, 'Ref', INTERNET_DOCUMENT, 'save'),
        number: requireStr(entry, 'IntDocNumber', INTERNET_DOCUMENT, 'save'),
        costMinor: costOnSite(entry),
        estimatedDeliveryDate: str(entry, 'EstimatedDeliveryDate') || null,
        warnings: response.warnings,
    };
}

function costOnSite(entry: Record<string, unknown>): number | null {
    const cost = entry.CostOnSite;
    if (cost === undefined || cost === null || cost === '') {
        return null;
    }
    try {
        return uahToKopiyky(cost);
    } catch {
        throw parseError(INTERNET_DOCUMENT, 'save', 'invalid CostOnSite');
    }
}

export async function deleteWaybill(client: NovaPoshtaClient, ref: string, options: RequestOptions = {}): Promise<string> {
    requireText(ref, 'ref');
    let response;
    try {
        response = await client.call(INTERNET_DOCUMENT, 'delete', { DocumentRefs: ref }, { mode: 'write', signal: options.signal });
    } catch (error) {
        if (error instanceof NovaPoshtaError && error.kind === 'api' && error.errorCodes.length === 1 && error.errorCodes[0] === DOCUMENT_NOT_FOUND_CODE) {
            return ref;
        }
        throw error;
    }
    const confirmed = response.data.some(entry => isRecord(entry) && str(entry, 'Ref') === ref);
    if (!confirmed) {
        throw apiError(INTERNET_DOCUMENT, 'delete', 'reply does not confirm the deleted ref', response.warnings);
    }
    return ref;
}
