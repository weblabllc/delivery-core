import type { DeliveryPointKind } from './delivery.js';
import { isRecord } from './guards.js';
import { NovaPoshtaClient, NovaPoshtaResponse, RequestOptions } from './novaposhta-client.js';
import { NovaPoshtaError } from './novaposhta-error.js';
import { asRecord, flag, num, optStr, requireStr, str, validationError } from './novaposhta-fields.js';

const MODEL = 'AddressGeneral';
const COUNTERPARTY_MODEL = 'CounterpartyGeneral';
const MAX_PAGE_SIZE = 500;
const MAX_PAGES = 50;

export interface PageOptions extends RequestOptions {
    page?: number;
    limit?: number;
}

export interface Settlement {
    settlementRef: string;
    cityRef: string | null;
    name: string;
    present: string | null;
    area: string | null;
    region: string | null;
    type: string | null;
    warehouses: number | null;
}

export interface WarehouseQuery extends PageOptions {
    cityRef?: string;
    settlementRef?: string;
    query?: string;
    number?: string;
    typeRef?: string;
}

export interface DimensionLimits {
    width: number;
    height: number;
    length: number;
}

export interface Warehouse {
    ref: string;
    number: string;
    description: string;
    shortAddress: string | null;
    cityRef: string | null;
    cityDescription: string | null;
    settlementRef: string | null;
    settlementDescription: string | null;
    typeRef: string | null;
    category: string | null;
    kind: DeliveryPointKind;
    index: string | null;
    maxWeightKg: number | null;
    denyToSelect: boolean;
    receivingLimits: DimensionLimits | null;
}

export interface WarehouseType {
    ref: string;
    description: string;
}

export interface SenderCounterparty {
    ref: string;
    description: string;
    type: string;
}

export interface ContactPerson {
    ref: string;
    name: string | null;
    firstName: string | null;
    middleName: string | null;
    lastName: string | null;
    phones: string[];
    email: string | null;
}

function assertInteger(value: number, name: string, min: number, max: number): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw validationError(`Invalid ${name}: ${value} (expected integer ${min}..${max})`);
    }
}

function paging(options: PageOptions, defaults: { page: number; limit: number }): { Page: string; Limit: string } {
    const page = options.page ?? defaults.page;
    const limit = options.limit ?? defaults.limit;
    assertInteger(page, 'page', 1, Number.MAX_SAFE_INTEGER);
    assertInteger(limit, 'limit', 1, MAX_PAGE_SIZE);
    return { Page: String(page), Limit: String(limit) };
}

function totalCount(response: NovaPoshtaResponse): number | null {
    return isRecord(response.info) && typeof response.info.totalCount === 'number' ? response.info.totalCount : null;
}

function refOf(entry: unknown): string | null {
    return isRecord(entry) ? str(entry, 'Ref') || null : null;
}

async function fetchAllPages(
    client: NovaPoshtaClient,
    modelName: string,
    calledMethod: string,
    properties: Record<string, unknown>,
    pageSize: number | null,
    signal: AbortSignal | undefined,
): Promise<unknown[]> {
    const items: unknown[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
        const pageProps = pageSize === null ? { ...properties, Page: String(page) } : { ...properties, Page: String(page), Limit: String(pageSize) };
        const response = await client.call(modelName, calledMethod, pageProps, { mode: 'read', signal });
        let added = 0;
        for (const entry of response.data) {
            const ref = refOf(entry);
            if (ref !== null && seen.has(ref)) {
                continue;
            }
            if (ref !== null) {
                seen.add(ref);
            }
            items.push(entry);
            added++;
        }
        const total = totalCount(response);
        const finished =
            response.data.length === 0 ||
            added === 0 ||
            (total !== null && items.length >= total) ||
            (pageSize !== null && response.data.length !== pageSize);
        if (finished) {
            return items;
        }
    }
    throw new NovaPoshtaError('limit', `NovaPoshta ${modelName}.${calledMethod}: more than ${MAX_PAGES} pages`, modelName, calledMethod);
}

export async function searchSettlements(client: NovaPoshtaClient, query: string, options: PageOptions = {}): Promise<Settlement[]> {
    if (typeof query !== 'string') {
        throw validationError('query must be a string');
    }
    const cityName = query.trim();
    if (!cityName) {
        return [];
    }
    const { Page, Limit } = paging(options, { page: 1, limit: 20 });
    const response = await client.call('AddressGeneral', 'searchSettlements', { CityName: cityName, Page, Limit }, { mode: 'read', signal: options.signal });
    const first = response.data[0];
    if (first === undefined) {
        return [];
    }
    const addresses = asRecord(first, MODEL, 'searchSettlements').Addresses;
    if (!Array.isArray(addresses)) {
        return [];
    }
    return addresses.map(entry => {
        const a = asRecord(entry, MODEL, 'searchSettlements');
        return {
            settlementRef: requireStr(a, 'Ref', MODEL, 'searchSettlements'),
            cityRef: str(a, 'DeliveryCity') || null,
            name: requireStr(a, 'MainDescription', MODEL, 'searchSettlements'),
            present: optStr(a, 'Present'),
            area: optStr(a, 'Area'),
            region: optStr(a, 'Region'),
            type: optStr(a, 'SettlementTypeCode'),
            warehouses: num(a, 'Warehouses'),
        };
    });
}

