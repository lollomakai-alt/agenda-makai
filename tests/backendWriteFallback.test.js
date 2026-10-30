import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BackendUnavailable,
  backendJson,
  backendReachable,
  isBackendUnavailable,
  markBackendDown,
  resetBackend,
} from '../src/lib/backendWrite.js';

test('without a browser session the backend is skipped and the caller can fall back to RPC', async () => {
  resetBackend();
  assert.equal(backendReachable(), false);
  await assert.rejects(
    backendJson('/api/admin/bookings/1/status', { body: { status: 'arrived' } }),
    error => isBackendUnavailable(error) && error instanceof BackendUnavailable,
  );
});

test('only transport and gateway failures are fallback-safe', () => {
  resetBackend();
  assert.equal(isBackendUnavailable(new Error('422')) || false, false);
  markBackendDown();
  assert.equal(backendReachable(), false);
  resetBackend();
});
