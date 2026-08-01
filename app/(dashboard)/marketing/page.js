'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Send, Calendar, Eye, Users, MousePointerClick, Mail, MessageSquare, Smartphone, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, Download, ChevronDown } from 'lucide-react';
import { getCampaigns, createCampaign } from '@/app/actions/campaigns';
import { bulkImportContacts } from '@/app/actions/contacts';
import Modal from '@/components/Modal';

const channelOptions = ['WhatsApp', 'Email', 'SMS'];

const channelIcons = { WhatsApp: MessageSquare, Email: Mail, SMS: Smartphone };
const channelColors = {
  WhatsApp: 'text-success bg-success-light',
  Email: 'text-info bg-info-light',
  SMS: 'text-purple bg-purple-light',
};
const statusColors = {
  Draft: 'bg-surface-hover text-muted border border-border',
  Scheduled: 'bg-info-light text-info',
  Sent: 'bg-success-light text-success',
};

// Expected columns for bulk import (flexible mapping)
const COLUMN_ALIASES = {
  name: ['name', 'full name', 'customer name', 'contact name', 'naam'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'contact', 'number', 'mob', 'ph'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  address: ['address', 'addr', 'locality', 'area'],
  city: ['city', 'town', 'district', 'location'],
  source: ['source', 'lead source', 'channel'],
  notes: ['notes', 'note', 'remarks', 'comment'],
};

function mapColumns(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const lower = h.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(lower) && !(field in map)) {
        map[field] = i;
      }
    }
  });
  return map;
}

