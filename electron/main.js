process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

// Common Spine CLI locations on Windows / macOS / Linux
const SPINE_CLI_CANDIDATES = [
  // Windows
  'C:\\Program Files\\Spine\\Spine.com',
  'C:\\Program Files (x86)\\Spine\\Spine.com',
  'C:\\Spine\\Spine.com',
  // macOS
  '/Applications/Spine.app/Contents/MacOS/Spine',
  // PATH fallback (any platform)
  'spine',
];

async function scanSpineImages(spineFile) {
  const imagesDir = path.join(path.dirname(spineFile), 'images');
  const images = {};

  async function scanDir(dir, relBase) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath, relBase ? `${relBase}/${entry.name}` : entry.name);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
          try {
            const data = await fs.readFile(fullPath);
            const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
            const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
            const nameNoExt = path.basename(entry.name, ext);
            // Key by "images/rel/path/name" (matches skeleton.images prefix in Spine JSON)
            const relPath = relBase ? `images/${relBase}/${nameNoExt}` : `images/${nameNoExt}`;
            images[relPath] = dataUrl;
            // Also key by plain basename for fallback resolution
            if (!images[nameNoExt]) images[nameNoExt] = dataUrl;
          } catch {}
        }
      }
    }
  }

  await scanDir(imagesDir, '');
  return images;
}

async function findSpineCli() {
  for (const candidate of SPINE_CLI_CANDIDATES) {
    try {
      if (candidate === 'spine') {
        // Try PATH
        await execFileAsync(candidate, ['--version'], { timeout: 4000 });
        return candidate;
      }
      await fs.access(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
  }
  return null;
}

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
  ipcMain.handle('import-spine-file', async (_event, opts) => {
    // opts: { spineCli?: string }  — optional override for the CLI path
    let spineCli = opts?.spineCli || null;

    // 1. Pick the .spine file
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Spine Project File',
      filters: [{ name: 'Spine Project', extensions: ['spine'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
    const spineFile = filePaths[0];

    // 2. Find the Spine CLI if not provided
    if (!spineCli) spineCli = await findSpineCli();
    if (!spineCli) {
      // Ask the user to locate Spine.com / Spine.exe themselves
      const pick = await dialog.showOpenDialog(mainWindow, {
        title: 'Locate Spine CLI (Spine.com or Spine executable)',
        filters: [
          { name: 'Spine CLI', extensions: ['com', 'exe', ''] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (pick.canceled || pick.filePaths.length === 0)
        return { success: false, error: 'Spine CLI not found. Please locate Spine.com manually.' };
      spineCli = pick.filePaths[0];
    }

    // 3. Create a temp output directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vertebrae-spine-'));
    try {
      // Spine CLI arg order matters: -i <input> -o <output> -e json
      // (the -e flag must come AFTER -o, and "json" is a valid built-in export type)
      let stdout = '', stderr = '';
      try {
        const result = await execFileAsync(
          spineCli,
          ['-i', spineFile, '-o', tmpDir, '-e', 'json'],
          { timeout: 60000 }
        );
        stdout = result.stdout || '';
        stderr = result.stderr || '';
      } catch (cliErr) {
        stdout = cliErr.stdout || '';
        stderr = cliErr.stderr || '';
        // Check if output was produced despite non-zero exit
        const files = await fs.readdir(tmpDir).catch(() => []);
        const jsonFile = files.find((f) => f.endsWith('.json'));
        if (!jsonFile) {
          return {
            success: false,
            error: `Spine CLI failed.\n\nSTDOUT: ${stdout}\nSTDERR: ${stderr}\nExit: ${cliErr.code}`,
          };
        }
        const jsonString = await fs.readFile(path.join(tmpDir, jsonFile), 'utf8');
        const images = await scanSpineImages(spineFile);
        return { success: true, jsonString, fileName: jsonFile, images };
      }

      // Find the exported JSON
      const files = await fs.readdir(tmpDir);
      const jsonFile = files.find((f) => f.endsWith('.json'));
      if (!jsonFile)
        return { success: false, error: `Spine CLI ran but produced no JSON output.\nSTDOUT: ${stdout}\nSTDERR: ${stderr}` };

      const jsonString = await fs.readFile(path.join(tmpDir, jsonFile), 'utf8');
      const images = await scanSpineImages(spineFile);
      return { success: true, jsonString, fileName: jsonFile, images };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    } finally {
      // Cleanup temp dir (best-effort)
      try { fss.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  ipcMain.handle('save-lightning-export', async (_event, payload) => {
    const { assets, projectName } = payload;

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Lightning Export Directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    const projectDir = path.join(filePaths[0], projectName || 'lightning_export');
    try {
      await fs.mkdir(projectDir, { recursive: true });
      for (const asset of assets) {
        const fullPath = path.join(projectDir, asset.name);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        if (asset.isText) {
          await fs.writeFile(fullPath, asset.data, 'utf8');
        } else {
          await fs.writeFile(fullPath, Buffer.from(asset.data, 'base64'));
        }
      }
      return { success: true, dir: projectDir };
    } catch (err) {
      console.error('save-lightning-export error:', err);
      return { success: false, error: err.message };
    }
  });

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
