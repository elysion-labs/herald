import { join } from 'node:path';

import { RPCHandler } from '@orpc/server/message-port';
import { app, BrowserWindow, ipcMain, Menu } from 'electron';

import { rpcPortMessage } from '../shared/platforms.ts';
import { createWorkspaceBrowser } from './browser.ts';
import { attachLoginPortals, migrateWebLogin } from './login.ts';
import { createRouter } from './router.ts';
import { openWorkspaces } from './workspaces.ts';

async function start() {
  await app.whenReady();
  Menu.setApplicationMenu(null);

  const directory = app.getPath('userData');
  await migrateWebLogin(directory).catch(() => console.warn('无法迁移旧版网页登录状态'));
  const workspaces = openWorkspaces(directory);
  app.once('before-quit', () => workspaces.dispose());

  function createWindow() {
    const window = new BrowserWindow({
      title: 'Herald',
      width: 1440,
      height: 920,
      minWidth: 900,
      minHeight: 580,
      backgroundColor: '#0b0b0d',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#0b0b0d', symbolColor: '#f4f4f5', height: 40 },
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        webviewTag: true,
      },
    });

    const contents = window.webContents;
    attachLoginPortals(contents);
    const browser = createWorkspaceBrowser(window);
    const { router, dispose } = createRouter(workspaces, browser);
    const handler = new RPCHandler(router);
    const ports = new Set<Electron.MessagePortMain>();

    const bindPort = (event: Electron.IpcMainEvent) => {
      if (
        event.sender !== contents ||
        event.senderFrame !== contents.mainFrame ||
        event.ports.length !== 1
      ) {
        return;
      }

      const [port] = event.ports;
      ports.add(port);
      port.on('close', () => ports.delete(port));
      handler.upgrade(port);
      port.start();
    };

    ipcMain.on(rpcPortMessage, bindPort);
    window.on('closed', () => {
      dispose();
      ipcMain.off(rpcPortMessage, bindPort);

      for (const port of ports) {
        port.close();
      }
    });

    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());

    const devUrl = process.env.ELECTRON_RENDERER_URL;

    if (devUrl) {
      void window.loadURL(devUrl);
    } else {
      void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    }
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

if (app.requestSingleInstanceLock()) {
  void start();
} else {
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
