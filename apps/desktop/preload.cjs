/**
 * What the web app is told about the program it is running in. Nothing here
 * gives the page power over the computer: it can learn that it is in the
 * desktop program and on which system, and ask where the computer is (the clinic
 * app pins a staff session to the place it opened).
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("parchaDesktop", {
  isDesktop: true,
  platform: process.platform,
  /** { lat, lng, accuracy } from the operating system, or null if it has no fix. */
  getLocation: () => ipcRenderer.invoke("parcha:location"),
});
