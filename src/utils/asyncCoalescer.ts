/**
 * Async coalescer — serializes concurrent async operations.
 * If `run()` is called while already executing, it coalesces:
 * the latest pending function runs once after the current execution finishes.
 * Guarantees at most 1 concurrent execution and no dropped trailing calls.
 */
export class AsyncCoalescer {
	private running = false;
	private pendingFn: (() => Promise<void>) | null = null;

	/** Runs `fn`, coalescing concurrent calls into a single trailing execution. */
	async run(fn: () => Promise<void>): Promise<void> {
		if (this.running) {
			this.pendingFn = fn;
			return;
		}
		this.running = true;
		let firstError: unknown;
		try {
			await fn();
		} catch (e) {
			firstError = e;
		}
		try {
			await this.drainPending();
		} finally {
			this.running = false;
		}
		if (firstError !== undefined) throw firstError;
	}

	/** Executes the latest pending function, repeating if new calls arrive. */
	private async drainPending(): Promise<void> {
		while (this.pendingFn) {
			const fn = this.pendingFn;
			this.pendingFn = null;
			await fn();
		}
	}
}
