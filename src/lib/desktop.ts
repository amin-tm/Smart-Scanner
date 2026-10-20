/**
 * Bridge to the native shell (Tauri). Everything degrades gracefully to plain
 * browser behaviour when the app runs as a normal web page.
 */
interface TauriCore {
  invoke<T = unknown>(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: { core?: TauriCore };
  }
}

const core = (): TauriCore | undefined => (typeof window !== 'undefined' ? window.__TAURI__?.core : undefined);

export const isDesktop = () => !!core();

async function call<T>(cmd: string, args?: unknown): Promise<T | undefined> {
  const c = core();
  if (!c) return undefined;
  try {
    return await c.invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`[desktop] ${cmd} failed`, e);
    return undefined;
  }
}

/** Tells the native shell the UI is painted (the window is shown only now – no white flash). */
export const appReady = () => call<void>('app_ready');
export const getDefaultDir = () => call<string>('get_default_dir');
export const chooseDir = (current: string) => call<string | null>('choose_dir', { current });
export const openPath = (path: string) => call<void>('open_path', { path });
export const showInFolder = (path: string) => call<void>('show_in_folder', { path });
export const setBackgroundMode = (enabled: boolean) => call<void>('set_background_mode', { enabled });
export const getAutostart = async () => (await call<boolean>('get_autostart')) ?? false;
export const setAutostart = (enabled: boolean) => call<boolean>('set_autostart', { enabled });
export const quitApp = () => call<void>('quit_app');

/** Saves the PDF with the native shell (raw binary IPC – no JSON/base64 overhead). */
export async function savePdfNative(data: Uint8Array, dir: string, filename: string): Promise<string | undefined> {
  const c = core();
  if (!c) return undefined;
  try {
    return await c.invoke<string>('save_pdf', data, {
      headers: { 'x-dir': encodeURIComponent(dir), 'x-filename': encodeURIComponent(filename) },
    });
  } catch (e) {
    console.warn('[desktop] save_pdf failed', e);
    throw e;
  }
}

/** Plain browser fallback: normal download. */
export function downloadBlob(data: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
