/**
 * Unit tests for AsyncCoalescer.
 * Verifies serialization, coalescing, and error isolation.
 */

import * as assert from 'assert';

import { AsyncCoalescer } from '../../utils/asyncCoalescer';

/** Creates a deferred promise that can be resolved externally. */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => { resolve = r; });
	return { promise, resolve };
}

describe('AsyncCoalescer', () => {
	it('should execute a single call normally', async () => {
		const coalescer = new AsyncCoalescer();
		let executed = false;
		await coalescer.run(async () => { executed = true; });
		assert.strictEqual(executed, true);
	});

	it('should run the latest pending function as trailing execution', async () => {
		const coalescer = new AsyncCoalescer();
		const order: string[] = [];
		const gate = createDeferred();

		const first = coalescer.run(async () => {
			order.push('first-start');
			await gate.promise;
			order.push('first-end');
		});

		// Second call arrives while first is running — its fn becomes pending
		void coalescer.run(async () => { order.push('second'); });

		// Only first has started so far
		assert.deepStrictEqual(order, ['first-start']);

		// Release the first call — trailing execution runs the latest fn
		gate.resolve();
		await first;

		assert.deepStrictEqual(order, ['first-start', 'first-end', 'second']);
	});

	it('should coalesce multiple concurrent calls into one trailing execution', async () => {
		const coalescer = new AsyncCoalescer();
		let executionCount = 0;
		const gate = createDeferred();

		const first = coalescer.run(async () => {
			executionCount++;
			await gate.promise;
		});

		// Fire 5 more calls while first is running
		for (let i = 0; i < 5; i++) {
			void coalescer.run(async () => { executionCount++; });
		}

		gate.resolve();
		await first;

		// Should be exactly 2: initial + one coalesced trailing
		assert.strictEqual(executionCount, 2);
	});

	it('should not block future calls after an error', async () => {
		const coalescer = new AsyncCoalescer();
		let secondExecuted = false;

		try {
			await coalescer.run(async () => { throw new Error('boom'); });
		} catch {
			// expected
		}

		await coalescer.run(async () => { secondExecuted = true; });
		assert.strictEqual(secondExecuted, true);
	});

	it('should allow sequential calls after previous completes', async () => {
		const coalescer = new AsyncCoalescer();
		const results: number[] = [];

		await coalescer.run(async () => { results.push(1); });
		await coalescer.run(async () => { results.push(2); });
		await coalescer.run(async () => { results.push(3); });

		assert.deepStrictEqual(results, [1, 2, 3]);
	});
});
