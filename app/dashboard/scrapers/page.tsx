'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Music, Settings, RefreshCw, Hash, StopCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface ScraperRun {
  id: string;
  campaign_id?: string;
  scraper_type: string;
  input_data: any;
  status: string;
  started_at: string;
  completed_at?: string;
  total_results: number;
  new_influencers: number;
  updated_influencers: number;
  error_message?: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
}

export default function ScrapersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'hashtag' | 'sound' | 'runs'>('hashtag');
  const [hashtags, setHashtags] = useState('');
  const [soundUrls, setSoundUrls] = useState('');
  const [maxResults, setMaxResults] = useState(20000);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [scraperRuns, setScraperRuns] = useState<ScraperRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [hasRunningScrapers, setHasRunningScrapers] = useState(false);
  const [activeRun, setActiveRun] = useState<ScraperRun | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true); // Start as true to disable buttons during initial check
  const [isForceStopping, setIsForceStopping] = useState(false);
  const storageKey = 'activeScraperRun';
  const isRunningScraper = hasRunningScrapers || Boolean(activeRun);
  // Only mark as resolved if we've loaded the status OR if we're not currently checking
  const statusResolved = statusLoaded && !isCheckingStatus;

  const loadCampaigns = async () => {
    try {
      const response = await fetch('/api/campaigns');
      if (response.ok) {
        const data = await response.json();
        // The API returns array directly, not wrapped in campaigns object
        setCampaigns(Array.isArray(data) ? data : (data.campaigns || []));
        console.log('Campaigns loaded:', Array.isArray(data) ? data : (data.campaigns || []));
      }
    } catch (error) {
      console.error('Failed to load campaigns:', error);
    }
  };

  // Force stop a running scraper
  const forceStopRun = async (runId: string) => {
    if (!confirm('Are you sure you want to force stop this scraper run? This will mark it as stopped and allow you to start a new run.')) {
      return;
    }
    
    setIsForceStopping(true);
    try {
      const response = await fetch(`${API_URL}/api/v1/scrapers/runs/${runId}/force-stop`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to stop scraper run');
      }
      
      setMessage({ type: 'success', text: 'Scraper run stopped successfully. You can now start a new run.' });
      setActiveRun(null);
      setHasRunningScrapers(false);
      persistActiveRun(null);
      
      // Refresh the runs list
      await checkRunningScrapers();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to stop scraper run' });
    } finally {
      setIsForceStopping(false);
    }
  };

  // Check if any scraper is currently running
  const checkRunningScrapers = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_URL}/api/v1/scrapers/runs?limit=50`);
      if (response.ok) {
        const data = await response.json();
        const runs = data.runs || [];

        // Check if any scrapers are running or pending
        const runningRun = runs.find((run: ScraperRun) =>
          run.status === 'running' || run.status === 'pending'
        );
        const hasRunning = Boolean(runningRun);

        // Also update the runs list for history tab
        setScraperRuns(runs);
        setHasRunningScrapers(hasRunning);
        setActiveRun(runningRun || null);
        persistActiveRun(runningRun || null);
        setLastChecked(new Date().toISOString());
        setStatusLoaded(true);
        setIsCheckingStatus(false); // Mark checking as complete

        return hasRunning;
      }
      setActiveRun(null);
      setHasRunningScrapers(false);
      persistActiveRun(null);
      setStatusLoaded(true);
      setIsCheckingStatus(false); // Mark checking as complete
      return false;
    } catch (error) {
      console.error('Failed to check running scrapers:', error);
      setActiveRun(null);
      setHasRunningScrapers(false);
      persistActiveRun(null);
      setStatusLoaded(true);
      setIsCheckingStatus(false); // Mark checking as complete
      return false;
    }
  }, []);

  // Load scraper runs for history tab
  const loadScraperRuns = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/scrapers/runs?limit=50`);
      if (response.ok) {
        const data = await response.json();
        const runs = data.runs || [];
        setScraperRuns(runs);
        const runningRun = runs.find((run: ScraperRun) => run.status === 'running' || run.status === 'pending');
        setActiveRun(runningRun || null);
        setHasRunningScrapers(Boolean(runningRun));
        persistActiveRun(runningRun || null);
      }
    } catch (error) {
      console.error('Failed to load scraper runs:', error);
    }
  };

  // Load campaigns on mount
  useEffect(() => {
    loadCampaigns();
  }, []);

  // Keep running status in sync even when user navigates away/returns
  useEffect(() => {
    checkRunningScrapers();
    const interval = setInterval(() => {
      checkRunningScrapers();
    }, 15000);

    return () => clearInterval(interval);
  }, [checkRunningScrapers]);

  const startHashtagScraper = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCampaign) {
      setMessage({ type: 'error', text: 'Please select a campaign before starting the scraper.' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      // First, check if any scraper is already running
      const isRunning = await checkRunningScrapers();

      if (isRunning) {
        setMessage({
          type: 'error',
          text: 'Another scraper is already in progress. Please wait for it to complete before starting a new one.'
        });
        setLoading(false);
        return;
      }

      // If no scraper is running, proceed to start
      const hashtagList = hashtags.split(',').map(h => h.trim()).filter(h => h);

      const response = await fetch(`${API_URL}/api/v1/scrapers/hashtag/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hashtags: hashtagList,
          max_results: maxResults,
          campaign_id: selectedCampaign
        })
      });

      if (response.ok) {
        const data = await response.json();
        const placeholderRun: ScraperRun = {
          id: data.scraper_run_id,
          campaign_id: selectedCampaign,
          scraper_type: 'hashtag',
          input_data: { hashtags: hashtagList },
          status: 'running',
          started_at: new Date().toISOString(),
          total_results: 0,
          new_influencers: 0,
          updated_influencers: 0,
          completed_at: undefined,
          error_message: undefined,
        };
        setMessage({
          type: 'success',
          text: `Hashtag scraper started! It will run in the background. Check the History tab for progress.`
        });
        setHashtags('');
        setHasRunningScrapers(true);
        setActiveRun(placeholderRun);
        persistActiveRun(placeholderRun);
        // Refresh the runs list
        await loadScraperRuns();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to start scraper' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const startSoundScraper = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCampaign) {
      setMessage({ type: 'error', text: 'Please select a campaign before starting the scraper.' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      // First, check if any scraper is already running
      const isRunning = await checkRunningScrapers();

      if (isRunning) {
        setMessage({
          type: 'error',
          text: 'Another scraper is already in progress. Please wait for it to complete before starting a new one.'
        });
        setLoading(false);
        return;
      }

      // If no scraper is running, proceed to start
      const urlList = soundUrls.split('\n').map(u => u.trim()).filter(u => u);

      const response = await fetch(`${API_URL}/api/v1/scrapers/sound/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sound_urls: urlList,
          max_results: maxResults,
          campaign_id: selectedCampaign
        })
      });

      if (response.ok) {
        const data = await response.json();
        const placeholderRun: ScraperRun = {
          id: data.scraper_run_id,
          campaign_id: selectedCampaign,
          scraper_type: 'sound',
          input_data: { sound_urls: urlList },
          status: 'running',
          started_at: new Date().toISOString(),
          total_results: 0,
          new_influencers: 0,
          updated_influencers: 0,
          completed_at: undefined,
          error_message: undefined,
        };
        setMessage({
          type: 'success',
          text: `Sound scraper started! It will run in the background. Check the History tab for progress.`
        });
        setSoundUrls('');
        setHasRunningScrapers(true);
        setActiveRun(placeholderRun);
        persistActiveRun(placeholderRun);
        // Refresh the runs list
        await loadScraperRuns();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.detail || 'Failed to start scraper' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      running: 'bg-blue-100 text-blue-800 animate-pulse',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    };

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Not available';
    const parsed = new Date(dateString);
    return Number.isNaN(parsed.getTime()) ? 'Not available' : parsed.toLocaleString();
  };

  const getCampaignName = (campaignId?: string) => {
    if (!campaignId) return 'No Campaign';
    const campaign = campaigns.find(c => c.id === campaignId);
    return campaign ? campaign.name : 'Unknown Campaign';
  };

  const formatScraperType = (type: string) => {
    if (type === 'hashtag') return 'Hashtag Scraper';
    if (type === 'sound') return 'Sound Scraper';
    if (type === 'profile') return 'Profile Scraper';
    return type;
  };

  const persistActiveRun = (run: ScraperRun | null) => {
    if (typeof window === 'undefined') return;
    if (run) {
      localStorage.setItem(storageKey, JSON.stringify(run));
    } else {
      localStorage.removeItem(storageKey);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setActiveRun(parsed);
        setHasRunningScrapers(true);
        setStatusLoaded(true);
      } catch (error) {
        console.error('Failed to parse stored scraper run', error);
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">TikTok Scrapers</h1>
            <p className="text-gray-600 mt-2">Discover influencers using hashtags or sound IDs</p>
          </div>
          <Link
            href="/dashboard/influencers"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            View All Influencers →
          </Link>
        </div>


        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
            message.type === 'info' ? 'bg-blue-50 text-blue-800 border border-blue-200' :
              'bg-red-50 text-red-800 border border-red-200'
            }`}>
            {message.text}
          </div>
        )}

        {activeRun && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-blue-900 uppercase tracking-wide">Scraper in progress</p>
              <p className="text-lg font-bold text-blue-900 flex items-center gap-2">
                {activeRun.scraper_type === 'hashtag' ? <Hash className="w-5 h-5" /> : activeRun.scraper_type === 'sound' ? <Music className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
                {formatScraperType(activeRun.scraper_type)}
              </p>
              <p className="text-sm text-blue-900 mt-1">
                Started: {formatDate(activeRun.started_at)} · Campaign: {getCampaignName(activeRun.campaign_id)}
              </p>
              <p className="text-sm text-blue-900">
                {activeRun.total_results > 0
                  ? `${activeRun.total_results} videos processed · ${activeRun.new_influencers} new influencers`
                  : 'Processing... results will appear here as soon as they are available.'}
              </p>
              {lastChecked && (
                <p className="text-xs text-blue-800 mt-1">
                  Last checked {new Date(lastChecked).toLocaleTimeString()}
                </p>
              )}
            </div>
            <div className="flex flex-col items-start md:items-end gap-2">
              {getStatusBadge(activeRun.status)}
              <button
                onClick={() => checkRunningScrapers()}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Refresh status
              </button>
              <button
                onClick={() => forceStopRun(activeRun.id)}
                disabled={isForceStopping}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
                title="Force stop this run if it's stuck or you want to cancel it"
              >
                <StopCircle className="w-4 h-4" /> {isForceStopping ? 'Stopping...' : 'Force Stop'}
              </button>
              <p className="text-xs text-blue-800">
                You can navigate away — this run continues in the background.
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md mb-8">
          <div className="border-b border-gray-200">
            <div className="flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('hashtag')}
                className={`py-4 px-4 font-medium border-b-2 transition-colors ${activeTab === 'hashtag'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                <Hash className="w-4 h-4 inline mr-1" /> Hashtag Scraper
              </button>
              <button
                onClick={() => setActiveTab('sound')}
                className={`py-4 px-4 font-medium border-b-2 transition-colors ${activeTab === 'sound'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                <Music className="w-4 h-4 inline mr-1" /> Sound Scraper
              </button>
              <button
                onClick={async () => {
                  setActiveTab('runs');
                  await loadScraperRuns();
                }}
                className={`py-4 px-4 font-medium border-b-2 transition-colors ${activeTab === 'runs'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
              >
                History
              </button>
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'hashtag' && (
              <form onSubmit={startHashtagScraper} className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-blue-900 mb-2">How it works</h3>
                  <p className="text-sm text-blue-800">
                    Enter hashtags to search TikTok videos. The scraper will find influencers who use these hashtags and automatically extract their profile info, emails from bios, and follower counts.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Link to Campaign <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={selectedCampaign}
                    onChange={(e) => setSelectedCampaign(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  >
                    <option value="">Select a campaign</option>
                    {campaigns.map(campaign => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-sm text-gray-500">
                    Influencers will be added to this campaign automatically
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Hashtags (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    placeholder="#movieedit, #gymtok, #edit"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Example: #movieedit, #gymtok, #edit
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Results per Hashtag
                  </label>
                  <input
                    type="number"
                    value={maxResults}
                    onChange={(e) => setMaxResults(parseInt(e.target.value))}
                    min="1"
                    max="50000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Recommended: 20,000 to avoid Apify overcharges. Use 100 for testing.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || !selectedCampaign || !statusResolved || isRunningScraper}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Starting Scraper...
                    </>
                  ) : !statusResolved ? (
                    'Checking scraper status...'
                  ) : isRunningScraper ? (
                    'Scraper already running...'
                  ) : !selectedCampaign ? (
                    'Please select a campaign'
                  ) : (
                    'Start Hashtag Scraper'
                  )}
                </button>
              </form>
            )}

            {activeTab === 'sound' && (
              <form onSubmit={startSoundScraper} className="space-y-6">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-purple-900 mb-2">How it works</h3>
                  <p className="text-sm text-purple-800">
                    Enter TikTok sound URLs to find influencers who've used those specific sounds in their videos. Great for finding creators already promoting similar content!
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Link to Campaign <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={selectedCampaign}
                    onChange={(e) => setSelectedCampaign(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  >
                    <option value="">Select a campaign</option>
                    {campaigns.map(campaign => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-sm text-gray-500">
                    Influencers will be added to this campaign automatically
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sound URLs (one per line)
                  </label>
                  <textarea
                    value={soundUrls}
                    onChange={(e) => setSoundUrls(e.target.value)}
                    placeholder="https://www.tiktok.com/music/Originalton-7560343199094065942"
                    rows={5}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Example: https://www.tiktok.com/music/Originalton-7560343199094065942
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Results per Sound
                  </label>
                  <input
                    type="number"
                    value={maxResults}
                    onChange={(e) => setMaxResults(parseInt(e.target.value))}
                    min="1"
                    max="50000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Recommended: 20,000 to avoid overcharges. Use 100 for testing.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || !selectedCampaign || !statusResolved || isRunningScraper}
                  className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Starting Scraper...
                    </>
                  ) : !statusResolved ? (
                    'Checking scraper status...'
                  ) : isRunningScraper ? (
                    'Scraper already running...'
                  ) : !selectedCampaign ? (
                    'Please select a campaign'
                  ) : (
                    'Start Sound Scraper'
                  )}
                </button>
              </form>
            )}

            {activeTab === 'runs' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Scraper History</h3>
                  <button
                    onClick={loadScraperRuns}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh
                  </button>
                </div>

                {scraperRuns.length === 0 ? (
                  <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="mt-4 text-gray-600 font-medium">No scraper runs yet</p>
                    <p className="text-sm text-gray-500 mt-2">Start a hashtag or sound scraper to see results here</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b-2 border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Type</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Campaign</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Started</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Results</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">New</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {scraperRuns.map((run) => (
                          <tr key={run.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-4 text-sm font-medium text-gray-900">
                              {run.scraper_type === 'hashtag' ? <Hash className="w-4 h-4 inline mr-1" /> : <Music className="w-4 h-4 inline mr-1" />}
                              {run.scraper_type}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-600">
                              {getCampaignName(run.campaign_id)}
                            </td>
                            <td className="px-4 py-4 text-sm">
                              {getStatusBadge(run.status)}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-500">
                              {formatDate(run.started_at)}
                            </td>
                            <td className="px-4 py-4 text-sm font-semibold text-gray-900">
                              {run.total_results}
                            </td>
                            <td className="px-4 py-4 text-sm text-green-600 font-semibold">
                              +{run.new_influencers}
                            </td>
                            <td className="px-4 py-4 text-sm text-blue-600 font-semibold">
                              {run.updated_influencers}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Info Banner */}
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-3">Next Steps After Scraping</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-start">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3 flex-shrink-0">1</span>
              <div>
                <p className="font-medium text-gray-800">Check Results</p>
                <p className="text-gray-600">Visit the <Link href="/dashboard/influencers" className="text-blue-600 hover:underline">Influencers page</Link> to see discovered creators</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3 flex-shrink-0">2</span>
              <div>
                <p className="font-medium text-gray-800">Filter & Select</p>
                <p className="text-gray-600">Filter by campaign, followers, engagement to find best matches</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mr-3 flex-shrink-0">3</span>
              <div>
                <p className="font-medium text-gray-800">Start Outreach</p>
                <p className="text-gray-600">Go to <Link href="/dashboard/outreach" className="text-blue-600 hover:underline">Outreach</Link> to send bulk emails</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
