"use strict";

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const isDev = process.argv.includes("--dev");
const DEV_URL = "http://127.0.0.1:5173";
const FILTERS = [
  { name: "DSTV part files", extensions: ["nc1", "nc", "dstv"] },
  { name: "All files", extensions: ["*"] },
];

/** @type {BrowserWindow|null} */
let win = null;
/** Path handed to us before the window finished loading. */
let pendingPath = null;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Pull a DSTV path out of a process argv array, if there is one. */
function pathFromArgv(argv) {
  const candidates = argv
    .slice(isDev ? 2 : 1)
    .filter((a) => !a.startsWith("-") && /\.(nc1?|dstv|txt)$/i.test(a));
  return candidates[0] || null;
}

async function readPart(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return { path: filePath, name: path.basename(filePath), text };
}

/** Read a file and push it into the renderer. Reports its own errors. */
async function openPart(filePath) {
  if (!filePath) return;
  try {
    const payload = await readPart(filePath);
    app.addRecentDocument(filePath);
    if (win && !win.webContents.isLoading()) {
      win.webContents.send("file:opened", payload);
    } else {
      pendingPath = filePath;
    }
  } catch (err) {
    dialog.showErrorBox("Could not open file", `${filePath}\n\n${err.message}`);
  }
}

async function openViaDialog() {
  const res = await dialog.showOpenDialog(win, {
    title: "Open DSTV part",
    properties: ["openFile"],
    filters: FILTERS,
  });
  if (!res.canceled && res.filePaths[0]) await openPart(res.filePaths[0]);
}

/* ------------------------------------------------------------------ */
/*  Menu                                                               */
/* ------------------------------------------------------------------ */

function buildMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open part…", accelerator: "CmdOrCtrl+O", click: openViaDialog },
        { role: "recentDocuments", submenu: [{ role: "clearRecentDocuments" }] },
        { type: "separator" },
        {
          label: "Export view as PNG…",
          accelerator: "CmdOrCtrl+E",
          click: () => win?.webContents.send("menu:action", "export-png"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Model tab", accelerator: "CmdOrCtrl+1", click: () => win?.webContents.send("menu:action", "tab-model") },
        { label: "Source tab", accelerator: "CmdOrCtrl+2", click: () => win?.webContents.send("menu:action", "tab-source") },
        { type: "separator" },
        { label: "Isometric", accelerator: "CmdOrCtrl+I", click: () => win?.webContents.send("menu:action", "view-iso") },
        { label: "Front", accelerator: "CmdOrCtrl+F", click: () => win?.webContents.send("menu:action", "view-front") },
        { label: "Top", accelerator: "CmdOrCtrl+T", click: () => win?.webContents.send("menu:action", "view-top") },
        { label: "End", accelerator: "CmdOrCtrl+R", click: () => win?.webContents.send("menu:action", "view-end") },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
        { role: "reload" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About DSTV Viewer",
          click: () =>
            dialog.showMessageBox(win, {
              type: "info",
              title: "About DSTV Viewer",
              message: `DSTV Viewer ${app.getVersion()}`,
              detail:
                "Visualises DSTV / NC1 part files: round holes and slotted holes " +
                "from BO blocks, and saw angles derived from the AK outer contour.\n\n" +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
            }),
        },
        {
          label: "DSTV format reference",
          click: () => shell.openExternal("https://www.steel-sdc.com/"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/*  Window                                                             */
/* ------------------------------------------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0B1723",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.on("did-finish-load", () => {
    if (pendingPath) {
      const p = pendingPath;
      pendingPath = null;
      openPart(p);
    }
  });

  // Keep navigation inside the app; send real links to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.on("closed", () => { win = null; });
}

/* ------------------------------------------------------------------ */
/*  IPC                                                                */
/* ------------------------------------------------------------------ */

ipcMain.handle("dialog:open", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Open DSTV part",
    properties: ["openFile"],
    filters: FILTERS,
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const payload = await readPart(res.filePaths[0]);
  app.addRecentDocument(res.filePaths[0]);
  return payload;
});

ipcMain.handle("file:read", async (_e, filePath) => readPart(filePath));

ipcMain.handle("file:save-png", async (_e, { dataUrl, suggestedName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: "Export view as PNG",
    defaultPath: suggestedName || "dstv-view.png",
    filters: [{ name: "PNG image", extensions: ["png"] }],
  });
  if (res.canceled || !res.filePath) return null;
  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, "");
  await fs.writeFile(res.filePath, Buffer.from(base64, "base64"));
  return res.filePath;
});

ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: process.platform,
}));

/* ------------------------------------------------------------------ */
/*  Lifecycle — single instance, file associations, argv              */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const p = pathFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    if (p) openPart(p);
  });

  // macOS: double-click / "Open with" arrives here, possibly before ready.
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (app.isReady() && win) openPart(filePath);
    else pendingPath = filePath;
  });

  app.whenReady().then(() => {
    pendingPath = pendingPath || pathFromArgv(process.argv);
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
