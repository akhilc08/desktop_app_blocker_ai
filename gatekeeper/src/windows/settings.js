const area = document.getElementById("json");
const save = document.getElementById("save");
const status = document.getElementById("status");

(async function init() {
  const cfg = await window.Gatekeeper.getConfig();
  // only edit these
  const editable = { blockedApps: cfg.blockedApps, policies: cfg.policies };
  area.value = JSON.stringify(editable, null, 2);
})();

save.addEventListener("click", async () => {
  try {
    const parsed = JSON.parse(area.value);
    await window.Gatekeeper.setConfig(parsed);
    status.textContent = "Saved ✅";
  } catch (e) {
    status.textContent = "Invalid JSON ❌";
  }
});
