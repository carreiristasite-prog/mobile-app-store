import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const startSource = await readFile(new URL('../app/(tabs)/simulados.tsx', import.meta.url), 'utf8');
const activeSource = await readFile(new URL('../app/simulados/active.tsx', import.meta.url), 'utf8');

test('simulation create retains one explicit idempotency key through lost responses', () => {
  assert.match(startSource, /pendingStartRef = useRef/);
  assert.match(startSource, /idempotencyKey: pendingStartRef\.current\.key/);
  assert.match(startSource, /activeQuery\.refetch\(\)/);
  assert.match(startSource, /pendingStartRef\.current = null/);
  assert.doesNotMatch(startSource, /offlineQueue\s*:/);
});

test('simulation answers retain one key and cannot change question while submitting', () => {
  assert.match(activeSource, /pendingRef = useRef/);
  assert.match(activeSource, /idempotencyKey: pendingRef\.current\.key/);
  assert.match(activeSource, /disabled=\{submitting\}/);
  assert.match(activeSource, /alreadyAnswered \|\| expiredLocally \|\| submitting/);
  assert.doesNotMatch(activeSource, /offlineQueue\s*:/);
});

test('one-second timer does not spam screen-reader live regions', () => {
  assert.match(activeSource, /accessibilityRole="timer" accessibilityLiveRegion="none"/);
  assert.doesNotMatch(activeSource, /accessibilityRole="timer" accessibilityLiveRegion=\{[^}]*polite/);
});
