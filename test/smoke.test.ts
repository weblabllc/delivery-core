import { describe, expect, it } from 'vitest';
import * as barrel from '../src/index.js';

describe('barrel', () => {
    it('exports the public surface', () => {
        expect(barrel.DELIVERY_STATUSES).toContain('delivered');
    });
});
