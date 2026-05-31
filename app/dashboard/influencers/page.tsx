'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Download, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Users, Search, Filter, X, Trash2, ChevronLeft, ChevronRight, MapPin, BarChart3, TrendingUp, CalendarDays, DollarSign, Edit2, ChevronUp, ChevronDown } from 'lucide-react';
import { detectRegion } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter, LineChart, Line } from 'recharts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Influencer {
  id: string;
  username: string;
  display_name?: string;
  followers?: number;
  engagement_rate?: number;
  avg_views?: number;
  email?: string;
  country?: string;
  is_business?: boolean;
  has_outreach?: boolean;
  last_outreach_at?: string;
  reached_by?: string;
  reference_order?: {
    date_paid?: string;
    price_per_video?: number | string;
    owner_name?: string;
    total_orders?: number;
  } | null;
  campaigns?: string[];
  campaign_count?: number;
  profile_url?: string;
  metadata?: any;
}

interface Campaign {
  id: string;
  name: string;
}

interface Hashtag {
  id: number;
  tag: string;
}

interface Sound {
  id: number;
  sound_id: string;
  name?: string;
}

interface OutreachSelectionInfluencer {
  id: string;
  username: string;
  display_name?: string;
  email?: string;
  followers?: number;
  country?: string;
  engagement_rate?: number;
}

interface AnalyticsResponse {
  summary: {
    totalInfluencers: number;
    avgEngagementRate: number;
    totalFollowers: number;
    countriesCount: number;
  };
  topPerformers: Array<{ name: string; engagement: number; followers: number }>;
  engagementDistribution: Array<{ range: string; count: number }>;
  countryDistribution: Array<{ name: string; value: number }>;
  scatterData: Array<{ followers: number; engagement: number }>;
  followerDistribution: Array<{ range: string; count: number }>;
  outreachByEmployee: Array<{ name: string; value: number }>;
  meta?: {
    scatterSampled?: boolean;
    scatterSampleLimit?: number;
  };
}

type InfluencerSortField = 'followers' | 'engagement_rate' | 'avg_views';
type SortOrder = 'asc' | 'desc';

