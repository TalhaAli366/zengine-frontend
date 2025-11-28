'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  is_default: boolean;
  created_at: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface Influencer {
  id: string;
  username: string;
  email?: string;
  followers?: number;
  display_name?: string;
  country?: string;
}

interface OutreachLog {
  id: string;
  campaign_id?: string;
  influencer_id?: string;
  channel: string;
  to_address: string;
  subject: string;
  body: string;
  sent_at: string;
  status: string;
  response_text?: string;
  raw_response?: any;
}

const TEMPLATE_PLACEHOLDERS = [
  { token: '{{username}}', description: 'TikTok handle' },
  { token: '{{display_name}}', description: 'Influencer display name' },
  { token: '{{profile_url}}', description: 'TikTok profile URL' },
  { token: '{{followers}}', description: 'Follower count' },
  { token: '{{total_likes}}', description: 'Total likes across profile' },
  { token: '{{avg_views}}', description: 'Average views (latest videos)' },
  { token: '{{engagement_rate}}', description: 'Engagement rate (%)' },
  { token: '{{campaign_name}}', description: 'Selected campaign name' },
  { token: '{{country}}', description: 'Detected country' },
] as const;

interface ZohoStatus {
  status: 'connected' | 'pending' | 'disconnected';
  from_address?: string;
  data_center?: string;
  last_connected_at?: string;
  source?: 'env' | 'db';
  can_disconnect?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function OutreachPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'send' | 'templates' | 'logs' | 'settings'>('send');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Template form
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');

