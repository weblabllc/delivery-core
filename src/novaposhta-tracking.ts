import type { TrackingRequest, TrackingResult } from './delivery.js';
import { NovaPoshtaClient, RequestOptions } from './novaposhta-client.js';
import { asRecord, parseError, str, validationError } from './novaposhta-fields.js';
import { tryNormalizePhone } from './novaposhta-phone.js';
import { mapNovaPoshtaStatus } from './novaposhta-status.js';

export const TRACKING_BATCH_SIZE = 100;

const MODEL = 'TrackingDocumentGeneral';
const METHOD = 'getStatusDocuments';

interface PreparedDocument {
    number: string;
    payload: Record<string, string>;
}

function prepare(request: TrackingRequest): PreparedDocument {
    const number = typeof request.number === 'string' ? request.number.trim() : '';
    if (!number) {
        throw validationError('Tracking number is required');
    }
    const phone = tryNormalizePhone(request.phone);
    return { number, payload: phone === null ? { DocumentNumber: number } : { DocumentNumber: number, Phone: phone } };
}

function mapResult(entry: unknown): TrackingResult {
    const row = asRecord(entry, MODEL, METHOD);
    const number = str(row, 'Number');
    if (!number) {
        throw parseError(MODEL, METHOD, 'entry has no number');
    }
    const statusCode = str(row, 'StatusCode');
    return {
        number,
        statusCode,
        status: mapNovaPoshtaStatus(statusCode),
        statusText: str(row, 'Status'),
        scheduledDeliveryDate: str(row, 'ScheduledDeliveryDate') || null,
        actualDeliveryDate: str(row, 'ActualDeliveryDate') || null,
        receivedAt: str(row, 'RecipientDateTime') || null,
        updatedAt: str(row, 'TrackingUpdateDate') || null,
    };
}

function unanswered(number: string): TrackingResult {
    return {
        number,
        statusCode: '',
        status: 'unknown',
        statusText: '',
        scheduledDeliveryDate: null,
        actualDeliveryDate: null,
        receivedAt: null,
        updatedAt: null,
    };
}

export async function track(client: NovaPoshtaClient, documents: TrackingRequest[], options: RequestOptions = {}): Promise<TrackingResult[]> {
    const prepared = documents.map(prepare);
    const byNumber = new Map<string, TrackingResult>();
    for (let from = 0; from < prepared.length; from += TRACKING_BATCH_SIZE) {
        const response = await client.call(
            MODEL,
            METHOD,
            { Documents: prepared.slice(from, from + TRACKING_BATCH_SIZE).map(document => document.payload) },
            { mode: 'read', signal: options.signal },
        );
        for (const result of response.data.map(mapResult)) {
            if (!byNumber.has(result.number)) {
                byNumber.set(result.number, result);
            }
        }
    }
    return prepared.map(document => byNumber.get(document.number) ?? unanswered(document.number));
}
