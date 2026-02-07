function getLocalDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function renderAppStatus() {
  const section = document.getElementById('appStatusSection');
  const listDiv = document.getElementById('appStatusList');
  if (!section || !listDiv) return;
  listDiv.innerHTML = 'Loading...';
  try {
    const cfg = await window.Gatekeeper.getConfig();
    // Build app list from blocked apps and policies (union)
    const blocked = (cfg && Array.isArray(cfg.blockedApps)) ? cfg.blockedApps.map(a => a.name || a.id) : [];
    const policyIds = cfg && cfg.policies ? Object.keys(cfg.policies) : [];
    const policyApps = [];
    for (const pid of policyIds) {
      const found = blocked.find(n => (String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '_') === pid));
      if (found) continue;
      // try to find matching installed app name
      const match = installedApps.find(n => (String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '_') === pid));
      if (match) policyApps.push(match);
      else policyApps.push(pid);
    }
    const visible = [...new Set([...blocked, ...policyApps])];
    const usageLog = cfg.usageToday || {};
    const policies = cfg.policies || {};
    const now = new Date();
    const todayKey = getLocalDayKey(now);
    const rows = [];
    for (const appName of visible) {
      const appId = String(appName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const tickets = cfg.tickets || [];
      const activeTicket = (tickets || []).find(t => String(t.appId || '').toLowerCase() === appId && (t.expiresAt || 0) > Date.now());
      const policy = policies[appId];
      let restricted = false;
      let allocated = false; // time allocated but not currently granted
      let minLeft = null;
      let reason = '';

      if (activeTicket) {
        // Active ticket: granted
        restricted = false;
        allocated = false;
        const secs = Math.max(0, Math.floor(((activeTicket.expiresAt || 0) - Date.now()) / 1000));
        const grantedMins = Math.max(0, Math.ceil(secs / 60));
        const dailyMax = (policy && policy.dailyMaxMinutes) ? Number(policy.dailyMaxMinutes) : 0;
        // determine usage at grant (from ticket if present) and initial granted minutes
        const tkt = activeTicket;
        const usageAtGrant = (typeof tkt.usageAtGrant === 'number') ? Number(tkt.usageAtGrant) : 0;
        const initialGranted = (typeof tkt.initialMinutes === 'number') ? Math.max(0, Math.floor(Number(tkt.initialMinutes))) : Math.max(0, Math.ceil(((tkt.expiresAt || 0) - Date.now()) / 60000));
        // elapsed granted minutes since grant
        const elapsedGranted = Math.max(0, initialGranted - grantedMins);
        // compute daily remaining now = dailyMax - (usageAtGrant + elapsedGranted)
        const dailyRemNow = (dailyMax > 0) ? Math.max(0, dailyMax - (usageAtGrant + elapsedGranted)) : 'Unlimited';
        minLeft = `${grantedMins}/${dailyRemNow} min left`;
        // store numeric values so timer updater can recompute
        // attach to row for rendering step (will be set on element)
      } else if (!policy) {
        // No policy -> restricted
        restricted = true;
        reason = 'No policy';
      } else {
        // Policy exists: check remaining allocation
        const used = (usageLog[todayKey] && usageLog[todayKey][appId]) ? usageLog[todayKey][appId] : 0;
        const dailyMax = policy.dailyMaxMinutes || 0;
        const remaining = Math.max(0, dailyMax - used);
        if (dailyMax > 0 && remaining <= 0) {
          restricted = true;
          reason = `Daily limit hit (${dailyMax} min)`;
        } else {
          // There is allocation available but no active ticket
          restricted = false;
          allocated = true;
          minLeft = dailyMax > 0 ? remaining : 'Unlimited';
        }
      }
      rows.push({ appName, restricted, allocated, minLeft, reason });
    }
    listDiv.innerHTML = '';
    if (rows.length === 0) {
      listDiv.textContent = 'No restricted apps or policies configured.';
      return;
    }
    for (const row of rows) {
      const div = document.createElement('div');
      div.className = 'app-status-row';
      const name = document.createElement('span');
      name.className = 'app-status-appname';
      name.textContent = row.appName;
      div.appendChild(name);
      if (row.restricted) {
        const status = document.createElement('span');
        status.className = 'app-status-restricted';
        status.textContent = 'Restricted';
        div.appendChild(status);
        if (row.reason) {
          const reason = document.createElement('span');
          reason.style.color = '#888';
          reason.style.fontSize = '12px';
          reason.textContent = `(${row.reason})`;
          div.appendChild(reason);
        }
      } else if (row.allocated) {
        const status = document.createElement('span');
        status.className = 'app-status-allocated';
        status.textContent = 'Available';
        div.appendChild(status);
        const min = document.createElement('span');
        min.className = 'app-status-minleft';
        if (typeof row.minLeft === 'number') {
          min.textContent = `${row.minLeft} min left`;
        } else {
          min.textContent = row.minLeft || '';
        }
        div.appendChild(min);
      } else {
        // granted (active ticket)
        const status = document.createElement('span');
        status.className = 'app-status-allowed';
        status.textContent = 'Allowed';
        div.appendChild(status);
        const min = document.createElement('span');
        min.className = 'app-status-minleft';
        if (row.minLeft && String(row.minLeft).includes('left')) {
          min.textContent = row.minLeft;
        } else if (typeof row.minLeft === 'number') {
          min.textContent = `${row.minLeft} min left`;
        } else {
          min.textContent = row.minLeft || '';
        }
        // attach expiry and daily-max data if active ticket exists
        try {
          const cfgTickets = cfg.tickets || [];
          const appId = String(row.appName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          const tkt = cfgTickets.find(t => String(t.appId || '').toLowerCase() === appId && (t.expiresAt || 0) > Date.now());
          if (tkt && tkt.expiresAt) {
            min.dataset.expires = String(tkt.expiresAt);
            // Prefer ticket metadata (initialMinutes, usageAtGrant) so we preserve elapsed across reloads
            const p = cfg.policies && cfg.policies[appId] ? cfg.policies[appId] : null;
            const dailyMax = (p && p.dailyMaxMinutes) ? Number(p.dailyMaxMinutes) : 0;
            const usageToday = cfg.usageToday || {};
            const todayKey = getLocalDayKey(new Date());
            const usedNow = (usageToday[todayKey] && usageToday[todayKey][appId]) ? usageToday[todayKey][appId] : 0;
            const usageAtGrant = (typeof tkt.usageAtGrant === 'number') ? Number(tkt.usageAtGrant) : usedNow;
            const dailyRemAtRender = (dailyMax > 0) ? Math.max(0, dailyMax - usageAtGrant) : 'Unlimited';
            if (dailyMax > 0) {
              min.dataset.dailyInitial = String(dailyRemAtRender);
            } else {
              min.dataset.dailyInitial = 'Unlimited';
            }
            // store initial granted minutes: prefer stored initialMinutes, fall back to computed value
            const grantedInitial = (typeof tkt.initialMinutes === 'number')
              ? Math.max(0, Math.floor(Number(tkt.initialMinutes)))
              : Math.max(0, Math.ceil(((tkt.expiresAt || 0) - Date.now()) / 60000));
            min.dataset.grantedInitial = String(grantedInitial);
          }
        } catch (_) { }
        div.appendChild(min);
      }
      listDiv.appendChild(div);
    }
  } catch (e) {
    listDiv.textContent = 'Error loading app status.';
  }
  // Start timer updater to refresh remaining seconds for active tickets
  startTimerUpdater();
}