function mapWarehouse(entry: unknown): Warehouse {
    const w = asRecord(entry, MODEL, 'getWarehouses');
    const category = optStr(w, 'CategoryOfWarehouse');
    const placeWeight = num(w, 'PlaceMaxWeightAllowed');
    const totalWeight = num(w, 'TotalMaxWeightAllowed');
    const limits = isRecord(w.ReceivingLimitationsOnDimensions) ? w.ReceivingLimitationsOnDimensions : null;
    const width = limits ? num(limits, 'Width') : null;
    const height = limits ? num(limits, 'Height') : null;
    const length = limits ? num(limits, 'Length') : null;
    return {
        ref: requireStr(w, 'Ref', MODEL, 'getWarehouses'),
        number: requireStr(w, 'Number', MODEL, 'getWarehouses'),
        description: requireStr(w, 'Description', MODEL, 'getWarehouses'),
        shortAddress: optStr(w, 'ShortAddress'),
        cityRef: optStr(w, 'CityRef'),
        cityDescription: optStr(w, 'CityDescription'),
        settlementRef: optStr(w, 'SettlementRef'),
        settlementDescription: optStr(w, 'SettlementDescription'),
        typeRef: optStr(w, 'TypeOfWarehouse'),
        category,
        kind: category === 'Postomat' ? 'postomat' : 'warehouse',
        index: optStr(w, 'WarehouseIndex'),
        maxWeightKg: placeWeight !== null && placeWeight > 0 ? placeWeight : totalWeight !== null && totalWeight > 0 ? totalWeight : null,
        denyToSelect: flag(w, 'DenyToSelect'),
        receivingLimits: width !== null && height !== null && length !== null ? { width, height, length } : null,
    };
}

export async function getWarehouses(client: NovaPoshtaClient, query: WarehouseQuery = {}): Promise<Warehouse[]> {
    const filters: Record<string, string> = {};
    if (query.cityRef) filters.CityRef = query.cityRef;
    if (query.settlementRef) filters.SettlementRef = query.settlementRef;
    if (query.query) filters.FindByString = query.query;
    if (query.number) filters.WarehouseId = query.number;
    if (query.typeRef) filters.TypeOfWarehouseRef = query.typeRef;

    if (query.page === undefined && query.limit === undefined) {
        const all = await fetchAllPages(client, MODEL, 'getWarehouses', filters, MAX_PAGE_SIZE, query.signal);
        return all.map(mapWarehouse);
    }
    const response = await client.call(MODEL, 'getWarehouses', { ...filters, ...paging(query, { page: 1, limit: MAX_PAGE_SIZE }) }, { mode: 'read', signal: query.signal });
    return response.data.map(mapWarehouse);
}

export async function getWarehouseTypes(client: NovaPoshtaClient, options: RequestOptions = {}): Promise<WarehouseType[]> {
    const response = await client.call(MODEL, 'getWarehouseTypes', {}, { mode: 'read', signal: options.signal });
    return response.data.map(entry => {
        const t = asRecord(entry, MODEL, 'getWarehouseTypes');
        return { ref: requireStr(t, 'Ref', MODEL, 'getWarehouseTypes'), description: requireStr(t, 'Description', MODEL, 'getWarehouseTypes') };
    });
}

export async function getSenderCounterparties(client: NovaPoshtaClient, options: RequestOptions = {}): Promise<SenderCounterparty[]> {
    const all = await fetchAllPages(client, COUNTERPARTY_MODEL, 'getCounterparties', { CounterpartyProperty: 'Sender' }, null, options.signal);
    return all.map(entry => {
        const c = asRecord(entry, COUNTERPARTY_MODEL, 'getCounterparties');
        return {
            ref: requireStr(c, 'Ref', COUNTERPARTY_MODEL, 'getCounterparties'),
            description: requireStr(c, 'Description', COUNTERPARTY_MODEL, 'getCounterparties'),
            type: str(c, 'CounterpartyType'),
        };
    });
}

export async function getContactPersons(client: NovaPoshtaClient, counterpartyRef: string, options: RequestOptions = {}): Promise<ContactPerson[]> {
    if (!counterpartyRef) {
        throw validationError('counterpartyRef is required');
    }
    const method = 'getCounterpartyContactPersons';
    const all = await fetchAllPages(client, COUNTERPARTY_MODEL, method, { Ref: counterpartyRef }, null, options.signal);
    return all.map(entry => {
        const p = asRecord(entry, COUNTERPARTY_MODEL, method);
        return {
            ref: requireStr(p, 'Ref', COUNTERPARTY_MODEL, method),
            name: optStr(p, 'Description'),
            firstName: optStr(p, 'FirstName'),
            middleName: optStr(p, 'MiddleName'),
            lastName: optStr(p, 'LastName'),
            phones: str(p, 'Phones').split(/[,;\s]+/).filter(Boolean),
            email: optStr(p, 'Email'),
        };
    });
}

const normalizeName = (value: string): string =>
    value
        .normalize('NFC')
        .toLowerCase()
        .replace(/[’ʼ`´‘]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

export function pickSettlement(text: string, candidates: readonly Settlement[]): Settlement | null {
    const wanted = typeof text === 'string' ? normalizeName(text) : '';
    if (!wanted) return null;
    const exact = candidates.filter(entry => entry.cityRef && normalizeName(entry.name) === wanted);
    if (exact.length === 1) return exact[0];
    const served = exact.filter(entry => (entry.warehouses ?? 0) > 0);
    return served.length === 1 ? served[0] : null;
}
