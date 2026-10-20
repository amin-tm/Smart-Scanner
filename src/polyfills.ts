// Promise.withResolvers is used by pdf.js; polyfill for slightly older browsers.
const P = Promise as unknown as { withResolvers?: () => unknown };
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (e?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
