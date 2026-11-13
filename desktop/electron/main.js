// Bridgy's Farm desktop app: a game window on the live website (desktop/web/index.html goes there,
// or says there is no internet). Nothing of the game itself lives here.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

const SITE = new URL('https://robot-farmer.vercel.app/').origin;
const START = app.isPackaged
  ? path.join(process.resourcesPath, 'web', 'index.html')
  : path.join(__dirname, '..', 'web', 'index.html');

if (!app.requestSingleInstanceLock()) app.quit();

let win;
function open() {
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 900, minHeight: 600, fullscreen: true,
    title: 'Բրիջիի ֆերման', backgroundColor: '#173a7a', autoHideMenuBar: true,
    icon: path.join(path.dirname(START), 'icon.png'),
  });
  win.loadFile(START);
  // links to other sites open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || new URL(url).origin === SITE) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  // the internet dropped while the page was loading: back to the start page, which waits for it
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3 && !url.startsWith('file:')) win.loadFile(START);
  });
}

// Mac needs the Edit menu for Cmd+C / Cmd+V / Cmd+Z; F11 and Ctrl+R work on Windows too.
Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen', accelerator: 'F11' }] },
  { role: 'windowMenu' },
]));

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(open);
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); });
// the game saves while the window closes; give that save a moment to reach the server
app.on('window-all-closed', () => setTimeout(() => app.quit(), 1500));
