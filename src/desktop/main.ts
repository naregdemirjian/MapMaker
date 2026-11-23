// The desktop app (Electron main process). It hosts the same local data service as the browser
// version, in this process, and shows the interface in the app's own window. Nothing else differs:
// the interface still talks to the service over HTTP on this computer only (127.0.0.1).
//
// Run in development:  node scripts/build.mjs && npx electron .
import { app, BrowserWindow, shell, Menu, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../server/http.ts';

declare const __APP_VERSION__: string;
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// Tests and power users may choose another projects folder.
const projectsDir = process.env.MAPMAKER_PROJECTS || join(app.getPath('documents'), 'Map Maker Projects');
const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
// A stable address keeps the interface's remembered views (they are stored per address).
const PREFERRED_PORT = Number(process.env.MAPMAKER_PORT || 4317);

// The terrain, conditions and the globe are drawn with WebGL2. Where the graphics card cannot be used
// (no driver, a blocked one, a machine without one), Chromium draws WebGL in software only when allowed
// to: allowed here, as the window shows nothing but Map Maker's own pages.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

if (!app.requestSingleInstanceLock()) {
  // Map Maker is already open: that window is brought forward instead (see 'second-instance').
  app.quit();
} else {
  let window: BrowserWindow | null = null;
  const chooseFolder = async (start?: string) => {
    const r = window
      ? await dialog.showOpenDialog(window, { title: 'Where should Map Maker export?', defaultPath: start, properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: 'Where should Map Maker export?', defaultPath: start, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  };
  // Downloaded terrain tiles (D101) are kept with the app's own data, not among the projects.
  // (And the satellite photographs' tiles, D138.)
  const { server, registry } = createAppServer({ projectsDir, staticDir, appVersion: version, chooseFolder, tileCacheDir: join(app.getPath('userData'), 'terrain-tiles'), photoCacheDir: join(app.getPath('userData'), 'photo-tiles') });

  const listen = (port: number, attempts = 20): Promise<string> => new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE' && attempts > 0) resolve(listen(port + 1, attempts - 1));
      else reject(e);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    });
  });

  const open = async () => {
    let url: string;
    try {
      url = await listen(PREFERRED_PORT);
    } catch (e) {
      dialog.showErrorBox('Map Maker could not start', (e as Error).message);
      app.quit();
      return;
    }
    console.log(`Map Maker ${version} is running at ${url} (projects: ${projectsDir})`);
    window = new BrowserWindow({
      width: 1600, height: 1000, minWidth: 1000, minHeight: 640, title: 'Map Maker', backgroundColor: '#0e141a', show: false,
      // No title bar of the system's own (white on Windows) above Map Maker's top bar (D214): the top bar is the title
      // bar, the window's minimise, maximise and close buttons drawn over its right end in its colours (on a Mac, the
      // three buttons at its left), and the bar leaves room for them.
      titleBarStyle: 'hidden',
      titleBarOverlay: process.platform === 'darwin' ? true : { color: '#151d25', symbolColor: '#e3e9ef', height: 24 },
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    window.once('ready-to-show', () => { window?.maximize(); window?.show(); });
    // The window only ever shows Map Maker itself; any other address opens in the normal browser.
    window.webContents.setWindowOpenHandler(({ url: target }) => { void shell.openExternal(target); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (ev, target) => { if (!target.startsWith(url)) { ev.preventDefault(); void shell.openExternal(target); } });
    window.on('closed', () => { window = null; });
    await window.loadURL(url);
  };

  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    registry.closeAll();
    server.close();
  });

  Menu.setApplicationMenu(null);
  void app.whenReady().then(open);
}
