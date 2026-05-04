const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, dialog } = require("electron");

const DEV_URL = process.env.ELECTRON_START_URL || "";
const APP_URL = DEV_URL || "http://127.0.0.1:3001";
const SHOULD_MANAGE_API =
  process.env.ELECTRON_MANAGED_API === "1" ||
  (!DEV_URL && process.env.ELECTRON_MANAGED_API !== "0");

let apiServer = null;
const APP_ICON_PATH = path.join(__dirname, "..", "assets", "logo-icon.png");
const API_HEALTH_URL = "http://127.0.0.1:3001/api/health";
let startupLogPath = null;

function resolveAppIconPath() {
  if (fs.existsSync(APP_ICON_PATH)) {
    return APP_ICON_PATH;
  }
  logStartup(`App icon missing at ${APP_ICON_PATH}; continuing without custom icon`);
  return null;
}

function logStartup(message, error) {
  const stamp = new Date().toISOString();
  const extra = error ? `\n${error.stack || error.message || String(error)}` : "";
  const line = `[${stamp}] ${message}${extra}\n`;
  try {
    if (startupLogPath) {
      fs.appendFileSync(startupLogPath, line, "utf8");
    }
  } catch {
    // Fallback to console when file logging fails.
  }
  console.log(line.trim());
}

async function waitForApiReady(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`Health endpoint returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for API: ${lastError?.message || "unknown error"}`);
}

async function ensureApiRunning() {
  if (!SHOULD_MANAGE_API) return;
  logStartup("Checking for existing API instance");
  try {
    await waitForApiReady(API_HEALTH_URL, 1000);
    logStartup("Detected existing API instance");
    return;
  } catch {
    // API is not up yet; continue to start managed server.
    logStartup("No existing API instance detected; starting managed API");
  }
  const { startApiServer } = await import("../server/api.js");
  try {
    apiServer = await startApiServer();
    logStartup("Managed API started");
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      logStartup("API port in use; waiting for existing API health");
      await waitForApiReady(API_HEALTH_URL, 5000);
      return;
    }
    logStartup("Failed starting managed API", error);
    throw error;
  }
  await waitForApiReady(API_HEALTH_URL);
  logStartup("API healthcheck passed");
}

function stopManagedApi() {
  if (!apiServer) return;
  logStartup("Stopping managed API");
  apiServer.close();
  apiServer = null;
}

function createWindow() {
  logStartup("Creating main window");
  const iconPath = resolveAppIconPath();
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (DEV_URL) {
    logStartup(`Loading dev URL: ${DEV_URL}`);
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    logStartup(`Window failed to load ${url} (${code}): ${description}`);
    dialog.showErrorBox(
      "Straight Outta failed to load",
      `Could not load ${url} (${code}): ${description}`
    );
  });
  mainWindow.webContents.once("did-finish-load", () => {
    logStartup(`Window loaded: ${APP_URL}`);
  });
  logStartup(`Loading app URL: ${APP_URL}`);
  mainWindow.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  startupLogPath = path.join(app.getPath("logs"), "straight-outta-startup.log");
  logStartup(`Startup log initialized at ${startupLogPath}`);
  logStartup(`App version ${app.getVersion()}`);
  try {
    await ensureApiRunning();
  } catch (error) {
    logStartup("Fatal startup error while ensuring API", error);
    dialog.showErrorBox(
      "Straight Outta could not start",
      `${error?.message || String(error)}\n\nStartup log:\n${startupLogPath}`
    );
    app.quit();
    return;
  }

  if (process.platform === "darwin" && app.dock) {
    const iconPath = resolveAppIconPath();
    if (iconPath) {
      try {
        app.dock.setIcon(iconPath);
      } catch (error) {
        logStartup("Failed to set dock icon; continuing startup", error);
      }
    }
  }

  createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        await ensureApiRunning();
      } catch (error) {
        logStartup("Failed to re-establish API on activate", error);
        dialog.showErrorBox(
          "Straight Outta could not reconnect API",
          `${error?.message || String(error)}\n\nStartup log:\n${startupLogPath}`
        );
        return;
      }
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopManagedApi();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopManagedApi();
});

process.on("uncaughtException", (error) => {
  logStartup("Uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  logStartup("Unhandled rejection", error);
});
