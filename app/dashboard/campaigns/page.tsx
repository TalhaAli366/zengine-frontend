'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Calendar, Users, TrendingUp, Loader2, MessageSquare, Trash2, AlertTriangle } from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
  created_at?: string;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ campaign: Campaign | null; show: boolean }>({ campaign: null, show: false });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    try {
      const response = await fetch('/api/campaigns');
      if (!response.ok) throw new Error('Failed to load');
      const data = await response.json();
      setCampaigns(data);
    } catch (err) {
      console.error('Error loading campaigns:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) return;

    setCreating(true);
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCampaignName,
          status: 'draft',
        }),
      });

      if (!response.ok) throw new Error('Failed to create');
      const newCampaign = await response.json();
      setCampaigns([newCampaign, ...campaigns]);
      setNewCampaignName('');
      setShowNewCampaign(false);
    } catch (err) {
      console.error('Error creating campaign:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCampaign = async (deleteInfluencers: boolean) => {
    if (!deleteConfirm.campaign) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/campaigns?id=${deleteConfirm.campaign.id}&delete_influencers=${deleteInfluencers}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete');
      }

      // Reload campaigns to ensure UI is in sync with database
      await loadCampaigns();
      setDeleteConfirm({ campaign: null, show: false });
    } catch (err: any) {
      alert(err.message || 'Failed to delete campaign');
      console.error('Error deleting campaign:', err);
    } finally {
      setDeleting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'closed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Campaigns</h1>
          <p className="text-gray-600">Create and manage your influencer marketing campaigns</p>
        </div>
        <button
          onClick={() => setShowNewCampaign(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Campaign
        </button>
      </div>

      {/* New Campaign Form */}
      {showNewCampaign && (
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Campaign</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={newCampaignName}
              onChange={(e) => setNewCampaignName(e.target.value)}
              placeholder="Campaign name (e.g., Summer Vibes - July 2025)"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-400"
            />
            <button
              onClick={handleCreateCampaign}
              disabled={creating || !newCampaignName.trim()}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create'}
            </button>
            <button
              onClick={() => setShowNewCampaign(false)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Campaigns Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : campaigns.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{campaign.name}</h3>
                  <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(campaign.status)}`}>
                    {campaign.status?.charAt(0).toUpperCase() + campaign.status?.slice(1)}
                  </span>
                </div>
                <button
                  onClick={() => setDeleteConfirm({ campaign, show: true })}
                  className="ml-2 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Delete campaign"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 mb-4">
                {campaign.created_at && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    {new Date(campaign.created_at).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => router.push(`/dashboard/influencers?campaign=${campaign.id}`)}
                  className="flex-1 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors"
                >
                  View Influencers
                </button>
                <button 
                  onClick={() => router.push(`/dashboard/outreach?campaign=${campaign.id}`)}
                  className="flex-1 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium transition-colors"
                >
                  Start Outreach
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-gray-200">
          <MessageSquare className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500 mb-2">No campaigns yet</p>
          <p className="text-sm text-gray-400 mb-6">Create your first campaign to start reaching out to influencers</p>
          <button
            onClick={() => setShowNewCampaign(true)}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Create First Campaign
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.show && deleteConfirm.campaign && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Campaign</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to delete <strong>"{deleteConfirm.campaign.name}"</strong>?
                </p>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-yellow-800 font-medium mb-2">⚠️ What happens to influencers?</p>
                  <p className="text-xs text-yellow-700">
                    This campaign may have influencers associated with it. Choose an option below:
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handleDeleteCampaign(true)}
                disabled={deleting}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete Campaign & All Influencers
                  </>
                )}
              </button>
              <button
                onClick={() => handleDeleteCampaign(false)}
                disabled={deleting}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? 'Deleting...' : 'Delete Campaign Only (Keep Influencers)'}
              </button>
              <button
                onClick={() => setDeleteConfirm({ campaign: null, show: false })}
                disabled={deleting}
                className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

