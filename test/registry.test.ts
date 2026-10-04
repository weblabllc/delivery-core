import { describe, expect, it } from 'vitest';
import { DeliveryCarrier } from '../src/delivery.js';
import { NovaPoshtaCarrier } from '../src/novaposhta.js';
import { CarrierRegistry } from '../src/registry.js';

const fake = (code: string): DeliveryCarrier => ({ code, track: async () => [] });
const custom = (code: string) => ({ type: 'custom' as const, carrier: fake(code) });

describe('CarrierRegistry', () => {
    it('enables the configured builtin carrier', () => {
        const registry = CarrierRegistry.create({ carriers: [{ type: 'novaposhta', apiKey: 'k' }] });
        expect(registry.codes()).toEqual(['novaposhta']);
        expect(registry.has('novaposhta')).toBe(true);
        expect(registry.get('novaposhta')).toBeInstanceOf(NovaPoshtaCarrier);
    });

    it('accepts custom carriers next to builtin ones', () => {
        const registry = CarrierRegistry.create({ carriers: [{ type: 'novaposhta', apiKey: 'k' }, custom('ukrposhta')] });
        expect(registry.codes().sort()).toEqual(['novaposhta', 'ukrposhta']);
    });

    it('treats a custom carrier that has its own track method as custom, not builtin', () => {
        const registry = CarrierRegistry.create({ carriers: [custom('novaposhta')] });
        expect(registry.get('novaposhta')).not.toBeInstanceOf(NovaPoshtaCarrier);
    });

    it('passes track options through to the carrier', async () => {
        const seen: unknown[] = [];
        const carrier: DeliveryCarrier = { code: 'x', track: async (_documents, options) => (seen.push(options), []) };
        const registry = CarrierRegistry.create({ carriers: [{ type: 'custom', carrier }] });
        const signal = AbortSignal.abort();
        await registry.get('x').track([{ number: '1' }], { signal });
        expect(seen).toEqual([{ signal }]);
    });

    it('throws for carriers that are not enabled', () => {
        const registry = CarrierRegistry.create({ carriers: [custom('ukrposhta')] });
        expect(registry.has('novaposhta')).toBe(false);
        expect(() => registry.get('novaposhta')).toThrow(/not enabled/);
    });

    it('rejects unknown builtin types', () => {
        expect(() => CarrierRegistry.create({ carriers: [{ type: 'dhl', apiKey: 'k' } as never] })).toThrow(/Unknown builtin/);
    });

    it('rejects duplicates', () => {
        expect(() => CarrierRegistry.create({ carriers: [custom('a'), custom('a')] })).toThrow(/Duplicate/);
    });

    it('requires at least one carrier', () => {
        expect(() => CarrierRegistry.create({ carriers: [] })).toThrow(/at least one/);
    });
});
