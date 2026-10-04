import { describe, expect, it } from 'vitest';
import { NovaPoshtaClient } from '../src/novaposhta-client.js';
import { track } from '../src/novaposhta-tracking.js';
import { fixture, mockFetch, npOk } from './helpers.js';

const clientFor = (...replies: Parameters<typeof mockFetch>) => {
    const mock = mockFetch(...replies);
    return { client: new NovaPoshtaClient({ apiKey: 'k', fetch: mock.fetch, retryDelayMs: 0 }), calls: mock.calls };
};

const row = (number: string, extra: Record<string, unknown> = {}) => ({ Number: number, StatusCode: '1', Status: 'Нова пошта очікує надходження від відправника', ...extra });

describe('track', () => {
    it('maps a delivered parcel', async () => {
        const { client, calls } = clientFor({
            body: npOk([
                row('20450000000001', {
                    StatusCode: '9',
                    Status: 'Відправлення отримано',
                    ScheduledDeliveryDate: '07-10-2026 12:00:00',
                    ActualDeliveryDate: '2026-10-07 11:30:00',
                    RecipientDateTime: '07.10.2026 11:31:02',
                    TrackingUpdateDate: '2026-10-07 11:35:00',
                }),
            ]),
        });
        const result = await track(client, [{ number: '20450000000001', phone: '0671112233' }]);
        expect(calls[0].body).toMatchObject({ modelName: 'TrackingDocumentGeneral', calledMethod: 'getStatusDocuments' });
        expect(calls[0].body.methodProperties).toEqual({ Documents: [{ DocumentNumber: '20450000000001', Phone: '380671112233' }] });
        expect(result).toEqual([
            {
                number: '20450000000001',
                statusCode: '9',
                status: 'delivered',
                statusText: 'Відправлення отримано',
                scheduledDeliveryDate: '07-10-2026 12:00:00',
                actualDeliveryDate: '2026-10-07 11:30:00',
                receivedAt: '07.10.2026 11:31:02',
                updatedAt: '2026-10-07 11:35:00',
            },
        ]);
    });

    it('omits phone when it is not given', async () => {
        const { client, calls } = clientFor({ body: npOk([row('1')]) });
        await track(client, [{ number: '1' }]);
        expect(calls[0].body.methodProperties.Documents).toEqual([{ DocumentNumber: '1' }]);
    });

    it('maps the recorded not-found reply', async () => {
        const { client } = clientFor({ body: fixture('tracking-not-found') });
        const [result] = await track(client, [{ number: '20400000000000' }]);
        expect(result).toEqual({
            number: '20400000000000',
            statusCode: '3',
            status: 'not_found',
            statusText: 'Номер не знайдено',
            scheduledDeliveryDate: null,
            actualDeliveryDate: null,
            receivedAt: null,
            updatedAt: null,
        });
    });

    it('returns nothing for an empty list without calling the api', async () => {
        const { client, calls } = clientFor();
        expect(await track(client, [])).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it('batches 250 documents into 3 calls of 100, 100 and 50 and keeps order', async () => {
        const docs = Array.from({ length: 250 }, (_, i) => ({ number: String(1000 + i) }));
        const reply = (from: number, to: number) => ({ body: npOk(docs.slice(from, to).map(d => row(d.number))) });
        const { client, calls } = clientFor(reply(0, 100), reply(100, 200), reply(200, 250));
        const result = await track(client, docs);
        expect(calls).toHaveLength(3);
        expect(calls.map(c => c.body.methodProperties.Documents.length)).toEqual([100, 100, 50]);
        expect(result.map(r => r.number)).toEqual(docs.map(d => d.number));
    });

    it('sends exactly 100 documents in one call', async () => {
        const docs = Array.from({ length: 100 }, (_, i) => ({ number: String(i + 1) }));
        const { client, calls } = clientFor({ body: npOk(docs.map(d => row(d.number))) });
        await track(client, docs);
        expect(calls).toHaveLength(1);
    });

    it('falls back to unknown for unmapped codes and missing text', async () => {
        const { client } = clientFor({ body: npOk([{ Number: '1', StatusCode: '999' }]) });
        const [result] = await track(client, [{ number: '1' }]);
        expect(result).toMatchObject({ statusCode: '999', status: 'unknown', statusText: '' });
    });

    it('fails with a parse error on an entry without number', async () => {
        const { client } = clientFor({ body: npOk([{ StatusCode: '1' }]) });
        await expect(track(client, [{ number: '1' }])).rejects.toMatchObject({ kind: 'parse' });
    });

    it('rejects blank numbers and invalid phones without echoing the phone', async () => {
        const { client, calls } = clientFor();
        await expect(track(client, [{ number: ' ' }])).rejects.toMatchObject({ name: 'NovaPoshtaError', kind: 'validation', message: expect.stringMatching(/number/) });
        expect(calls).toHaveLength(0);
    });

    it('drops an invalid phone for that item only and never fails the batch', async () => {
        const { client, calls } = clientFor({ body: npOk([row('1'), row('2'), row('3')]) });
        const result = await track(client, [
            { number: '1', phone: '123456' },
            { number: '2', phone: '0671112233' },
            { number: '3', phone: '' },
        ]);
        expect(result).toHaveLength(3);
        expect(calls[0].body.methodProperties.Documents).toEqual([{ DocumentNumber: '1' }, { DocumentNumber: '2', Phone: '380671112233' }, { DocumentNumber: '3' }]);
        expect(JSON.stringify(calls[0].body)).not.toContain('123456');
    });

    it('returns results in input order, not api order', async () => {
        const { client } = clientFor({ body: npOk([row('B', { StatusCode: '9' }), row('A', { StatusCode: '7' })]) });
        const result = await track(client, [{ number: 'A' }, { number: 'B' }]);
        expect(result.map(r => [r.number, r.status])).toEqual([['A', 'arrived'], ['B', 'delivered']]);
    });

    it('keeps input order across batches', async () => {
        const docs = Array.from({ length: 150 }, (_, i) => ({ number: String(1000 + i) }));
        const reverse = (from: number, to: number) => ({ body: npOk(docs.slice(from, to).map(d => row(d.number)).reverse()) });
        const { client } = clientFor(reverse(0, 100), reverse(100, 150));
        expect((await track(client, docs)).map(r => r.number)).toEqual(docs.map(d => d.number));
    });

    it('returns an entry for every requested number even when the api omits one', async () => {
        const { client } = clientFor({ body: npOk([row('A')]) });
        const result = await track(client, [{ number: 'A' }, { number: 'B' }]);
        expect(result).toHaveLength(2);
        expect(result[1]).toEqual({
            number: 'B',
            statusCode: '',
            status: 'unknown',
            statusText: '',
            scheduledDeliveryDate: null,
            actualDeliveryDate: null,
            receivedAt: null,
            updatedAt: null,
        });
    });

    it('answers a duplicated number for each occurrence', async () => {
        const { client } = clientFor({ body: npOk([row('A')]) });
        const result = await track(client, [{ number: 'A' }, { number: 'A' }]);
        expect(result.map(r => r.number)).toEqual(['A', 'A']);
    });

    it('trims numbers before matching', async () => {
        const { client } = clientFor({ body: npOk([row('A')]) });
        expect((await track(client, [{ number: ' A ' }]))[0].status).toBe('created');
    });

    it('retries a 5xx because it is a read', async () => {
        const { client, calls } = clientFor({ status: 500, body: '' }, { body: npOk([row('1')]) });
        await track(client, [{ number: '1' }]);
        expect(calls).toHaveLength(2);
    });

    it('is cancelled by an abort signal', async () => {
        const { client } = clientFor({ body: npOk([]) });
        await expect(track(client, [{ number: '1' }], { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' });
    });
});
