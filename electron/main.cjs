const { app, BrowserWindow, Menu, session, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
};

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("enable-features", "AudioServiceOutOfProcess");
app.commandLine.appendSwitch("high-dpi-support", "1");

let server;
let serverUrl;

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, cleanPath));

  if (!filePath.startsWith(ROOT)) {
    return null;
  }

  return filePath;
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const filePath = resolveRequestPath(request.url || "/");
      if (!filePath) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": type,
        });
        response.end(data);
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      serverUrl = `http://127.0.0.1:${address.port}`;
      resolve(serverUrl);
    });
  });
}

function configurePermissions() {
  const appSession = session.defaultSession;

  appSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = new Set([
      "audioCapture",
      "display-capture",
      "media",
      "mediaKeySystem",
      "speaker-selection",
    ]);
    callback(allowed.has(permission));
  });

  appSession.setDisplayMediaRequestHandler((request, callback) => {
    callback({
      audio: "loopback",
      video: request.videoRequested ? undefined : null,
    });
  }, {
    useSystemPicker: true,
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#101316",
    title: "Speaker Splitter Pro",
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(`${serverUrl}/index.html?desktop=1`);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  configurePermissions();
  await startServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  server?.close();
});
