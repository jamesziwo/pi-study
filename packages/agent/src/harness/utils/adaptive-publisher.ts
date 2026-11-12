export interface AdaptivePublisherOptions<TValue, TUpdate> {
	snapshot(): TValue;
	update(previous: TValue | undefined, current: TValue): TUpdate | undefined;
	measure(update: TUpdate): number;
	publish(update: TUpdate): void;
	onError(error: unknown): void;
	minIntervalMs?: number;
	targetBytesPerSecond?: number;
}

// 中文：发布最新状态，不将中间修改逐个排队。空闲后首次出现的脏状态立即发布；之后每次发布按编码后的大小设置成比例的延迟，并以最小间隔限制事件数量。一个尾随计时器保证最终会发
// 布。
/**
 * Publishes the latest state without queuing intermediate mutations.
 *
 * The first dirty state after idle is immediate. Each publication then buys a
 * delay proportional to its encoded size, with a minimum interval that also
 * bounds event count. A single trailing timer guarantees eventual publication.
 */
export class AdaptivePublisher<TValue, TUpdate> {
	readonly #options: AdaptivePublisherOptions<TValue, TUpdate>;
	readonly #minIntervalMs: number;
	readonly #targetBytesPerSecond: number;
	#published: TValue | undefined;
	#dirty = false;
	#nextEmitAt = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#disposed = false;

	constructor(options: AdaptivePublisherOptions<TValue, TUpdate>) {
		this.#options = options;
		this.#minIntervalMs = options.minIntervalMs ?? 100;
		this.#targetBytesPerSecond = options.targetBytesPerSecond ?? 100 * 1024;
	}

	markDirty(): void {
		if (this.#disposed) return;
		this.#dirty = true;
		const wait = this.#nextEmitAt - Date.now();
		if (wait <= 0) {
			this.flush();
			return;
		}
		this.#armTimer(wait);
	}

	flush(force = false): void {
		if (this.#disposed || !this.#dirty) return;
		const now = Date.now();
		if (!force && now < this.#nextEmitAt) {
			this.#armTimer(this.#nextEmitAt - now);
			return;
		}
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		const current = this.#options.snapshot();
		const update = this.#options.update(this.#published, current);
		if (update === undefined) {
			this.#published = current;
			this.#dirty = false;
			return;
		}
		const encodedBytes = this.#options.measure(update);
		this.#published = current;
		this.#dirty = false;
		this.#nextEmitAt = now + Math.max(this.#minIntervalMs, (encodedBytes * 1000) / this.#targetBytesPerSecond);
		// 中文：先提交状态，再投递。消费者可能应用更新后抛错，或重入生产方；保留旧基准会导致重复发送该增量。
		// Commit before delivery. A consumer may apply the update and then throw or
		// reenter the producer; retaining the old baseline would duplicate that delta.
		this.#options.publish(update);
	}

	dispose(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#disposed = true;
	}

	#armTimer(wait: number): void {
		if (this.#timer !== undefined) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			try {
				this.flush();
			} catch (error) {
				this.#options.onError(error);
			}
		}, wait);
	}
}
