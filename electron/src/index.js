const electron = require('electron');
const { globalShortcut } = require('electron');
const crypto = require('crypto');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const path = require('path');
const waitForPythonServerToBeAvailable = require('./check_python_server');
const childProcess = require('child_process');
const { electronLogger, pythonAppLogger } = require('./logger');

const pythonApplicationPort = 3456;
const secret = crypto.randomBytes(12).toString('hex');
const pythonApplicationUrl = `http://127.0.0.1:${pythonApplicationPort}?key=${secret}`;

const allWindows = {};

let pyProc = null;
let activeWindow = null;
let loadingWindow = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

/** ***********************************************************
 * window management
 ************************************************************ */

let mainWindow = null;

function createNewWindow(url) {
  const windowId = Math.random()
    .toString();
  const webPreferences = {
    nativeWindowOpen: true,

  };

  let newWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'assets/icons/mac/logo-256.png.icns'),
    webPreferences,
    show: false,
  });

  let urlToLoad = `file://${__dirname}/index.html`;

  if (url !== undefined && url !== null) {
    urlToLoad = url;
    if (activeWindow !== null) {
      newWindow.webContents.session =
        Object.assign({}, activeWindow.webContents.session);
    }
  }
  newWindow.loadURL(urlToLoad);

  newWindow.on('closed', () => {
    newWindow = null;
    delete allWindows[windowId];
  });

  newWindow.on('close', () => {
    newWindow.hide();
    delete allWindows[windowId];
  });

  newWindow.on('focus', () => {
    activeWindow = newWindow;
  });

  newWindow.webContents.once('dom-ready', () => {
    newWindow.show();
    try {
      loadingWindow.hide();
      loadingWindow.close();
    } catch (exp) {
      electronLogger.error(`failed to create new window ${exp}`);
    }
  });

  activeWindow = newWindow;

  allWindows[windowId] = newWindow;

  return newWindow;
}

function createMainWindow() {
  mainWindow = createNewWindow(pythonApplicationUrl);
  const Menu = electron.Menu;

  // Create the Application's main menu
  const template = [{
    label: 'PGAdmin4',
    submenu: [
      {
        label: 'New window',
        accelerator: 'CommandOrControl+N',
        selector: 'newwindow:',
        click: () => {
          createNewWindow();
        },
      }, {
        label: 'New tab',
        accelerator: 'CommandOrControl+t',
        selector: 'newtab:',
        click: () => {
          activeWindow.webContents.send(
            'tabs-channel',
            'create',
            'pgAdmin4',
            pythonApplicationUrl,
          );
        },
      },
      { type: 'separator' },
      {
        label: 'About PGAdmin4',
        selector: 'orderFrontStandardAboutPanel:',
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click() {
          app.quit();
        },
      },
    ],
  }, {
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
      {
        label: 'Redo',
        accelerator: 'Shift+CmdOrCtrl+Z',
        selector: 'redo:',
      },
      { type: 'separator' },
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
      {
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        selector: 'selectAll:',
      },
      { type: 'separator' },
      {
        label: 'Dev Tools',
        accelerator: 'CmdOrCtrl+Alt+I',
        click: () => {
          if (activeWindow !== null) {
            activeWindow.webContents.openDevTools();
          }
        },
      },
    ],
  },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  globalShortcut.register('CommandOrControl+N', () => {
    electronLogger.debug('CommandOrControl+N is pressed');
    createNewWindow(`http://${pythonApplicationUrl}`);
  });
}


app.on('ready', () => {
  loadingWindow = new BrowserWindow({
    show: false,
    frame: false,
    width: 200,
    height: 100,
    icon: `${__dirname}assets/icons/linux/pgAdmin4.png`,
  });

  loadingWindow.loadURL(`file://${__dirname}/index.html`);

  loadingWindow.show();
});

app.on('window-all-closed', () => {
  electronLogger.debug('perhaps going to close windows');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

function createPyProc() {
  const pythonPath = path.join(__dirname, '..', 'venv', 'bin', 'python');
  const scriptPath = path.join(__dirname, '..', 'web', 'pgAdmin4.py');
  electronLogger.info('info: Spawning...');
  pyProc = childProcess.spawn(pythonPath, [scriptPath], {
    env: {
      PGADMIN_PORT: pythonApplicationPort,
      PGADMIN_KEY: secret,
      SERVER_MODE: false,
    },
  });

  waitForPythonServerToBeAvailable.waitForPythonServerToBeAvailable(pythonApplicationUrl, () => {
    electronLogger.debug('debug: Python server is Up, going to start the pgadmin window');
    createMainWindow();
    electronLogger.debug('debug: closing the loading window');
  });

  pyProc.on('error', (error) => {
    pythonAppLogger.error('error: ', error);
  });

  pyProc.stdout.on('data', (data) => {
    pythonAppLogger.info(`PYTHON: info: ${data}`);
  });

  pyProc.stderr.on('data', (data) => {
    pythonAppLogger.info(`PYTHON: info: ${data}`);
  });
}

function exitPyProc() {
  electronLogger.debug('Going to exit');
  if (pyProc != null) {
    pyProc.kill();
    pyProc = null;
  } else {
    app.exit();
  }
}

app.on('ready', createPyProc);

app.on('before-quit', () => {
  electronLogger.debug('before-quit');
  exitPyProc();

  app.quit();
});

app.on('quit', () => {
  electronLogger.debug('quit');
});

