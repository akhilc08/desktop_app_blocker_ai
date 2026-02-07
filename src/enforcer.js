// src/enforcer.js
const { spawn } = require("child_process");
const path = require("path");
const { recordUsageTick, evaluatePolicy, minutesUsedToday } = require("./policy");

let killLoop = null;
let usageLoop = null;
let dailyLoop = null;
const notifyCooldownMs = 30 * 1000;
const lastNotifyByApp = new Map();

function nowMs() {
  return Date.now();
}

function cleanTickets(tickets) {
  const t = nowMs();
  return (tickets || []).filter(x => x.expiresAt > t);
}

function reconcileExpiredTickets(ctx) {
  const tickets = ctx.getTickets ? (ctx.getTickets() || []) : [];
  const now = Date.now();
  const expired = tickets.filter(t => (t.expiresAt || 0) <= now);
  if (expired.length === 0) return tickets;

  let usageLog = ctx.getUsageLog ? (ctx.getUsageLog() || {}) : {};
  let updatedUsage = false;
  const today = new Date();

  for (const t of expired) {
    const appId = t.appId;
    if (!appId) continue;
    let initialMinutes = (typeof t.initialMinutes === "number") ? Math.floor(t.initialMinutes) : null;
    if (!initialMinutes || initialMinutes <= 0) {
      const createdAt = Number(t.createdAt || 0);
      const expiresAt = Number(t.expiresAt || 0);
      if (createdAt > 0 && expiresAt > createdAt) {
        initialMinutes = Math.max(1, Math.ceil((expiresAt - createdAt) / 60000));
      }
    }
    if (!initialMinutes || initialMinutes <= 0) continue;

    const usageAtGrant = (typeof t.usageAtGrant === "number")
      ? Number(t.usageAtGrant)
      : minutesUsedToday(usageLog, appId, today);

    const usageNow = minutesUsedToday(usageLog, appId, today);
    const alreadyCounted = Math.max(0, usageNow - usageAtGrant);
    const toAdd = Math.max(0, initialMinutes - alreadyCounted);
    if (toAdd > 0) {
      usageLog = recordUsageTick({ usageLog, appId, minutes: toAdd, now: today });
      updatedUsage = true;
    }
  }

  if (updatedUsage && ctx.setUsageLog) ctx.setUsageLog(usageLog);

  const active = tickets.filter(t => (t.expiresAt || 0) > now);
  if (ctx.setTickets) ctx.setTickets(active);
  return active;
}

function hasValidTicket(tickets, appId) {
  const t = nowMs();
  const needle = String(appId || '').toLowerCase();
  return (tickets || []).some(x => String(x.appId || '').toLowerCase() === needle && x.expiresAt > t);
}

function getProcessNameCandidates(appItem) {
  const names = new Set();
  const add = (v) => {
    if (!v) return;
    const s = String(v).trim();
    if (!s) return;
    names.add(s.toLowerCase());
  };

  const pn = Array.isArray(appItem.processNames) ? appItem.processNames : [];
  pn.forEach(add);

  const baseNames = [appItem.name, appItem.id];
  for (const n of baseNames) {
    if (!n) continue;
    const s = String(n);
    add(s);
    add(s.replace(/\s+/g, ""));
    add(`${s}.exe`);
    add(`${s.replace(/\s+/g, "")}.exe`);
    const firstWord = s.split(/\s+/)[0];
    add(firstWord);
    add(`${firstWord}.exe`);
  }

  const launchPath = appItem.launch && appItem.launch.path ? String(appItem.launch.path) : "";
  if (launchPath) {
    const base = path.basename(launchPath);
    add(base);
    add(base.replace(/\s+/g, ""));
  }

  return Array.from(names);
}

// ps-list is ESM-only, so we must dynamic import it
async function getProcesses() {
  const mod = await import("ps-list");
  const psList = mod.default || mod;
  return psList();
}

async function killProcess(proc) {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(proc.pid), "/F"], { windowsHide: true });
    } else {
      process.kill(proc.pid, "SIGKILL");
    }
  } catch (_) { }
}

async function launchAppNow(appItem) {
  try {
    const launch = appItem.launch;
    if (!launch) return;

    if (process.platform === "win32" && launch.type === "exe") {
      spawn(launch.path, [], { detached: true, stdio: "ignore", windowsHide: true });
    } else if (process.platform === "darwin" && launch.type === "mac_open_app") {
      spawn("open", ["-a", launch.appName], { detached: true, stdio: "ignore" });
    }
  } catch (_) { }
}

