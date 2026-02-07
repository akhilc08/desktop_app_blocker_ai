const status = document.getElementById("status");
const apiKeyInput = document.getElementById("apiKey");
const saveApiKey = document.getElementById("saveApiKey");
const apiStatus = document.getElementById("apiStatus");
const clearApiKey = document.getElementById("clearApiKey");
const addAppSelect = document.getElementById('addAppSelect');
const blockedList = document.getElementById('blockedList');
const addBlockedBtn = document.getElementById('addBlocked');
const policyModal = document.getElementById('policyModal');
const policyAppName = document.getElementById('policyAppName');
const policyDaily = document.getElementById('policyDaily');
const policyPerReq = document.getElementById('policyPerReq');
const policySave = document.getElementById('policySave');
const policyRemove = document.getElementById('policyRemove');
const policyClose = document.getElementById('policyClose');
let currentConfig = { blockedApps: [], policies: {} };
let installedApps = [];
let activePolicyId = '';

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getConfigCopy() {
  return {
    blockedApps: Array.isArray(currentConfig.blockedApps) ? [...currentConfig.blockedApps] : [],
    policies: currentConfig.policies && typeof currentConfig.policies === 'object'
      ? { ...currentConfig.policies }
      : {}
  };
}

async function persistConfig(cfg, okText) {
  try {
    await window.Gatekeeper.setConfig(cfg);
    currentConfig = {
      blockedApps: Array.isArray(cfg.blockedApps) ? cfg.blockedApps : [],
      policies: cfg.policies && typeof cfg.policies === 'object' ? cfg.policies : {}
    };
    status.textContent = okText || 'Saved ✅';
    status.className = 'status success';
  } catch (e) {
    status.textContent = `Save failed: ${e.message}`;
    status.className = 'status error';
  }
}

