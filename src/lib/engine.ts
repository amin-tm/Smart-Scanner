import ProcWorker from '../workers/proc.worker.ts?worker&inline';
import type { ProcessMsg, ProcessResult } from './types';

type Pending = { resolve: (v: ProcessResult) => void; reject: (e: unknown) => void };

class PoolWorker {
  w: Worker;
  busy = false;
  cur: Pending | null = null;
  constructor(onIdle: () => void) {
    this.w = new ProcWorker();
    this.w.onmessage = (e: MessageEvent<{ ok: boolean; result?: ProcessResult; error?: string }>) => {
      const p = this.cur;
      this.cur = null;
      this.busy = false;
      if (p) {
        if (e.data.ok && e.data.result) {
          if (e.data.result.timing) console.debug('[scan]', JSON.stringify(e.data.result.timing));
          p.resolve(e.data.result);
        }
        else p.reject(new Error(e.data.error || 'processing error'));
      }
      onIdle();
    };
    this.w.onerror = (e: ErrorEvent) => {
      const p = this.cur;
      this.cur = null;
      this.busy = false;
      p?.reject(new Error(e.message || 'worker error'));
      onIdle();
    };
  }
}

/** Priority queue on top of a fixed set of workers. Higher priority first, FIFO inside a priority. */
export class Pool {
  private workers: PoolWorker[] = [];
  private queue: { msg: ProcessMsg; res: Pending; priority: number; seq: number }[] = [];
  private seq = 0;
  constructor(private size: number) {
    this.size = Math.max(1, size);
  }
  /** spawn workers ahead of time so the first job does not pay the start-up cost */
  warm() {
    while (this.workers.length < this.size) this.workers.push(new PoolWorker(() => this.pump()));
  }
  run(msg: ProcessMsg, priority = 0): Promise<ProcessResult> {
    this.warm();
    return new Promise<ProcessResult>((resolve, reject) => {
      this.queue.push({ msg, res: { resolve, reject }, priority, seq: this.seq++ });
      this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      this.pump();
    });
  }
  /** fire-and-forget message to every worker (no reply expected) */
  broadcast(msg: unknown, gapMs = 0) {
    this.warm();
    this.workers.forEach((w, i) => setTimeout(() => w.w.postMessage(msg), i * gapMs));
  }
  get pending() {
    return this.queue.length + this.workers.filter((w) => w.busy).length;
  }
  private pump() {
    for (const w of this.workers) {
      if (w.busy) continue;
      const task = this.queue.shift();
      if (!task) return;
      w.busy = true;
      w.cur = task.res;
      w.w.postMessage(task.msg);
    }
  }
}

const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;

/** One dedicated worker for interactive previews – never queued behind batch work. */
export const previewPool = new Pool(1);
/** Parallel workers for imports and final renders. */
export const batchPool = new Pool(Math.max(2, Math.min(4, cores - 1)));

let cvWarmed = false;
export function warmEngine() {
  previewPool.warm();
  batchPool.warm();
  if (cvWarmed) return;
  cvWarmed = true;
  // Preload OpenCV in the batch workers once the UI is idle, staggered so the
  // first photo is detected immediately instead of waiting for the library.
  const start = () => batchPool.broadcast({ type: 'warm' }, 900);
  const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(start, { timeout: 2500 });
  else setTimeout(start, 1200);
}
