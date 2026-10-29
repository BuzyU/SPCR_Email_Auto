// extension/popup.ts
var latestScannedOpportunityId = null;
function el(id) {
  return document.getElementById(id);
}
function showFeedback(text) {
  const box = el("feedback-box");
  box.textContent = text;
  box.classList.remove("hidden");
}
function clearFeedback() {
  const box = el("feedback-box");
  box.textContent = "";
  box.classList.add("hidden");
}
async function detectActiveGmailMessageInTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab.url || !tab.url.startsWith("https://mail.google.com/")) {
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "QUERY_ACTIVE_GMAIL_MESSAGE" }).catch(() => null);
    const input = el("gmail-msg-id");
    if (response?.messageId && !input.value) {
      input.value = response.messageId;
    }
  } catch {
  }
}
async function refreshPopupState() {
  const statusPill = el("status-pill");
  const pairedSection = el("paired-section");
  const pairFormSection = el("pair-form-section");
  const originInput = el("backend-origin");
  const res = await chrome.runtime.sendMessage({ type: "GET_CONFIG_AND_STATUS" });
  if (res?.paired) {
    statusPill.textContent = "Paired";
    pairedSection.classList.remove("hidden");
    pairFormSection.classList.add("hidden");
    el("paired-owner").textContent = `${res.ownerEmail}`;
    await detectActiveGmailMessageInTab();
  } else {
    statusPill.textContent = "Unpaired";
    pairedSection.classList.add("hidden");
    pairFormSection.classList.remove("hidden");
    if (!originInput.value) {
      originInput.value = res?.backendOrigin || res?.defaultBackendOrigin || "https://spcr-web.onrender.com";
    }
    if (res?.authError) {
      showFeedback(res.authError);
    }
  }
}
document.addEventListener("DOMContentLoaded", () => {
  void refreshPopupState();
  el("btn-pair").addEventListener("click", async () => {
    clearFeedback();
    const backendOrigin = el("backend-origin").value.trim();
    const pairingCode = el("pairing-code").value.trim();
    const res = await chrome.runtime.sendMessage({
      type: "PAIR_EXTENSION",
      backendOrigin,
      pairingCode
    });
    if (!res?.ok) {
      showFeedback(res?.error || "Pairing failed.");
      return;
    }
    el("pairing-code").value = "";
    showFeedback(`Paired with SPCR as ${res.ownerEmail}.`);
    await refreshPopupState();
  });
  el("btn-unpair").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "UNPAIR_EXTENSION" });
    latestScannedOpportunityId = null;
    clearFeedback();
    await refreshPopupState();
  });
  el("btn-scan").addEventListener("click", async () => {
    clearFeedback();
    const gmailMessageId = el("gmail-msg-id").value.trim();
    if (!gmailMessageId) {
      showFeedback("Enter or open a Gmail message ID first.");
      return;
    }
    const scanBtn = el("btn-scan");
    scanBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "SCAN_GMAIL_MESSAGE",
        gmailMessageId
      });
      if (!res?.ok) {
        showFeedback(res?.error || "Manual scan failed.");
        return;
      }
      const r = res.result;
      latestScannedOpportunityId = r.opportunityId || null;
      const resultBox = el("scan-result-box");
      resultBox.textContent = `Scanned \u2014 no Groq request made. Classification: ${r.classification} (${(Number(r.confidence || 0) * 100).toFixed(0)}%) | Authenticity: ${r.authenticityLabel}`;
      resultBox.classList.remove("hidden");
      el("btn-format-groq").disabled = !latestScannedOpportunityId;
    } finally {
      scanBtn.disabled = false;
    }
  });
  el("btn-format-groq").addEventListener("click", async () => {
    if (!latestScannedOpportunityId) return;
    clearFeedback();
    const btn = el("btn-format-groq");
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: "FORMAT_OPPORTUNITY_GROQ",
        opportunityId: latestScannedOpportunityId
      });
      if (!res?.ok) {
        showFeedback(res?.error || "Groq formatting blocked by gate.");
        return;
      }
      showFeedback("Formatted with Groq. Click Review/Edit in SPCR to inspect and approve.");
    } finally {
      btn.disabled = !latestScannedOpportunityId;
    }
  });
  el("btn-open-review").addEventListener("click", () => {
    const path = latestScannedOpportunityId ? `/?tab=inbox&opportunityId=${encodeURIComponent(latestScannedOpportunityId)}` : "/?tab=inbox";
    void chrome.runtime.sendMessage({ type: "OPEN_SPCR_TAB", path });
  });
  el("btn-open-groups").addEventListener("click", () => {
    const path = latestScannedOpportunityId ? `/?tab=inbox&opportunityId=${encodeURIComponent(latestScannedOpportunityId)}` : "/?tab=routing";
    void chrome.runtime.sendMessage({ type: "OPEN_SPCR_TAB", path });
  });
  el("btn-open-dashboard-unpaired").addEventListener("click", () => {
    const origin = el("backend-origin").value.trim();
    if (origin.startsWith("https://") || origin.startsWith("http://localhost")) {
      void chrome.tabs.create({ url: origin, active: true });
    }
  });
});
