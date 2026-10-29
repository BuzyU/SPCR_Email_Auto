import React, { useEffect, useState } from 'react';
import { apiFetch } from './api.js';

export function OpportunityInboxAndReviewScreen(props: {
  initialOpportunityId?: string | null;
  onOpenDispatchBatch: (batchId: string) => void;
}) {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [screenedMessages, setScreenedMessages] = useState<any[]>([]);
  const [selectedOppId, setSelectedOppId] = useState<string | null>(props.initialOpportunityId || null);
  const [oppDetail, setOppDetail] = useState<any>(null);
  const [draftEditorText, setDraftEditorText] = useState('');
  const [registry, setRegistry] = useState<any>({ sections: [], groups: [], duplicateWarnings: [] });
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [manualAddGroupIds, setManualAddGroupIds] = useState<string[]>([]);
  const [manualRemoveGroupIds, setManualRemoveGroupIds] = useState<string[]>([]);
  const [destinationPreview, setDestinationPreview] = useState<any>(null);
  const [manualScanSubject, setManualScanSubject] = useState('');
  const [manualScanFrom, setManualScanFrom] = useState('');
  const [manualScanBody, setManualScanBody] = useState('');
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function refreshList() {
    setLoading(true);
    try {
      const [oppsRes, msgsRes, regRes] = await Promise.all([
        apiFetch('/api/opportunities'),
        apiFetch('/api/messages/screened'),
        apiFetch('/api/routing/registry'),
      ]);
      setOpportunities(oppsRes.opportunities || []);
      setScreenedMessages(msgsRes.messages || []);
      setRegistry(regRes);
      if (!selectedOppId && oppsRes.opportunities?.[0]?.id) {
        setSelectedOppId(oppsRes.opportunities[0].id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadOpportunityDetail(id: string) {
    try {
      const detail = await apiFetch(`/api/opportunities/${id}`);
      setOppDetail(detail);
      const latestDraft = detail.drafts?.[0];
      setDraftEditorText(latestDraft?.draft_text || '');
      const suggested = Array.isArray(detail.opportunity?.suggested_section_ids_json)
        ? detail.opportunity.suggested_section_ids_json
        : [];
      setSelectedSectionIds(suggested);
      setManualAddGroupIds([]);
      setManualRemoveGroupIds([]);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refreshList();
  }, []);

  useEffect(() => {
    if (selectedOppId) {
      loadOpportunityDetail(selectedOppId);
    } else {
      setOppDetail(null);
    }
  }, [selectedOppId]);

  useEffect(() => {
    apiFetch('/api/routing/preview', {
      method: 'POST',
      body: {
        sectionIds: selectedSectionIds,
        addGroupIds: manualAddGroupIds,
        removeGroupIds: manualRemoveGroupIds,
      },
    })
      .then(setDestinationPreview)
      .catch(() => undefined);
  }, [selectedSectionIds, manualAddGroupIds, manualRemoveGroupIds]);

  async function seedDemo() {
    setError('');
    setBanner('');
    try {
      const res = await apiFetch('/api/demo/seed', { method: 'POST' });
      setBanner(
        `Loaded synthetic placement demo data (${res.scannedMessages.length} emails screened locally — ${res.totalGroqCallsMade} Groq requests made).`
      );
      await refreshList();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function submitManualScan(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBanner('');
    try {
      const res = await apiFetch('/api/scan/manual', {
        method: 'POST',
        body: {
          gmailMessageId: `manual-${Date.now()}`,
          syntheticPayload: {
            fromRaw: manualScanFrom,
            subject: manualScanSubject,
            bodyText: manualScanBody,
          },
        },
      });
      setBanner(`${res.statusBanner} | Outcome: ${res.classification} | Authenticity: ${res.authenticityLabel}`);
      setManualScanSubject('');
      setManualScanFrom('');
      setManualScanBody('');
      await refreshList();
      if (res.opportunityId) setSelectedOppId(res.opportunityId);
    } catch (e2: any) {
      setError(e2.message);
    }
  }

  async function formatWithGroq() {
    if (!selectedOppId) return;
    setError('');
    setBanner('');
    try {
      const res = await apiFetch(`/api/opportunities/${selectedOppId}/format-groq`, {
        method: 'POST',
        body: { confirmSuspiciousDataTransfer: false },
      });
      setBanner(
        `Formatted with Groq (${res.draft.model_id}). Tokens: ${res.usage.promptTokens} in / ${res.usage.completionTokens} out (INR ${res.usage.actualCostInr}).`
      );
      await loadOpportunityDetail(selectedOppId);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveDraftEdit() {
    if (!selectedOppId) return;
    setError('');
    try {
      await apiFetch(`/api/opportunities/${selectedOppId}/drafts`, {
        method: 'POST',
        body: { draftText: draftEditorText },
      });
      setBanner('Manual draft edit saved as new draft version. Any prior approval was invalidated.');
      await loadOpportunityDetail(selectedOppId);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function approveAndStartGuidedDispatch() {
    if (!selectedOppId || !oppDetail?.drafts?.[0]?.id) return;
    setError('');
    try {
      const firstParsedAtt = (oppDetail.attachments || []).find((a: any) => a.blob_stored);
      const batchRes = await apiFetch(`/api/opportunities/${selectedOppId}/approve`, {
        method: 'POST',
        body: {
          draftVersionId: oppDetail.drafts[0].id,
          sectionIds: selectedSectionIds,
          addGroupIds: manualAddGroupIds,
          removeGroupIds: manualRemoveGroupIds,
          jdAttachmentId: firstParsedAtt?.id || null,
        },
      });
      props.onOpenDispatchBatch(batchRes.batch.id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-danger">{error}</div>}
      {banner && <div className="notice">{banner}</div>}

      <div className="spcr-card">
        <div className="spcr-row" style={{ justifyContent: 'space-between' }}>
          <h2>Opportunity Inbox &amp; Zero-Groq Email Screening</h2>
          <div className="spcr-row">
            <button className="btn btn-primary" onClick={seedDemo}>
              Load Synthetic Placement Demo Data
            </button>
            <button className="btn" onClick={refreshList}>
              Refresh Inbox
            </button>
          </div>
        </div>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Manual Scan Email Action (Zero Groq Calls — Test Synthetic Email)
          </summary>
          <form onSubmit={submitManualScan} style={{ marginTop: 10 }}>
            <div className="spcr-grid-2">
              <div className="field">
                <label htmlFor="ms-from">From Header</label>
                <input
                  id="ms-from"
                  type="text"
                  placeholder='"Recruiter Name" <careers@company.example>'
                  value={manualScanFrom}
                  onChange={(e) => setManualScanFrom(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="ms-sub">Subject</label>
                <input
                  id="ms-sub"
                  type="text"
                  placeholder="Campus Hiring Drive 2027 — Backend Engineer"
                  value={manualScanSubject}
                  onChange={(e) => setManualScanSubject(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="ms-body">Email Body</label>
              <textarea
                id="ms-body"
                rows={3}
                value={manualScanBody}
                onChange={(e) => setManualScanBody(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Scan Email (Local ONNX + Rules — Zero Groq Calls)
            </button>
          </form>
        </details>

        {loading ? (
          <p>Loading opportunities...</p>
        ) : opportunities.length === 0 ? (
          <div className="notice">
            No screened opportunities yet. Click <strong>Load Synthetic Placement Demo Data</strong> above to inspect
            realistic unknown-company opportunities, multi-email JD linking, conflict provenance, and suspicious sender
            quarantine with zero external API keys.
          </div>
        ) : (
          <table className="spcr-table">
            <thead>
              <tr>
                <th>Company &amp; Role</th>
                <th>Status</th>
                <th>Confidence Tier</th>
                <th>Version &amp; Sources</th>
                <th>Flags</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((o) => (
                <tr
                  key={o.id}
                  style={{ background: o.id === selectedOppId ? 'var(--surface)' : undefined }}
                >
                  <td>
                    <strong>{o.company_name}</strong>
                    <div>{o.role_title}</div>
                  </td>
                  <td>
                    <span className="badge">[{o.status}]</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        o.screening_confidence_tier === 'suspicious'
                          ? 'badge-danger'
                          : o.screening_confidence_tier === 'high'
                            ? 'badge-ok'
                            : 'badge-warn'
                      }`}
                    >
                      [{o.screening_confidence_tier.toUpperCase()}]
                    </span>
                  </td>
                  <td>
                    v{o.current_version} | {o.linked_messages_count} email(s), {o.attachments_count} JD(s)
                    {o.proposed_links_count > 0 && ` (+${o.proposed_links_count} proposed match)`}
                  </td>
                  <td className="mono">{(o.review_flags_json || []).join(', ') || 'None'}</td>
                  <td>
                    <button className="btn" onClick={() => setSelectedOppId(o.id)}>
                      Inspect &amp; Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {oppDetail && (
        <div className="spcr-card">
          <div className="spcr-row" style={{ justifyContent: 'space-between' }}>
            <h2>
              Opportunity Review: {oppDetail.opportunity.company_name} — {oppDetail.opportunity.role_title} (v
              {oppDetail.opportunity.current_version})
            </h2>
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!window.confirm('Delete this opportunity and its stored email/JD data?')) return;
                await apiFetch(`/api/privacy/opportunities/${oppDetail.opportunity.id}`, { method: 'DELETE' });
                setSelectedOppId(null);
                refreshList();
              }}
            >
              Delete Opportunity
            </button>
          </div>

          <h3>1. Linked &amp; Proposed Source Emails (Sender Authenticity Separate from Relevance)</h3>
          {(oppDetail.messageLinks || []).map((ml: any) => (
            <div key={ml.link_id} className="notice">
              <div className="spcr-row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{ml.subject}</strong> — <span className="mono">{ml.from_raw}</span>
                </div>
                <span className={`badge ${ml.link_state === 'confirmed' ? 'badge-ok' : 'badge-warn'}`}>
                  [LINK: {ml.link_state.toUpperCase()} ({ml.match_score})]
                </span>
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>Authenticity Assessment:</strong>{' '}
                <span
                  className={`badge ${
                    (ml.risk_flags_json || []).length > 0 ? 'badge-danger' : 'badge-warn'
                  }`}
                >
                  {ml.authenticity_label}
                </span>{' '}
                (Note: SPF/DKIM pass never proves company legitimacy.)
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>Match Evidence:</strong> {(ml.evidence_json || []).join(' | ')}
              </div>
              {ml.link_state === 'proposed' && (
                <div className="spcr-row" style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      await apiFetch(`/api/opportunities/links/${ml.link_id}/resolve`, {
                        method: 'POST',
                        body: { decision: 'confirm' },
                      });
                      loadOpportunityDetail(oppDetail.opportunity.id);
                    }}
                  >
                    Confirm Link to This Opportunity
                  </button>
                  <button
                    className="btn"
                    onClick={async () => {
                      await apiFetch(`/api/opportunities/links/${ml.link_id}/resolve`, {
                        method: 'POST',
                        body: { decision: 'keep_separate' },
                      });
                      refreshList();
                    }}
                  >
                    Keep Separate Opportunity
                  </button>
                </div>
              )}
              <div className="spcr-row" style={{ marginTop: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Officer Classifier Feedback:</span>
                {(['relevant_placement', 'related_jd', 'not_relevant', 'suspicious'] as const).map((fb) => (
                  <button
                    key={fb}
                    className="btn"
                    style={{ padding: '2px 8px', fontSize: 12 }}
                    onClick={async () => {
                      await apiFetch(`/api/messages/${ml.message_id}/feedback`, {
                        method: 'POST',
                        body: { feedback: fb },
                      });
                      loadOpportunityDetail(oppDetail.opportunity.id);
                    }}
                  >
                    {ml.officer_feedback === fb ? `[Selected] ${fb}` : fb}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <h3>2. JD Attachments &amp; Extraction Security Status</h3>
          {(oppDetail.attachments || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No attachments linked yet.</p>
          ) : (
            <table className="spcr-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Verified Magic Type</th>
                  <th>Parse Status &amp; Reason</th>
                  <th>SHA-256</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {oppDetail.attachments.map((att: any) => (
                  <tr key={att.id}>
                    <td>{att.filename}</td>
                    <td className="mono">{att.verified_type}</td>
                    <td>
                      <span className={`badge ${att.parse_status === 'parsed' ? 'badge-ok' : 'badge-warn'}`}>
                        [{att.parse_status}]
                      </span>{' '}
                      {att.parse_reason}
                    </td>
                    <td className="mono">{att.sha256_hash.slice(0, 16)}...</td>
                    <td>
                      {att.blob_stored ? (
                        <a href={`/api/attachments/${att.id}/download`} target="_blank" rel="noreferrer">
                          Download JD
                        </a>
                      ) : (
                        'Not stored'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 18 }}>3. Extracted Opportunity Facts, Provenance &amp; Conflicts</h3>
          <table className="spcr-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
                <th>Source Provenance</th>
                <th>Conflicts Across Sources</th>
              </tr>
            </thead>
            <tbody>
              {(oppDetail.facts || []).map((f: any) => (
                <tr key={f.id}>
                  <td className="mono">{f.field_name}</td>
                  <td>
                    {f.field_value === 'Not specified' ? (
                      <span style={{ color: 'var(--text-muted)' }}>Not specified</span>
                    ) : (
                      <strong>{f.field_value}</strong>
                    )}
                  </td>
                  <td>
                    {f.source_label ? (
                      <span>
                        {f.source_label} — <em style={{ fontSize: 12 }}>&quot;{f.source_excerpt}&quot;</em>
                      </span>
                    ) : (
                      'Missing in sources'
                    )}
                  </td>
                  <td>
                    {(f.conflicts_json || []).length > 0 ? (
                      <span className="badge badge-danger">
                        CONFLICT:{' '}
                        {f.conflicts_json.map((c: any) => `${c.value} (${c.sourceLabel})`).join(' vs ')}
                      </span>
                    ) : (
                      'None'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="spcr-grid-2" style={{ marginTop: 18 }}>
            <div>
              <div className="spcr-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>4. Plain-Text Announcement Draft</h3>
                <button className="btn" onClick={formatWithGroq}>
                  Format Announcement with Groq
                </button>
              </div>
              <textarea
                rows={15}
                className="mono"
                style={{ width: '100%', padding: 10, border: '1px solid var(--border)' }}
                value={draftEditorText}
                onChange={(e) => setDraftEditorText(e.target.value)}
              />
              <div className="spcr-row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={saveDraftEdit}>
                  Save Manual Draft Changes
                </button>
                {oppDetail.approvals?.[0] && (
                  <span
                    className={`badge ${
                      oppDetail.approvals[0].status === 'active' ? 'badge-ok' : 'badge-danger'
                    }`}
                  >
                    [Latest Approval: {oppDetail.approvals[0].status.toUpperCase()}]
                  </span>
                )}
              </div>
            </div>

            <div>
              <h3>5. Choose WhatsApp Sections &amp; Approve Final Draft</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Selecting sections resolves to a deduplicated union of active WhatsApp groups. Approving does{' '}
                <strong>not</strong> send anything automatically — it opens the one-by-one human WhatsApp queue.
              </p>
              {(registry.sections || []).map((sec: any) => (
                <div key={sec.id} style={{ marginBottom: 6 }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedSectionIds.includes(sec.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedSectionIds([...selectedSectionIds, sec.id]);
                        else setSelectedSectionIds(selectedSectionIds.filter((x) => x !== sec.id));
                      }}
                    />{' '}
                    <strong>{sec.name}</strong> ({sec.groupIds.length} mapped groups)
                  </label>
                </div>
              ))}

              {destinationPreview && (
                <div className="notice" style={{ marginTop: 10 }}>
                  <strong>Deduplicated Destination Preview ({destinationPreview.uniqueGroupCount} unique groups):</strong>
                  {destinationPreview.destinations.length === 0 ? (
                    <div>Select at least one section above.</div>
                  ) : (
                    <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                      {destinationPreview.destinations.map((d: any) => (
                        <li key={d.groupId}>
                          <strong>{d.visibleName}</strong> — via [{d.contributingSections.join(', ')}]
                        </li>
                      ))}
                    </ul>
                  )}
                  {(destinationPreview.duplicateWarnings || []).map((w: any, idx: number) => (
                    <div key={idx} className="notice notice-warn" style={{ marginTop: 6 }}>
                      {w.message}
                    </div>
                  ))}
                </div>
              )}

              <button
                className="btn btn-primary"
                disabled={!destinationPreview || destinationPreview.uniqueGroupCount === 0}
                onClick={approveAndStartGuidedDispatch}
              >
                Approve Final Draft &amp; Open Guided WhatsApp Queue
              </button>

              {(oppDetail.dispatchBatches || []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <strong>Existing Dispatch Batches:</strong>
                  <ul style={{ paddingLeft: 18 }}>
                    {oppDetail.dispatchBatches.map((b: any) => (
                      <li key={b.id}>
                        Batch {b.id.slice(0, 12)} (v{b.opportunity_version}) — [{b.status}]{' '}
                        <button
                          className="btn"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => props.onOpenDispatchBatch(b.id)}
                        >
                          Open Queue
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {screenedMessages.length > 0 && (
        <div className="spcr-card">
          <h3>Recent Screened Emails Log (Proving Non-Candidate Body Minimization &amp; Zero Groq Calls)</h3>
          <table className="spcr-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>From</th>
                <th>Classification</th>
                <th>Body Retained?</th>
                <th>Groq Calls</th>
              </tr>
            </thead>
            <tbody>
              {screenedMessages.slice(0, 15).map((m) => (
                <tr key={m.id}>
                  <td>{m.subject}</td>
                  <td className="mono">{m.from_email}</td>
                  <td>
                    <span className="badge">[{m.classification}]</span>
                  </td>
                  <td>{m.body_retained ? 'Yes (Candidate)' : 'No (Discarded)'}</td>
                  <td className="mono">{m.groq_calls_made}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SectionsAndGroupsRegistryScreen() {
  const [data, setData] = useState<any>({ sections: [], groups: [], duplicateWarnings: [] });
  const [secName, setSecName] = useState('');
  const [secDesc, setSecDesc] = useState('');
  const [secTags, setSecTags] = useState('');
  const [grpName, setGrpName] = useState('');
  const [grpNotes, setGrpNotes] = useState('');
  const [grpLink, setGrpLink] = useState('');
  const [grpSections, setGrpSections] = useState<string[]>([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      setData(await apiFetch('/api/routing/registry'));
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/routing/sections', {
        method: 'POST',
        body: {
          name: secName,
          description: secDesc,
          eligibilityTags: secTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
      });
      setSecName('');
      setSecDesc('');
      setSecTags('');
      await load();
    } catch (e2: any) {
      setError(e2.message);
    }
  }

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/routing/groups', {
        method: 'POST',
        body: {
          visibleName: grpName,
          aliasOrNotes: grpNotes,
          unverifiedInviteLink: grpLink || undefined,
          verifiedNow: true,
          sectionIds: grpSections,
        },
      });
      setGrpName('');
      setGrpNotes('');
      setGrpLink('');
      setGrpSections([]);
      await load();
    } catch (e2: any) {
      setError(e2.message);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-danger">{error}</div>}
      {(data.duplicateWarnings || []).map((w: any, i: number) => (
        <div key={i} className="notice notice-warn">
          {w.message}
        </div>
      ))}

      <div className="spcr-grid-2">
        <div className="spcr-card">
          <h3>Create Named Section</h3>
          <form onSubmit={addSection}>
            <div className="field">
              <label htmlFor="s-name">Section Name</label>
              <input id="s-name" type="text" value={secName} onChange={(e) => setSecName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="s-desc">Description</label>
              <input id="s-desc" type="text" value={secDesc} onChange={(e) => setSecDesc(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="s-tags">Eligibility Hint Tags (comma-separated)</label>
              <input
                id="s-tags"
                type="text"
                placeholder="cse, it, 2027"
                value={secTags}
                onChange={(e) => setSecTags(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Create Section
            </button>
          </form>

          <h4 style={{ marginTop: 18 }}>Configured Sections (Deleting a section preserves its groups)</h4>
          <table className="spcr-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Groups</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(data.sections || []).map((s: any) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.description}</div>
                  </td>
                  <td>{s.groupIds.length}</td>
                  <td>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={async () => {
                        await apiFetch(`/api/routing/sections/${s.id}`, { method: 'DELETE' });
                        load();
                      }}
                    >
                      Delete Section
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="spcr-card">
          <h3>Register Manual WhatsApp Group</h3>
          <form onSubmit={addGroup}>
            <div className="field">
              <label htmlFor="g-name">Exact Officer-Confirmed Visible Group Title</label>
              <input id="g-name" type="text" value={grpName} onChange={(e) => setGrpName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="g-notes">Notes / Alias / Batch Verification Info</label>
              <input id="g-notes" type="text" value={grpNotes} onChange={(e) => setGrpNotes(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="g-link">Optional Invite Link (Labelled Unverified Convenience Only)</label>
              <input id="g-link" type="url" value={grpLink} onChange={(e) => setGrpLink(e.target.value)} />
            </div>
            <div className="field">
              <label>Map to Sections (Many-to-Many)</label>
              {(data.sections || []).map((s: any) => (
                <div key={s.id}>
                  <label style={{ fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={grpSections.includes(s.id)}
                      onChange={(e) => {
                        if (e.target.checked) setGrpSections([...grpSections, s.id]);
                        else setGrpSections(grpSections.filter((x) => x !== s.id));
                      }}
                    />{' '}
                    {s.name}
                  </label>
                </div>
              ))}
            </div>
            <button type="submit" className="btn btn-primary">
              Register WhatsApp Group
            </button>
          </form>

          <h4 style={{ marginTop: 18 }}>Registered WhatsApp Groups ({(data.groups || []).length})</h4>
          <table className="spcr-table">
            <thead>
              <tr>
                <th>Visible Group Title &amp; Notes</th>
                <th>Mapped Sections</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(data.groups || []).map((g: any) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.visible_name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.alias_or_notes}</div>
                    {g.unverified_invite_link && (
                      <div style={{ fontSize: 11 }} className="badge badge-warn">
                        [Unverified Invite Link Stored]
                      </div>
                    )}
                  </td>
                  <td>{g.sectionIds.length} section(s)</td>
                  <td>
                    <button
                      className="btn btn-danger"
                      style={{ padding: '2px 8px', fontSize: 12 }}
                      onClick={async () => {
                        if (!window.confirm(`Confirm removing WhatsApp group "${g.visible_name}" and its section mappings?`))
                          return;
                        await apiFetch(`/api/routing/groups/${g.id}?confirm=true`, { method: 'DELETE' });
                        load();
                      }}
                    >
                      Remove Group
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function GuidedWhatsAppDispatchScreen(props: { batchId: string | null }) {
  const [details, setDetails] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [error, setError] = useState('');

  async function load(id: string) {
    setError('');
    try {
      setDetails(await apiFetch(`/api/dispatch/batches/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (props.batchId) load(props.batchId);
  }, [props.batchId]);

  if (!props.batchId) {
    return (
      <div className="spcr-card">
        <h2>Guided Manual WhatsApp Dispatch Queue</h2>
        <p>Select an opportunity in the Opportunity Inbox, approve its final draft, and choose destination sections to open a guided manual dispatch batch.</p>
      </div>
    );
  }

  if (!details) return <div className="spcr-card">Loading dispatch queue...</div>;

  const currentTarget = details.nextPendingTarget;

  async function copyAnnouncement() {
    await navigator.clipboard.writeText(details.batch.approved_draft_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function recordOutcome(outcome: string) {
    if (!currentTarget) return;
    setError('');
    try {
      const updated = await apiFetch(
        `/api/dispatch/batches/${details.batch.id}/targets/${currentTarget.id}/outcome`,
        {
          method: 'POST',
          body: { outcome, officerNote: noteInput },
        }
      );
      setNoteInput('');
      setDetails(updated);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-danger">{error}</div>}
      <div className="spcr-card">
        <h2>Guided Manual WhatsApp Dispatch Queue (Batch {details.batch.id.slice(0, 12)})</h2>
        <div className="notice notice-warn">{details.manualVerificationNotice}</div>
        <p>
          <strong>Batch Status:</strong> <span className="badge">[{details.batch.status.toUpperCase()}]</span> |{' '}
          <strong>Officer Marked Sent:</strong> {details.summary.officerMarkedSent}/{details.summary.total} |{' '}
          <strong>Pending:</strong> {details.summary.pending} | <strong>Skipped:</strong> {details.summary.skipped} |{' '}
          <strong>Failed:</strong> {details.summary.failed} |{' '}
          <strong>Uncertain (Check Chat History):</strong> {details.summary.uncertainNeedsConfirmation}
        </p>

        {currentTarget ? (
          <div className="spcr-card" style={{ background: 'var(--surface)' }}>
            <h3>
              Current Destination ({currentTarget.sort_index + 1} of {details.summary.total}):{' '}
              {currentTarget.group_visible_name_snapshot}
            </h3>
            <p>
              <strong>Contributing Sections:</strong> {(currentTarget.contributing_sections_json || []).join(', ')}
            </p>
            {currentTarget.group_notes_snapshot && (
              <p>
                <strong>Verification Notes:</strong> {currentTarget.group_notes_snapshot}
              </p>
            )}
            <ol>
              <li>
                Open <a href="https://web.whatsapp.com" target="_blank" rel="noreferrer">WhatsApp Web</a> in another
                browser tab (note: opening WhatsApp does <strong>not</strong> mark anything sent).
              </li>
              <li>
                Manually search for <strong className="mono">{currentTarget.group_visible_name_snapshot}</strong> and
                verify the exact chat header and participant batch.
              </li>
              <li>
                Click <strong>Copy Announcement</strong> below, paste into WhatsApp manually, attach the JD file if
                applicable, and press <strong>Send</strong> in WhatsApp yourself.
              </li>
              <li>Record the truthful manual status below.</li>
            </ol>

            <div className="spcr-row" style={{ marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={copyAnnouncement}>
                {copied ? 'Copied Plain-Text Announcement' : 'Copy Announcement'}
              </button>
              {details.batch.jd_attachment_id && (
                <a
                  className="btn"
                  href={`/api/attachments/${details.batch.jd_attachment_id}/download`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download JD File for Manual Attach
                </a>
              )}
            </div>

            <pre
              className="mono"
              style={{
                background: '#fff',
                border: '1px solid var(--border)',
                padding: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {details.batch.approved_draft_text}
            </pre>

            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="disp-note">Optional Officer Note</label>
              <input
                id="disp-note"
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="e.g. Sent with PDF JD at 5:15 PM"
              />
            </div>

            <div className="spcr-row">
              <button className="btn btn-primary" onClick={() => recordOutcome('officer_marked_sent')}>
                Officer Marked Sent (Not Provider-Confirmed)
              </button>
              <button className="btn" onClick={() => recordOutcome('skipped')}>
                Mark Skipped
              </button>
              <button className="btn" onClick={() => recordOutcome('uncertain_needs_confirmation')}>
                Uncertain / Needs Chat History Check
              </button>
              <button className="btn btn-danger" onClick={() => recordOutcome('failed')}>
                Mark Failed
              </button>
            </div>
          </div>
        ) : (
          <div className="notice">
            All pending targets in this batch have been processed by the officer. Review any Uncertain items in
            WhatsApp chat history before manually updating them.
          </div>
        )}

        <h3>Destination Status Table</h3>
        <table className="spcr-table">
          <thead>
            <tr>
              <th>#</th>
              <th>WhatsApp Group (Snapshot)</th>
              <th>Sections</th>
              <th>Honest Manual Status</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {(details.targets || []).map((t: any) => (
              <tr key={t.id}>
                <td>{t.sort_index + 1}</td>
                <td>{t.group_visible_name_snapshot}</td>
                <td>{(t.contributing_sections_json || []).join(', ')}</td>
                <td>
                  <span
                    className={`badge ${
                      t.status === 'officer_marked_sent'
                        ? 'badge-ok'
                        : t.status === 'pending'
                          ? ''
                          : 'badge-warn'
                    }`}
                  >
                    [{t.status}]
                  </span>
                </td>
                <td>{t.officer_note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
