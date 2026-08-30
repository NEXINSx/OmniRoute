"use strict";

const { contextBridge } = require("electron");

// Minimaler, sicherer Bridge — die Control-Room-PWA braucht keine Node-APIs.
contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  isDesktop: true,
  uiPort: 20129,
});
