/**
 * SPCR Content Script for https://mail.google.com/*
 * - Defensive MutationObserver + hashchange tracking across Gmail SPA navigation.
 * - Never reuses stale message IDs when switching threads or messages.
 * - Zero innerHTML injection of untrusted content; zero emojis; minimalist white UI.
 * - Graceful fallback guidance to extension toolbar popup if Gmail DOM changes.
 */

interface ScanSummaryState {
  forMessageId: string;
  classification: string;
  authenticityLabel: string;
  confidence: number;
  opportunityId: string | null;
  statusMessage: string;
  groqDrafted: boolean;
}

const BAR_ID = 'spcr-gmail-triage-bar';
let currentObservedHash = '';
let currentActiveMessageId: string | null = null;
let latestScanState: ScanSummaryState | null = null;
let isBusy = false;

function isVisibleElement(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (!htmlEl || htmlEl.offsetParent === null) return false;
  const rect = htmlEl.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Extracts the currently opened, visible Gmail legacy hex message ID (used by Gmail REST API `users.messages.get`).
 * Returns null if the user is on an inbox list view or if Gmail changed its DOM attributes.
 */
function extractActiveGmailMessageId(): {
  messageId: string | null;
  isThreadOpenLikely: boolean;
  selectorFallbackNeeded: boolean;
} {
  const hash = window.location.hash || '';
  // Gmail open-message hashes typically have a slash + token after folder name, e.g. #inbox/FMfcgz... or #all/192d...
  const hashParts = hash.replace(/^#/, '').split('/');
  const isThreadOpenLikely = hashParts.length >= 2 && Boolean(hashParts[1] && hashParts[1].length >= 6);

  const legacyNodes = Array.from(document.querySelectorAll('[data-legacy-message-id]')).filter(isVisibleElement);
  if (legacyNodes.length > 0) {
    // In an opened Gmail thread, the most recently expanded visible message is typically last in visual order
    const targetNode = legacyNodes[legacyNodes.length - 1]!;
    const rawId = (targetNode.getAttribute('data-legacy-message-id') || '').trim();
    if (/^[0-9a-fA-F]{10,32}$/.test(rawId)) {
      return { messageId: rawId, isThreadOpenLikely: true, selectorFallbackNeeded: false };
    }
  }

  // Secondary check: hex message ID directly in URL hash (#inbox/18f3a9b2c1d0e4f5)
  const possibleHex = (hashParts[hashParts.length - 1] || '').split('?')[0] || '';
  if (/^[0-9a-fA-F]{14,20}$/.test(possibleHex)) {
    return { messageId: possibleHex, isThreadOpenLikely: true, selectorFallbackNeeded: false };
  }

  return {
    messageId: null,
    isThreadOpenLikely,
    selectorFallbackNeeded: isThreadOpenLikely,
  };
}

function injectStylesOnce(): void {
  if (document.getElementById('spcr-gmail-bar-styles')) return;
  const style = document.createElement('style');
  style.id = 'spcr-gmail-bar-styles';
  style.textContent = `
    #${BAR_ID} {
      box-sizing: border-box;
      background: #FFFFFF;
      color: #1F2328;
      border: 1px solid #D0D7DE;
      border-radius: 6px;
      padding: 8px 12px;
      margin: 8px 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      z-index: 20;
    }
    #${BAR_ID} .spcr-ext-left {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    #${BAR_ID} .spcr-ext-brand {
      font-weight: 700;
      color: #1F2328;
      padding-right: 6px;
      border-right: 1px solid #D0D7DE;
    }
    #${BAR_ID} .spcr-ext-status {
      color: #57606A;
    }
    #${BAR_ID} .spcr-ext-badge {
      display: inline-block;
      padding: 2px 6px;
      border: 1px solid #D0D7DE;
      border-radius: 4px;
      background: #F6F8FA;
      color: #1F2328;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
    }
    #${BAR_ID} .spcr-ext-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    #${BAR_ID} button.spcr-ext-btn {
      appearance: none;
      background: #FFFFFF;
      color: #1F2328;
      border: 1px solid #D0D7DE;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    #${BAR_ID} button.spcr-ext-btn:hover:not(:disabled) {
      background: #F6F8FA;
    }
    #${BAR_ID} button.spcr-ext-btn-primary {
      background: #1F4E79;
      color: #FFFFFF;
      border-color: #1F4E79;
    }
    #${BAR_ID} button.spcr-ext-btn-primary:hover:not(:disabled) {
      background: #173B5C;
    }
    #${BAR_ID} button.spcr-ext-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

function findMountTarget(): HTMLElement | null {
  // Prefer mounting above the open Gmail conversation header (`div[role="main"]`)
  const mainRegion = document.querySelector('div[role="main"]') as HTMLElement | null;
  if (mainRegion && isVisibleElement(mainRegion)) {
    return mainRegion;
  }
  return null;
}

function removeBar(): void {
  const existing = document.getElementById(BAR_ID);
  if (existing) existing.remove();
}

async function handleScanClick(): Promise<void> {
  if (isBusy) return;
  // Re-extract live message ID at click time so stale IDs can NEVER be submitted!
  const live = extractActiveGmailMessageId();
  if (!live.messageId) {
    latestScanState = null;
    renderBar('Unable to read active Gmail message ID. Use the SPCR toolbar icon popup fallback.');
    return;
  }

  isBusy = true;
  renderBar(`Scanning message ${live.messageId} locally on SPCR server (zero Groq calls)...`);
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SCAN_GMAIL_MESSAGE',
      gmailMessageId: live.messageId,
    });
    if (!response?.ok) {
      renderBar(`Scan failed: ${response?.error || 'Check extension pairing in popup.'}`);
      return;
    }
    const r = response.result;
    latestScanState = {
      forMessageId: live.messageId,
      classification: r.classification,
      authenticityLabel: r.authenticityLabel,
      confidence: Number(r.confidence || 0),
      opportunityId: r.opportunityId || null,
      statusMessage: 'Scanned — no Groq request made',
      groqDrafted: false,
    };
    renderBar();
  } catch (err: any) {
    renderBar(`Scan error: ${err?.message || 'Extension communication failed.'}`);
  } finally {
    isBusy = false;
    renderBar();
  }
}

async function handleFormatGroqClick(): Promise<void> {
  if (isBusy || !latestScanState?.opportunityId) return;
  const live = extractActiveGmailMessageId();
  if (live.messageId !== latestScanState.forMessageId) {
    latestScanState = null;
    renderBar('Active Gmail message changed. Click Scan Email first.');
    return;
  }

  isBusy = true;
  renderBar('Submitting candidate opportunity to Groq structured formatter...');
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FORMAT_OPPORTUNITY_GROQ',
      opportunityId: latestScanState.opportunityId,
    });
    if (!response?.ok) {
      renderBar(`Groq formatting blocked: ${response?.error || 'Verify Groq consent/budget/API key in SPCR.'}`);
      return;
    }
    latestScanState = {
      ...latestScanState,
      groqDrafted: true,
      statusMessage: 'Formatted with Groq — ready for officer review in SPCR',
    };
  } catch (err: any) {
    renderBar(`Groq request error: ${err?.message || 'Failed'}`);
  } finally {
    isBusy = false;
    renderBar();
  }
}

function openSpcrPath(path: string): void {
  void chrome.runtime.sendMessage({ type: 'OPEN_SPCR_TAB', path });
}

function renderBar(overrideNotice?: string): void {
  const detection = extractActiveGmailMessageId();

  if (detection.messageId !== currentActiveMessageId || window.location.hash !== currentObservedHash) {
    currentObservedHash = window.location.hash;
    currentActiveMessageId = detection.messageId;
    if (latestScanState && latestScanState.forMessageId !== detection.messageId) {
      latestScanState = null;
    }
  }

  if (!detection.isThreadOpenLikely && !detection.messageId) {
    removeBar();
    return;
  }

  const mountTarget = findMountTarget();
  if (!mountTarget) return;

  injectStylesOnce();

  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement('div');
    bar.id = BAR_ID;
    mountTarget.insertBefore(bar, mountTarget.firstChild);
  }

  // Clear previous children safely
  while (bar.firstChild) {
    bar.removeChild(bar.firstChild);
  }

  const left = document.createElement('div');
  left.className = 'spcr-ext-left';

  const brand = document.createElement('span');
  brand.className = 'spcr-ext-brand';
  brand.textContent = 'SPCR';
  left.appendChild(brand);

  const statusSpan = document.createElement('span');
  statusSpan.className = 'spcr-ext-status';

  if (overrideNotice) {
    statusSpan.textContent = overrideNotice;
    left.appendChild(statusSpan);
  } else if (detection.selectorFallbackNeeded || !detection.messageId) {
    statusSpan.textContent =
      'Gmail layout selector unavailable for this view. Click the SPCR toolbar icon to scan via popup fallback.';
    left.appendChild(statusSpan);
  } else if (latestScanState && latestScanState.forMessageId === detection.messageId) {
    statusSpan.textContent = latestScanState.statusMessage;
    left.appendChild(statusSpan);

    const clsBadge = document.createElement('span');
    clsBadge.className = 'spcr-ext-badge';
    clsBadge.textContent = `${latestScanState.classification} (${(latestScanState.confidence * 100).toFixed(0)}%)`;
    left.appendChild(clsBadge);

    const authBadge = document.createElement('span');
    authBadge.className = 'spcr-ext-badge';
    authBadge.textContent = latestScanState.authenticityLabel;
    left.appendChild(authBadge);
  } else {
    statusSpan.textContent = `Message ID ${detection.messageId} ready for independent local screening.`;
    left.appendChild(statusSpan);
  }

  const actions = document.createElement('div');
  actions.className = 'spcr-ext-actions';

  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'spcr-ext-btn spcr-ext-btn-primary';
  scanBtn.textContent = 'Scan Email';
  scanBtn.disabled = isBusy || !detection.messageId;
  scanBtn.addEventListener('click', () => {
    void handleScanClick();
  });
  actions.appendChild(scanBtn);

  const activeOppId =
    latestScanState && latestScanState.forMessageId === detection.messageId ? latestScanState.opportunityId : null;

  const formatBtn = document.createElement('button');
  formatBtn.type = 'button';
  formatBtn.className = 'spcr-ext-btn';
  formatBtn.textContent = 'Format Announcement with Groq';
  formatBtn.disabled = isBusy || !activeOppId;
  formatBtn.title = activeOppId
    ? 'Explicitly submit this candidate opportunity to Groq structured formatting'
    : 'Scan a candidate placement email first';
  formatBtn.addEventListener('click', () => {
    void handleFormatGroqClick();
  });
  actions.appendChild(formatBtn);

  const reviewBtn = document.createElement('button');
  reviewBtn.type = 'button';
  reviewBtn.className = 'spcr-ext-btn';
  reviewBtn.textContent = 'Review/Edit in SPCR';
  reviewBtn.disabled = isBusy;
  reviewBtn.addEventListener('click', () => {
    const query = activeOppId ? `/?tab=inbox&opportunityId=${encodeURIComponent(activeOppId)}` : '/?tab=inbox';
    openSpcrPath(query);
  });
  actions.appendChild(reviewBtn);

  const groupsBtn = document.createElement('button');
  groupsBtn.type = 'button';
  groupsBtn.className = 'spcr-ext-btn';
  groupsBtn.textContent = 'Choose WhatsApp Groups';
  groupsBtn.disabled = isBusy;
  groupsBtn.addEventListener('click', () => {
    const query = activeOppId
      ? `/?tab=inbox&opportunityId=${encodeURIComponent(activeOppId)}`
      : '/?tab=routing';
    openSpcrPath(query);
  });
  actions.appendChild(groupsBtn);

  bar.appendChild(left);
  bar.appendChild(actions);
}

// Allow toolbar popup to query the active tab's detected Gmail message ID
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'QUERY_ACTIVE_GMAIL_MESSAGE') {
    sendResponse(extractActiveGmailMessageId());
  }
});

let debounceTimer: number | undefined;
function scheduleRefresh(): void {
  if (debounceTimer !== undefined) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    renderBar();
  }, 180);
}

window.addEventListener('hashchange', scheduleRefresh);
window.addEventListener('popstate', scheduleRefresh);

const observer = new MutationObserver(() => {
  scheduleRefresh();
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleRefresh();
}

