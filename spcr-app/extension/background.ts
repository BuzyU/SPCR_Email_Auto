/**
 * SPCR Manifest V3 Background Service Worker
 * - Zero background Gmail polling (all automatic monitoring runs on Render worker).
 * - Zero embedded API keys, client secrets, or database credentials.
 * - Authenticates strictly via paired one-time extension bearer token + CSRF header stored in chrome.storage.local.
 */

export interface StoredPairingState {
  backendOrigin: string;
  extensionToken: string;
  csrfToken: string;
  pairingId: string;
  ownerEmail: string;
  pairedAt: string;
}

const STORAGE_KEY = 'spcr_pairing_state';
declare const __DEFAULT_BACKEND_ORIGIN__: string;

function getDefaultBackendOrigin(): string {
  return typeof __DEFAULT_BACKEND_ORIGIN__ === 'string' && __DEFAULT_BACKEND_ORIGIN__
    ? __DEFAULT_BACKEND_ORIGIN__
    : 'https://spcr-web.onrender.com';
}

function normalizeOrigin(raw: string): string {
  const parsed = new URL(raw.trim());
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('SPCR backend origin must use HTTPS.');
  }
  return parsed.origin;
}

async function getPairingState(): Promise<StoredPairingState | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const state = data[STORAGE_KEY] as StoredPairingState | undefined;
  if (!state || !state.extensionToken || !state.backendOrigin) {
    return null;
  }
  return state;
}

async function authenticatedSpcrFetch(
  pathName: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {}
): Promise<any> {
  const pairing = await getPairingState();
  if (!pairing) {
    throw new Error('Extension is not paired with SPCR. Open the SPCR extension popup and enter a one-time pairing code.');
  }

  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${pairing.extensionToken}`,
    'X-CSRF-Token': pairing.csrfToken,
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${pairing.backendOrigin}${pathName}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Extension pairing expired or was revoked in SPCR. Re-pair in the extension popup.');
    }
    throw new Error(payload?.message || `SPCR request failed with HTTP ${response.status}.`);
  }
  return payload;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'GET_CONFIG_AND_STATUS': {
          const pairing = await getPairingState();
          if (!pairing) {
            return {
              ok: true,
              paired: false,
              defaultBackendOrigin: getDefaultBackendOrigin(),
            };
          }
          try {
            const status = await authenticatedSpcrFetch('/api/auth/status');
            return {
              ok: true,
              paired: Boolean(status.authenticated),
              backendOrigin: pairing.backendOrigin,
              ownerEmail: pairing.ownerEmail,
              pairingId: pairing.pairingId,
              serverAuth: status,
            };
          } catch (err: any) {
            return {
              ok: true,
              paired: false,
              backendOrigin: pairing.backendOrigin,
              ownerEmail: pairing.ownerEmail,
              authError: err.message,
            };
          }
        }

        case 'PAIR_EXTENSION': {
          const backendOrigin = normalizeOrigin(String(message.backendOrigin || getDefaultBackendOrigin()));
          const pairingCode = String(message.pairingCode || '').trim().toUpperCase();
          if (pairingCode.length < 6) {
            throw new Error('Enter the 12-character one-time pairing code from the SPCR Dashboard.');
          }

          const res = await fetch(`${backendOrigin}/api/extension/pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairingCode }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(payload?.message || `Pairing rejected (HTTP ${res.status}).`);
          }

          const state: StoredPairingState = {
            backendOrigin,
            extensionToken: payload.extensionToken,
            csrfToken: payload.csrfToken,
            pairingId: payload.pairingId,
            ownerEmail: payload.ownerEmail,
            pairedAt: new Date().toISOString(),
          };
          await chrome.storage.local.set({ [STORAGE_KEY]: state });
          return {
            ok: true,
            paired: true,
            ownerEmail: state.ownerEmail,
            backendOrigin: state.backendOrigin,
          };
        }

        case 'UNPAIR_EXTENSION': {
          await chrome.storage.local.remove(STORAGE_KEY);
          return { ok: true, paired: false };
        }

        case 'SCAN_GMAIL_MESSAGE': {
          const gmailMessageId = String(message.gmailMessageId || '').trim();
          if (!gmailMessageId || !/^[A-Za-z0-9_-]{6,128}$/.test(gmailMessageId)) {
            throw new Error('Valid Gmail message ID is required for manual scan.');
          }
          const result = await authenticatedSpcrFetch('/api/scan/manual', {
            method: 'POST',
            body: { gmailMessageId },
          });
          const pairing = await getPairingState();
          return {
            ok: true,
            backendOrigin: pairing?.backendOrigin || getDefaultBackendOrigin(),
            result,
          };
        }

        case 'FORMAT_OPPORTUNITY_GROQ': {
          const opportunityId = String(message.opportunityId || '').trim();
          if (!opportunityId) {
            throw new Error('No candidate opportunity ID available to format.');
          }
          const result = await authenticatedSpcrFetch(
            `/api/opportunities/${encodeURIComponent(opportunityId)}/format-groq`,
            {
              method: 'POST',
              body: { confirmSuspiciousDataTransfer: Boolean(message.confirmSuspiciousDataTransfer) },
            }
          );
          const pairing = await getPairingState();
          return {
            ok: true,
            backendOrigin: pairing?.backendOrigin || getDefaultBackendOrigin(),
            result,
          };
        }

        case 'OPEN_SPCR_TAB': {
          const pairing = await getPairingState();
          const base = pairing?.backendOrigin || getDefaultBackendOrigin();
          const targetPath = typeof message.path === 'string' ? message.path : '/';
          const safePath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
          await chrome.tabs.create({ url: `${base}${safePath}`, active: true });
          return { ok: true };
        }

        default:
          return { ok: false, error: 'Unsupported extension action.' };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Unexpected SPCR extension error.' };
    }
  })().then(sendResponse);

  return true;
});

