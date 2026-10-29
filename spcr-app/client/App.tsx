import React, { useEffect, useState } from 'react';
import { apiFetch, setClientCsrfToken } from './api.js';
import {
  ChecklistAndConnectionsScreen,
  EmailIntelligenceAndRetrainingScreen,
  GeneralSettingsPrivacyAndAuditScreen,
  GroqBudgetAndSettingsScreen,
  OverviewAndWizardScreen,
} from './SetupAndSettingsViews.js';
import {
  GuidedWhatsAppDispatchScreen,
  OpportunityInboxAndReviewScreen,
  SectionsAndGroupsRegistryScreen,
} from './InboxAndDispatchViews.js';

export function App() {
  const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const initialUrlTab = urlParams.get('tab');
  const initialUrlOppId = urlParams.get('opportunityId');

  const [authState, setAuthState] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>(initialUrlTab || 'inbox');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [loginError, setLoginError] = useState('');
  const [loading, setLoading] = useState(true);

  async function bootstrap() {
    setLoading(true);
    try {
      const auth = await apiFetch('/api/auth/status');
      setAuthState(auth);
      if (auth.authenticated && auth.principal?.csrfToken) {
        setClientCsrfToken(auth.principal.csrfToken);
        const sRes = await apiFetch('/api/settings');
        setSettings(sRes.settings);
        if (!sRes.settings?.firstRunCompleted && !initialUrlTab && !initialUrlOppId) {
          setActiveTab('overview');
        }
      }
    } catch (e: any) {
      setLoginError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
  }, []);

  async function handleDemoLogin() {
    setLoginError('');
    try {
      const res = await apiFetch('/api/auth/demo-login', {
        method: 'POST',
        body: { email: authState?.configuredOwnerEmail },
      });
      setClientCsrfToken(res.csrfToken);
      await bootstrap();
    } catch (e: any) {
      setLoginError(e.message);
    }
  }

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setClientCsrfToken('');
    setSettings(null);
    await bootstrap();
  }

  if (loading) {
    return <div style={{ padding: 32 }}>Loading SPCR workstation...</div>;
  }

  if (!authState?.authenticated) {
    return (
      <div style={{ maxWidth: 540, margin: '64px auto', padding: '0 20px' }}>
        <div className="spcr-card">
          <h1 style={{ fontSize: 20, marginTop: 0 }}>SPCR — Student Progression &amp; Company Relation</h1>
          <p>
            Single-Owner Training &amp; Placement Officer Sign-In. Public access and open self-registration are disabled.
          </p>
          <div className="notice">
            <strong>Allowlisted Owner Identity:</strong>{' '}
            <code className="mono">{authState?.configuredOwnerEmail || 'Unconfigured'}</code>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              Dashboard identity verification is strictly separate from Gmail mailbox OAuth authorization.
            </div>
          </div>
          {loginError && <div className="notice notice-danger">{loginError}</div>}

          <div className="spcr-row" style={{ marginTop: 16 }}>
            {authState?.googleOidcConfigured ? (
              <a className="btn btn-primary" href="/api/auth/google/login" style={{ textDecoration: 'none' }}>
                Sign In with Google OpenID Connect
              </a>
            ) : (
              <button className="btn" disabled>
                Google OIDC Not Configured Yet
              </button>
            )}

            {authState?.demoAuthAvailable && (
              <button className="btn btn-primary" onClick={handleDemoLogin}>
                Sign In as Owner (Local Demo / Synthetic Mode)
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header className="spcr-header">
        <div className="spcr-brand">
          <span className="spcr-brand-short">SPCR</span>
          <span className="spcr-brand-sub">Student Progression &amp; Company Relation — TPO Workstation</span>
        </div>
        <div className="spcr-row">
          <span className="badge badge-ok">
            [{authState.operatingMode || 'LOCAL_ZERO_COST'} | INR 0 RECURRING]
          </span>
          <span className="badge">
            [GROQ: {authState.optionalGroqMode || 'DISABLED'}]
          </span>
          <span className="mono" style={{ fontSize: 12 }}>
            Owner: {authState.principal.email} ({authState.principal.authMethod})
          </span>
          <button className="btn" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <div className="spcr-shell">
        <nav className="spcr-nav" aria-label="SPCR Navigation">
          <div className="spcr-nav-group-label">Placement Triage</div>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'inbox' ? 'page' : undefined}
            onClick={() => setActiveTab('inbox')}
          >
            Opportunity Inbox &amp; Review
          </button>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'ml' ? 'page' : undefined}
            onClick={() => setActiveTab('ml')}
          >
            Email Intelligence &amp; Retraining
          </button>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'dispatch' ? 'page' : undefined}
            onClick={() => setActiveTab('dispatch')}
          >
            Guided WhatsApp Queue
          </button>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'routing' ? 'page' : undefined}
            onClick={() => setActiveTab('routing')}
          >
            Sections &amp; WhatsApp Groups
          </button>

          <div className="spcr-nav-group-label">Setup &amp; Governance</div>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'overview' ? 'page' : undefined}
            onClick={() => setActiveTab('overview')}
          >
            Overview &amp; First-Run Consent
          </button>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'checklist' ? 'page' : undefined}
            onClick={() => setActiveTab('checklist')}
          >
            Setup Checklist &amp; Gmail Sync
          </button>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'groq' ? 'page' : undefined}
            onClick={() => setActiveTab('groq')}
          >
            Optional Groq &amp; Free-Tier Guard
          </button>
          <button
            className="spcr-nav-btn"
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            onClick={() => setActiveTab('settings')}
          >
            Settings, Privacy &amp; Audit
          </button>
        </nav>

        <main className="spcr-main">
          {activeTab === 'overview' && (
            <OverviewAndWizardScreen
              settings={settings}
              onSettingsUpdated={setSettings}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'checklist' && <ChecklistAndConnectionsScreen />}
          {activeTab === 'ml' && <EmailIntelligenceAndRetrainingScreen />}
          {activeTab === 'groq' && (
            <GroqBudgetAndSettingsScreen settings={settings} onSettingsUpdated={setSettings} />
          )}
          {activeTab === 'inbox' && (
            <OpportunityInboxAndReviewScreen
              initialOpportunityId={initialUrlOppId}
              onOpenDispatchBatch={(batchId) => {
                setActiveBatchId(batchId);
                setActiveTab('dispatch');
              }}
            />
          )}
          {activeTab === 'routing' && <SectionsAndGroupsRegistryScreen />}
          {activeTab === 'dispatch' && <GuidedWhatsAppDispatchScreen batchId={activeBatchId} />}
          {activeTab === 'settings' && (
            <GeneralSettingsPrivacyAndAuditScreen settings={settings} onSettingsUpdated={setSettings} />
          )}
        </main>
      </div>
    </div>
  );
}