function renderBlockedList(cfg, installed = []) {
  blockedList.innerHTML = '';
  const blocked = Array.isArray(cfg.blockedApps) ? cfg.blockedApps : [];
  if (blocked.length === 0) {
    blockedList.textContent = 'No restricted apps configured.';
    return;
  }

  for (const app of blocked) {
    const wrapper = document.createElement('div');
    wrapper.style.padding = '6px 4px';
    wrapper.style.borderBottom = '1px solid #eef2f8';

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.justifyContent = 'space-between';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';

    const title = document.createElement('div');
    title.textContent = app.name || app.id || '(unknown)';
    title.style.fontSize = '13px';
    title.style.fontWeight = '500';

    const id = String(app.id || '').toLowerCase();
    const policy = cfg.policies && cfg.policies[id] ? cfg.policies[id] : null;
    const policySummary = policy
      ? `Policy: ${policy.dailyMaxMinutes || 60} / ${policy.maxUnlockMinutesPerRequest || 30}`
      : 'Policy: none';

    // Process names (first line)
    const procEl = document.createElement('div');
    procEl.textContent = (app.processNames && app.processNames.join(', ')) || '';
    procEl.style.fontSize = '12px';
    procEl.style.color = 'var(--muted, #666)';

    // Policy summary (always on its own second line)
    const policyEl = document.createElement('div');
    policyEl.textContent = policySummary;
    policyEl.style.fontSize = '12px';
    policyEl.style.color = 'var(--muted, #666)';
    policyEl.style.marginTop = '6px';

    left.appendChild(title);
    if (procEl.textContent) left.appendChild(procEl);
    left.appendChild(policyEl);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const policyBtn = document.createElement('button');
    policyBtn.textContent = policy ? 'Edit Policy' : 'Add Policy';
    policyBtn.className = 'btn';
    policyBtn.classList.add('policy-btn');
    policyBtn.style.fontSize = '12px';
    policyBtn.style.padding = '6px 8px';
    policyBtn.addEventListener('click', () => {
      openPolicyModal(id, app.name || app.id || '(unknown)');
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'btn secondary';
    removeBtn.style.fontSize = '12px';
    removeBtn.style.padding = '6px 8px';
    removeBtn.addEventListener('click', async () => {
      const cfg = getConfigCopy();
      cfg.blockedApps = cfg.blockedApps.filter(a => String(a.id || '').toLowerCase() !== id);
      if (cfg.policies && cfg.policies[id]) delete cfg.policies[id];
      await persistConfig(cfg, 'Restricted app removed.');
      // refresh add-select and blocked list
      populateAddSelect(cfg, installed);
      renderBlockedList(cfg, installed);
    });

    actions.appendChild(policyBtn);
    actions.appendChild(removeBtn);
    topRow.appendChild(left);
    topRow.appendChild(actions);

    wrapper.appendChild(topRow);
    blockedList.appendChild(wrapper);
  }
}

function openPolicyModal(appId, appName) {
  if (!policyModal) return;
  activePolicyId = String(appId || '').toLowerCase();
  const cfg = getConfigCopy();
  const policy = cfg.policies && cfg.policies[activePolicyId] ? cfg.policies[activePolicyId] : null;

  policyAppName.textContent = appName || activePolicyId;
  policyDaily.value = Number((policy && policy.dailyMaxMinutes) || 60);
  policyPerReq.value = Number((policy && policy.maxUnlockMinutesPerRequest) || 30);
  policyRemove.disabled = !policy;
  policyModal.style.display = 'flex';
}

function closePolicyModal() {
  if (!policyModal) return;
  policyModal.style.display = 'none';
  activePolicyId = '';
}

function populateAddSelect(cfg, installed = []) {
  if (!addAppSelect) return;
  addAppSelect.innerHTML = '';
  const blockedIds = (cfg.blockedApps || []).map(a => String(a.id || '').toLowerCase());
  for (const name of installed) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (blockedIds.includes(slugify(name))) opt.disabled = true;
    addAppSelect.appendChild(opt);
  }
}

async function init() {
  const cfg = await window.Gatekeeper.getConfig();
  currentConfig = {
    blockedApps: cfg.blockedApps || [],
    policies: cfg.policies || {}
  };

  // Render blocked apps immediately from config (no installed apps yet)
  try {
    renderBlockedList(currentConfig, []);
  } catch (e) {
    console.warn('Could not render blocked list initially', e);
  }

  // Show a loading placeholder in the add-select until installed apps are available
  if (addAppSelect) {
    addAppSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.textContent = 'Loading apps...';
    opt.disabled = true;
    opt.selected = true;
    addAppSelect.appendChild(opt);
  }

  // Fetch installed apps in background and update UI when ready
  window.Gatekeeper.getInstalledApps()
    .then((installed) => {
      installedApps = installed || [];
      try {
        populateAddSelect(currentConfig, installedApps);
        renderBlockedList(currentConfig, installedApps);
      } catch (e) {
        console.warn('Could not render blocked list or add-select after installed apps', e);
      }
    })
    .catch((e) => {
      console.warn('Error loading installed apps:', e);
    });
}

init();

policyClose.addEventListener('click', closePolicyModal);
policyModal.addEventListener('click', (event) => {
  if (event.target === policyModal) closePolicyModal();
});

policySave.addEventListener('click', async () => {
  if (!activePolicyId) return;
  const cfg = getConfigCopy();
  cfg.policies[activePolicyId] = {
    ...(cfg.policies[activePolicyId] || {}),
    dailyMaxMinutes: Number(policyDaily.value || 0),
    maxUnlockMinutesPerRequest: Number(policyPerReq.value || 0),
    allowedWindows: (cfg.policies[activePolicyId] && cfg.policies[activePolicyId].allowedWindows) || []
  };
  await persistConfig(cfg, 'Policy saved.');
  renderBlockedList(cfg, installedApps);
  closePolicyModal();
});

policyRemove.addEventListener('click', async () => {
  if (!activePolicyId) return;
  const cfg = getConfigCopy();
  if (cfg.policies && cfg.policies[activePolicyId]) delete cfg.policies[activePolicyId];
  await persistConfig(cfg, 'Policy removed.');
  renderBlockedList(cfg, installedApps);
  closePolicyModal();
});

addBlockedBtn.addEventListener('click', async () => {
  if (!addAppSelect) {
    status.textContent = 'No apps available to add.';
    status.className = 'status error';
    return;
  }
  const name = addAppSelect.value && addAppSelect.value.trim();
  if (!name) {
    status.textContent = 'Select an app to add.';
    status.className = 'status error';
    return;
  }
  const cfg = getConfigCopy();
  const id = slugify(name);
  const existing = cfg.blockedApps.find(a => String(a.id || '').toLowerCase() === id);
  if (!existing) {
    cfg.blockedApps.push({ id, name, processNames: [], launch: null });
  }
  await persistConfig(cfg, 'Restricted app added.');
  // refresh UI
  (async () => {
    try {
      const installed = await window.Gatekeeper.getInstalledApps();
      installedApps = installed || [];
      populateAddSelect(cfg, installedApps);
      renderBlockedList(cfg, installedApps);
    } catch (e) {
      console.warn('Error refreshing add-select after add', e);
    }
  })();
});

saveApiKey.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    apiStatus.textContent = "Please enter an API key ❌";
    apiStatus.className = "status error";
    return;
  }

  try {
    const setRes = await window.Gatekeeper.setChatbotApiKey(key);
    if (!setRes || !setRes.ok) {
      apiStatus.textContent = `Error saving key: ${setRes && setRes.error}`;
      apiStatus.className = 'status error';
      return;
    }

    // Validate the key immediately to provide clear feedback
    const val = await window.Gatekeeper.validateChatbotApiKey();
    if (val && val.ok) {
      apiStatus.textContent = "API Key saved ✅ Chatbot is now active!";
      apiStatus.className = "status success";
      apiKeyInput.value = "";
    } else {
      apiStatus.textContent = `API Key saved but validation failed: ${val && val.message}`;
      apiStatus.className = "status error";
    }
  } catch (e) {
    apiStatus.textContent = `Error: ${e.message} ❌`;
    apiStatus.className = "status error";
  }
});

clearApiKey.addEventListener("click", async () => {
  try {
    await window.Gatekeeper.setChatbotApiKey("");
    apiStatus.textContent = "API Key cleared";
    apiStatus.className = "status";
  } catch (e) {
    apiStatus.textContent = `Error: ${e.message}`;
    apiStatus.className = "status error";
  }
});


// model selection removed
