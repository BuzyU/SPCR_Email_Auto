/**
 * SPCR Extension Toolbar Popup
 * Complete manual fallback when Gmail's DOM changes, plus pairing management.
 */

let latestScannedOpportunityId: string | null = null;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function showFeedback(text: string): void {
  const box = el<HTMLDivElement>('feedback-box');
  box.textContent = text;
  box.classList.remove('hidden');
}

function clearFeedback(): void {
  const box = el<HTMLDivElement>('feedback-box');
  box.textContent = '';
  box.classList.add('hidden');
}

async function detectActiveGmailMessageInTab(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab.url || !tab.url.startsWith('https://mail.google.com/')) {
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'QUERY_ACTIVE_GMAIL_MESSAGE' }).catch(() => null);
    const input = el<HTMLInputElement>('gmail-msg-id');
    if (response?.messageId && !input.value) {
      input.value = response.messageId;
    }
  } catch {
    // Graceful no-op if content script is not attached yet
  }
}

async function refreshPopupState(): Promise<void> {
  const statusPill = el<HTMLSpanElement>('status-pill');
  const pairedSection = el<HTMLElement>('paired-section');
  const pairFormSection = el<HTMLElement>('pair-form-section');
  const originInput = el<HTMLInputElement>('backend-origin');

  const res = await chrome.runtime.sendMessage({ type: 'GET_CONFIG_AND_STATUS' });
  if (res?.paired) {
    statusPill.textContent = 'Paired';
    pairedSection.classList.remove('hidden');
    pairFormSection.classList.add('hidden');
    el<HTMLSpanElement>('paired-owner').textContent = `${res.ownerEmail}`;
    await detectActiveGmailMessageInTab();
  } else {
    statusPill.textContent = 'Unpaired';
    pairedSection.classList.add('hidden');
    pairFormSection.classList.remove('hidden');
    if (!originInput.value) {
      originInput.value = res?.backendOrigin || res?.defaultBackendOrigin || 'https://spcr-web.onrender.com';
    }
    if (res?.authError) {
      showFeedback(res.authError);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void refreshPopupState();

  el<HTMLButtonElement>('btn-pair').addEventListener('click', async () => {
    clearFeedback();
    const backendOrigin = el<HTMLInputElement>('backend-origin').value.trim();
    const pairingCode = el<HTMLInputElement>('pairing-code').value.trim();
    const res = await chrome.runtime.sendMessage({
      type: 'PAIR_EXTENSION',
      backendOrigin,
      pairingCode,
    });
    if (!res?.ok) {
      showFeedback(res?.error || 'Pairing failed.');
      return;
    }
    el<HTMLInputElement>('pairing-code').value = '';
    showFeedback(`Paired with SPCR as ${res.ownerEmail}.`);
    await refreshPopupState();
  });

  el<HTMLButtonElement>('btn-unpair').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'UNPAIR_EXTENSION' });
    latestScannedOpportunityId = null;
    clearFeedback();
    await refreshPopupState();
  });

  el<HTMLButtonElement>('btn-scan').addEventListener('click', async () => {
    clearFeedback();
    const gmailMessageId = el<HTMLInputElement>('gmail-msg-id').value.trim();
    if (!gmailMessageId) {
      showFeedback('Enter or open a Gmail message ID first.');
      return;
    }
    const scanBtn = el<HTMLButtonElement>('btn-scan');
    scanBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'SCAN_GMAIL_MESSAGE',
        gmailMessageId,
      });
      if (!res?.ok) {
        showFeedback(res?.error || 'Manual scan failed.');
        return;
      }
      const r = res.result;
      latestScannedOpportunityId = r.opportunityId || null;
      const resultBox = el<HTMLDivElement>('scan-result-box');
      resultBox.textContent = `Scanned — no Groq request made. Classification: ${r.classification} (${(
        Number(r.confidence || 0) * 100
      ).toFixed(0)}%) | Authenticity: ${r.authenticityLabel}`;
      resultBox.classList.remove('hidden');
      el<HTMLButtonElement>('btn-format-groq').disabled = !latestScannedOpportunityId;
    } finally {
      scanBtn.disabled = false;
    }
  });

  el<HTMLButtonElement>('btn-format-groq').addEventListener('click', async () => {
    if (!latestScannedOpportunityId) return;
    clearFeedback();
    const btn = el<HTMLButtonElement>('btn-format-groq');
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'FORMAT_OPPORTUNITY_GROQ',
        opportunityId: latestScannedOpportunityId,
      });
      if (!res?.ok) {
        showFeedback(res?.error || 'Groq formatting blocked by gate.');
        return;
      }
      showFeedback('Formatted with Groq. Click Review/Edit in SPCR to inspect and approve.');
    } finally {
      btn.disabled = !latestScannedOpportunityId;
    }
  });

  el<HTMLButtonElement>('btn-open-review').addEventListener('click', () => {
    const path = latestScannedOpportunityId
      ? `/?tab=inbox&opportunityId=${encodeURIComponent(latestScannedOpportunityId)}`
      : '/?tab=inbox';
    void chrome.runtime.sendMessage({ type: 'OPEN_SPCR_TAB', path });
  });

  el<HTMLButtonElement>('btn-open-groups').addEventListener('click', () => {
    const path = latestScannedOpportunityId
      ? `/?tab=inbox&opportunityId=${encodeURIComponent(latestScannedOpportunityId)}`
      : '/?tab=routing';
    void chrome.runtime.sendMessage({ type: 'OPEN_SPCR_TAB', path });
  });

  el<HTMLButtonElement>('btn-open-dashboard-unpaired').addEventListener('click', () => {
    const origin = el<HTMLInputElement>('backend-origin').value.trim();
    if (origin.startsWith('https://') || origin.startsWith('http://localhost')) {
      void chrome.tabs.create({ url: origin, active: true });
    }
  });
});