  // Outreach logs
  const [outreachLogs, setOutreachLogs] = useState<OutreachLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logFilterCampaign, setLogFilterCampaign] = useState('');
  const [logFilterStatus, setLogFilterStatus] = useState('');
  const [zohoStatus, setZohoStatus] = useState<ZohoStatus | null>(null);
  const [zohoForm, setZohoForm] = useState({
    clientId: '',
    clientSecret: '',
    fromAddress: '',
    dataCenter: 'com',
  });
  const [zohoLoading, setZohoLoading] = useState(false);

  useEffect(() => {
    loadTemplates();
    loadCampaigns();
    const loadedFromSelection = loadSelectionFromStorage(false);
    if (!loadedFromSelection) {
      loadInfluencers();
    }
    loadZohoStatus();
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') {
      loadOutreachLogs();
    }
  }, [activeTab, logFilterCampaign, logFilterStatus]);

  useEffect(() => {
    const zohoParam = searchParams?.get('zoho');
    const messageParam = searchParams?.get('message');
    if (zohoParam === 'connected') {
      setMessage({ type: 'success', text: 'Zoho Mail connected successfully.' });
      loadZohoStatus();
    } else if (zohoParam === 'error') {
      setMessage({ type: 'error', text: decodeURIComponent(messageParam || 'Zoho authorization failed.') });
    }
  }, [searchParams]);

  const loadTemplates = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/outreach/templates`);
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  };

  const loadCampaigns = async () => {
    try {
      const response = await fetch('/api/campaigns');
      if (response.ok) {
        const data = await response.json();
        // The API returns array directly, not wrapped in campaigns object
        setCampaigns(Array.isArray(data) ? data : (data.campaigns || []));
        console.log('Campaigns loaded for outreach:', Array.isArray(data) ? data : (data.campaigns || []));
      }
    } catch (error) {
      console.error('Failed to load campaigns:', error);
    }
  };

  const loadSelectionFromStorage = (showMessage: boolean = true) => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('outreachSelection');
    if (!stored) {
      if (showMessage) {
        setMessage({
          type: 'info',
          text: 'No saved outreach selection found. Use the influencers page to add people.',
        });
      }
      setSelectionMode(false);
      return false;
    }

    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let removedMissingEmail = 0;
        const sanitized = parsed.filter((inf: Influencer) => {
          const valid = inf && inf.id;
          if (!valid) return false;
          if (!inf.email) {
            removedMissingEmail += 1;
            return false;
          }
          return true;
        });

        if (sanitized.length === 0) {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('outreachSelection');
          }
          if (showMessage) {
            setMessage({
              type: 'info',
              text: 'All saved influencers were missing email addresses. Please rebuild your selection from the dashboard.',
            });
          }
          setInfluencers([]);
          setSelectedInfluencers([]);
          setSelectionMode(false);
          return false;
        }

        if (removedMissingEmail > 0 && typeof window !== 'undefined') {
          window.localStorage.setItem('outreachSelection', JSON.stringify(sanitized));
        }

        setInfluencers(sanitized);
        setSelectedInfluencers(sanitized.map((inf: Influencer) => inf.id));
        setSelectionMode(true);
        if (showMessage) {
          setMessage({
            type: 'info',
            text: removedMissingEmail > 0
              ? `Loaded ${sanitized.length} influencer${sanitized.length === 1 ? '' : 's'} (removed ${removedMissingEmail} without email).`
              : `Loaded ${sanitized.length} influencer${sanitized.length === 1 ? '' : 's'} from your selection.`,
          });
        }
        return true;
      }
    } catch (error) {
      console.error('Failed to parse outreach selection from storage', error);
    }

    if (showMessage) {
      setMessage({
        type: 'error',
        text: 'Saved outreach selection is invalid. Please rebuild it from the influencers page.',
      });
    }
    setSelectionMode(false);
    return false;
  };

  const loadInfluencers = async () => {
    try {
      const response = await fetch('/api/influencers');
      if (response.ok) {
        const data = await response.json();
        // Filter influencers with emails
        const allInfluencers = Array.isArray(data) ? data : (data.influencers || []);
        const withEmails = allInfluencers.filter((inf: Influencer) => inf.email);
        setInfluencers(withEmails);
        setSelectedInfluencers([]);
        setSelectionMode(false);
      }
    } catch (error) {
      console.error('Failed to load influencers:', error);
    }
  };

  // Load influencers for specific campaign
  const deleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_URL}/api/v1/outreach/templates/${templateId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Template deleted successfully' });
        loadTemplates();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to delete template' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const createTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_URL}/api/v1/outreach/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName,
          subject: templateSubject,
          body: templateBody,
          is_default: false
        })
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Template created successfully!' });
        setTemplateName('');
        setTemplateSubject('');
        setTemplateBody('');
        loadTemplates();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to create template' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const sendBulkEmails = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_URL}/api/v1/outreach/send-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: selectedTemplate,
          influencer_ids: selectedInfluencers,
          custom_variables: {}
        })
      });

      if (response.ok) {
        const data = await response.json();
        setMessage({
          type: 'success',
          text: `Sending emails to ${data.total_recipients} influencers...`
        });
        setSelectedInfluencers([]);
        // Refresh logs after sending (with a small delay to allow backend to process)
        setTimeout(() => {
          if (activeTab === 'logs') {
            loadOutreachLogs();
          }
        }, 2000);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to send emails' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const toggleInfluencerSelection = (influencerId: string) => {
    setSelectedInfluencers(prev =>
      prev.includes(influencerId)
        ? prev.filter(id => id !== influencerId)
        : [...prev, influencerId]
    );
  };

  const selectAllInfluencers = () => {
    if (selectedInfluencers.length === influencers.length) {
      setSelectedInfluencers([]);
    } else {
      setSelectedInfluencers(influencers.map(inf => inf.id));
    }
  };

  const handleReloadSelection = () => {
    const loaded = loadSelectionFromStorage();
    if (!loaded) {
      setInfluencers([]);
    }
  };

  const handleClearOutreachSelection = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('outreachSelection');
    }
    setSelectionMode(false);
    setInfluencers([]);
    setSelectedInfluencers([]);
    setMessage({
      type: 'info',
      text: 'Cleared outreach selection. Use the influencers page to add a new group.',
    });
  };

  const loadOutreachLogs = async () => {
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      if (logFilterCampaign) params.append('campaign_id', logFilterCampaign);
      if (logFilterStatus) params.append('status', logFilterStatus);
      params.append('limit', '100');

      const response = await fetch(`${API_URL}/api/v1/outreach/logs?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setOutreachLogs(data.logs || []);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to load outreach logs' });
      }
    } catch (error) {
      console.error('Failed to load outreach logs:', error);
      setMessage({ type: 'error', text: 'Failed to load outreach logs' });
    } finally {
      setLoadingLogs(false);
    }
  };

  const loadZohoStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/outreach/zoho/status`);
      if (!response.ok) {
        throw new Error('Failed to load Zoho status');
      }
      const data = await response.json();
      setZohoStatus({
        status: data.status || 'disconnected',
        from_address: data.from_address,
        data_center: data.data_center,
        last_connected_at: data.last_connected_at,
        source: data.source,
        can_disconnect: data.can_disconnect,
      });
    } catch (error) {
      console.error('Failed to load Zoho status:', error);
    }
  };

  const handleZohoSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setZohoLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/api/v1/outreach/zoho/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: zohoForm.clientId,
          client_secret: zohoForm.clientSecret,
          from_address: zohoForm.fromAddress,
          data_center: zohoForm.dataCenter,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to initiate Zoho authorization');
      }
      if (data.authorize_url) {
        window.location.href = data.authorize_url;
      } else {
        throw new Error('Authorization URL missing in response');
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to start Zoho authorization' });
      setZohoLoading(false);
    }
  };

  const handleZohoDisconnect = async () => {
    setZohoLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/api/v1/outreach/zoho/disconnect`, {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to disconnect Zoho');
      }
      setMessage({ type: 'success', text: 'Zoho integration disconnected.' });
      await loadZohoStatus();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to disconnect Zoho' });
    } finally {
      setZohoLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      sent: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      pending: 'bg-yellow-100 text-yellow-800',
      delivered: 'bg-blue-100 text-blue-800',
      bounced: 'bg-orange-100 text-orange-800',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status?.toUpperCase() || 'UNKNOWN'}
      </span>
    );
  };

  const getCampaignName = (campaignId?: string) => {
    if (!campaignId) return '-';
    const campaign = campaigns.find(c => c.id === campaignId);
    return campaign ? campaign.name : 'Unknown Campaign';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Outreach Management</h1>
          <p className="text-gray-600 mt-2">Send bulk emails to influencers and manage templates</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
            message.type === 'info' ? 'bg-blue-50 text-blue-800 border border-blue-200' :
              'bg-red-50 text-red-800 border border-red-200'
            }`}>
            {message.text}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md mb-8">
          <div className="border-b border-gray-200">
            <div className="flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('send')}
                className={`py-4 px-4 font-medium border-b-2 transition-colors ${activeTab === 'send'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Send Emails
              </button>
              <button
                onClick={() => setActiveTab('templates')}
                className={`py-4 px-4 font-medium border-b-2 transition-colors ${activeTab === 'templates'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Email Templates
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`py-4 px-4 font-medium border-b-2 transition-colors ${activeTab === 'logs'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Outreach Logs
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`py-4 px-4 font-medium border-b-2 transition-colors ${activeTab === 'settings'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                Email Settings
              </button>
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'send' && (
              <form onSubmit={sendBulkEmails} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Template
                  </label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  >
                    <option value="">Select a template</option>
                    {templates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex flex-wrap justify-between items-center gap-3 mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Select Influencers ({selectedInfluencers.length} selected)
                    </label>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <button
                        type="button"
                        onClick={selectAllInfluencers}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        {selectedInfluencers.length === influencers.length ? 'Deselect All' : 'Select All'}
                      </button>
                      <button
                        type="button"
                        onClick={handleReloadSelection}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        Reload Selection
                      </button>
                      <button
                        type="button"
                        onClick={handleClearOutreachSelection}
                        className="text-red-600 hover:text-red-700"
                      >
                        Clear Outreach Selection
                      </button>
                    </div>
                  </div>
                  {selectionMode && influencers.length > 0 && (
                    <p className="text-xs text-blue-600 mb-2">
                      Showing influencers you sent from the dashboard list. Use "Clear Outreach Selection" to start over.
                    </p>
                  )}

                  <div className="border border-gray-300 rounded-lg max-h-96 overflow-y-auto">
                    {influencers.length === 0 ? (
                      <div className="p-4 text-center text-gray-500">
                        No influencers with email addresses found
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200">
                        {influencers.map(influencer => (
                          <label
                            key={influencer.id}
                            className="flex items-center p-4 hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedInfluencers.includes(influencer.id)}
                              onChange={() => toggleInfluencerSelection(influencer.id)}
                              className="mr-3 h-4 w-4 text-blue-600"
                            />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900">
                                @{influencer.username}
                              </p>
                              <p className="text-xs text-gray-500">{influencer.email}</p>
                            </div>
                            <span className="text-sm text-gray-500">
                              {influencer.followers ? influencer.followers.toLocaleString() : 'N/A'} followers
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || selectedInfluencers.length === 0}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Sending...' : `Send to ${selectedInfluencers.length} Influencer(s)`}
                </button>
              </form>
            )}

            {activeTab === 'templates' && (
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Template</h3>
                  <form onSubmit={createTemplate} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Template Name
                      </label>
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder="Summer Campaign Outreach"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Subject (supports placeholders below)
                      </label>
                      <input
                        type="text"
                        value={templateSubject}
                        onChange={(e) => setTemplateSubject(e.target.value)}
                        placeholder="Collaboration Opportunity - {{campaign_name}}"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email Body (HTML supported)
                      </label>
                      <textarea
                        value={templateBody}
                        onChange={(e) => setTemplateBody(e.target.value)}
                        placeholder="Hi {{display_name}},&#10;&#10;We'd love to collaborate with you on our {{campaign_name}} campaign. Based on your {{avg_views}} average views and {{engagement_rate}}% engagement..."
                        rows={8}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        required
                      />
                      <div className="mt-3 text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50">
                        <p className="font-semibold text-gray-700">Available placeholders</p>
                        <p>We automatically fill these per influencer:</p>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                          {TEMPLATE_PLACEHOLDERS.map(({ token, description }) => (
                            <div key={token} className="flex items-start gap-2">
                              <code className="bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-800">{token}</code>
                              <span className="text-gray-600">{description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {loading ? 'Creating...' : 'Create Template'}
                    </button>
                  </form>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Existing Templates</h3>
                  {templates.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No templates yet</p>
                  ) : (
                    <div className="space-y-4">
                      {templates.map(template => (
                        <div key={template.id} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900">{template.name}</h4>
                              <p className="text-sm text-gray-600 mt-1">
                                <strong>Subject:</strong> {template.subject}
                              </p>
                              <p className="text-sm text-gray-500 mt-2 truncate">
                                {template.body.substring(0, 100)}...
                              </p>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              {template.is_default && (
                                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                                  Default
                                </span>
                              )}
                              <button
                                onClick={() => deleteTemplate(template.id)}
                                className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                                title="Delete template"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="space-y-6">
                {/* Filters */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">Filter Logs</h3>
                    <button
                      onClick={loadOutreachLogs}
                      disabled={loadingLogs}
                      className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      <svg className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Campaign
                      </label>
                      <select
                        value={logFilterCampaign}
                        onChange={(e) => setLogFilterCampaign(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      >
                        <option value="">All Campaigns</option>
                        {campaigns.map(campaign => (
                          <option key={campaign.id} value={campaign.id}>
                            {campaign.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Status
                      </label>
                      <select
                        value={logFilterStatus}
                        onChange={(e) => setLogFilterStatus(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      >
                        <option value="">All Statuses</option>
                        <option value="sent">Sent</option>
                        <option value="failed">Failed</option>
                        <option value="pending">Pending</option>
                        <option value="delivered">Delivered</option>
                        <option value="bounced">Bounced</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Logs Table */}
                {loadingLogs ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : outreachLogs.length > 0 ? (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Campaign</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Recipient</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Subject</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Sent At</th>
                            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Channel</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {outreachLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {getCampaignName(log.campaign_id)}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {log.to_address || '-'}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate" title={log.subject}>
                                {log.subject || '-'}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                {getStatusBadge(log.status)}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-500">
                                {log.sent_at ? new Date(log.sent_at).toLocaleString() : '-'}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {log.channel || 'email'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                      <p className="text-sm text-gray-600">
                        Showing {outreachLogs.length} log{outreachLogs.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                    <p className="text-gray-500 mb-2">No outreach logs found</p>
                    <p className="text-sm text-gray-400">
                      {logFilterCampaign || logFilterStatus
                        ? 'Try adjusting your filters'
                        : 'Send emails to see logs here'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-8">
                <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Zoho Mail Integration</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Connect your Zoho Mail account to send outreach emails directly from your Zoho mailbox.
                  </p>
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Status</p>
                      <p className="text-lg font-semibold text-gray-900 capitalize">
                        {zohoStatus?.status || 'disconnected'}
                      </p>
                      {zohoStatus?.from_address && (
                        <p className="text-sm text-gray-600 mt-1">
                          From:{' '}
                          <span className="font-medium">
                            {zohoStatus.from_address}
                          </span>
                        </p>
                      )}
                      {zohoStatus?.last_connected_at && (
                        <p className="text-xs text-gray-500 mt-1">
                          Last connected: {new Date(zohoStatus.last_connected_at).toLocaleString()}
                        </p>
                      )}
                      {zohoStatus?.source === 'env' && (
                        <p className="text-xs text-yellow-700 mt-2">
                          This integration is managed via environment variables.
                        </p>
                      )}
                    </div>
                    {zohoStatus?.status === 'connected' && zohoStatus?.can_disconnect && (
                      <button
                        onClick={handleZohoDisconnect}
                        disabled={zohoLoading}
                        className="px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                      >
                        {zohoLoading ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    )}
                  </div>
                </div>

                {zohoStatus?.source !== 'env' && (
                  <form onSubmit={handleZohoSetup} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Zoho Client ID
                        </label>
                        <input
                          type="text"
                          value={zohoForm.clientId}
                          onChange={(e) => setZohoForm((prev) => ({ ...prev, clientId: e.target.value }))}
                          required
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                          placeholder="1000.xxxxxx"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Zoho Client Secret
                        </label>
                        <input
                          type="password"
                          value={zohoForm.clientSecret}
                          onChange={(e) => setZohoForm((prev) => ({ ...prev, clientSecret: e.target.value }))}
                          required
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                          placeholder="Secret token"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          From Email Address
                        </label>
                        <input
                          type="email"
                          value={zohoForm.fromAddress}
                          onChange={(e) => setZohoForm((prev) => ({ ...prev, fromAddress: e.target.value }))}
                          required
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                          placeholder="you@yourdomain.com"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Data Center
                        </label>
                        <select
                          value={zohoForm.dataCenter}
                          onChange={(e) => setZohoForm((prev) => ({ ...prev, dataCenter: e.target.value }))}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        >
                          <option value="com">United States (.com)</option>
                          <option value="eu">Europe (.eu)</option>
                          <option value="in">India (.in)</option>
                          <option value="cn">China (.cn)</option>
                          <option value="au">Australia (.au)</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500">
                      After clicking connect you&apos;ll be redirected to Zoho to approve access. Make sure the selected mailbox matches the from address above.
                    </p>
                    <button
                      type="submit"
                      disabled={zohoLoading}
                      className="inline-flex items-center px-6 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      {zohoLoading ? 'Opening Zoho...' : 'Connect Zoho Mail'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

