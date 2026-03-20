process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

let mainWindow = null;

function createMenu(window) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Properties',
          click: () => {
            console.log('Properties clicked, sending IPC event');
            if (window && window.webContents) {
              window.webContents.send('show-properties');
            } else {
              console.warn('Window or webContents not available');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.on('console-message', (e, level, msg, line, id) => { console.log('BROWSER CONSOLE:', msg); });
  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.webContents.openDevTools();
  }

  mainWindow = win;
  createMenu(win);
  return win;
}

app.on('ready', () => {
  ipcMain.handle('save-spine-export', async (event, payload) => {
    const { jsonString, assets, projectName } = payload;

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Export Directory',
      properties: ['openDirectory', 'createDirectory']
    });

    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    const baseDir = filePaths[0];
    const projectDir = path.join(baseDir, projectName || 'particle_export');

    try {
      await fs.mkdir(projectDir, { recursive: true });
      const imagesDir = path.join(projectDir, 'images', 'particles', 'png');
      await fs.mkdir(imagesDir, { recursive: true });

      await fs.writeFile(path.join(projectDir, 'particle_export_spine.json'), jsonString, 'utf8');

      for (const asset of assets) {
        const buffer = Buffer.from(asset.data);
        await fs.mkdir(path.dirname(path.join(projectDir, asset.name)), { recursive: true });
        await fs.writeFile(path.join(projectDir, asset.name), buffer);
      }

      return { success: true, dir: projectDir };
    } catch (err) {
      console.error(err);
      return { success: false, error: err.message };
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
