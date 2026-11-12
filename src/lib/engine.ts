import ProcWorker from '../workers/proc.worker.ts?worker';
import DetectWorker from '../workers/detect.worker.ts?worker';
import type { DetectMsg, DetectResult, ProcessMsg, ProcessResult } from './types';

type Pending<Result> = { resolve: (v: Result) => void; reject: (e: unknown) => void };

class PoolWorker<Message, Result extends { timing?: Record<string, number> }> {
  readonly w: Worker;
  private current: Pending<Result> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  get busy() { return this.current !== null; }

  constructor(create: () => Worker, onIdle: () => void, private onFailure: (worker: PoolWorker<Message, Result>) => void) {
    this.w = create();
    this.w.onmessage = (event: MessageEvent<{ ok: boolean; result?: Result; error?: string }>) => {
      const pending = this.finish();
      if (!pending) return;
      if (event.data.ok && event.data.result) {
        if (event.data.result.timing) console.debug('[scan]', JSON.stringify(event.data.result.timing));
        pending.resolve(event.data.result);
      } else pending.reject(new Error(event.data.error || 'processing error'));
      onIdle();
    };
    this.w.onerror = event => this.fail(new Error(event.message || 'worker error'));
    this.w.onmessageerror = () => this.fail(new Error('Unreadable worker response'));
  }

  run(msg: Message, pending: Pending<Result>, timeout: number) {
    this.current = pending;
    this.timer = setTimeout(() => this.fail(new Error('Processing timed out')), timeout);
    try {
      this.w.postMessage(msg);
    } catch (error) {
      this.fail(error);
    }
  }

  private finish() {
    clearTimeout(this.timer);
    const pending = this.current;
    this.current = null;
    return pending;
  }

  private fail(error: unknown) {
    this.w.terminate();
    this.finish()?.reject(error);
    this.onFailure(this);
  }
}

/** Priority queue on top of a fixed set of workers. Higher priority first, FIFO inside a priority. */
class Pool<Message extends { id: string }, Result extends { timing?: Record<string, number> }> {
  private workers: PoolWorker<Message, Result>[] = [];
  private queue: { msg: Message; res: Pending<Result>; priority: number; seq: number }[] = [];
  private seq = 0;
  constructor(private create: () => Worker, private size: number, private timeout = 120_000) {
    this.size = Math.max(1, size);
  }
  private spawn() {
    const worker = new PoolWorker<Message, Result>(this.create, () => this.pump(), failed => {
      this.workers = this.workers.filter(worker => worker !== failed);
      this.pump();
    });
    this.workers.push(worker);
    return worker;
  }
  warmFirst() {
    if (!this.workers.length) this.spawn();
  }
  run(msg: Message, priority = 0): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      this.queue.push({ msg, res: { resolve, reject }, priority, seq: this.seq++ });
      this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      this.pump();
    });
  }

  prioritize(id: string, priority: number) {
    const task = this.queue.find(item => item.msg.id === id);
    if (!task) return;
    task.priority = priority;
    this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  }
  cancelQueued(ids: ReadonlySet<string>) {
    this.queue = this.queue.filter(task => {
      if (!ids.has(task.msg.id)) return true;
      task.res.reject(new Error('Cancelled'));
      return false;
    });
  }
  get pending() {
    return this.queue.length + this.workers.filter((w) => w.busy).length;
  }
  private pump() {
    if (this.queue.length && this.workers.length < this.size && this.workers.every(worker => worker.busy)) {
      try {
        this.spawn();
      } catch (error) {
        for (const task of this.queue.splice(0)) task.res.reject(error);
        return;
      }
    }
    for (const w of this.workers) {
      if (w.busy) continue;
      const task = this.queue.shift();
      if (!task) return;
      w.run(task.msg, task.res, this.timeout);
    }
  }
}

const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;

/** One dedicated worker for interactive previews – never queued behind batch work. */
export const previewPool = new Pool<ProcessMsg, ProcessResult>(() => new ProcWorker(), 1, 30_000);
export const batchPool = new Pool<ProcessMsg, ProcessResult>(() => new ProcWorker(), Math.max(2, Math.min(4, cores - 1)));
export const detectionPool = new Pool<DetectMsg, DetectResult>(() => new DetectWorker(), cores >= 8 ? 2 : 1, 30_000);

let cvWarmed = false;
export function warmEngine() {
  if (cvWarmed) return;
  cvWarmed = true;
  const start = () => {
    try { previewPool.warmFirst(); } catch (error) { console.warn('preview worker startup failed', error); }
  };
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(start, { timeout: 2500 });
  else setTimeout(start, 1200);
}
