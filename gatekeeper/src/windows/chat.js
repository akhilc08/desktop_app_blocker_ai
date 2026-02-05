const log = document.getElementById("log");
const appSelect = document.getElementById("appSelect");
const msg = document.getElementById("msg");
const send = document.getElementById("send");

function append(text) {
  log.textContent += (log.textContent ? "\n\n" : "") + text;
  log.scrollTop = log.scrollHeight;
}

(async function init() {
  const cfg = await window.Gatekeeper.getConfig();
  for (const a of cfg.blockedApps) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.name;
    appSelect.appendChild(opt);
  }
  append("Gatekeeper: What do you want to unlock?");
})();

send.addEventListener("click", async () => {
  const appId = appSelect.value;
  const message = msg.value;

  append(`You: ${message}`);

  const res = await window.Gatekeeper.requestUnlock({ appId, message });
  append(`Gatekeeper: ${res.reply}`);

  msg.value = "";
});
