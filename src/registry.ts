import type { DeliveryCarrier } from './delivery.js';
import type { NovaPoshtaClientOptions } from './novaposhta-client.js';
import { NovaPoshtaCarrier } from './novaposhta.js';

export type BuiltinCarrierConfig = { type: 'novaposhta' } & NovaPoshtaClientOptions;

export interface CustomCarrierConfig {
    type: 'custom';
    carrier: DeliveryCarrier;
}

export type CarrierConfig = BuiltinCarrierConfig | CustomCarrierConfig;

export interface CarrierRegistryConfig {
    carriers: CarrierConfig[];
}

const BUILTIN_TYPES = ['novaposhta'];

function instantiate(entry: CarrierConfig): DeliveryCarrier {
    switch (entry.type) {
        case 'novaposhta': {
            const { type: _type, ...options } = entry;
            return new NovaPoshtaCarrier(options);
        }
        case 'custom':
            return entry.carrier;
        default:
            throw new Error(`Unknown builtin delivery carrier "${String((entry as { type: unknown }).type)}" (builtin: ${BUILTIN_TYPES.join(', ')})`);
    }
}

export class CarrierRegistry {
    private constructor(private readonly byCode: Map<string, DeliveryCarrier>) {}

    static create(config: CarrierRegistryConfig): CarrierRegistry {
        if (!config.carriers.length) {
            throw new Error('CarrierRegistry requires at least one carrier');
        }
        const byCode = new Map<string, DeliveryCarrier>();
        for (const entry of config.carriers) {
            const carrier = instantiate(entry);
            if (byCode.has(carrier.code)) {
                throw new Error(`Duplicate delivery carrier code: ${carrier.code}`);
            }
            byCode.set(carrier.code, carrier);
        }
        return new CarrierRegistry(byCode);
    }

    codes(): string[] {
        return [...this.byCode.keys()];
    }

    has(code: string): boolean {
        return this.byCode.has(code);
    }

    get(code: string): DeliveryCarrier {
        const carrier = this.byCode.get(code);
        if (!carrier) {
            throw new Error(`Delivery carrier "${code}" is not enabled (enabled: ${this.codes().join(', ')})`);
        }
        return carrier;
    }
}
