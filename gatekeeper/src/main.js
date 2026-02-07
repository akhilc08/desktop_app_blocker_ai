const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, Notification } = require("electron");
const Store = require("electron-store");
const { startEnforcer, stopEnforcer, launchAppNow } = require("./enforcer");
const { evaluatePolicy, minutesUsedToday, recordUsageTick } = require("./policy");
const Chatbot = require("./chatbot");
const { getProcessNamesForApp } = require("./appDetector");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

if (process.platform === "win32") {
  // Ensure the taskbar icon uses the app's window icon.
  app.setAppUserModelId("com.gatekeeper.app");
}

const store = new Store({
  name: "gatekeeper",
  defaults: {
    blockedApps: [],
    policies: {},
    // runtime data
    tickets: [],          // allow tickets
    usageLog: {},          // keyed by YYYY-MM-DD -> { appId: minutes }
    geminiApiKey: "",      // Gemini API key for chatbot (set in Settings)
    visibleApps: []
    ,
    modelName: ""
  }
});

// Initialize chatbot with API key
const geminiApiKey = process.env.GEMINI_API_KEY || store.get("geminiApiKey");
let chatbot = new Chatbot(geminiApiKey);

let tray = null;
let chatWin = null;
let settingsWin = null;

// Get installed applications from Windows Registry
function getInstalledApps() {
  try {
    const apps = new Set();

    if (process.platform === "win32") {
      // Query Windows registry for installed apps
      const registryPaths = [
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
      ];

      for (const regPath of registryPaths) {
        try {
          const output = execSync(
            `powershell -Command "Get-ItemProperty '${regPath}\\*' -ErrorAction SilentlyContinue | Select-Object DisplayName | Where-Object {$_.DisplayName} | ForEach-Object {$_.DisplayName}"`,
            { encoding: 'utf8' }
          );

          output.split('\n').forEach(name => {
            const trimmed = name.trim();
            if (trimmed && trimmed.length > 0) {
              apps.add(trimmed);
            }
          });
        } catch (e) {
          // Registry path might not exist
        }
      }

      // Also include Microsoft Store (AppX) apps like Spotify
      try {
        const appxOutput = execSync(
          'powershell -Command "Get-AppxPackage | ForEach-Object { if ($_.DisplayName) { $_.DisplayName } else { $_.Name } }"',
          { encoding: 'utf8' }
        );

        appxOutput.split('\n').forEach(name => {
          const trimmed = name.trim();
          // Skip GUID-like package names
          const isGuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
          const isWindowsWorkload = /^WindowsWorkload/i.test(trimmed);
          if (trimmed && trimmed.length > 0 && !isGuidLike && !isWindowsWorkload) {
            apps.add(trimmed);
          }
        });
      } catch (e) {
        // AppX query might fail on some systems
      }
    }

    return Array.from(apps).sort();
  } catch (error) {
    console.error("Error getting installed apps:", error);
    return [];
  }
}

// Ensure an app is in the blocked apps list with proper process names
function ensureAppInBlockedList(appId, appName) {
  const blockedApps = store.get("blockedApps");

  // Normalize id (slug)
  const normalizedId = String(appId || appName || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const displayName = appName || appId || normalizedId;

  // Check if already in list
  const existingIndex = blockedApps.findIndex(a => String(a.id).toLowerCase() === normalizedId);
  if (existingIndex !== -1) {
    const existing = blockedApps[existingIndex];
    const existingNames = Array.isArray(existing.processNames) ? existing.processNames : [];
    const computed = getProcessNamesForApp(displayName);
    const merged = Array.from(new Set([...existingNames, ...computed]));
    if (merged.length !== existingNames.length) {
      blockedApps[existingIndex] = { ...existing, processNames: merged };
      store.set("blockedApps", blockedApps);
    }
    return;
  }

  // Get likely process names for this app
  const processNames = getProcessNamesForApp(displayName);

  // Create a new blocked app entry
  const newApp = {
    id: normalizedId,
    name: displayName,
    processNames: processNames,
    launch: null
  };

  // Add to blocked apps
  blockedApps.push(newApp);
  store.set("blockedApps", blockedApps);

  console.log(`Added app to blocked list: ${displayName} (id=${normalizedId}) with process names: ${processNames.join(", ")}`);
}

function normalizeBlockedApps(blockedApps) {
  const list = Array.isArray(blockedApps) ? blockedApps : [];
  return list.map(appItem => {
    const displayName = appItem.name || appItem.id || "";
    const computed = getProcessNamesForApp(displayName);
    const existing = Array.isArray(appItem.processNames) ? appItem.processNames : [];
    const merged = Array.from(new Set([...existing, ...computed]));
    return { ...appItem, processNames: merged };
  });
}

function createWindow(htmlFile, width = 900, height = 700, minWidth = 800, minHeight = 600) {
  const iconIco = path.join(__dirname, "assets", "icon.ico");
  const iconSvg = path.join(__dirname, "assets", "icon.svg");
  const iconPath = (process.platform === "win32" && fs.existsSync(iconIco)) ? iconIco : iconSvg;
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    resizable: true,
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "windows", htmlFile));
  return win;
}

