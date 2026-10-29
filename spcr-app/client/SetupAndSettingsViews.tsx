import React, { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

export function OverviewAndWizardScreen(props: {
  settings: any;
  onSettingsUpdated: (s: any) => void;
  onNavigate: (tab: string) => void;
}) {
  const { settings, onSettingsUpdated, onNavigate } = props;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function acceptFirstRun() {
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body: { acceptPrivacyDisclosure: true, firstRunCompleted: true },
      });
      onSettingsUpdated(res.settings);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="spcr-card">
        <h2>SPCR — Student Progression &amp; Company Relation</h2>
        <p>
          Administrative workstation for a single Training &amp; Placement Officer (TPO) to screen placement-related
          correspondence locally, match job descriptions across follow-up threads, prepare verified plain-text notices,
          and manage human-verified WhatsApp section dispatch.
        </p>
        <div className="notice">
          <strong>v1 Scope Boundary:</strong> SPCR v1 covers placement-email screening, JD matching, announcement
          formatting, and guided manual WhatsApp dispatch. Student academic databases and student progression tracking
          are intentionally excluded from v1 unless specified by the owner.
        </div>
        {error && <div className="notice notice-danger">{error}</div>}
        <h3>First-Run Data &amp; Privacy Disclosure</h3>
        <ul>
          <li>
            <strong>Zero-Groq Screening:</strong> Automatic mailbox monitoring and the manual <code>Scan Email</code>{' '}
            action execute strictly on the hosted SPCR server using deterministic rules and a local CPU ONNX classifier
            (<code>Xenova/all-MiniLM-L6-v2</code>). Zero emails are sent to Groq during scanning.
          </li>
          <li>
            <strong>Data Minimization:</strong> Unrelated, personal, and newsletter messages discard body text
            immediately. Only candidate opportunities retain source text and encrypted JD blobs (when policy allows).
          </li>
          <li>
            <strong>External AI Gate:</strong> Post-screen Groq extraction/formatting remains disabled until you set and
            confirm a monthly spending cap and acknowledge Groq&apos;s data-handling policy.
          </li>
          <li>
            <strong>Manual WhatsApp Integrity:</strong> SPCR never scripts <code>web.whatsapp.com</code> or claims
            automated delivery. Every target group requires human chat verification and manual Send.
          </li>
        </ul>
        <div className="spcr-row" style={{ marginTop: 14 }}>
          {settings?.privacyDisclosureAcceptedAt ? (
            <span className="badge badge-ok">
              [ACKNOWLEDGED] Accepted at {new Date(settings.privacyDisclosureAcceptedAt).toLocaleString()}
            </span>
          ) : (
            <button className="btn btn-primary" disabled={saving} onClick={acceptFirstRun}>
              Acknowledge Overview &amp; Privacy Rules
            </button>
          )}
          <button className="btn" onClick={() => onNavigate('checklist')}>
            Open Integration Setup Checklist
          </button>
          <button className="btn" onClick={() => onNavigate('inbox')}>
            Open Opportunity Inbox
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChecklistAndConnectionsScreen() {
  const [data, setData] = useState<any>(null);
  const [safeCheckResult, setSafeCheckResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await apiFetch('/api/integrations/checklist'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runSafeCheck() {
    setError('');
    try {
      const res = await apiFetch('/api/integrations/safe-check', { method: 'POST' });
      setSafeCheckResult(res);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function startGmailOAuth() {
    setError('');
    try {
      const res = await apiFetch<{ authUrl: string }>('/api/gmail/oauth/start', { method: 'POST' });
      window.location.href = res.authUrl;
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function disconnectGmail() {
    setError('');
    try {
      await apiFetch('/api/gmail/disconnect', { method: 'POST' });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function pollNow() {
    setError('');
    try {
      await apiFetch('/api/gmail/poll-now', { method: 'POST' });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) return <div className="spcr-card">Loading integration status...</div>;

  const mon = data?.monitoring;

  return (
    <div>
      {error && <div className="notice notice-danger">{error}</div>}
      <div className="spcr-card">
        <div className="spcr-row" style={{ justifyContent: 'space-between' }}>
          <h2>Integration Setup Checklist &amp; Safe Connection Verification</h2>
          <button className="btn btn-primary" onClick={runSafeCheck}>
            Run Safe Connection Check
          </button>
        </div>
        <div className="notice notice-warn">
          <strong>Secret Handling Rule:</strong> Never paste API keys, OAuth client secrets, or database passwords into
          normal forms or AI chat. Enter secrets exclusively in Render Dashboard &rarr; Environment Settings.
        </div>
        {safeCheckResult && (
          <div className="notice">
            <strong>Safe Check Result ({new Date(safeCheckResult.checkedAt).toLocaleTimeString()}):</strong> Database:{' '}
            <code>{safeCheckResult.database.driver}</code> OK | Local ONNX Classifier:{' '}
            <code>{safeCheckResult.localClassifier.modelId}</code> Checksum Verified | Google OAuth Env Present:{' '}
            {safeCheckResult.googleOAuthConfig.credentialsPresent ? 'Yes' : 'No'} | Groq Status:{' '}
            {safeCheckResult.groq.detail} (Zero mailbox scans or completion tokens used).
          </div>
        )}
        <table className="spcr-table">
          <thead>
            <tr>
              <th>Integration / Gate</th>
              <th>Status</th>
              <th>Where Configured</th>
              <th>Details &amp; Callback URIs</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((item: any) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  {item.consoleUrl && (
                    <div>
                      <a href={item.consoleUrl} target="_blank" rel="noreferrer">
                        Open Official Console
                      </a>
                    </div>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${
                      item.state === 'CONFIGURED'
                        ? 'badge-ok'
                        : item.state === 'NOT NEEDED'
                          ? ''
                          : item.state === 'BLOCKED BY POLICY' || item.state === 'INVALID'
                            ? 'badge-danger'
                            : 'badge-warn'
                    }`}
                  >
                    [{item.state}]
                  </span>
                </td>
                <td>{item.whereEntered}</td>
                <td>
                  <div>{item.detail}</div>
                  {item.callbackUris && (
                    <div className="mono" style={{ marginTop: 6 }}>
                      <div>OIDC Login Callback: {item.callbackUris.dashboardLoginOidc}</div>
                      <div>Gmail OAuth Callback: {item.callbackUris.gmailMailboxReadonly}</div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="spcr-grid-2">
        <div className="spcr-card">
          <h3>Google OAuth &amp; Gmail Mailbox Connection</h3>
          <p>
            Read-only scope requested when permitted: <code className="mono">gmail.readonly</code> (never modify or
            send). Authorizing read-only access permits the server to inspect mailbox messages; SPCR persists only
            screened placement candidates.
          </p>
          <p>
            <strong>Policy Gate:</strong>{' '}
            <span className={`badge ${mon?.policyGateApproved ? 'badge-ok' : 'badge-danger'}`}>
              {mon?.policyGateApproved ? '[POLICY APPROVED]' : '[BLOCKED BY POLICY GATE]'}
            </span>
          </p>
          <p>{mon?.policyGateExplanation}</p>
          <p>
            <strong>Connected Mailbox:</strong>{' '}
            {mon?.connection ? `${mon.connection.mailbox_email} (${mon.connection.status})` : 'Not connected'}
          </p>
          <div className="spcr-row">
            <button className="btn btn-primary" disabled={!mon?.policyGateApproved} onClick={startGmailOAuth}>
              Authorize Gmail Mailbox (OAuth 2.0)
            </button>
            {mon?.connection && mon.connection.status !== 'disconnected' && (
              <button className="btn btn-danger" onClick={disconnectGmail}>
                Disconnect &amp; Revoke Mailbox Token
              </button>
            )}
          </div>
        </div>

        <div className="spcr-card">
          <h3>Background Monitoring &amp; Worker Health</h3>
          <p>
            <strong>Worker Lease Status:</strong>{' '}
            <span className={`badge ${mon?.workerActive ? 'badge-ok' : 'badge-warn'}`}>
              {mon?.workerActive ? `[ACTIVE: ${mon.workerLease?.holder_id}]` : '[STOPPED / NO ACTIVE WORKER LEASE]'}
            </span>
          </p>
          <p>
            <strong>Last Successful Sync:</strong>{' '}
            {mon?.connection?.last_success_at ? new Date(mon.connection.last_success_at).toLocaleString() : 'Never'}
          </p>
          <p>
            <strong>History Cursor ID:</strong> <code className="mono">{mon?.connection?.last_history_id || 'None'}</code>
          </p>
          <p>
            <strong>Queued Candidates in Review:</strong> {mon?.queuedCandidatesCount ?? 0}
          </p>
          {mon?.connection?.last_error && (
            <div className="notice notice-danger">Last Sync Error: {mon.connection.last_error}</div>
          )}
          <button className="btn" disabled={!mon?.policyGateApproved} onClick={pollNow}>
            Trigger Incremental Gmail Sync (Zero Groq Calls)
          </button>
        </div>
      </div>
    </div>
  );
}

export function GroqBudgetAndSettingsScreen(props: { settings: any; onSettingsUpdated: (s: any) => void }) {
  const { settings, onSettingsUpdated } = props;
  const [groqStatus, setGroqStatus] = useState<any>(null);
  const [budgetInput, setBudgetInput] = useState<string>(
    settings?.monthlyBudgetInr !== null && settings?.monthlyBudgetInr !== undefined
      ? String(settings.monthlyBudgetInr)
      : ''
  );
  const [selectedModel, setSelectedModel] = useState<string>(settings?.groqModel || 'openai/gpt-oss-20b');
  const [estCandidatesPerMonth, setEstCandidatesPerMonth] = useState<number>(60);
  const [estCharsPerCandidate, setEstCharsPerCandidate] = useState<number>(6000);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function loadGroq() {
    try {
      setGroqStatus(await apiFetch('/api/groq/status'));
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadGroq();
  }, []);

  const currentModelSpec = (groqStatus?.verifiedModels || []).find((m: any) => m.id === selectedModel);
  const estInputTokens = Math.ceil(estCharsPerCandidate / 3.2) + 500;
  const estOutputTokens = 750;
  const estMonthlyUsd = currentModelSpec
    ? estCandidatesPerMonth *
      ((estInputTokens / 1_000_000) * currentModelSpec.inputPricePer1MUsd +
        (estOutputTokens / 1_000_000) * currentModelSpec.outputPricePer1MUsd)
    : 0;
  const estMonthlyInr = estMonthlyUsd * (settings?.usdToInrRate || 86);

  async function saveBudgetAndConsent(acceptDisclosure: boolean) {
    setError('');
    setMsg('');
    try {
      const parsedBudget = budgetInput.trim() === '' ? null : Number(budgetInput);
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body: {
          groqModel: selectedModel,
          monthlyBudgetInr: parsedBudget,
          confirmBudget: parsedBudget !== null && parsedBudget > 0,
          ...(acceptDisclosure ? { acceptGroqDisclosure: true } : {}),
        },
      });
      onSettingsUpdated(res.settings);
      await loadGroq();
      setMsg('Groq model, disclosure state, and confirmed monthly budget cap updated.');
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleAutoDraft(nextVal: boolean) {
    setError('');
    setMsg('');
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body: { autoDraftHighConfidence: nextVal },
      });
      onSettingsUpdated(res.settings);
      await loadGroq();
      setMsg(
        nextVal
          ? 'Automatic Groq formatting for high-confidence candidates enabled.'
          : 'Automatic Groq formatting disabled (manual click required).'
      );
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-danger">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      <div className="spcr-card">
        <h2>Groq Post-Screen Extraction, Pricing &amp; Monthly Budget Gate</h2>
        <p>
          <strong>Server Key Status:</strong>{' '}
          <span className={`badge ${groqStatus?.liveEnabled ? 'badge-ok' : 'badge-warn'}`}>
            {groqStatus?.liveEnabled
              ? '[LIVE GROQ ENABLED SERVER-SIDE]'
              : groqStatus?.apiKeyConfigured
                ? '[KEY PRESENT — GROQ_LIVE_ENABLED=false]'
                : '[NOT CONFIGURED — MANUAL / DETERMINISTIC MODE ACTIVE]'}
          </span>
        </p>
        <div className="notice">{groqStatus?.dataRetentionDisclosure}</div>
        <div className="notice notice-warn">{groqStatus?.providerSpendLimitWarning}</div>

        <h3>Verified Groq Self-Serve Production Models (Verified 2026-10-29)</h3>
        <table className="spcr-table">
          <thead>
            <tr>
              <th>Model ID</th>
              <th>Input / 1M Tokens</th>
              <th>Output / 1M Tokens</th>
              <th>Strict JSON Schema</th>
              <th>Free Tier Limits</th>
              <th>Developer Plan Limits</th>
            </tr>
          </thead>
          <tbody>
            {(groqStatus?.verifiedModels || []).map((m: any) => (
              <tr key={m.id}>
                <td className="mono">{m.id}</td>
                <td>${m.inputPricePer1MUsd}</td>
                <td>${m.outputPricePer1MUsd}</td>
                <td>{m.strictStructuredOutputs ? 'Supported (strict: true)' : 'Best-effort'}</td>
                <td>
                  {m.freeTierLimits
                    ? `${m.freeTierLimits.rpm} RPM / ${m.freeTierLimits.tpm} TPM / ${m.freeTierLimits.tpd} TPD`
                    : 'N/A'}
                </td>
                <td>{m.developerTierLimits ? `${m.developerTierLimits.rpm} RPM / ${m.developerTierLimits.tpm} TPM` : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="spcr-grid-2">
        <div className="spcr-card">
          <h3>Monthly Cost Estimator</h3>
          <div className="field">
            <label htmlFor="est-cand">Expected Screened Candidates Formatted / Month</label>
            <input
              id="est-cand"
              type="number"
              min={1}
              max={5000}
              value={estCandidatesPerMonth}
              onChange={(e) => setEstCandidatesPerMonth(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label htmlFor="est-chars">Average Combined Email + JD Characters</label>
            <input
              id="est-chars"
              type="number"
              min={500}
              max={60000}
              value={estCharsPerCandidate}
              onChange={(e) => setEstCharsPerCandidate(Number(e.target.value) || 0)}
            />
          </div>
          <p>
            <strong>Estimated Monthly Groq Spend ({selectedModel}):</strong> ${estMonthlyUsd.toFixed(4)} USD (approx.
            INR {estMonthlyInr.toFixed(2)} at {settings?.usdToInrRate || 86} INR/USD).
          </p>
        </div>

        <div className="spcr-card">
          <h3>Configure &amp; Confirm Application Budget Stop</h3>
          <div className="field">
            <label htmlFor="groq-model-sel">Selected Groq Model ID</label>
            <select id="groq-model-sel" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              <option value="openai/gpt-oss-20b">openai/gpt-oss-20b ($0.075 in / $0.30 out)</option>
              <option value="openai/gpt-oss-120b">openai/gpt-oss-120b ($0.15 in / $0.60 out)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="budget-inr">Monthly Application Cap (INR)</label>
            <input
              id="budget-inr"
              type="number"
              min={0}
              step="1"
              placeholder="Unset — enter cap in INR (e.g. 250)"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
            />
          </div>
          <p>
            <strong>Current Month Ledger ({groqStatus?.currentMonth?.monthKey}):</strong> Spent INR{' '}
            {groqStatus?.currentMonth?.spentInr ?? 0} | Reserved INR {groqStatus?.currentMonth?.reservedInr ?? 0} |
            Remaining INR:{' '}
            {groqStatus?.currentMonth?.remainingInr !== null ? groqStatus?.currentMonth?.remainingInr : 'Unset'}
          </p>
          <div className="spcr-row">
            <button className="btn btn-primary" onClick={() => saveBudgetAndConsent(true)}>
              Accept Data Disclosure &amp; Confirm Monthly Cap
            </button>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={Boolean(settings?.autoDraftHighConfidence)}
                onChange={(e) => toggleAutoDraft(e.target.checked)}
              />{' '}
              Automatically format high-confidence placement candidates with Groq (Default OFF)
            </label>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Scanning itself never calls Groq. When enabled, only high-confidence candidates with zero risk flags enter
              a separate post-screen drafting queue. Uncertain or suspicious emails are never auto-sent to Groq.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GeneralSettingsPrivacyAndAuditScreen(props: {
  settings: any;
  onSettingsUpdated: (s: any) => void;
}) {
  const { settings, onSettingsUpdated } = props;
  const [signature, setSignature] = useState(settings?.collegeSignature || '');
  const [template, setTemplate] = useState(settings?.announcementTemplate || '');
  const [retentionDays, setRetentionDays] = useState<number>(settings?.retentionDays || 90);
  const [extMode, setExtMode] = useState<'zip_developer_mode' | 'browser_store_planned'>(
    settings?.extensionDistributionMode || 'zip_developer_mode'
  );
  const [senderNotes, setSenderNotes] = useState<any[]>([]);
  const [noteDomain, setNoteDomain] = useState('');
  const [noteCat, setNoteCat] = useState<'known_company' | 'recruitment_agency' | 'caution' | 'general_note'>(
    'known_company'
  );
  const [noteText, setNoteText] = useState('');
  const [pairings, setPairings] = useState<any[]>([]);
  const [generatedPairing, setGeneratedPairing] = useState<any>(null);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [err, setErr] = useState('');

  async function loadAll() {
    try {
      const [sn, pr, au] = await Promise.all([
        apiFetch('/api/sender-notes'),
        apiFetch('/api/extension/pairings'),
        apiFetch('/api/audit-events'),
      ]);
      setSenderNotes(sn.notes || []);
      setPairings(pr.pairings || []);
      setAuditEvents(au.events || []);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveTemplateSettings() {
    setErr('');
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body: {
          collegeSignature: signature,
          announcementTemplate: template,
          retentionDays,
          extensionDistributionMode: extMode,
        },
      });
      onSettingsUpdated(res.settings);
      setStatusMsg('Settings saved.');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function addSenderNote(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await apiFetch('/api/sender-notes', {
        method: 'POST',
        body: { domainOrEmail: noteDomain, category: noteCat, note: noteText },
      });
      setNoteDomain('');
      setNoteText('');
      await loadAll();
    } catch (e2: any) {
      setErr(e2.message);
    }
  }

  async function createPairingCode() {
    setErr('');
    try {
      const res = await apiFetch('/api/extension/pairings', {
        method: 'POST',
        body: { label: 'Chrome/Edge Extension v1.0.0' },
      });
      setGeneratedPairing(res);
      await loadAll();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function purgeAllData() {
    if (!window.confirm('Delete ALL stored Gmail-derived messages, opportunities, drafts, and encrypted JD blobs?')) {
      return;
    }
    setErr('');
    try {
      const res = await apiFetch('/api/privacy/purge-all-gmail-data', {
        method: 'POST',
        body: { disconnectMailbox: false },
      });
      setStatusMsg(
        `Purged ${res.purgedOpportunities} opportunities, ${res.purgedMessages} messages, and ${res.purgedEncryptedBlobs} encrypted blobs.`
      );
      await loadAll();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function runRetention() {
    setErr('');
    try {
      const res = await apiFetch('/api/privacy/run-retention-now', { method: 'POST' });
      setStatusMsg(`Retention cleanup complete (cutoff ${res.cutoffIso}).`);
      await loadAll();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div>
      {err && <div className="notice notice-danger">{err}</div>}
      {statusMsg && <div className="notice">{statusMsg}</div>}

      <div className="spcr-grid-2">
        <div className="spcr-card">
          <h3>Announcement Template, Retention &amp; Extension Mode</h3>
          <div className="field">
            <label htmlFor="col-sig">Editable College Signature</label>
            <input id="col-sig" type="text" value={signature} onChange={(e) => setSignature(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ann-tpl">Plain-Text Formal Template (No Emojis)</label>
            <textarea
              id="ann-tpl"
              rows={9}
              className="mono"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ret-days">Retention Window (Days — Default 90 subject to policy validation)</label>
            <input
              id="ret-days"
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value) || 90)}
            />
          </div>
          <div className="field">
            <label htmlFor="ext-mode">Browser Extension Distribution Path</label>
            <select id="ext-mode" value={extMode} onChange={(e) => setExtMode(e.target.value as any)}>
              <option value="zip_developer_mode">
                Tested ZIP + Unpacked Developer Mode (chrome://extensions / edge://extensions)
              </option>
              <option value="browser_store_planned">
                Plan Chrome Web Store / Edge Add-ons Publication (requires owner store review approval)
              </option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={saveTemplateSettings}>
            Save Settings
          </button>
        </div>

        <div className="spcr-card">
          <h3>Chrome/Edge Extension Pairing &amp; Sender Notes</h3>
          <p>
            Generate a short-lived one-time pairing code to link the SPCR Manifest V3 browser extension without putting
            secrets in extension storage.
          </p>
          <button className="btn btn-primary" onClick={createPairingCode}>
            Generate One-Time Extension Pairing Code
          </button>
          {generatedPairing && (
            <div className="notice" style={{ marginTop: 10 }}>
              One-Time Pairing Code: <strong className="mono">{generatedPairing.pairingCode}</strong> (expires{' '}
              {new Date(generatedPairing.expiresAt).toLocaleTimeString()}).
            </div>
          )}
          {pairings.length > 0 && (
            <ul style={{ fontSize: 12, paddingLeft: 18 }}>
              {pairings.slice(0, 5).map((p) => (
                <li key={p.id}>
                  {p.label} — {p.revoked_at ? 'Revoked' : p.claimed_at ? 'Paired' : 'Pending claim'}{' '}
                  {!p.revoked_at && (
                    <button
                      className="btn"
                      style={{ padding: '2px 6px', fontSize: 11 }}
                      onClick={async () => {
                        await apiFetch(`/api/extension/pairings/${p.id}`, { method: 'DELETE' });
                        loadAll();
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <h4>Owner Sender Domain Notes (Informational — Not Blind Trust)</h4>
          <form onSubmit={addSenderNote}>
            <div className="field">
              <label htmlFor="sn-dom">Domain or Email</label>
              <input
                id="sn-dom"
                type="text"
                placeholder="example-corp.com"
                value={noteDomain}
                onChange={(e) => setNoteDomain(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="sn-cat">Category</label>
              <select id="sn-cat" value={noteCat} onChange={(e) => setNoteCat(e.target.value as any)}>
                <option value="known_company">Known Company Domain</option>
                <option value="recruitment_agency">Recruitment Agency</option>
                <option value="caution">Caution / Verify Extra</option>
                <option value="general_note">General Note</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sn-txt">Note</label>
              <input
                id="sn-txt"
                type="text"
                placeholder="Visited in 2025; verify HR email signature"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn">
              Save Sender Note
            </button>
          </form>
          {senderNotes.length > 0 && (
            <ul style={{ fontSize: 12, paddingLeft: 18 }}>
              {senderNotes.map((n) => (
                <li key={n.id}>
                  <strong>{n.domain_or_email}</strong> [{n.category}]: {n.note}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="spcr-card">
        <h3>Privacy Center &amp; Data Deletion Controls</h3>
        <p>
          Stored attachment blobs are encrypted at rest with AES-256-GCM inside PostgreSQL so both web and worker
          services share private access without public URLs. Unrelated emails never retain body text.
        </p>
        <div className="spcr-row">
          <button className="btn" onClick={runRetention}>
            Run Scheduled Retention Cleanup Now
          </button>
          <a className="btn" href="/api/privacy/export-metadata" target="_blank" rel="noreferrer">
            Export Non-Secret Metadata JSON
          </a>
          <button className="btn btn-danger" onClick={purgeAllData}>
            Delete All Stored Gmail-Derived Data
          </button>
        </div>
      </div>

      <div className="spcr-card">
        <h3>Audit Trail (Secrets &amp; Raw Email Bodies Redacted)</h3>
        <table className="spcr-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Event</th>
              <th>Entity</th>
              <th>Metadata</th>
            </tr>
          </thead>
          <tbody>
            {auditEvents.slice(0, 25).map((ev) => (
              <tr key={ev.id}>
                <td className="mono">{new Date(ev.created_at).toLocaleString()}</td>
                <td>{ev.actor_email || 'system'}</td>
                <td className="mono">{ev.event_type}</td>
                <td>
                  {ev.entity_type} {ev.entity_id ? `(${ev.entity_id.slice(0, 14)})` : ''}
                </td>
                <td className="mono">{JSON.stringify(ev.metadata_json)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