export default function MarketingPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', channel: 'WhatsApp', audience: '', template: '', scheduledDate: '', saveAsDraft: false });
  // Bulk import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importHeaders, setImportHeaders] = useState([]);
  const [importColMap, setImportColMap] = useState({});
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);

  const refresh = async () => {
    const res = await getCampaigns();
    if (res.success) setCampaigns(res.data);
  };

  useEffect(() => {
    getCampaigns().then(res => {
      if (res.success) setCampaigns(res.data);
      setLoading(false);
    });
  }, []);

  const totalSent = campaigns.reduce((s, c) => s + c.sent, 0);
  const totalOpened = campaigns.reduce((s, c) => s + c.opened, 0);
  const totalClicked = campaigns.reduce((s, c) => s + c.clicked, 0);

  const handleCreate = async (saveAsDraft) => {
    if (!form.name || !form.template) return;
    setSubmitting(true);
    try {
      const res = await createCampaign({
        name: form.name,
        channel: form.channel,
        audience: form.audience ? parseInt(form.audience) : 0,
        template: form.template,
        scheduledDate: form.scheduledDate || undefined,
      });
      if (res.success) {
        setShowCreateModal(false);
        setForm({ name: '', channel: 'WhatsApp', audience: '', template: '', scheduledDate: '' });
        await refresh();
      } else {
        alert(res.error || 'Failed to create campaign');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportResult(null);
    setImportRows([]);
    setImportHeaders([]);

    try {
      const XLSX = (await import('xlsx')).default;
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (rawData.length < 2) {
        setImportError('File is empty or has no data rows');
        return;
      }

      const headers = rawData[0].map(h => String(h));
      const rows = rawData.slice(1).filter(row => row.some(cell => String(cell).trim()));
      const colMap = mapColumns(headers);

      if (!('name' in colMap) && !('phone' in colMap)) {
        setImportError('Could not find "Name" or "Phone" columns. Please check your file headers.');
        return;
      }

      setImportHeaders(headers);
      setImportRows(rows);
      setImportColMap(colMap);
    } catch (err) {
      setImportError('Failed to parse file. Please use .xlsx, .xls, or .csv format.');
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImportSubmit = async () => {
    if (importRows.length === 0) return;
    setImportLoading(true);
    setImportError('');
    try {
      const contacts = importRows.map(row => ({
        name: String(row[importColMap.name] ?? '').trim(),
        phone: String(row[importColMap.phone] ?? '').trim(),
        email: importColMap.email !== undefined ? String(row[importColMap.email] ?? '').trim() || undefined : undefined,
        address: importColMap.address !== undefined ? String(row[importColMap.address] ?? '').trim() || undefined : undefined,
        city: importColMap.city !== undefined ? String(row[importColMap.city] ?? '').trim() || undefined : undefined,
        source: importColMap.source !== undefined ? String(row[importColMap.source] ?? '').trim() || undefined : undefined,
        notes: importColMap.notes !== undefined ? String(row[importColMap.notes] ?? '').trim() || undefined : undefined,
      })).filter(c => c.name || c.phone);

      const res = await bulkImportContacts(contacts);
      if (res.success) {
        setImportResult(res.data);
        setImportRows([]);
        setImportHeaders([]);
      } else {
        setImportError(res.error || 'Import failed');
      }
    } catch {
      setImportError('Import failed. Please try again.');
    }
    setImportLoading(false);
  };

  const downloadTemplate = () => {
    const csv = 'Name,Phone,Email,Address,City,Source,Notes\nAhmed Khan,+971501234567,ahmed@example.com,"Dubai Marina","Dubai","Walk-in","VIP customer"';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-surface rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="h-20 bg-surface rounded-2xl" />)}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">{[1,2,3].map(i => <div key={i} className="h-48 bg-surface rounded-2xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-[fade-in_0.5s_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Marketing & Campaigns</h1>
          <p className="text-sm text-muted mt-1">{campaigns.length} campaigns · {totalSent.toLocaleString()} messages sent</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowImportModal(true); setImportRows([]); setImportHeaders([]); setImportResult(null); setImportError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-surface border border-border hover:border-accent/30 text-foreground rounded-xl text-sm font-semibold transition-all">
            <Upload className="w-4 h-4" /> Import Contacts
          </button>
          <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all">
            <Plus className="w-4 h-4" /> Create Campaign
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-accent-light"><Send className="w-5 h-5 text-accent" /></div>
          <div><p className="text-xs text-muted">Total Sent</p><p className="text-lg font-bold text-foreground">{totalSent.toLocaleString()}</p></div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-info-light"><Eye className="w-5 h-5 text-info" /></div>
          <div><p className="text-xs text-muted">Total Opened</p><p className="text-lg font-bold text-foreground">{totalOpened.toLocaleString()}</p></div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-success-light"><MousePointerClick className="w-5 h-5 text-success" /></div>
          <div><p className="text-xs text-muted">Total Clicked</p><p className="text-lg font-bold text-foreground">{totalClicked.toLocaleString()}</p></div>
        </div>
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-light"><Users className="w-5 h-5 text-purple" /></div>
          <div><p className="text-xs text-muted">Avg Open Rate</p><p className="text-lg font-bold text-foreground">{totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0}%</p></div>
        </div>
      </div>

      {/* Campaign Cards */}
      {campaigns.length === 0 ? (
        <div className="glass-card py-16 text-center text-muted">
          <Send className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first campaign to reach customers</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {campaigns.map(campaign => {
            const ChannelIcon = channelIcons[campaign.channel];
            const openRate = campaign.sent > 0 ? Math.round((campaign.opened / campaign.sent) * 100) : 0;
            const clickRate = campaign.sent > 0 ? Math.round((campaign.clicked / campaign.sent) * 100) : 0;
            return (
              <div key={campaign.id} onClick={() => setSelectedCampaign(campaign)}
                className="glass-card overflow-hidden hover:scale-[1.01] transition-transform cursor-pointer">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-foreground mb-1">{campaign.name}</h3>
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${channelColors[campaign.channel]}`}>
                          <ChannelIcon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs text-muted">{campaign.channel}</span>
                        <span className={`badge text-[10px] ${statusColors[campaign.status]}`}>{campaign.status}</span>
                      </div>
                    </div>
                  </div>
                  {campaign.scheduledDate && (
                    <div className="flex items-center gap-1.5 text-xs text-muted mb-3">
                      <Calendar className="w-3.5 h-3.5" />
                      {campaign.status === 'Sent' ? 'Sent on' : 'Scheduled for'} {campaign.scheduledDate}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-muted mb-4">
                    <Users className="w-3.5 h-3.5" />{campaign.audience.toLocaleString()} audience
                  </div>
                  {campaign.sent > 0 ? (
                    <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                      <div className="text-center"><p className="text-xs text-muted">Sent</p><p className="text-sm font-bold text-foreground">{campaign.sent.toLocaleString()}</p></div>
                      <div className="text-center"><p className="text-xs text-muted">Opened</p><p className="text-sm font-bold text-info">{openRate}%</p></div>
                      <div className="text-center"><p className="text-xs text-muted">Clicked</p><p className="text-sm font-bold text-success">{clickRate}%</p></div>
                    </div>
                  ) : (
                    <div className="pt-3 border-t border-border">
                      <p className="text-xs text-muted text-center">Not yet sent</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Campaign Detail Modal */}
      <Modal isOpen={!!selectedCampaign} onClose={() => setSelectedCampaign(null)} title="Campaign Details" size="lg">
        {selectedCampaign && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">{selectedCampaign.name}</h3>
              <span className={`badge ${statusColors[selectedCampaign.status]}`}>{selectedCampaign.status}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-surface text-center"><p className="text-xs text-muted">Channel</p><p className="text-sm font-medium text-foreground">{selectedCampaign.channel}</p></div>
              <div className="p-3 rounded-xl bg-surface text-center"><p className="text-xs text-muted">Audience</p><p className="text-sm font-medium text-foreground">{selectedCampaign.audience.toLocaleString()}</p></div>
              <div className="p-3 rounded-xl bg-surface text-center"><p className="text-xs text-muted">Sent</p><p className="text-sm font-medium text-foreground">{selectedCampaign.sent.toLocaleString()}</p></div>
              <div className="p-3 rounded-xl bg-surface text-center"><p className="text-xs text-muted">Opened</p><p className="text-sm font-medium text-foreground">{selectedCampaign.opened.toLocaleString()}</p></div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted mb-2">Message Template</p>
              <div className="p-4 rounded-xl bg-surface border border-border">
                <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">{selectedCampaign.template}</pre>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk Import Contacts Modal */}
      <Modal isOpen={showImportModal} onClose={() => setShowImportModal(false)} title="Import Contacts from Excel / CSV" size="lg">
        <div className="space-y-4">
          {/* Instructions */}
          <div className="flex items-start gap-3 p-3 bg-info-light/30 border border-info/20 rounded-xl">
            <FileSpreadsheet className="w-4 h-4 text-info mt-0.5 flex-shrink-0" />
            <div className="text-xs text-muted">
              <p className="font-medium text-foreground mb-1">Supported formats: .xlsx, .xls, .csv, Google Sheets (export as CSV/Excel)</p>
              <p>Required columns: <strong>Name</strong>, <strong>Phone</strong>. Optional: Email, Address, City, Source, Notes</p>
            </div>
          </div>

          {/* Download Template */}
          <button onClick={downloadTemplate}
            className="flex items-center gap-2 text-xs text-accent hover:underline">
            <Download className="w-3.5 h-3.5" /> Download sample template
          </button>

          {/* File Input */}
          {!importResult && (
            <div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border hover:border-accent/40 rounded-xl p-8 text-center transition-colors group">
                <Upload className="w-8 h-8 text-muted group-hover:text-accent mx-auto mb-2 transition-colors" />
                <p className="text-sm font-medium text-foreground">Click to upload file</p>
                <p className="text-xs text-muted mt-1">.xlsx, .xls, or .csv</p>
              </button>
            </div>
          )}

          {/* Error */}
          {importError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {importError}
            </div>
          )}

          {/* Success Result */}
          {importResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-4 bg-success-light border border-success/20 rounded-xl">
                <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-success">Import successful!</p>
                  <p className="text-xs text-muted">{importResult.created} contacts added · {importResult.skipped} skipped (already exist)</p>
                </div>
              </div>
              <button onClick={() => { setShowImportModal(false); setImportResult(null); }}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all">
                Done
              </button>
            </div>
          )}

          {/* Preview Table */}
          {importRows.length > 0 && !importResult && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">{importRows.length} rows found</p>
                <button onClick={() => { setImportRows([]); setImportHeaders([]); }} className="text-xs text-muted hover:text-foreground">Clear</button>
              </div>

              {/* Column mapping info */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(importColMap).map(([field, idx]) => (
                  <span key={field} className="px-2 py-1 bg-accent/10 text-accent text-[11px] rounded-lg font-medium">
                    {field} → &quot;{importHeaders[idx]}&quot;
                  </span>
                ))}
                {!('name' in importColMap) && (
                  <span className="px-2 py-1 bg-red-500/10 text-red-700 text-[11px] rounded-lg font-medium">⚠ No &quot;Name&quot; column</span>
                )}
                {!('phone' in importColMap) && (
                  <span className="px-2 py-1 bg-red-500/10 text-red-700 text-[11px] rounded-lg font-medium">⚠ No &quot;Phone&quot; column</span>
                )}
              </div>

              {/* Preview rows */}
              <div className="max-h-48 overflow-y-auto border border-border rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-surface sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted">#</th>
                      {importHeaders.slice(0, 6).map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-muted truncate max-w-[100px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-t border-border hover:bg-surface-hover">
                        <td className="px-3 py-2 text-muted">{i + 1}</td>
                        {row.slice(0, 6).map((cell, j) => (
                          <td key={j} className="px-3 py-2 truncate max-w-[120px] text-foreground">{String(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importRows.length > 10 && (
                  <p className="text-center text-xs text-muted py-2 border-t border-border">+{importRows.length - 10} more rows</p>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={handleImportSubmit} disabled={importLoading || !('name' in importColMap) || !('phone' in importColMap)}
                  className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {importLoading ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Importing...</> : <><Upload className="w-4 h-4" /> Import {importRows.length} Contacts</>}
                </button>
                <button onClick={() => setShowImportModal(false)}
                  className="px-4 py-2.5 text-sm text-muted hover:text-foreground hover:bg-surface rounded-xl transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Create Campaign Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Campaign">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Campaign Name *</label>
            <input type="text" placeholder="e.g., Diwali Mega Sale 🪔" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-accent/50" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Channel</label>
              <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-accent/50">
                {channelOptions.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Audience Size</label>
              <input type="number" min="0" placeholder="0" value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Schedule Date (optional)</label>
            <input type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
              className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:border-accent/50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Message Template *</label>
            <textarea rows={6} placeholder="Write your campaign message..." value={form.template} onChange={e => setForm(f => ({ ...f, template: e.target.value }))}
              className="w-full px-4 py-2.5 bg-surface border border-border rounded-xl text-sm resize-none focus:outline-none focus:border-accent/50" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCreateModal(false)}
              className="px-4 py-2.5 rounded-xl text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors">Cancel</button>
            <button onClick={() => handleCreate(true)} disabled={submitting || !form.name || !form.template}
              className="px-5 py-2.5 border border-border rounded-xl text-sm font-medium text-foreground hover:bg-surface-hover transition-colors disabled:opacity-50">
              Save as Draft
            </button>
            <button onClick={() => handleCreate(false)} disabled={submitting || !form.name || !form.template}
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50">
              {submitting ? 'Saving...' : 'Schedule'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
