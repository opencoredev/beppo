/**
 * True when running inside the desktop bridge, false in a regular browser.
 * The desktop runtime injects `window.desktopBridge` before the web app boots,
 * so this remains reliable at module load time.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);