function openChat() {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.focus();
    return;
  }
  chatWin = createWindow("chat.html", 900, 700, 820, 600);
  chatWin.on("closed", () => (chatWin = null));
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = createWindow("settings.html", 1000, 800, 900, 700);
  settingsWin.on("closed", () => (settingsWin = null));
}

function buildTray() {
  // load bundled icon for tray
  const iconIco = path.join(__dirname, "assets", "icon.ico");
  const iconSvg = path.join(__dirname, "assets", "icon.svg");
  const iconPath = (process.platform === "win32" && fs.existsSync(iconIco)) ? iconIco : iconSvg;
  let icon = nativeImage.createFromPath(iconPath);
  try { icon = icon.resize({ width: 16, height: 16 }); } catch (_) { }
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  buildTray();
  openChat(); // <-- add this line so a window always appears

  // Normalize blocked apps process names on startup
  try {
    const normalized = normalizeBlockedApps(store.get("blockedApps"));
    store.set("blockedApps", normalized);
  } catch (_) { }

  // Attempt to discover a working model at startup (if API key provided)
  try {
    if (chatbot && typeof chatbot.ensureModel === 'function') {
      await chatbot.ensureModel();
      const detected = chatbot.modelName || store.get('modelName') || '';
      if (detected) store.set('modelName', detected);
    }
  } catch (_) { }

  startEnforcer({
    getBlockedApps: () => store.get("blockedApps"),
    getTickets: () => store.get("tickets"),
    setTickets: (tickets) => store.set("tickets", tickets),
    getPolicies: () => store.get("policies"),
    getUsageLog: () => store.get("usageLog"),
    setUsageLog: (log) => store.set("usageLog", log),
    notifyRestricted: (appItem, _matches, reason, context) => {
      try {
        if (!Notification.isSupported()) return;
        const name = appItem && (appItem.name || appItem.id) ? (appItem.name || appItem.id) : "An app";
        const reasonText = reason ? `Reason: ${reason}` : "Reason: Gatekeeper policy";
        const isTimeExpired = context && context.type === "time-expired";
        // choose an icon (prefer bundled .ico on Windows, else svg)
        const iconIco = path.join(__dirname, "assets", "icon.ico");
        const iconSvg = path.join(__dirname, "assets", "icon.svg");
        const iconPath = (process.platform === "win32" && fs.existsSync(iconIco)) ? iconIco : iconSvg;
        const note = new Notification({
          title: isTimeExpired ? "Time's up" : "Gatekeeper restricted app",
          body: isTimeExpired
            ? `${name} was closed because your time ran out. You can request more time if needed.`
            : `${name} was restricted from opening. ${reasonText}`,
          icon: iconPath
        });
        note.show();
      } catch (_) { }
    }
  });

  app.on("window-all-closed", (e) => e.preventDefault());
});


app.on("before-quit", () => {
  stopEnforcer();
});

// Allow renderer to request opening the settings window
ipcMain.handle('window:openSettings', () => {
  openSettings();
  return { ok: true };
});

ipcMain.handle("config:get", () => {
  return {
    blockedApps: store.get("blockedApps"),
    policies: store.get("policies"),
    tickets: store.get("tickets"),
    usageToday: store.get("usageLog"),
    visibleApps: store.get("visibleApps")
    ,
    modelName: store.get("modelName")
  };
});