export default function InfluencersPage() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  // note: enrich-all button removed; state cleaned up
  const [error, setError] = useState<string | null>(null);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [allInfluencers, setAllInfluencers] = useState<Influencer[]>([]);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsResponse | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingInfluencers, setLoadingInfluencers] = useState(true);
  const [activeTab, setActiveTab] = useState<'list' | 'visualizations'>('list');

  // Pending filter states (what user is typing)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [minFollowers, setMinFollowers] = useState('');
  const [maxFollowers, setMaxFollowers] = useState('');
  const [minEngagementRate, setMinEngagementRate] = useState('');
  const [maxEngagementRate, setMaxEngagementRate] = useState('');
  const [minAvgViews, setMinAvgViews] = useState('');
  const [maxAvgViews, setMaxAvgViews] = useState('');
  const [selectedHashtag, setSelectedHashtag] = useState('');
  const [selectedSound, setSelectedSound] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [reachedOutFilter, setReachedOutFilter] = useState('');
  const [onlyWithEmail, setOnlyWithEmail] = useState(false);
  const [onlyPersonalEmail, setOnlyPersonalEmail] = useState(false);

  // Applied filter states (what's actually being used for queries)
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [appliedSelectedCampaign, setAppliedSelectedCampaign] = useState('');
  const [appliedMinFollowers, setAppliedMinFollowers] = useState('');
  const [appliedMaxFollowers, setAppliedMaxFollowers] = useState('');
  const [appliedMinEngagementRate, setAppliedMinEngagementRate] = useState('');
  const [appliedMaxEngagementRate, setAppliedMaxEngagementRate] = useState('');
  const [appliedMinAvgViews, setAppliedMinAvgViews] = useState('');
  const [appliedMaxAvgViews, setAppliedMaxAvgViews] = useState('');
  const [appliedSelectedHashtag, setAppliedSelectedHashtag] = useState('');
  const [appliedSelectedSound, setAppliedSelectedSound] = useState('');
  const [appliedSelectedCountry, setAppliedSelectedCountry] = useState('');
  const [appliedReachedOutFilter, setAppliedReachedOutFilter] = useState('');
  const [appliedOnlyWithEmail, setAppliedOnlyWithEmail] = useState(false);
  const [appliedOnlyPersonalEmail, setAppliedOnlyPersonalEmail] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [hashtags, setHashtags] = useState<Hashtag[]>([]);
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showVisualizations, setShowVisualizations] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detectingRegionId, setDetectingRegionId] = useState<string | null>(null);
  const [selectedInfluencerIds, setSelectedInfluencerIds] = useState<string[]>([]);
  const [selectedInfluencerDetails, setSelectedInfluencerDetails] = useState<Record<string, OutreachSelectionInfluencer>>({});
  const [editingInfluencer, setEditingInfluencer] = useState<Influencer | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: '',
    email: '',
    country: '',
    followers: '',
    avgViews: '',
    engagementRate: '',
    hasOutreach: false,
    lastOutreachAt: '',
    isBusiness: false,
    reachedBy: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(true);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState<InfluencerSortField>('followers');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });

  const formatCurrencyValue = (value?: number | string | null) => {
    if (value === null || value === undefined || value === '') return '-';
    const numeric = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(numeric)) return '-';
    return currencyFormatter.format(numeric);
  };

  const formatDateValue = (value?: string | null) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString();
  };

  // Apply filters function - copies pending filters to applied filters
  const applyFilters = () => {
    setAppliedSearchQuery(searchQuery);
    setAppliedSelectedCampaign(selectedCampaign);
    setAppliedMinFollowers(minFollowers);
    setAppliedMaxFollowers(maxFollowers);
    setAppliedMinEngagementRate(minEngagementRate);
    setAppliedMaxEngagementRate(maxEngagementRate);
    setAppliedMinAvgViews(minAvgViews);
    setAppliedMaxAvgViews(maxAvgViews);
    setAppliedSelectedHashtag(selectedHashtag);
    setAppliedSelectedSound(selectedSound);
    setAppliedSelectedCountry(selectedCountry);
    setAppliedReachedOutFilter(reachedOutFilter);
    setAppliedOnlyWithEmail(onlyWithEmail);
    setAppliedOnlyPersonalEmail(onlyPersonalEmail);
    setCurrentPage(1);
  };

  useEffect(() => {
    loadCampaigns();
    loadFilters();
    loadInfluencers();
  }, [currentPage, appliedSearchQuery, appliedSelectedCampaign, appliedMinFollowers, appliedMaxFollowers, appliedMinEngagementRate, appliedMaxEngagementRate, appliedMinAvgViews, appliedMaxAvgViews, appliedSelectedHashtag, appliedSelectedSound, appliedSelectedCountry, appliedReachedOutFilter, appliedOnlyWithEmail, appliedOnlyPersonalEmail, sortBy, sortOrder]); // Reload when page, sorting, or applied filters change

  // Scroll position detection for scroll buttons
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;
      const isAtTop = scrollTop < 100;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 100;

      setShowScrollToTop(!isAtTop);
      setShowScrollToBottom(!isAtBottom);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial position

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  // Load all influencers for analytics when switching to visualizations tab
  useEffect(() => {
    if (activeTab === 'visualizations' && !analyticsData && !loadingAnalytics) {
      loadAllInfluencersForAnalytics();
    }
  }, [activeTab, analyticsData, loadingAnalytics]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedSelection = window.localStorage.getItem('outreachSelection');
    if (!storedSelection) return;
    try {
      const parsed: OutreachSelectionInfluencer[] = JSON.parse(storedSelection);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const ids = parsed.map((inf) => inf.id);
        const detailMap: Record<string, OutreachSelectionInfluencer> = {};
        parsed.forEach((inf) => {
          if (inf?.id) {
            detailMap[inf.id] = inf;
          }
        });
        setSelectedInfluencerIds(ids);
        setSelectedInfluencerDetails(detailMap);
      }
    } catch (error) {
      console.error('Failed to load outreach selection from storage', error);
      // Clear invalid data
      window.localStorage.removeItem('outreachSelection');
    }
  }, []);

  // Clear stale selections when filters change (not when pages change)
  // Store previous filter values to detect filter changes
  const prevFiltersRef = useRef<string>('');
  useEffect(() => {
    // Create a filter signature to detect filter changes
    const filterSignature = JSON.stringify({
      search: appliedSearchQuery,
      campaign: appliedSelectedCampaign,
      minFollowers: appliedMinFollowers,
      maxFollowers: appliedMaxFollowers,
      minEngagementRate: appliedMinEngagementRate,
      maxEngagementRate: appliedMaxEngagementRate,
      minAvgViews: appliedMinAvgViews,
      maxAvgViews: appliedMaxAvgViews,
      hashtag: appliedSelectedHashtag,
      sound: appliedSelectedSound,
      country: appliedSelectedCountry,
      reachedOut: appliedReachedOutFilter,
      onlyWithEmail: appliedOnlyWithEmail,
      onlyPersonalEmail: appliedOnlyPersonalEmail,
    });

    // Only filter selections when filters actually change (not on initial load or page change)
    if (prevFiltersRef.current && prevFiltersRef.current !== filterSignature && !loadingInfluencers && selectedInfluencerIds.length > 0) {
      // Filters changed - validate selections against current filtered results
      // Note: We can't validate against allInfluencers because it only contains current page
      // Instead, we'll keep all selections and let the API validate when sending to outreach
      // Or we could fetch all matching IDs, but that's expensive. For now, keep selections.
      console.log('[SELECTION] Filters changed, keeping existing selections');
    }

    prevFiltersRef.current = filterSignature;
  }, [loadingInfluencers, appliedSearchQuery, appliedSelectedCampaign, appliedMinFollowers, appliedMaxFollowers, appliedMinEngagementRate, appliedMaxEngagementRate, appliedMinAvgViews, appliedMaxAvgViews, appliedSelectedHashtag, appliedSelectedSound, appliedSelectedCountry, appliedReachedOutFilter, appliedOnlyWithEmail, appliedOnlyPersonalEmail, selectedInfluencerIds.length]);

  // Sync influencers state when allInfluencers changes (from API response)
  useEffect(() => {
    setInfluencers(allInfluencers);
  }, [allInfluencers]);

  const loadCampaigns = async () => {
    try {
      const response = await fetch('/api/campaigns');
      if (response.ok) {
        const data = await response.json();
        setCampaigns(Array.isArray(data) ? data : (data.campaigns || []));
      }
    } catch (error) {
      console.error('Failed to load campaigns:', error);
    }
  };

  const loadFilters = async () => {
    try {
      const response = await fetch('/api/filters');
      if (response.ok) {
        const data = await response.json();
        setHashtags(data.hashtags || []);
        setSounds(data.sounds || []);
      }
    } catch (error) {
      console.error('Failed to load filters:', error);
    }
  };

  const loadInfluencers = async () => {
    try {
      setLoadingInfluencers(true);
      const params = new URLSearchParams();

      // Pagination
      params.append('page', currentPage.toString());
      params.append('limit', itemsPerPage.toString());

      // Filters (use applied filters)
      if (appliedSelectedCampaign) params.append('campaign', appliedSelectedCampaign);
      if (appliedSearchQuery) params.append('search', appliedSearchQuery);
      if (appliedMinFollowers) params.append('min_followers', appliedMinFollowers);
      if (appliedMaxFollowers) params.append('max_followers', appliedMaxFollowers);
      if (appliedMinEngagementRate) params.append('min_engagement_rate', appliedMinEngagementRate);
      if (appliedMaxEngagementRate) params.append('max_engagement_rate', appliedMaxEngagementRate);
      if (appliedMinAvgViews) params.append('min_avg_views', appliedMinAvgViews);
      if (appliedMaxAvgViews) params.append('max_avg_views', appliedMaxAvgViews);
      if (appliedSelectedHashtag) params.append('hashtag_id', appliedSelectedHashtag);
      if (appliedSelectedSound) params.append('sound_id', appliedSelectedSound);
      if (appliedSelectedCountry) params.append('country', appliedSelectedCountry);
      if (appliedReachedOutFilter) params.append('reached_out', appliedReachedOutFilter);
      if (appliedOnlyWithEmail) params.append('has_email', 'true');
      if (appliedOnlyPersonalEmail) params.append('only_personal_email', 'true');
      params.append('sort_by', sortBy);
      params.append('sort_order', sortOrder);

      const url = `/api/influencers?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load');
      const result = await response.json();

      // Handle both old format (array) and new format (object with pagination)
      if (Array.isArray(result)) {
        setAllInfluencers(result);
        setInfluencers(result);
        setTotalCount(result.length);
        setTotalPages(Math.ceil(result.length / itemsPerPage));
      } else {
        setAllInfluencers(result.data || []);
        setInfluencers(result.data || []);
        setTotalCount(result.total || 0);
        setTotalPages(result.totalPages || 1);
      }
    } catch (err) {
      console.error('Error loading influencers:', err);
    } finally {
      setLoadingInfluencers(false);
    }
  };

  const loadAllInfluencersForAnalytics = async () => {
    try {
      setLoadingAnalytics(true);
      const params = new URLSearchParams();

      if (appliedSelectedCampaign) params.append('campaign', appliedSelectedCampaign);
      if (appliedSearchQuery) params.append('search', appliedSearchQuery);
      if (appliedMinFollowers) params.append('min_followers', appliedMinFollowers);
      if (appliedMaxFollowers) params.append('max_followers', appliedMaxFollowers);
      if (appliedMinEngagementRate) params.append('min_engagement_rate', appliedMinEngagementRate);
      if (appliedMaxEngagementRate) params.append('max_engagement_rate', appliedMaxEngagementRate);
      if (appliedMinAvgViews) params.append('min_avg_views', appliedMinAvgViews);
      if (appliedMaxAvgViews) params.append('max_avg_views', appliedMaxAvgViews);
      if (appliedSelectedHashtag) params.append('hashtag_id', appliedSelectedHashtag);
      if (appliedSelectedSound) params.append('sound_id', appliedSelectedSound);
      if (appliedSelectedCountry) params.append('country', appliedSelectedCountry);
      if (appliedReachedOutFilter) params.append('reached_out', appliedReachedOutFilter);
      if (appliedOnlyWithEmail) params.append('has_email', 'true');
      if (appliedOnlyPersonalEmail) params.append('only_personal_email', 'true');

      const response = await fetch(`/api/influencers/analytics?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load analytics');
      const result = await response.json();
      setAnalyticsData(result);
    } catch (err) {
      console.error('Error loading all influencers for analytics:', err);
      setAnalyticsData(null);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const buildSelectionPayload = (influencer: Influencer): OutreachSelectionInfluencer => ({
    id: influencer.id,
    username: influencer.username,
    display_name: influencer.display_name,
    email: influencer.email,
    followers: influencer.followers,
    country: influencer.country,
    engagement_rate: influencer.engagement_rate,
  });

  const toggleInfluencerSelection = (influencer: Influencer) => {
    setSelectedInfluencerIds(prev => {
      const exists = prev.includes(influencer.id);
      return exists ? prev.filter(id => id !== influencer.id) : [...prev, influencer.id];
    });

    setSelectedInfluencerDetails(prev => {
      const exists = !!prev[influencer.id];
      const updated = exists
        ? (() => {
          const { [influencer.id]: _, ...rest } = prev;
          return rest;
        })()
        : {
          ...prev,
          [influencer.id]: buildSelectionPayload(influencer),
        };

      // Sync to localStorage when selections change
      if (typeof window !== 'undefined') {
        const detailsArray = Object.values(updated);
        if (detailsArray.length === 0) {
          window.localStorage.removeItem('outreachSelection');
        } else {
          window.localStorage.setItem('outreachSelection', JSON.stringify(detailsArray));
        }
      }

      return updated;
    });
  };

  const toggleSelectAllCurrentPage = () => {
    const pageIds = influencers.map(inf => inf.id);
    const allSelected = pageIds.every(id => selectedInfluencerIds.includes(id));

    if (allSelected) {
      setSelectedInfluencerIds(prev => prev.filter(id => !pageIds.includes(id)));
      setSelectedInfluencerDetails(prev => {
        const updated = { ...prev };
        pageIds.forEach(id => {
          delete updated[id];
        });

        // Sync to localStorage
        if (typeof window !== 'undefined') {
          const detailsArray = Object.values(updated);
          if (detailsArray.length === 0) {
            window.localStorage.removeItem('outreachSelection');
          } else {
            window.localStorage.setItem('outreachSelection', JSON.stringify(detailsArray));
          }
        }

        return updated;
      });
    } else {
      setSelectedInfluencerIds(prev => Array.from(new Set([...prev, ...pageIds])));
      setSelectedInfluencerDetails(prev => {
        const updated = { ...prev };
        influencers.forEach(inf => {
          updated[inf.id] = buildSelectionPayload(inf);
        });

        // Sync to localStorage
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('outreachSelection', JSON.stringify(Object.values(updated)));
        }

        return updated;
      });
    }
  };

  const handleSendToOutreach = () => {
    if (selectedInfluencerIds.length === 0) return;
    const payload = selectedInfluencerIds
      .map(id => {
        if (selectedInfluencerDetails[id]) {
          return selectedInfluencerDetails[id];
        }
        const found = influencers.find(inf => inf.id === id);
        return found ? buildSelectionPayload(found) : null;
      })
      .filter((inf): inf is OutreachSelectionInfluencer => Boolean(inf && inf.id));

    if (payload.length === 0) return;

    try {
      if (typeof window !== 'undefined') {
        // Merge with existing selection in localStorage instead of replacing
        const existingSelectionStr = window.localStorage.getItem('outreachSelection');
        let existingSelection: OutreachSelectionInfluencer[] = [];

        if (existingSelectionStr) {
          try {
            const parsed = JSON.parse(existingSelectionStr);
            if (Array.isArray(parsed)) {
              existingSelection = parsed;
            }
          } catch (e) {
            console.warn('Failed to parse existing selection, starting fresh:', e);
          }
        }

        // Merge: deduplicate by email (most reliable identifier)
        const existingEmails = new Set(existingSelection.map(inf => inf.email?.toLowerCase()).filter(Boolean));
        const newItems = payload.filter(inf => {
          const emailLower = inf.email?.toLowerCase();
          return emailLower && !existingEmails.has(emailLower);
        });

        const mergedSelection = [...existingSelection, ...newItems];
        window.localStorage.setItem('outreachSelection', JSON.stringify(mergedSelection));
      }
      router.push('/dashboard/outreach?source=influencers');
    } catch (error) {
      console.error('Failed to store outreach selection', error);
    }
  };

  const handleClearSelection = () => {
    setSelectedInfluencerIds([]);
    setSelectedInfluencerDetails({});
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('outreachSelection');
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCampaign('');
    setMinFollowers('');
    setMaxFollowers('');
    setMinEngagementRate('');
    setMaxEngagementRate('');
    setMinAvgViews('');
    setMaxAvgViews('');
    setSelectedHashtag('');
    setSelectedSound('');
    setSelectedCountry('');
    setReachedOutFilter('');
    setOnlyWithEmail(false);
    setOnlyPersonalEmail(false);
    // Also clear applied filters
    setAppliedSearchQuery('');
    setAppliedSelectedCampaign('');
    setAppliedMinFollowers('');
    setAppliedMaxFollowers('');
    setAppliedMinEngagementRate('');
    setAppliedMaxEngagementRate('');
    setAppliedMinAvgViews('');
    setAppliedMaxAvgViews('');
    setAppliedSelectedHashtag('');
    setAppliedSelectedSound('');
    setAppliedSelectedCountry('');
    setAppliedReachedOutFilter('');
    setAppliedOnlyWithEmail(false);
    setAppliedOnlyPersonalEmail(false);
    setCurrentPage(1); // Reset to first page
    // loadInfluencers will be called automatically via useEffect when applied filters change
  };

  const hasActiveFilters = appliedSearchQuery || appliedSelectedCampaign || appliedMinFollowers || appliedMaxFollowers || appliedMinEngagementRate || appliedMaxEngagementRate || appliedMinAvgViews || appliedMaxAvgViews || appliedSelectedHashtag || appliedSelectedSound || appliedSelectedCountry || appliedReachedOutFilter || appliedOnlyWithEmail || appliedOnlyPersonalEmail;
  const hasSelection = selectedInfluencerIds.length > 0;
  const pageSelectionCount = influencers.filter(inf => selectedInfluencerIds.includes(inf.id)).length;
  const allPageSelected = influencers.length > 0 && pageSelectionCount === influencers.length;

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      // Scroll to top when page changes
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSort = (field: InfluencerSortField) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  const renderSortIndicator = (field: InfluencerSortField) => {
    if (sortBy !== field) {
      return <ChevronDown className="w-3.5 h-3.5 text-gray-300" />;
    }

    return sortOrder === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 text-primary-600" />
      : <ChevronDown className="w-3.5 h-3.5 text-primary-600" />;
  };



  const handleExport = async (format: 'csv' | 'excel') => {
    setExporting(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (appliedSelectedCampaign) params.append('campaign', appliedSelectedCampaign);
      if (appliedSearchQuery) params.append('search', appliedSearchQuery);
      if (appliedMinFollowers) params.append('min_followers', appliedMinFollowers);
      if (appliedMaxFollowers) params.append('max_followers', appliedMaxFollowers);
      if (appliedMinEngagementRate) params.append('min_engagement_rate', appliedMinEngagementRate);
      if (appliedMaxEngagementRate) params.append('max_engagement_rate', appliedMaxEngagementRate);
      if (appliedMinAvgViews) params.append('min_avg_views', appliedMinAvgViews);
      if (appliedMaxAvgViews) params.append('max_avg_views', appliedMaxAvgViews);
      if (appliedSelectedHashtag) params.append('hashtag_id', appliedSelectedHashtag);
      if (appliedSelectedSound) params.append('sound_id', appliedSelectedSound);
      if (appliedSelectedCountry) params.append('country', appliedSelectedCountry);
      if (appliedReachedOutFilter) params.append('reached_out', appliedReachedOutFilter);
      if (appliedOnlyWithEmail) params.append('has_email', 'true');
      if (appliedOnlyPersonalEmail) params.append('only_personal_email', 'true');

      params.append('format', format);
      const endpoint = '/api/influencers/export';
      const response = await fetch(`${endpoint}?${params.toString()}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `influencers_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Export error:', err);
      setError(err.message || 'An error occurred during export');
    } finally {
      setExporting(false);
    }
  };




  const handleDetectRegion = async (influencerId: string) => {
    setDetectingRegionId(influencerId);
    try {
      const result = await detectRegion([influencerId]);
      if (result.status === 'completed') {
        // Reload influencers to show updated country
        await loadInfluencers();
        setError(null);
      } else {
        setError(result.message || 'Region detection failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to detect region');
    } finally {
      setDetectingRegionId(null);
    }
  };

  const handleDeleteInfluencer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this influencer? This action cannot be undone.')) {
      return;
    }

    setDeletingId(id);
    try {
      const response = await fetch(`/api/influencers?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete');
      }

      // Remove from local state
      setInfluencers(influencers.filter(inf => inf.id !== id));
      setAllInfluencers(allInfluencers.filter(inf => inf.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete influencer');
      console.error('Error deleting influencer:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const openEditModal = (influencer: Influencer) => {
    setEditError(null);
    setEditSuccess(null);
    setEditingInfluencer(influencer);
    setEditForm({
      displayName: influencer.display_name || '',
      email: influencer.email || '',
      country: influencer.country || '',
      followers: influencer.followers?.toString() || '',
      avgViews: influencer.avg_views != null ? Math.floor(influencer.avg_views).toString() : '',
      engagementRate: influencer.engagement_rate?.toString() || '',
      hasOutreach: Boolean(influencer.has_outreach),
      lastOutreachAt: influencer.last_outreach_at ? influencer.last_outreach_at.substring(0, 10) : '',
      isBusiness: Boolean(influencer.is_business),
      reachedBy: influencer.reached_by || '',
    });
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditingInfluencer(null);
  };

  const handleEditSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingInfluencer) return;

    setEditSaving(true);
    setEditError(null);
    try {
      const payload: Record<string, any> = {
        id: editingInfluencer.id,
        displayName: editForm.displayName,
        email: editForm.email,
        country: editForm.country,
        followers: editForm.followers,
        avgViews: editForm.avgViews,
        engagementRate: editForm.engagementRate,
        hasOutreach: editForm.hasOutreach,
        lastOutreachAt: editForm.lastOutreachAt,
        isBusiness: editForm.isBusiness,
        reachedBy: editForm.reachedBy,
      };

      const response = await fetch('/api/influencers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update influencer');
      }

      setEditSuccess(`Saved changes for @${editingInfluencer.username}`);
      setEditingInfluencer(null);
      await loadInfluencers();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update influencer');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Influencers</h1>
          <p className="text-gray-600">
            Showing {influencers.length} of {totalCount} influencers
            {totalPages > 1 && ` (Page ${currentPage} of ${totalPages})`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="text-sm text-gray-500">
            {hasSelection ? `${selectedInfluencerIds.length} selected for outreach` : 'Select influencers to build outreach list'}
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-lg shadow-sm">
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting}
                className="px-4 py-2 text-sm font-medium bg-white border border-gray-300 rounded-l-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                CSV
              </button>
              <button
                onClick={() => handleExport('excel')}
                disabled={exporting}
                className="px-4 py-2 text-sm font-medium bg-white border border-l-0 border-gray-300 rounded-r-lg hover:bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                Excel
              </button>
            </div>
            <button
              onClick={handleSendToOutreach}
              disabled={!hasSelection}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${hasSelection
                ? 'text-white bg-primary-600 hover:bg-primary-700'
                : 'text-gray-500 bg-gray-200 cursor-not-allowed'
                }`}
            >
              Send to Outreach
            </button>
            <button
              onClick={handleClearSelection}
              disabled={!hasSelection}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Clear Selection
            </button>
            {/* Enrich All button removed - backend supports batch enrichment; use backend endpoints directly if needed */}
          </div>
        </div>
      </div>

      {editSuccess && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-blue-900">Update saved</p>
            <p className="text-sm text-blue-800">{editSuccess}</p>
          </div>
          <button
            className="text-blue-500 hover:text-blue-700"
            onClick={() => setEditSuccess(null)}
            aria-label="Dismiss update message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${activeTab === 'list'
            ? 'border-primary-600 text-primary-600'
            : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
        >
          Influencer List ({influencers.length})
        </button>
        <button
          onClick={() => setActiveTab('visualizations')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'visualizations'
            ? 'border-primary-600 text-primary-600'
            : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
        >
          <BarChart3 className="w-4 h-4" />
          Analytics & Visualizations
        </button>

      </div>

      {/* Influencer List Tab */}
      {activeTab === 'list' && (
        <div>
          {/* Filters Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="ml-2 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    Clear All
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={applyFilters}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Filter className="w-4 h-4" />
                  Apply Filters
                </button>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  {showFilters ? 'Hide' : 'Show'} Filters
                </button>
              </div>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Search */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Search (Username/Name)
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          applyFilters();
                        }
                      }}
                      placeholder="Search influencers..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    />
                  </div>
                </div>

                {/* Campaign Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign
                  </label>
                  <select
                    value={selectedCampaign}
                    onChange={(e) => setSelectedCampaign(e.target.value)}
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

                {/* Hashtag Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Hashtag
                  </label>
                  <select
                    value={selectedHashtag}
                    onChange={(e) => setSelectedHashtag(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">All Hashtags</option>
                    {hashtags.map(hashtag => (
                      <option key={hashtag.id} value={hashtag.id.toString()}>
                        #{hashtag.tag}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sound Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sound ID
                  </label>
                  <select
                    value={selectedSound}
                    onChange={(e) => setSelectedSound(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">All Sounds</option>
                    {sounds.map(sound => (
                      <option key={sound.id} value={sound.id.toString()}>
                        {sound.name || sound.sound_id}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Outreach Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Outreach Status
                  </label>
                  <select
                    value={reachedOutFilter}
                    onChange={(e) => setReachedOutFilter(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">All Statuses</option>
                    <option value="true">Reached Out</option>
                    <option value="false">Not Yet Contacted</option>
                  </select>
                </div>

                {/* Country Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Country
                  </label>
                  <input
                    type="text"
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    placeholder="e.g. United States"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {/* Min Followers */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Min Followers
                  </label>
                  <input
                    type="number"
                    value={minFollowers}
                    onChange={(e) => setMinFollowers(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    placeholder="e.g. 1000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {/* Max Followers */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Followers
                  </label>
                  <input
                    type="number"
                    value={maxFollowers}
                    onChange={(e) => setMaxFollowers(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    placeholder="e.g. 1000000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {/* Min Engagement Rate */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Min Engagement Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={minEngagementRate}
                    onChange={(e) => setMinEngagementRate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    placeholder="e.g. 1.0"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {/* Max Engagement Rate */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Engagement Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={maxEngagementRate}
                    onChange={(e) => setMaxEngagementRate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    placeholder="e.g. 10.0"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {/* Min Avg Views */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Min Median Views
                  </label>
                  <input
                    type="number"
                    value={minAvgViews}
                    onChange={(e) => setMinAvgViews(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    placeholder="e.g. 1000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {/* Max Avg Views */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Median Views
                  </label>
                  <input
                    type="number"
                    value={maxAvgViews}
                    onChange={(e) => setMaxAvgViews(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    placeholder="e.g. 1000000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>

                {/* Only With Email */}
                <div className="flex items-center gap-3 pt-6">
                  <input
                    id="only-with-email"
                    type="checkbox"
                    checked={onlyWithEmail}
                    onChange={(e) => setOnlyWithEmail(e.target.checked)}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label htmlFor="only-with-email" className="text-sm font-medium text-gray-700">
                    Only show influencers with an email
                  </label>
                </div>

                {/* Only Personal Emails */}
                <div className="flex items-center gap-3 pt-6">
                  <input
                    id="only-personal-email"
                    type="checkbox"
                    checked={onlyPersonalEmail}
                    onChange={(e) => setOnlyPersonalEmail(e.target.checked)}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label htmlFor="only-personal-email" className="text-sm font-medium text-gray-700">
                    Only show personal emails (Gmail, Outlook, Yahoo, etc.)
                  </label>
                </div>
              </div>
            )}
          </div>

          {editingInfluencer && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Edit Influencer</h2>
                    <p className="text-sm text-gray-500">Update contact and performance fields before sending to outreach.</p>
                  </div>
                  <button onClick={closeEditModal} className="text-gray-500 hover:text-gray-700" aria-label="Close edit modal">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleEditSubmit} className="px-6 py-6 space-y-6">
                  {editError && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{editError}</div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                      <input
                        type="text"
                        value={editForm.displayName}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, displayName: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        placeholder="Creator name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        placeholder="creator@email.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                      <input
                        type="text"
                        value={editForm.country}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, country: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        placeholder="United States"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Followers</label>
                      <input
                        type="number"
                        min="0"
                        value={editForm.followers}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, followers: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        placeholder="150000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Median Views</label>
                      <input
                        type="number"
                        min="0"
                        value={editForm.avgViews}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, avgViews: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        placeholder="50000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Engagement Rate (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.engagementRate}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, engagementRate: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        placeholder="1.25"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Last Outreach Date</label>
                      <input
                        type="date"
                        value={editForm.lastOutreachAt}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, lastOutreachAt: e.target.value }))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reached By (Employee)</label>
                      <input
                        type="text"
                        value={editForm.reachedBy}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, reachedBy: e.target.value }))}
                        placeholder="e.g. Ryan"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                        checked={editForm.hasOutreach}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, hasOutreach: e.target.checked }))}
                      />
                      <span className="text-sm text-gray-700">Already reached out</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                        checked={editForm.isBusiness}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, isBusiness: e.target.checked }))}
                      />
                      <span className="text-sm text-gray-700">Business email</span>
                    </label>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={closeEditModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
                      disabled={editSaving}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editSaving}
                      className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {editSaving ? 'Saving...' : 'Save changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
          {loadingInfluencers ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : influencers.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: '70vh' }}>
                <table className="w-full" style={{ minWidth: '1200px' }}>
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">
                        <input
                          type="checkbox"
                          aria-label="Select all on page"
                          checked={allPageSelected && influencers.length > 0}
                          onChange={toggleSelectAllCurrentPage}
                          className="h-4 w-4 text-primary-600 rounded border-gray-300"
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Username</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Display Name</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">
                        <button onClick={() => handleSort('followers')} className="inline-flex items-center gap-1 hover:text-gray-900">
                          Followers
                          {renderSortIndicator('followers')}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">
                        <button onClick={() => handleSort('engagement_rate')} className="inline-flex items-center gap-1 hover:text-gray-900">
                          Engagement
                          {renderSortIndicator('engagement_rate')}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">
                        <button onClick={() => handleSort('avg_views')} className="inline-flex items-center gap-1 hover:text-gray-900">
                          Median Views
                          {renderSortIndicator('avg_views')}
                        </button>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Profile</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Video Metrics</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Campaigns</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Country</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Orders</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Outreach</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Reached By</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Email</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {influencers.map((influencer, idx) => (
                      <tr key={influencer.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${influencer.username}`}
                            checked={selectedInfluencerIds.includes(influencer.id)}
                            onChange={() => toggleInfluencerSelection(influencer)}
                            className="h-4 w-4 text-primary-600 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{influencer.username}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{influencer.display_name || '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{influencer.followers?.toLocaleString() || '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{influencer.engagement_rate ? `${influencer.engagement_rate}%` : '-'}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{influencer.avg_views ? influencer.avg_views.toLocaleString() : '-'}</td>
                        <td className="px-6 py-4 text-sm">
                          {(() => {
                            const profileUrl = influencer.profile_url ||
                              influencer.metadata?.raw_author?.profileUrl ||
                              `https://www.tiktok.com/@${influencer.username}`;

                            return (
                              <a
                                href={profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                              >
                                Profile Link
                              </a>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {(() => {
                            const videoMetrics = influencer.metadata?.video_metrics;
                            if (videoMetrics && (videoMetrics.playCount || videoMetrics.diggCount || videoMetrics.shareCount || videoMetrics.commentCount)) {
                              return (
                                <div className="space-y-0.5 text-xs min-w-[120px]">
                                  <div className="flex justify-between gap-3">
                                    <span className="text-gray-500">Views:</span>
                                    <span className="font-medium text-gray-900">{(videoMetrics.playCount || 0).toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <span className="text-gray-500">Likes:</span>
                                    <span className="font-medium text-gray-900">{(videoMetrics.diggCount || 0).toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <span className="text-gray-500">Shares:</span>
                                    <span className="font-medium text-gray-900">{(videoMetrics.shareCount || 0).toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <span className="text-gray-500">Comments:</span>
                                    <span className="font-medium text-gray-900">{(videoMetrics.commentCount || 0).toLocaleString()}</span>
                                  </div>
                                </div>
                              );
                            }
                            return <span className="text-gray-400">-</span>;
                          })()}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {influencer.campaigns && influencer.campaigns.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {influencer.campaigns.map((campaign, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium"
                                >
                                  {campaign}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          <div className="flex items-center gap-2">
                            {influencer.country ? (
                              <span>{influencer.country}</span>
                            ) : (
                              <>
                                <span className="text-gray-400">-</span>
                                <button
                                  onClick={() => handleDetectRegion(influencer.id)}
                                  disabled={detectingRegionId === influencer.id}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Detect region"
                                >
                                  {detectingRegionId === influencer.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <MapPin className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {influencer.reference_order ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-gray-900">
                                <CalendarDays className="w-4 h-4 text-blue-500" />
                                <span className="text-sm font-medium">
                                  {formatDateValue(influencer.reference_order.date_paid)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-gray-600 text-sm">
                                <DollarSign className="w-4 h-4 text-green-500" />
                                <span>{formatCurrencyValue(influencer.reference_order.price_per_video)} / video</span>
                              </div>
                              <div className="text-xs text-gray-500">
                                {(influencer.reference_order.owner_name && influencer.reference_order.owner_name.trim()) || '—'} •{' '}
                                {influencer.reference_order.total_orders || 1}{' '}
                                {influencer.reference_order.total_orders === 1 ? 'order' : 'orders'}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">No orders recorded</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {(() => {
                            const hasOrders = Boolean(influencer.reference_order);
                            const isContacted = influencer.has_outreach || hasOrders;
                            const contactDate = influencer.last_outreach_at || influencer.reference_order?.date_paid || null;
                            const totalOrders = influencer.reference_order?.total_orders || (hasOrders ? 1 : 0);

                            if (!isContacted) {
                              return <span className="text-xs text-gray-400">Not yet contacted</span>;
                            }

                            return (
                              <div className="flex flex-col">
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium w-max">
                                  Contacted
                                </span>
                                {contactDate && (
                                  <span className="text-xs text-gray-500 mt-1">
                                    {formatDateValue(contactDate)}
                                  </span>
                                )}
                                {hasOrders && (
                                  <span className="text-xs text-gray-500">
                                    {totalOrders} {totalOrders === 1 ? 'order' : 'orders'} recorded
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{influencer.reached_by || '-'}</td>
                        <td className="px-6 py-4 text-sm text-primary-600">{influencer.email ? influencer.email : '-'}</td>
                        <td className="px-6 py-4 text-sm">
                          {influencer.is_business ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                              Business
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                              Personal
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEditModal(influencer)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                            >
                              <Edit2 className="w-4 h-4" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteInfluencer(influencer.id)}
                              disabled={deletingId === influencer.id}
                              className="inline-flex items-center justify-center p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Delete influencer"
                            >
                              {deletingId === influencer.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
                  <div className="text-sm text-gray-600">
                    Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} influencers
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 7) {
                          pageNum = i + 1;
                        } else if (currentPage <= 4) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 3) {
                          pageNum = totalPages - 6 + i;
                        } else {
                          pageNum = currentPage - 3 + i;
                        }

                        return (
                          <button
                            key={pageNum}
                            onClick={() => handlePageChange(pageNum)}
                            className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${currentPage === pageNum
                              ? 'bg-primary-600 text-white'
                              : 'text-gray-700 hover:bg-gray-100'
                              }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-gray-200">
              <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-2">No influencers found</p>
              <p className="text-sm text-gray-400 mb-4">
                {hasActiveFilters ? 'Try adjusting your filters' : 'Import your first batch of influencers to get started'}
              </p>
              {hasActiveFilters ? (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Clear Filters
                </button>
              ) : (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                  Clear Filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Visualizations Tab */}
      {activeTab === 'visualizations' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <BarChart3 className="w-6 h-6" />
              Analytics & Visualizations
            </h2>

            {loadingAnalytics ? (
              <div className="text-center py-12">
                <Loader2 className="w-16 h-16 text-primary-600 mx-auto mb-4 animate-spin" />
                <p className="text-gray-500">Loading analytics data...</p>
                <p className="text-sm text-gray-400 mt-2">This may take a moment for large datasets</p>
              </div>
            ) : !analyticsData || analyticsData.summary.totalInfluencers === 0 ? (
              <div className="text-center py-12">
                <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No data available for visualizations</p>
                <p className="text-sm text-gray-400 mt-2">Import influencers to see analytics</p>
              </div>
            ) : (
              <div className="space-y-8">
                {analyticsData.meta?.scatterSampled && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Scatter plot is sampled from the latest {analyticsData.meta.scatterSampleLimit?.toLocaleString()} records for faster loading.
                  </div>
                )}
                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <div className="text-sm text-blue-600 font-medium">Total Influencers</div>
                    <div className="text-2xl font-bold text-blue-900 mt-1">{analyticsData.summary.totalInfluencers}</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                    <div className="text-sm text-green-600 font-medium">Avg Engagement Rate</div>
                    <div className="text-2xl font-bold text-green-900 mt-1">
                      {`${analyticsData.summary.avgEngagementRate.toFixed(2)}%`}
                    </div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                    <div className="text-sm text-purple-600 font-medium">Total Followers</div>
                    <div className="text-2xl font-bold text-purple-900 mt-1">
                      {(analyticsData.summary.totalFollowers / 1000000).toFixed(1)}M
                    </div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                    <div className="text-sm text-orange-600 font-medium">Countries</div>
                    <div className="text-2xl font-bold text-orange-900 mt-1">
                      {analyticsData.summary.countriesCount}
                    </div>
                  </div>
                </div>

                {/* Top Performers */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Performers by Engagement Rate</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={analyticsData.topPerformers}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="engagement" fill="#3b82f6" name="Engagement Rate (%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Engagement Rate Distribution */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Engagement Rate Distribution</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={analyticsData.engagementDistribution}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="range" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#10b981" name="Number of Influencers" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Country Distribution */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Country Distribution</h3>
                  <ResponsiveContainer width="100%" height={400}>
                    <PieChart>
                      <Pie
                        data={analyticsData.countryDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
                        outerRadius={120}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {(() => {
                          const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];
                          return colors.map((color, index) => <Cell key={`cell-${index}`} fill={color} />);
                        })()}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Engagement vs Followers Scatter */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Engagement Rate vs Followers</h3>
                  <ResponsiveContainer width="100%" height={400}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        type="number"
                        dataKey="followers"
                        name="Followers"
                        label={{ value: 'Followers', position: 'insideBottom', offset: -5 }}
                        scale="log"
                        domain={['dataMin', 'dataMax']}
                      />
                      <YAxis
                        type="number"
                        dataKey="engagement"
                        name="Engagement Rate (%)"
                        label={{ value: 'Engagement Rate (%)', angle: -90, position: 'insideLeft' }}
                      />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                      <Scatter
                        name="Influencers"
                        data={analyticsData.scatterData}
                        fill="#3b82f6"
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>

                {/* Follower Distribution */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Follower Distribution</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={analyticsData.followerDistribution}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="range" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#8b5cf6" name="Number of Influencers" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Employee Outreach Tracking */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Creators Approached by Employee</h3>
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart
                      data={analyticsData.outreachByEmployee}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={120} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#8b5cf6" name="Creators Approached" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scroll to Top/Bottom Buttons */}
      {showScrollToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-24 right-6 z-50 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all duration-200 hover:scale-110 flex items-center justify-center"
          aria-label="Scroll to top"
        >
          <ChevronUp className="w-6 h-6" />
        </button>
      )}
      {showScrollToBottom && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-6 right-6 z-50 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all duration-200 hover:scale-110 flex items-center justify-center"
          aria-label="Scroll to bottom"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
