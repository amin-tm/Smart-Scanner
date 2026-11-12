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

/** Saves a PDF or image with the native shell (raw binary IPC – no JSON/base64 overhead). */
export async function saveExportNative(data: Uint8Array, dir: string, filename: string): Promise<string | undefined> {
  const c = core();
  if (!c) return undefined;
  try {
    return await c.invoke<string>('save_export', data, {
      headers: { 'x-dir': encodeURIComponent(dir), 'x-filename': encodeURIComponent(filename) },
    });
  } catch (e) {
    console.warn('[desktop] save_export failed', e);
    throw e;
  }
}

/** Resolve and validate a real Windows path before rendering a batch of JPEGs. */
export async function pickImageFolder(current: string): Promise<string | null> {
  const native = core();
  if (!native) throw new Error('برای انتخاب و بررسی مسیر پوشه، خروجی عکس را در برنامهٔ ویندوز بگیرید.');
  const folder = await chooseDir(current);
  return folder ? native.invoke<string>('validate_image_folder', { folder }) : null;
}

/** Plain browser fallback: normal download. */
export function downloadBlob(data: Uint8Array, filename: string, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Updater is registered in Rust to avoid a second JS/Tauri dependency. */
export async function checkUpdate(): Promise<string | null> {
  const c = core();
  if (!c) return null;
  return c.invoke<string | null>('check_update');
}

/** This will exit the Windows app once the signed update installer starts. */
export async function installUpdate(): Promise<boolean> {
  const c = core();
  if (!c) return false;
  return c.invoke<boolean>('install_update');
}