renderAppStatus();

let _timerInterval = null;
function startTimerUpdater() {
  if (_timerInterval) return;
  _timerInterval = setInterval(() => {
    const els = document.querySelectorAll('.app-status-minleft[data-expires]');
    const now = Date.now();
    for (const el of els) {
      const exp = Number(el.dataset.expires || 0);
      const dailyInitial = el.dataset.dailyInitial || '';
      const grantedInitial = Number(el.dataset.grantedInitial || 0);
      const secs = Math.max(0, Math.floor((exp - now) / 1000));
      if (secs <= 0) {
        // expired — re-render full status to pick up store changes
        renderAppStatus();
        return;
      }
      const grantedRemaining = Math.max(0, Math.ceil(secs / 60));
      const elapsedGranted = Math.max(0, grantedInitial - grantedRemaining);
      if (dailyInitial && dailyInitial !== 'Unlimited') {
        const dailyRemNum = Math.max(0, Number(dailyInitial) - elapsedGranted);
        el.textContent = `${grantedRemaining}/${dailyRemNum} min left`;
      } else {
        el.textContent = `${grantedRemaining}/Unlimited min left`;
      }
    }
  }, 1000);
}
const log = document.getElementById("log");
const appSelect = document.getElementById("appSelect");
const timeSlider = document.getElementById('timeSlider');
const timeLabel = document.getElementById('timeLabel');
const msg = document.getElementById("msg");
const send = document.getElementById("send");
const quick = document.getElementById("quick");
const openSettingsBtn = document.getElementById("openSettings");
let currentCfg = null;

