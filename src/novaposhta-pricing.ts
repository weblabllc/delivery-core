import { kopiykyToWholeUahCeil, uahToKopiyky } from './money.js';
import { NovaPoshtaClient, RequestOptions } from './novaposhta-client.js';
import { asRecord, parseError } from './novaposhta-fields.js';
import {
    ApiSeat,
    assertCargoType,
    assertSeatsAmount,
    assertServiceType,
    gramsToKg,
    NovaPoshtaCargoType,
    NovaPoshtaServiceType,
    SeatInput,
    seatToApi,
} from './novaposhta-units.js';

export interface DocumentPriceInput {
    citySender: string;
    cityRecipient: string;
    weightGrams: number;
    serviceType: NovaPoshtaServiceType;
    declaredValueMinor: number;
    seatsAmount: number;
    cargoType: NovaPoshtaCargoType;
    optionsSeat?: SeatInput[];
}

export interface DocumentPrice {
    costMinor: number;
    assessedCostMinor: number | null;
    costRedeliveryMinor: number | null;
    costPackMinor: number | null;
    warnings: string[];
}

const MODEL = 'InternetDocumentGeneral';
const METHOD = 'getDocumentPrice';

function optionalMoney(record: Record<string, unknown>, key: string): number | null {
    const value = record[key];
    if (value === undefined || value === null || value === '') {
        return null;
    }
    try {
        return uahToKopiyky(value);
    } catch {
        throw parseError(MODEL, METHOD, `invalid ${key}`);
    }
}

function requiredMoney(record: Record<string, unknown>, key: string): number {
    const value = optionalMoney(record, key);
    if (value === null) {
        throw parseError(MODEL, METHOD, `missing ${key}`);
    }
    return value;
}

export async function getDocumentPrice(client: NovaPoshtaClient, input: DocumentPriceInput, options: RequestOptions = {}): Promise<DocumentPrice> {
    assertServiceType(input.serviceType);
    assertCargoType(input.cargoType);
    assertSeatsAmount(input.seatsAmount);
    const properties: Record<string, unknown> = {
        CitySender: input.citySender,
        CityRecipient: input.cityRecipient,
        Weight: gramsToKg(input.weightGrams),
        ServiceType: input.serviceType,
        Cost: kopiykyToWholeUahCeil(input.declaredValueMinor, 'declaredValueMinor'),
        CargoType: input.cargoType,
        SeatsAmount: String(input.seatsAmount),
    };
    if (input.optionsSeat) {
        properties.OptionsSeat = input.optionsSeat.map((seat, index): ApiSeat => seatToApi(seat, `optionsSeat[${index}]`));
    }
    const response = await client.call(MODEL, METHOD, properties, { mode: 'read', signal: options.signal });
    if (response.data.length === 0) {
        throw parseError(MODEL, METHOD, 'empty price reply');
    }
    const price = asRecord(response.data[0], MODEL, METHOD);
    return {
        costMinor: requiredMoney(price, 'Cost'),
        assessedCostMinor: optionalMoney(price, 'AssessedCost'),
        costRedeliveryMinor: optionalMoney(price, 'CostRedelivery'),
        costPackMinor: optionalMoney(price, 'CostPack'),
        warnings: response.warnings,
    };
}
