import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeNativeAgeBand,
  unavailablePlatformReport,
} from '../src/features/identity/platform-age-domain.ts';

test('normaliza somente as quatro faixas sem data de nascimento', () => {
  assert.equal(normalizeNativeAgeBand({ lowerBound: 0, upperBound: 12 }), 'under_13');
  assert.equal(normalizeNativeAgeBand({ lowerBound: 13, upperBound: 15 }), '13_15');
  assert.equal(normalizeNativeAgeBand({ lowerBound: 16, upperBound: 17 }), '16_17');
  assert.equal(normalizeNativeAgeBand({ lowerBound: 18, upperBound: null }), '18_plus');
});

test('rejeita faixas ambíguas, invertidas e fora do domínio', () => {
  assert.equal(normalizeNativeAgeBand({ lowerBound: 12, upperBound: 17 }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: 18, upperBound: 17 }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: -1, upperBound: 12 }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: 13.5, upperBound: 15 }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: Number.NaN, upperBound: 12 }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: 131, upperBound: null }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: 13, upperBound: null }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: null, upperBound: 17 }), null);
  assert.equal(normalizeNativeAgeBand({ lowerBound: null, upperBound: null }), null);
});

test('status indisponível nunca carrega uma faixa', () => {
  assert.deepEqual(unavailablePlatformReport('android', 'verification_required'), {
    platform: 'android',
    status: 'verification_required',
    ageBand: null,
  });
});