ipcMain.handle("apps:getInstalledApps", () => {
  return getInstalledApps();
});

ipcMain.handle("config:set", (_event, newConfig) => {
  if (newConfig.blockedApps) store.set("blockedApps", normalizeBlockedApps(newConfig.blockedApps));
  if (newConfig.policies) store.set("policies", newConfig.policies);
  if (newConfig.visibleApps) store.set("visibleApps", newConfig.visibleApps);
  if (newConfig.modelName !== undefined) store.set("modelName", newConfig.modelName);
  // Ensure visible apps are present in blockedApps so they are actually restricted
  try {
    if (newConfig.visibleApps && Array.isArray(newConfig.visibleApps)) {
      for (const name of newConfig.visibleApps) {
        const id = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        ensureAppInBlockedList(id, name);
      }
    }
  } catch (_) { }
  // Broadcast updated config to all renderer windows so UI can refresh live
  try {
    const payload = {
      blockedApps: store.get("blockedApps"),
      policies: store.get("policies"),
      visibleApps: store.get("visibleApps")
    };
    BrowserWindow.getAllWindows().forEach(w => {
      try { w.webContents.send('config:updated', payload); } catch (_) { }
    });
  } catch (_) { }

  return { ok: true };
});

ipcMain.handle('chatbot:detectModel', async () => {
  try {
    if (!chatbot) return '';
    if (typeof chatbot.ensureModel === 'function') {
      await chatbot.ensureModel();
      return chatbot.modelName || store.get('modelName') || '';
    }
    return store.get('modelName') || '';
  } catch (e) {
    return store.get('modelName') || '';
  }
});

