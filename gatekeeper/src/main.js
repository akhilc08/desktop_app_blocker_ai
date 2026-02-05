const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage } = require("electron");
const Store = require("electron-store");
const { startEnforcer, stopEnforcer, launchAppNow } = require("./enforcer");
const { evaluatePolicy, minutesUsedToday, recordUsageTick } = require("./policy");
const path = require("path");

const store = new Store({
  name: "gatekeeper",
  defaults: {
    blockedApps: [
      {
        id: "steam",
        name: "Steam",
        // Minimal: match process names (cross-platform-ish)
        processNames: process.platform === "win32" ? ["steam.exe"] : ["Steam"],
        // Optional launch info
        launch: process.platform === "win32"
          ? { type: "exe", path: "C:\\Program Files (x86)\\Steam\\Steam.exe" }
          : { type: "mac_open_app", appName: "Steam" }
      }
    ],
    policies: {
      steam: {
        allowedWindows: [
          { days: ["Sat", "Sun"], start: "18:00", end: "22:00" }
        ],
        dailyMaxMinutes: 60,
        maxUnlockMinutesPerRequest: 20
      }
    },
    // runtime data
    tickets: [],          // allow tickets
    usageLog: {}          // keyed by YYYY-MM-DD -> { appId: minutes }
  }
});

let tray = null;
let chatWin = null;
let settingsWin = null;

function createWindow(htmlFile, width = 420, height = 560) {
  const win = new BrowserWindow({
    width,
    height,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, "windows", htmlFile));
  return win;
}

function openChat() {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.focus();
    return;
  }
  chatWin = createWindow("chat.html");
  chatWin.on("closed", () => (chatWin = null));
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = createWindow("settings.html", 640, 560);
  settingsWin.on("closed", () => (settingsWin = null));
}

function buildTray() {
  // simple empty icon fallback
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Gatekeeper");

  const menu = Menu.buildFromTemplate([
    { label: "Request Unlock", click: openChat },
    { label: "Settings", click: openSettings },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]);

  tray.setContextMenu(menu);
  tray.on("click", openChat);
}

app.whenReady().then(() => {
  buildTray();
  openChat(); // <-- add this line so a window always appears

  startEnforcer({
    getBlockedApps: () => store.get("blockedApps"),
    getTickets: () => store.get("tickets"),
    setTickets: (tickets) => store.set("tickets", tickets),
    getPolicies: () => store.get("policies"),
    getUsageLog: () => store.get("usageLog"),
    setUsageLog: (log) => store.set("usageLog", log),
  });

  app.on("window-all-closed", (e) => e.preventDefault());
});


app.on("before-quit", () => {
  stopEnforcer();
});

ipcMain.handle("config:get", () => {
  return {
    blockedApps: store.get("blockedApps"),
    policies: store.get("policies"),
    tickets: store.get("tickets"),
    usageToday: store.get("usageLog")
  };
});

ipcMain.handle("config:set", (_event, newConfig) => {
  if (newConfig.blockedApps) store.set("blockedApps", newConfig.blockedApps);
  if (newConfig.policies) store.set("policies", newConfig.policies);
  return { ok: true };
});

ipcMain.handle("unlock:request", async (_event, { appId, message }) => {
  const blockedApps = store.get("blockedApps");
  const policies = store.get("policies");
  const usageLog = store.get("usageLog");

  const appItem = blockedApps.find(a => a.id === appId);
  if (!appItem) return { ok: false, reply: "Unknown app." };

  // Hard policy verdict (no AI override)
  const verdict = evaluatePolicy({
    appId,
    policy: policies[appId],
    usageLog,
    now: new Date()
  });

  if (verdict.type === "DENY") {
    return {
      ok: false,
      reply: `No. ${verdict.reason}\n\nTry again when you’re inside your allowed window or under your daily limit.`
    };
  }

  // “AI” stub: add friction, ask a follow-up if message too short
  let reply = "";
  if (!message || message.trim().length < 8) {
    return {
      ok: false,
      reply: "Give me an actual reason (one sentence). What are you going to do in the app?"
    };
  }

  const unlockMinutes = Math.min(
    verdict.allowedMinutes,
    policies[appId]?.maxUnlockMinutesPerRequest ?? verdict.allowedMinutes
  );

  // Create allow ticket
  const tickets = store.get("tickets");
  const expiresAt = Date.now() + unlockMinutes * 60 * 1000;
  const ticket = { appId, expiresAt, reason: message.slice(0, 160), createdAt: Date.now() };

  // Replace any existing ticket for same app
  const nextTickets = tickets.filter(t => t.appId !== appId).concat(ticket);
  store.set("tickets", nextTickets);

  // Launch app now (optional but nice)
  await launchAppNow(appItem);

  reply = `Fine. You get ${unlockMinutes} minutes.\n\nRule: when time’s up, it closes.`;
  return { ok: true, reply, unlockMinutes };
});
