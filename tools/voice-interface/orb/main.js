const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Right-click context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Size',
      submenu: [
        { label: 'Small (400×300)', click: () => win.setSize(400, 300) },
        { label: 'Medium (800×600)', click: () => win.setSize(800, 600) },
        { label: 'Large (1200×900)', click: () => win.setSize(1200, 900) },
      ]
    },
    {
      label: 'Full Screen',
      type: 'checkbox',
      checked: false,
      click: (item) => win.setFullScreen(item.checked)
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: true,
      click: (item) => win.setAlwaysOnTop(item.checked)
    },
    { type: 'separator' },
    {
      label: 'DevTools',
      click: () => win.webContents.toggleDevTools()
    },
    { type: 'separator' },
    { label: 'Quit JARVIS', click: () => app.quit() }
  ]);

  // Handle context menu via IPC
  ipcMain.on('show-context-menu', () => {
    contextMenu.popup({ window: win });
  });

  // Handle fullscreen toggle via IPC (F11)
  ipcMain.on('toggle-fullscreen', () => {
    win.setFullScreen(!win.isFullScreen());
  });

  // Handle manual window dragging via IPC
  ipcMain.on('move-window', (_event, dx, dy) => {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