function startEnforcer(ctx) {
  stopEnforcer();

  // Track local day key so we can reset daily usage at midnight
  function pad2(n) { return String(n).padStart(2, "0"); }
  function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  let currentDayKey = ymd(new Date());

  // Kill loop
  killLoop = setInterval(async () => {
    try {
      const blockedApps = ctx.getBlockedApps();
      const now = nowMs();
      const allTickets = ctx.getTickets ? (ctx.getTickets() || []) : [];
      const expiredByApp = new Set(
        allTickets
          .filter(t => (t.expiresAt || 0) <= now)
          .map(t => String(t.appId || '').toLowerCase())
      );
      // reconcile expired tickets into usage log and remove them
      let tickets = reconcileExpiredTickets(ctx);
      // ensure any remaining stale tickets are cleaned
      tickets = cleanTickets(tickets);
      if (tickets.length !== ctx.getTickets().length) ctx.setTickets(tickets);

      const procs = await getProcesses();

      for (const appItem of blockedApps) {
        const blockedNames = getProcessNameCandidates(appItem);
        const matches = procs.filter(p => blockedNames.includes((p.name || "").toLowerCase()));
        if (matches.length === 0) continue;

        if (!hasValidTicket(tickets, appItem.id)) {
          if (typeof ctx.notifyRestricted === "function") {
            const key = String(appItem.id || appItem.name || "").toLowerCase();
            const last = lastNotifyByApp.get(key) || 0;
            if ((now - last) >= notifyCooldownMs) {
              lastNotifyByApp.set(key, now);
              const isTimeExpired = expiredByApp.has(String(appItem.id || '').toLowerCase());
              let reason = isTimeExpired ? "Time limit expired." : "No active unlock ticket.";
              try {
                if (typeof ctx.getPolicies === "function" && typeof ctx.getUsageLog === "function") {
                  const policies = ctx.getPolicies() || {};
                  const usageLog = ctx.getUsageLog() || {};
                  const policy = policies[appItem.id];
                  const verdict = evaluatePolicy({ appId: appItem.id, policy, usageLog, now: new Date() });
                  if (verdict && verdict.type === "HARD_DENY" && verdict.reason) {
                    reason = verdict.reason;
                  }
                }
              } catch (_) { }
              try { ctx.notifyRestricted(appItem, matches, reason, { type: isTimeExpired ? "time-expired" : "restricted" }); } catch (_) { }
            }
          }
          for (const proc of matches) await killProcess(proc);
        }
      }
    } catch (e) {
      // keep app alive even if ps-list throws sometimes
    }
  }, 900);

  // Usage loop
  usageLoop = setInterval(async () => {
    try {
      const blockedApps = ctx.getBlockedApps();
      let tickets = cleanTickets(ctx.getTickets());
      if (tickets.length !== ctx.getTickets().length) ctx.setTickets(tickets);

      const procs = await getProcesses();
      let usageLog = ctx.getUsageLog();

      for (const appItem of blockedApps) {
        if (!hasValidTicket(tickets, appItem.id)) continue;

        const blockedNames = getProcessNameCandidates(appItem);
        const running = procs.some(p => blockedNames.includes((p.name || "").toLowerCase()));

        if (running) {
          usageLog = recordUsageTick({ usageLog, appId: appItem.id, minutes: 1, now: new Date() });
        }
      }

      ctx.setUsageLog(usageLog);
    } catch (e) { }
  }, 60 * 1000);

  // Daily reset loop: when the local day rolls over, keep only today's usage
  dailyLoop = setInterval(() => {
    try {
      const today = ymd(new Date());
      if (today === currentDayKey) return;
      currentDayKey = today;
      let usageLog = ctx.getUsageLog ? (ctx.getUsageLog() || {}) : {};
      // Keep only today's entry to effectively reset daily counters
      const newLog = {};
      newLog[today] = usageLog[today] || {};
      if (ctx.setUsageLog) ctx.setUsageLog(newLog);
    } catch (_) { }
  }, 60 * 1000);
}

function stopEnforcer() {
  if (killLoop) clearInterval(killLoop);
  if (usageLoop) clearInterval(usageLoop);
  if (dailyLoop) clearInterval(dailyLoop);
  killLoop = null;
  usageLoop = null;
  dailyLoop = null;
}

module.exports = {
  startEnforcer,
  stopEnforcer,
  launchAppNow
};