function appendMessage(text, cls = "system") {
  const d = document.createElement("div");
  d.className = `msg ${cls}`;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

function setAppOptions(list) {
  const prev = appSelect.value;
  appSelect.innerHTML = '';
  for (const name of list) {
    const display = String(name || '')
    const id = display.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = display;
    opt.dataset.name = display;
    appSelect.appendChild(opt);
  }
  if (prev) {
    const found = Array.from(appSelect.options).some(o => o.value === prev);
    if (found) appSelect.value = prev;
  }
}


// Improved: always show visibleApps if set, else blockedApps, else installed
async function init() {
  appendMessage("Loading installed apps...");
  try {
    const installedApps = await window.Gatekeeper.getInstalledApps();
    const cfg = await window.Gatekeeper.getConfig();
    currentCfg = cfg;
    let appList = [];
    // prefer restricted apps and apps with policies, but only include apps with time left
    const blockedNames = (cfg && Array.isArray(cfg.blockedApps)) ? cfg.blockedApps.map(a => a.name || a.id) : [];
    const usageLog = cfg.usageToday || {};
    const policyIds2 = cfg && cfg.policies ? Object.keys(cfg.policies) : [];
    const policyNames2 = [];
    // determine active tickets to exclude apps currently granted
    const activeTickets = (cfg && Array.isArray(cfg.tickets)) ? (cfg.tickets || []).filter(t => (t.expiresAt || 0) > Date.now()).map(t => String(t.appId || '').toLowerCase()) : [];
    for (const pid of policyIds2) {
      const b = blockedNames.find(n => (String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '_') === pid));
      if (activeTickets.includes(pid)) continue; // skip apps that are currently granted
      if (b) continue;
      // only include policy apps that have time left or unlimited
      const appId = pid;
      const now = new Date();
      const todayKey = getLocalDayKey(now);
      const used = (usageLog[todayKey] && usageLog[todayKey][appId]) ? usageLog[todayKey][appId] : 0;
      const policy = cfg.policies && cfg.policies[appId] ? cfg.policies[appId] : null;
      if (!policy) continue; // no policy -> no time left
      const dailyMax = policy.dailyMaxMinutes || 0;
      const remaining = (dailyMax > 0) ? Math.max(0, dailyMax - used) : Infinity;
      if (remaining > 0 || dailyMax === 0) {
        const match = installedApps.find(n => (String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '_') === pid));
        if (match) policyNames2.push(match);
        else policyNames2.push(pid);
      }
    }
    // Also include blocked apps if they have time left (but skip active tickets)
    const filteredBlocked = [];
    const now2 = new Date();
    const todayKey2 = getLocalDayKey(now2);
    for (const bname of blockedNames) {
      const bid = String(bname || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const policy = cfg.policies && cfg.policies[bid] ? cfg.policies[bid] : null;
      const used = (usageLog[todayKey2] && usageLog[todayKey2][bid]) ? usageLog[todayKey2][bid] : 0;
      const dailyMax = policy ? (policy.dailyMaxMinutes || 0) : 0;
      const remaining = (dailyMax > 0) ? Math.max(0, dailyMax - used) : Infinity;
      if (policy && (remaining > 0 || dailyMax === 0)) {
        const bid = String(bname || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        if (activeTickets.includes(bid)) continue; // skip if currently granted
        filteredBlocked.push(bname);
      }
    }
    appList = [...new Set([...filteredBlocked, ...policyNames2])];
    setAppOptions(appList);
    appSelect.disabled = false;
    updateSliderForSelected();
    const hasApiKey = await window.Gatekeeper.hasChatbotApiKey();
    if (!hasApiKey) {
      appendMessage("Chatbot API Key not configured. Add it in Settings.", "system");
    }
    log.innerHTML = "";
    appendMessage("Gatekeeper: What do you want to unlock?", "system");
  } catch (error) {
    appendMessage(`Error loading apps: ${error.message}`, "system");
    appendMessage("Falling back to configured apps...", "system");
    try {
      const cfg = await window.Gatekeeper.getConfig();
      let appList = [];
      if (cfg && Array.isArray(cfg.blockedApps) && cfg.blockedApps.length) {
        appList = cfg.blockedApps.map(a => a.name || a.id);
      }
      setAppOptions(appList);
    } catch (_) { }
    appendMessage("Gatekeeper: What do you want to unlock?", "system");
  }
}
init();

if (appSelect) {
  appSelect.addEventListener('change', () => {
    updateSliderForSelected();
  });
}

function updateSliderForSelected() {
  if (!appSelect || !timeSlider || !timeLabel) return;
  const opt = appSelect.selectedOptions[0];
  if (!opt) {
    timeSlider.disabled = true;
    send.disabled = true;
    return;
  }
  const appId = opt.value;
  // compute max from currentCfg policies
  let maxVal = 15;
  let allowed = false;
  if (currentCfg && currentCfg.policies) {
    const policy = currentCfg.policies[appId];
    if (policy) {
      const maxReq = Number(policy.maxUnlockMinutesPerRequest || 15);
      maxVal = Math.max(1, maxReq);
      const usageLog = currentCfg.usageToday || {};
      const todayKey = getLocalDayKey(new Date());
      const used = (usageLog[todayKey] && usageLog[todayKey][appId]) ? usageLog[todayKey][appId] : 0;
      const dailyMax = Number(policy.dailyMaxMinutes || 0);
      const remaining = (dailyMax > 0) ? Math.max(0, dailyMax - used) : Infinity;
      allowed = (remaining > 0 || dailyMax === 0);
    }
  }
  timeSlider.max = String(maxVal);
  if (Number(timeSlider.value) > maxVal) timeSlider.value = String(maxVal);
  timeLabel.textContent = timeSlider.value;
  timeSlider.disabled = !allowed;
  send.disabled = !allowed;
}

if (timeSlider) {
  timeSlider.addEventListener('input', () => {
    if (timeLabel) timeLabel.textContent = timeSlider.value;
  });
}
send.addEventListener("click", async () => {
  const appId = appSelect.value;
  const appName = (appSelect.selectedOptions[0] && appSelect.selectedOptions[0].dataset.name) || appSelect.selectedOptions[0]?.textContent;
  const message = msg.value.trim();
  if (!appId || !message) return;

  appendMessage(message, "user");

  try {
    const requestedMinutes = timeSlider ? Number(timeSlider.value) : undefined;
    const res = await window.Gatekeeper.requestUnlock({ appId, appName, message, requestedMinutes });
    appendMessage(res.reply || "No reply", "system");
  } catch (error) {
    appendMessage(`Error: ${error.message}`, "system");
  } finally {
    renderAppStatus();
  }

  msg.value = "";
});

quick.addEventListener("click", () => {
  const mins = timeSlider ? Number(timeSlider.value) : 15;
  msg.value = `I need access for ${mins} minutes to finish a quick task.`;
});

openSettingsBtn.addEventListener("click", async () => {
  try {
    await window.Gatekeeper.openSettings();
  } catch (e) {
    appendMessage(`Error opening settings: ${e.message}`, "system");
  }
});

if (window.Gatekeeper && window.Gatekeeper.onConfigUpdated) {
  window.Gatekeeper.onConfigUpdated((payload) => {
    try {
      if (payload) {
        // update currentCfg for slider logic
        currentCfg = payload;
        const blockedNames = payload.blockedApps && Array.isArray(payload.blockedApps) ? payload.blockedApps.map(a => a.name || a.id) : [];
        const policyIds = payload.policies ? Object.keys(payload.policies) : [];
        const policyNames = [];
        const activeTickets = payload.tickets && Array.isArray(payload.tickets) ? (payload.tickets || []).filter(t => (t.expiresAt || 0) > Date.now()).map(t => String(t.appId || '').toLowerCase()) : [];
        for (const pid of policyIds) {
          const found = blockedNames.find(n => (String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '_') === pid));
          if (found) continue;
          if (activeTickets.includes(pid)) continue; // hide apps with active tickets
          // try installed apps lookup via Gatekeeper
          try {
            // best-effort: leave id as fallback; renderer will update on next init
            policyNames.push(pid);
          } catch (_) { policyNames.push(pid); }
        }
        // filter blockedNames for active tickets
        const filteredBlocked = [];
        for (const bn of blockedNames) {
          const bid = String(bn || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          if (activeTickets.includes(bid)) continue;
          filteredBlocked.push(bn);
        }
        const list = [...new Set([...filteredBlocked, ...policyNames])];
        setAppOptions(list);
        appSelect.disabled = false;
        updateSliderForSelected();
      }
      renderAppStatus();
    } catch (_) { }
  });
}
