"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Deliberately narrow surface: the renderer can ask for a file and save a PNG,
 * and nothing else. No fs, no path, no ipcRenderer leak.
 */
contextBridge.exposeInMainWorld("dstv", {
  /** Native open dialog. Resolves to {path,name,text} or null if cancelled. */
  openDialog: () => ipcRenderer.invoke("dialog:open"),

  /** Read a specific path (used for drag-and-drop). */
  readPath: (filePath) => ipcRenderer.invoke("file:read", filePath),

  /** Native save dialog for a PNG data URL. Resolves to the written path or null. */
  savePng: (dataUrl, suggestedName) =>
    ipcRenderer.invoke("file:save-png", { dataUrl, suggestedName }),

  appInfo: () => ipcRenderer.invoke("app:info"),

  /** Fired when the main process opens a part (menu, argv, file association). */
  onOpenFile: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("file:opened", handler);
    return () => ipcRenderer.removeListener("file:opened", handler);
  },

  /** Fired for menu commands the renderer owns (tabs, views, export). */
  onMenuAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on("menu:action", handler);
    return () => ipcRenderer.removeListener("menu:action", handler);
  },
});
