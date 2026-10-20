/**
 * Loads OpenCV.js inside a Web Worker.
 * The library is bundled as plain text and evaluated once; the WebAssembly
 * binary is embedded in it, so everything works offline.
 */
import cvSource from '@techstark/opencv-js/dist/opencv.js?raw';

/* eslint-disable @typescript-eslint/no-explicit-any */
let loading: Promise<{ cv: any }> | null = null;

export function loadCV(): Promise<{ cv: any }> {
  if (!loading) {
    loading = new Promise<{ cv: any }>((resolve, reject) => {
      try {
        const g = self as any;
        // run the UMD bundle with module/define hidden so it registers `self.cv`
        new Function('module', 'exports', 'define', cvSource).call(g, undefined, undefined, undefined);
        const mod = g.cv;
        if (!mod) throw new Error('OpenCV did not register');
        const done = (cv: any) => resolve({ cv }); // wrapped: the module itself is thenable
        if (mod.Mat) done(mod);
        else if (typeof mod.then === 'function') mod.then((cv: any) => done(cv));
        else mod.onRuntimeInitialized = () => done(mod);
      } catch (e) {
        reject(e);
      }
    }).catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}
