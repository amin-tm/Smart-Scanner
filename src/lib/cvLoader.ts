/**
 * Loads OpenCV.js inside a Web Worker.
 * The library is a local asset and is evaluated once in the detector.
 * Its embedded WebAssembly does not require a network service.
 */
import cvUrl from '@techstark/opencv-js/dist/opencv.js?url&no-inline';

/* eslint-disable @typescript-eslint/no-explicit-any */
let loading: Promise<{ cv: any }> | null = null;

export function loadCV(): Promise<{ cv: any } | undefined> {
  if (!loading) {
    loading = fetch(cvUrl, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
      .then(response => {
        if (!response.ok) throw new Error(`OpenCV asset returned ${response.status}`);
        return response.text();
      })
      .then(cvSource => new Promise<{ cv: any }>((resolve, reject) => {
        const g = self as any;
        // run the UMD bundle with module/define hidden so it registers `self.cv`
        new Function('module', 'exports', 'define', cvSource).call(g, undefined, undefined, undefined);
        const mod = g.cv;
        if (!mod) throw new Error('OpenCV did not register');
        const done = (cv: any) => resolve({ cv }); // wrapped: the module itself is thenable
        if (mod.Mat) done(mod);
        else if (typeof mod.then === 'function') mod.then((cv: any) => done(cv), reject);
        else mod.onRuntimeInitialized = () => done(mod);
      }));
  }
  // The photo is already editable. Let background detection wait for the
  // stronger detector, with a bounded fallback if initialization stalls.
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), 15_000);
    loading!.then(resolve, error => {
      console.warn('[detect] OpenCV asset unavailable', error);
      resolve(undefined);
    }).finally(() => clearTimeout(timer));
  });
}
