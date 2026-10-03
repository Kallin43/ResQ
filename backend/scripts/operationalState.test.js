import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveCounterUsing, reserveWithPersistenceUsing } from '../src/services/operationalStateService.js';

// Redis executes each INCR/DECR command atomically. This test double applies each
// command synchronously while returning promises, allowing concurrent callers to
// exercise the real DECR/compensating-INCR reservation flow without Redis installed.
class AtomicCounterRedis {
  constructor(initial) { this.value = initial; }
  async decr() { this.value -= 1; return this.value; }
  async incr() { this.value += 1; return this.value; }
  async incrBy(_key, amount) { this.value += amount; return this.value; }
}

test('two concurrent requests cannot reserve the last available unit twice', async () => {
  const redis = new AtomicCounterRedis(1);
  const attempts = await Promise.all([
    reserveCounterUsing(redis, 'facility:example:beds'),
    reserveCounterUsing(redis, 'facility:example:beds'),
  ]);

  assert.deepEqual(attempts.sort(), [false, true]);
  assert.equal(redis.value, 0);
});

test('MongoDB persistence failure restores the Redis reservation counter', async () => {
  const redis = new AtomicCounterRedis(1);
  await assert.rejects(
    reserveWithPersistenceUsing(redis, [{ key: 'facility:example:beds', units: 1 }], async () => {
      throw new Error('simulated MongoDB write failure');
    }),
    /simulated MongoDB write failure/,
  );
  assert.equal(redis.value, 1);
});

test('a rejected multi-unit reservation compensates every decrement', async () => {
  const redis = new AtomicCounterRedis(1);
  const accepted = await reserveCounterUsing(redis, 'facility:example:stock:water', 2);
  assert.equal(accepted, false);
  assert.equal(redis.value, 1);
});
