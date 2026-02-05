// src/enforcer.js
const { spawn } = require("child_process");
const { recordUsageTick } = require("./policy");

let killLoop = null;
let usageLoop = null;

function nowMs() {
  return Date.now();
}

function cleanTickets(tickets) {
  const t = nowMs();
  return (tickets || []).filter(x => x.expiresAt > t);
}

function hasValidTicket(tickets, appId) {
  const t = nowMs();
  return (tickets || []).some(x => x.appId === appId && x.expiresAt > t);
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
  } catch (_) {}
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
  } catch (_) {}
}

function startEnforcer(ctx) {
  stopEnforcer();

  // Kill loop
  killLoop = setInterval(async () => {
    try {
      const blockedApps = ctx.getBlockedApps();
      let tickets = cleanTickets(ctx.getTickets());
      if (tickets.length !== ctx.getTickets().length) ctx.setTickets(tickets);

      const procs = await getProcesses();

      for (const appItem of blockedApps) {
        const blockedNames = (appItem.processNames || []).map(x => x.toLowerCase());
        const matches = procs.filter(p => blockedNames.includes((p.name || "").toLowerCase()));
        if (matches.length === 0) continue;

        if (!hasValidTicket(tickets, appItem.id)) {
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

        const blockedNames = (appItem.processNames || []).map(x => x.toLowerCase());
        const running = procs.some(p => blockedNames.includes((p.name || "").toLowerCase()));

        if (running) {
          usageLog = recordUsageTick({ usageLog, appId: appItem.id, minutes: 1, now: new Date() });
        }
      }

      ctx.setUsageLog(usageLog);
    } catch (e) {}
  }, 60 * 1000);
}

function stopEnforcer() {
  if (killLoop) clearInterval(killLoop);
  if (usageLoop) clearInterval(usageLoop);
  killLoop = null;
  usageLoop = null;
}

module.exports = {
  startEnforcer,
  stopEnforcer,
  launchAppNow
};
