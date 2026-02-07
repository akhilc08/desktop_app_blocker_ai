function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dayName(d) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(s) {
  const [hh, mm] = s.split(":").map(Number);
  return hh * 60 + mm;
}

function minutesUsedToday(usageLog, appId, now = new Date()) {
  const key = ymd(now);
  const day = usageLog[key] || {};
  return day[appId] || 0;
}

function evaluatePolicy({ appId, policy, usageLog, now }) {
  // If no policy, default deny (safer)
  if (!policy) {
    return { type: "HARD_DENY", reason: "No policy configured for this app." };
  }

  const used = minutesUsedToday(usageLog, appId, now);
  const remaining = Math.max(0, (policy.dailyMaxMinutes ?? 0) - used);

  if ((policy.dailyMaxMinutes ?? 0) > 0 && remaining <= 0) {
    return { type: "HARD_DENY", reason: `Daily limit hit (${policy.dailyMaxMinutes} min).` };
  }

  // Allowed time windows
  const windows = policy.allowedWindows ?? [];
  if (windows.length > 0) {
    const dn = dayName(now);
    const t = minutesSinceMidnight(now);

    const inAny = windows.some(w => {
      if (!w.days.includes(dn)) return false;
      const start = parseHHMM(w.start);
      const end = parseHHMM(w.end);
      return t >= start && t <= end;
    });

    if (!inAny) {
      return { type: "HARD_DENY", reason: "Outside your allowed time window." };
    }
  }

  // If no daily max set, allow 15 minutes default
  const defaultAllow = 15;
  // Compute effective max-per-request capped by remaining minutes (if a daily cap exists)
  const configuredMaxPerRequest = (typeof policy.maxUnlockMinutesPerRequest === 'number') ? policy.maxUnlockMinutesPerRequest : null;
  let effectiveMaxPerRequest = null;

  if ((policy.dailyMaxMinutes ?? 0) > 0) {
    // If there's a daily cap, cap per-request at the remaining minutes
    effectiveMaxPerRequest = configuredMaxPerRequest !== null
      ? Math.min(configuredMaxPerRequest, remaining)
      : remaining;
  } else {
    // No daily cap configured — fall back to configured per-request or default
    effectiveMaxPerRequest = configuredMaxPerRequest !== null ? configuredMaxPerRequest : defaultAllow;
  }

  const allowedMinutes = Math.max(1, Math.floor(effectiveMaxPerRequest || 0));

  return { type: "LIMIT", allowedMinutes: allowedMinutes, remainingMinutes: remaining, maxPerRequestEffective: allowedMinutes };
}

function recordUsageTick({ usageLog, appId, minutes = 1, now = new Date() }) {
  const key = ymd(now);
  const day = usageLog[key] || {};
  day[appId] = (day[appId] || 0) + minutes;
  usageLog[key] = day;
  return usageLog;
}

module.exports = {
  evaluatePolicy,
  minutesUsedToday,
  recordUsageTick
};