ipcMain.handle('chatbot:setModelName', async (_e, modelName) => {
  try {
    store.set('modelName', modelName);
    if (chatbot) {
      chatbot.modelName = modelName;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('chatbot:listModels', async () => {
  try {
    if (!chatbot || !chatbot.client) {
      return { models: [], fallback: true, message: 'No API key configured. Enter a model name manually.' };
    }

    // GoogleGenAI doesn't have a listModels method; just return a message
    return { models: [], fallback: true, message: 'Model listing not available. Use a model name like gemini-2.5-flash or gemini-2.5-pro.' };
  } catch (e) {
    return { models: [], fallback: true, message: String(e) };
  }
});

ipcMain.handle("chatbot:setApiKey", (_event, apiKey) => {
  return (async () => {
    try {
      store.set("geminiApiKey", apiKey);
      // Also set environment vars commonly used by clients so they can pick up the key
      try { process.env.GEMINI_API_KEY = apiKey; } catch (_) { }
      try { process.env.GOOGLE_API_KEY = apiKey; } catch (_) { }

      // Reinitialize chatbot with new key
      const ChatbotCls = require("./chatbot");
      // prefer passing the key, but client may read env vars if needed
      chatbot = new ChatbotCls(apiKey);
      if (chatbot && typeof chatbot.ensureModel === 'function') {
        try {
          await chatbot.ensureModel();
          if (chatbot.modelName) store.set('modelName', chatbot.modelName);
        } catch (_) { }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })();
});

// Validate API key by attempting a lightweight generation call
ipcMain.handle('chatbot:validateApiKey', async () => {
  try {
    if (!chatbot || !chatbot.client) {
      // try to reinitialize from store in case API key was saved but client wasn't built
      const stored = store.get('geminiApiKey') || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (stored) {
        const ChatbotCls = require('./chatbot');
        chatbot = new ChatbotCls(stored);
      }
      if (!chatbot || !chatbot.client) return { ok: false, message: 'No API key configured' };
    }

    // Try a quick generation test with GoogleGenAI shape
    if (chatbot.client && chatbot.client.models && typeof chatbot.client.models.generateContent === 'function') {
      try {
        const testModel = chatbot.modelName || store.get('modelName') || 'gemini-3-flash-preview';
        const response = await chatbot.client.models.generateContent({
          model: testModel,
          contents: 'health-check'
        });
        return { ok: true, message: 'API key valid' };
      } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        const cause = e && e.cause ? e.cause : null;
        const causeMsg = cause && cause.message ? cause.message : null;
        const causeCode = cause && cause.code ? cause.code : null;
        const detail = [msg, causeCode ? `code=${causeCode}` : '', causeMsg ? `cause=${causeMsg}` : '']
          .filter(Boolean)
          .join(' | ');
        return { ok: false, message: detail };
      }
    }

    return { ok: false, message: 'Unable to validate API key with this client' };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
});

ipcMain.handle("chatbot:hasApiKey", () => {
  return !!store.get("geminiApiKey");
});

ipcMain.handle("unlock:request", async (_event, { appId, appName, message, requestedMinutes }) => {
  // Ensure the app is in the blocked list with proper process names
  ensureAppInBlockedList(appId, appName);

  const blockedApps = store.get("blockedApps");
  const policies = store.get("policies");
  const usageLog = store.get("usageLog");

  let appItem = blockedApps.find(a => String(a.id).toLowerCase() === String(appId).toLowerCase());

  // If still not found, create a default entry (shouldn't happen)
  if (!appItem) {
    appItem = {
      id: appId,
      name: appId,
      processNames: getProcessNamesForApp(appId),
      launch: null
    };
  }

  // Hard policy verdict (no AI override)
  // If no specific policy exists, deny by policy
  const policy = policies[appId] || null;
  const displayName = appName || appId;
  const verdict = evaluatePolicy({
    appId,
    policy,
    usageLog,
    now: new Date()
  });

  if (verdict.type === "HARD_DENY") {
    const denyResp = await chatbot.generateResponse(message, displayName, verdict);
    const denyText = (denyResp && typeof denyResp === 'object') ? (denyResp.text || '') : String(denyResp || 'Request denied');
    return { ok: false, reply: denyText };
  }

  // “AI” stub: add friction, ask a follow-up if message too short

  if (!message || message.trim().length < 8) {
    return {
      ok: false,
      reply: "Give me an actual reason (one sentence). What are you going to do in the app?"
    };
  }

  // honor a requestedMinutes value from UI but cap it to policy and verdict
  const cap = Math.min(verdict.allowedMinutes, policy?.maxUnlockMinutesPerRequest ?? verdict.allowedMinutes);
  // Ask the chatbot to evaluate the reason strictly; it may return a decision object
  try {
    const cbResp = await chatbot.generateResponse(message, displayName, verdict);
    let cbText = '';
    let cbDecision = null;
    if (cbResp && typeof cbResp === 'object') {
      cbText = cbResp.text || '';
      cbDecision = cbResp.decision || null;
    } else {
      cbText = String(cbResp || '');
    }

    // Require explicit allow from the chatbot to grant time
    if (!cbDecision || cbDecision.allow !== true) {
      const fallback = cbText || 'Denied by Gatekeeper AI. Provide a clear reason and try again.';
      return { ok: false, reply: fallback };
    }

    const requested = (typeof requestedMinutes === 'number' && !Number.isNaN(requestedMinutes))
      ? Math.max(1, Math.floor(requestedMinutes))
      : cap;
    const modelAllow = (cbDecision && typeof cbDecision.allowMinutes === 'number')
      ? Math.max(1, Math.floor(cbDecision.allowMinutes))
      : null;
    const desired = modelAllow ? Math.min(requested, modelAllow) : requested;
    const unlockMinutes = Math.min(desired, cap);

    // Create allow ticket
    const tickets = store.get("tickets");
    const expiresAt = Date.now() + unlockMinutes * 60 * 1000;
    // capture usage so far at grant time so UI can compute remaining daily allowance across reloads
    const usageAtGrant = minutesUsedToday(store.get("usageLog"), appId, new Date());
    const ticket = {
      appId,
      expiresAt,
      reason: message.slice(0, 160),
      createdAt: Date.now(),
      initialMinutes: unlockMinutes,
      usageAtGrant: usageAtGrant
    };

    // Replace any existing ticket for same app
    const nextTickets = tickets.filter(t => t.appId !== appId).concat(ticket);
    store.set("tickets", nextTickets);

    // Launch app now (optional but nice)
    if (appItem.launch) {
      await launchAppNow(appItem);
    }

    // Use the chatbot's decision message for confirmation
    const replyText = cbText || `Approved for ${unlockMinutes} minutes.`;
    return { ok: true, reply: replyText, unlockMinutes };
  } catch (e) {
    return { ok: false, reply: String(e) };
  }
});

