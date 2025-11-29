'use client';

import { useEffect, useMemo, useState } from 'react';
import { Upload, Filter, Search, Loader2, CheckCircle2, AlertCircle, DollarSign, Users, CalendarDays, RefreshCw, Plus, X, Trash2, Music, BarChart3, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, Video, StopCircle } from 'lucide-react';
import { importReferenceOrders, ReferenceImportResult } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ReferenceOrderRow {
  id: string;
  influencer_id?: string | null;
  username: string;
  normalized_username?: string;
  email?: string;
  account_link?: string;
  owner_name?: string;
  approved_vendor?: boolean;
  total_fee_per_import?: number;
  price_usd?: number;
  video_count?: number;
  final_price?: number;
  price_per_video?: number;
  songs?: string;
  video_links?: string;
  paid?: boolean;
  date_paid?: string;
  total_orders?: number;
  avg_price_per_video?: number;
  avg_views?: number | null;
  avg_views_status?: string | null;
  avg_views_updated_at?: string | null;
}

interface OwnerStat {
  owner_name: string;
  total_orders: number;
}

interface ReferenceOrdersResponse {
  data: ReferenceOrderRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: {
    totalOrders: number;
    totalCreators: number;
    avgPricePerVideo: number;
    totalSpend: number;
  };
  owners: OwnerStat[];
}

interface AvgViewJob {
  id: string;
  mode: string;
  skip_existing?: boolean;
  status: string;
  total_requested?: number;
  total_enqueued?: number;
  total_skipped?: number;
  total_processed?: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

const formatCurrencyValue = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '$0';
  const numeric = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(numeric)) return '$0';
  return currencyFormatter.format(numeric);
};

const formatDateValue = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
};

const toInputValue = (value?: number | string | null) => {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
};

const formatDateForInput = (value?: string | null) => {
  if (!value) return '';
  return value.split('T')[0];
};

const SONGS_PER_PAGE = 20;
const JOBS_PER_PAGE = 3;
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const normalizeHandle = (value?: string | null) => {
  if (!value) return '';
  return value.trim().replace(/^@/, '').toLowerCase();
};

const getJobStatusBadge = (status?: string | null) => {
  switch ((status || '').toLowerCase()) {
    case 'completed':
      return 'bg-green-100 text-green-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'running':
    case 'pending':
      return 'bg-yellow-100 text-yellow-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
};

interface SongAnalytics {
  song_name: string;
  total_videos: number;
  order_count: number;
  avg_price_per_video: number;
  total_spend?: number;
}

interface SongAnalyticsResponse {
  songs: SongAnalytics[];
  totals: {
    total_songs: number;
    total_videos: number;
    total_orders: number;
  };
  cached?: boolean;
}

export default function ReferenceOrdersPage() {
  const [activeTab, setActiveTab] = useState<'orders' | 'songs'>('orders');
  const [orders, setOrders] = useState<ReferenceOrderRow[]>([]);
  const [ownerStats, setOwnerStats] = useState<OwnerStat[]>([]);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalCreators: 0,
    avgPricePerVideo: 0,
    totalSpend: 0,
  });
  const [songAnalytics, setSongAnalytics] = useState<SongAnalytics[]>([]);
  const [songTotals, setSongTotals] = useState({
    total_songs: 0,
    total_videos: 0,
    total_orders: 0,
  });
  const [songPage, setSongPage] = useState(1);
  const [songSearch, setSongSearch] = useState('');
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [refreshingSongs, setRefreshingSongs] = useState(false);
  const [totalRecords, setTotalRecords] = useState(0);
  const [selectedCreators, setSelectedCreators] = useState<Record<string, { display: string; handle: string }>>({});
  const [avgViewJobs, setAvgViewJobs] = useState<AvgViewJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true); // Start as true to disable buttons during initial load
  const [avgViewProcessing, setAvgViewProcessing] = useState(false);
  const [jobsPage, setJobsPage] = useState(1);
  const jobsPageCount = Math.max(1, Math.ceil(avgViewJobs.length / JOBS_PER_PAGE) || 1);
  const paginatedJobs = useMemo(() => {
    const start = (jobsPage - 1) * JOBS_PER_PAGE;
    return avgViewJobs.slice(start, start + JOBS_PER_PAGE);
  }, [avgViewJobs, jobsPage]);

  const [sheetUrl, setSheetUrl] = useState('');
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [lastSheetSyncAt, setLastSheetSyncAt] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [approvedFilter, setApprovedFilter] = useState('');
  const [paidFilter, setPaidFilter] = useState('');
  const [matchedFilter, setMatchedFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('date_paid');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(25);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ReferenceImportResult | null>(null);
  const filteredSongs = useMemo(() => {
    const term = songSearch.trim().toLowerCase();
    if (!term) return songAnalytics;
    return songAnalytics.filter((song) => song.song_name.toLowerCase().includes(term));
  }, [songAnalytics, songSearch]);
  const songPageCount = Math.max(1, Math.ceil(filteredSongs.length / SONGS_PER_PAGE) || 1);
  const paginatedSongs = useMemo(() => {
    const start = (songPage - 1) * SONGS_PER_PAGE;
    return filteredSongs.slice(start, start + SONGS_PER_PAGE);
  }, [filteredSongs, songPage]);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [videoLinksModalOpen, setVideoLinksModalOpen] = useState(false);
  const [selectedVideoLinks, setSelectedVideoLinks] = useState<string>('');

  const manualOrderDefaults = useMemo(
    () => ({
      username: '',
      email: '',
      accountLink: '',
      ownerName: '',
      pricePerVideo: '',
      priceUsd: '',
      finalPrice: '',
      totalFeePerImport: '',
      videoCount: '',
      songs: '',
      videoLinks: '',
      datePaid: '',
      approvedVendor: false,
      paid: true,
    }),
    [],
  );
  const [manualOrder, setManualOrder] = useState({ ...manualOrderDefaults });
  const [editForm, setEditForm] = useState({ ...manualOrderDefaults });
  const selectedCreatorCount = Object.keys(selectedCreators).length;

  // Check if there's a running or pending job
  const hasRunningJob = useMemo(() => {
    return avgViewJobs.some((job) => job.status === 'pending' || job.status === 'running');
  }, [avgViewJobs]);

  // Get the running job for force stop button
  const runningJob = useMemo(() => {
    return avgViewJobs.find((job) => job.status === 'pending' || job.status === 'running');
  }, [avgViewJobs]);

  const [isForceStopping, setIsForceStopping] = useState(false);

  // Force stop a running avg view job
  const forceStopJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to force stop this job? This will mark it as stopped and allow you to start a new job.')) {
      return;
    }
    
    setIsForceStopping(true);
    try {
      const response = await fetch(`${API_URL}/api/v1/reference-orders/avg-views/jobs/${jobId}/force-stop`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to stop job');
      }
      
      setBanner({ type: 'success', message: 'Avg view job stopped successfully. You can now start a new job.' });
      
      // Refresh the jobs list
      await loadAvgViewJobs();
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to stop job' });
    } finally {
      setIsForceStopping(false);
    }
  };

  const loadOrders = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: limit.toString(),
      });
      if (search) params.append('search', search);
      if (ownerFilter) params.append('owner', ownerFilter);
      if (approvedFilter) params.append('approved', approvedFilter);
      if (paidFilter) params.append('paid', paidFilter);
      if (matchedFilter) params.append('matched', matchedFilter);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (sortBy) params.append('sort_by', sortBy);
      if (sortOrder) params.append('sort_order', sortOrder);

      const response = await fetch(`/api/reference-orders?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load reference orders');
      const data: ReferenceOrdersResponse = await response.json();

      setOrders(data.data || []);
      setOwnerStats(data.owners || []);
      setStats(data.stats);
      setTotalRecords(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load reference data');
    } finally {
      setLoading(false);
    }
  };

  const loadSongAnalytics = async (
    options: { refresh?: boolean; background?: boolean } = {},
  ) => {
    const { refresh = false, background = false } = options;
    try {
      if (!background) {
        setLoadingSongs(true);
      }
      const url = refresh ? '/api/songs-analytics?refresh=true' : '/api/songs-analytics';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load song analytics');
      const data: SongAnalyticsResponse = await response.json();

      const sanitizedSongs = (data.songs || [])
        .filter((song) => song.song_name && song.song_name.trim().length > 0)
        .map((song) => ({
          ...song,
          song_name: song.song_name.trim(),
          total_videos: Number(song.total_videos) || 0,
          order_count: Number(song.order_count) || 0,
          avg_price_per_video: Number(song.avg_price_per_video) || 0,
        }));

      setSongAnalytics(sanitizedSongs);
      setSongTotals((prev) => ({
        total_songs: data.totals?.total_songs ?? sanitizedSongs.length,
        total_videos:
          data.totals?.total_videos ??
          sanitizedSongs.reduce((sum, song) => sum + (Number(song.total_videos) || 0), 0),
        total_orders: data.totals?.total_orders ?? prev.total_orders,
      }));
      setSongPage(1);
    } catch (err: any) {
      console.error('Error loading song analytics:', err);
      setError('Failed to load song analytics');
    } finally {
      if (!background) {
        setLoadingSongs(false);
      }
    }
  };

  const handleRefreshSongAnalytics = async () => {
    try {
      setRefreshingSongs(true);
      const response = await fetch('/api/songs-analytics', {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Failed to refresh cache');

      // Reload data after refresh
      await loadSongAnalytics({ refresh: true });
      setBanner({ type: 'success', message: 'Song analytics refreshed successfully' });
    } catch (err: any) {
      console.error('Error refreshing song analytics:', err);
      setError('Failed to refresh song analytics');
    } finally {
      setRefreshingSongs(false);
    }
  };

  const loadAvgViewJobs = async (silent = false) => {
    try {
      if (!silent) {
        setJobsLoading(true);
      }
      const response = await fetch(`${API_URL}/api/v1/reference-orders/avg-views/jobs?limit=5`);
      if (!response.ok) throw new Error('Failed to load avg view jobs');
      const data = await response.json();
      setAvgViewJobs(data.jobs || []);
    } catch (err) {
      console.error('Error loading avg view jobs:', err);
    } finally {
      if (!silent) {
        setJobsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, ownerFilter, approvedFilter, paidFilter, matchedFilter, dateFrom, dateTo, sortBy, sortOrder, currentPage]);

  useEffect(() => {
    loadSongAnalytics({ background: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'songs') {
      loadSongAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(songAnalytics.length / SONGS_PER_PAGE) || 1);
    if (songPage > maxPage) {
      setSongPage(maxPage);
    }
  }, [filteredSongs.length, songPage]);

  useEffect(() => {
    // Initial load (with loading state)
    loadAvgViewJobs();

    // Poll every 30 seconds silently in the background
    const interval = setInterval(() => {
      loadAvgViewJobs(true); // Silent polling - no loading indicator
    }, 30000); // Increased from 15s to 30s

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const result = await importReferenceOrders(file);
      setImportResult(result);
      await loadOrders();

      // Auto-refresh song analytics cache after import
      if (result.inserted > 0) {
        console.log('Auto-refreshing song analytics after import...');
        fetch('/api/songs-analytics', { method: 'POST' }).catch(err =>
          console.error('Failed to auto-refresh song cache:', err)
        );
      }
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleSyncFromSheet = async () => {
    if (!sheetUrl.trim()) {
      setBanner({ type: 'error', message: 'Enter the public Google Sheet URL first' });
      return;
    }
    setSyncingSheet(true);
    setBanner(null);
    try {
      const response = await fetch(`${API_URL}/api/v1/reference-orders/sheet-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_url: sheetUrl.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || data.error || 'Failed to sync from sheet');
      }
      if (data.last_synced_at) {
        setLastSheetSyncAt(data.last_synced_at);
      }
      setBanner({
        type: 'success',
        message: `Synced ${data.imported ?? 0} new orders from sheet`,
      });
      await loadOrders();
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to sync from sheet' });
    } finally {
      setSyncingSheet(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm('Delete this order entry? This action cannot be undone.')) {
      return;
    }
    setDeletingOrderId(orderId);
    try {
      const response = await fetch(`/api/reference-orders?id=${orderId}`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete order');
      }
      setBanner({ type: 'success', message: 'Order entry deleted' });
      await loadOrders();
    } catch (err: any) {
      setBanner({ type: 'error', message: err.message || 'Failed to delete order' });
    } finally {
      setDeletingOrderId(null);
    }
  };

  const handleToggleCreatorSelection = (order: ReferenceOrderRow) => {
    const normalized = normalizeHandle(order.normalized_username || order.username);
    if (!normalized) return;
    setSelectedCreators((prev) => {
      const updated = { ...prev };
      if (updated[normalized]) {
        delete updated[normalized];
      } else {
        const display = order.username || order.normalized_username || normalized;
        updated[normalized] = {
          display,
          handle: display.replace(/^@/, '').trim() || normalized,
        };
      }
      return updated;
    });
  };

  const handleSelectPageCreators = () => {
    setSelectedCreators((prev) => {
      const updated = { ...prev };
      orders.forEach((order) => {
        const normalized = normalizeHandle(order.normalized_username || order.username);
        if (!normalized) return;
        if (!updated[normalized]) {
          const display = order.username || order.normalized_username || normalized;
          updated[normalized] = {
            display,
            handle: display.replace(/^@/, '').trim() || normalized,
          };
        }
      });
      return updated;
    });
  };

  const handleClearSelectedCreators = () => {
    setSelectedCreators({});
  };

  const handleStartAvgViewJob = async (mode: 'manual' | 'all') => {
    if (mode === 'manual' && selectedCreatorCount === 0) {
      setBanner({ type: 'error', message: 'Select at least one creator first' });
      return;
    }
    try {
      setAvgViewProcessing(true);
      const payload =
        mode === 'manual'
          ? { usernames: Object.values(selectedCreators).map((entry) => entry.handle), mode: 'manual' }
          : { mode: 'all' };

      const response = await fetch(`${API_URL}/api/v1/reference-orders/avg-views/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          skip_existing: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Failed to start avg view calculation');
      }

      // Check if a job is already running
      if (data.already_running) {
        setBanner({
          type: 'error',
          message: data.message || 'A job is already running. Please wait for it to complete.',
        });
        loadAvgViewJobs(); // Refresh jobs list to show the running job
        return;
      }

      setBanner({
        type: 'success',
        message:
          mode === 'manual'
            ? `Queued avg view calculation for ${selectedCreatorCount} creator${selectedCreatorCount === 1 ? '' : 's'}`
            : 'Queued avg view calculation for all creators',
      });
      if (mode === 'manual') {
        setSelectedCreators({});
      }
      loadAvgViewJobs();
    } catch (err: any) {
      console.error('Avg view job error:', err);
      setBanner({ type: 'error', message: err.message || 'Failed to start avg view calculation' });
    } finally {
      setAvgViewProcessing(false);
    }
  };

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      // Toggle order
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to descending
      setSortBy(column);
      setSortOrder('desc');
    }
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  const clearFilters = () => {
    setSearch('');
    setOwnerFilter('');
    setApprovedFilter('');
    setPaidFilter('');
    setMatchedFilter('');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  const openManualModal = () => {
    setManualError(null);
    setManualOrder({ ...manualOrderDefaults });
    setManualModalOpen(true);
  };

  const closeManualModal = () => {
    if (manualSaving) return;
    setManualModalOpen(false);
    setManualError(null);
  };

  const handleManualOrderSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manualOrder.username.trim()) {
      setManualError('Creator handle is required');
      return;
    }
    setManualSaving(true);
    setManualError(null);

    const toNumber = (value: string) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
    };

    const payload = {
      username: manualOrder.username.trim(),
      email: manualOrder.email?.trim() || null,
      accountLink: manualOrder.accountLink?.trim() || null,
      ownerName: manualOrder.ownerName?.trim() || null,
      pricePerVideo: toNumber(manualOrder.pricePerVideo),
      priceUsd: toNumber(manualOrder.priceUsd),
      finalPrice: toNumber(manualOrder.finalPrice),
      totalFeePerImport: toNumber(manualOrder.totalFeePerImport),
      videoCount: manualOrder.videoCount ? Number(manualOrder.videoCount) : null,
      songs: manualOrder.songs?.trim() || null,
      videoLinks: manualOrder.videoLinks?.trim() || null,
      datePaid: manualOrder.datePaid || null,
      approvedVendor: manualOrder.approvedVendor,
      paid: manualOrder.paid,
    };

    try {
      const response = await fetch('/api/reference-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create order');
      }

      setBanner({ type: 'success', message: `Saved order for @${manualOrder.username.replace(/^@/, '')}` });
      setManualOrder({ ...manualOrderDefaults });
      setManualModalOpen(false);
      await loadOrders();
    } catch (err: any) {
      setManualError(err.message || 'Failed to create order');
    } finally {
      setManualSaving(false);
    }
  };

  const openEditModal = (order: ReferenceOrderRow) => {
    setEditError(null);
    setEditingOrderId(order.id);
    setEditForm({
      username: order.username || '',
      email: order.email || '',
      accountLink: order.account_link || '',
      ownerName: order.owner_name || '',
      pricePerVideo: toInputValue(order.price_per_video),
      priceUsd: toInputValue(order.price_usd),
      finalPrice: toInputValue(order.final_price),
      totalFeePerImport: toInputValue(order.total_fee_per_import),
      videoCount: toInputValue(order.video_count),
      songs: order.songs || '',
      videoLinks: order.video_links || '',
      datePaid: formatDateForInput(order.date_paid),
      approvedVendor: Boolean(order.approved_vendor),
      paid: Boolean(order.paid),
    });
    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditModalOpen(false);
    setEditingOrderId(null);
    setEditForm({ ...manualOrderDefaults });
  };

  const handleEditOrderSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingOrderId) return;
    setEditSaving(true);
    setEditError(null);

    const payload = {
      id: editingOrderId,
      username: editForm.username,
      email: editForm.email,
      accountLink: editForm.accountLink,
      ownerName: editForm.ownerName,
      pricePerVideo: editForm.pricePerVideo,
      priceUsd: editForm.priceUsd,
      finalPrice: editForm.finalPrice,
      totalFeePerImport: editForm.totalFeePerImport,
      videoCount: editForm.videoCount,
      songs: editForm.songs,
      videoLinks: editForm.videoLinks,
      datePaid: editForm.datePaid,
      approvedVendor: editForm.approvedVendor,
      paid: editForm.paid,
    };

    try {
      const response = await fetch('/api/reference-orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update order');
      }

      setBanner({
        type: 'success',
        message: `Updated order ${editForm.username ? `for @${editForm.username}` : ''}`.trim(),
      });
      closeEditModal();
      await loadOrders();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update order');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <>
      <div>
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Orders</h1>
            <p className="text-gray-600">
              Track historical collaborations, pricing, and owner activity for scraped influencers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={openManualModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Order
            </button>
            <label className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg cursor-pointer hover:bg-primary-700 transition-colors">
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Import Reference Sheet
                </>
              )}
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileUpload}
                disabled={importing}
              />
            </label>
          </div>
        </div>

        {/* Google Sheet sync */}
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Sync from Google Sheet</p>
              <p className="text-xs text-gray-600">
                Paste the public URL of your orders Google Sheet (with a <code>created_at</code> column). Only rows
                added after the last sync will be imported.
              </p>
            </div>
            {lastSheetSyncAt && (
              <p className="text-xs text-gray-500">
                Last sync:{' '}
                {new Date(lastSheetSyncAt).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="text"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="flex-1 min-w-[240px] rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
            />
            <button
              type="button"
              onClick={handleSyncFromSheet}
              disabled={syncingSheet}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {syncingSheet ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Sync New Rows
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'orders'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
          >
            <Users className="w-4 h-4" />
            Orders List ({totalRecords})
          </button>
          <button
            onClick={() => setActiveTab('songs')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'songs'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
          >
            <Music className="w-4 h-4" />
            Song Analytics ({songTotals.total_songs})
          </button>
        </div>

        {importResult && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900">Import Completed</p>
              <p className="text-sm text-green-800">
                Added {importResult.inserted} new rows. Skipped {importResult.skipped} duplicates out of {importResult.total_rows} rows.
              </p>
            </div>
          </div>
        )}

        {banner && (
          <div
            className={`mb-4 p-4 border rounded-lg flex items-start gap-3 ${banner.type === 'success'
              ? 'bg-blue-50 border-blue-200 text-blue-900'
              : 'bg-red-50 border-red-200 text-red-900'
              }`}
          >
            <CheckCircle2
              className={`w-5 h-5 flex-shrink-0 mt-0.5 ${banner.type === 'success' ? 'text-blue-600' : 'text-red-600'
                }`}
            />
            <div className="flex-1">
              <p className="font-semibold">
                {banner.type === 'success' ? 'Success' : 'Something went wrong'}
              </p>
              <p className="text-sm">{banner.message}</p>
            </div>
            <button
              className={`${banner.type === 'success' ? 'text-blue-500 hover:text-blue-700' : 'text-red-500 hover:text-red-700'}`}
              onClick={() => setBanner(null)}
              aria-label="Dismiss message"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900">Error</p>
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Total Orders</p>
                <p className="text-2xl font-bold text-gray-900">{numberFormatter.format(stats.totalOrders)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Unique Creators</p>
                <p className="text-2xl font-bold text-gray-900">{numberFormatter.format(stats.totalCreators)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Average Price / Video</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrencyValue(stats.avgPricePerVideo)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Total Spend</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrencyValue(stats.totalSpend)}</p>
              </div>
            </div>

            {/* Avg Views Controls */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Avg Views Calculator</h3>
                  <p className="text-sm text-gray-600">
                    Select creators from the table (unique selection) or queue all {numberFormatter.format(stats.totalCreators || 0)} creators.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleSelectPageCreators}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Select Page Creators
                  </button>
                  <button
                    onClick={handleClearSelectedCreators}
                    disabled={selectedCreatorCount === 0}
                    className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clear Selection
                  </button>
                  <button
                    onClick={() => handleStartAvgViewJob('manual')}
                    disabled={selectedCreatorCount === 0 || avgViewProcessing || hasRunningJob || jobsLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={hasRunningJob ? 'A job is already running' : jobsLoading ? 'Loading jobs...' : ''}
                  >
                    {avgViewProcessing || hasRunningJob || jobsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                    Calculate Selected
                  </button>
                  <button
                    onClick={() => handleStartAvgViewJob('all')}
                    disabled={avgViewProcessing || hasRunningJob || jobsLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={hasRunningJob ? 'A job is already running' : jobsLoading ? 'Loading jobs...' : ''}
                  >
                    {avgViewProcessing || hasRunningJob || jobsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Calculate All Creators
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600 mt-3">
                Selected creators:{' '}
                <span className="font-semibold text-gray-900">{numberFormatter.format(selectedCreatorCount)}</span>. Previously
                processed creators are skipped automatically.
              </p>
              {hasRunningJob && runningJob && (
                <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <Loader2 className="w-4 h-4 text-yellow-600 mt-0.5 animate-spin flex-shrink-0" />
                    <p className="text-sm text-yellow-800">
                      <span className="font-semibold">Job in progress:</span> Another avg view calculation job is currently running.
                      Please wait for it to complete before starting a new one.
                    </p>
                  </div>
                  <button
                    onClick={() => forceStopJob(runningJob.id)}
                    disabled={isForceStopping}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 flex-shrink-0"
                    title="Force stop this job if it's stuck or you want to cancel it"
                  >
                    <StopCircle className="w-4 h-4" />
                    {isForceStopping ? 'Stopping...' : 'Force Stop'}
                  </button>
                </div>
              )}
            </div>

            {/* Recent Avg View Jobs */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Recent Avg View Jobs</h3>
                  <p className="text-sm text-gray-500">Track long running Apify batches.</p>
                </div>
                <button
                  onClick={() => loadAvgViewJobs()}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>
              {jobsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                </div>
              ) : avgViewJobs.length === 0 ? (
                <p className="text-sm text-gray-500">No avg view jobs have been queued yet.</p>
              ) : (
                <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
                        <th className="px-4 py-3">Mode</th>
                        <th className="px-4 py-3">Requested</th>
                        <th className="px-4 py-3">Processed</th>
                        <th className="px-4 py-3">Skipped</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedJobs.map((job) => (
                        <tr key={job.id} className="border-b border-gray-100 last:border-0">
                          <td className="px-4 py-3 text-gray-700 capitalize">{job.mode || 'manual'}</td>
                          <td className="px-4 py-3 text-gray-900 font-medium">
                            {numberFormatter.format(job.total_requested ?? 0)}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {numberFormatter.format(job.total_processed ?? 0)}{' '}
                            <span className="text-xs text-gray-500">
                              / {numberFormatter.format(job.total_enqueued ?? job.total_requested ?? 0)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {numberFormatter.format(job.total_skipped ?? 0)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getJobStatusBadge(
                                job.status,
                              )}`}
                            >
                              {job.status}
                            </span>
                            {job.error_message && (
                              <p className="text-xs text-red-500 mt-1 truncate max-w-[200px]">{job.error_message}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{formatDateValue(job.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Jobs Pagination */}
                {jobsPageCount > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                    <span className="text-sm text-gray-600">
                      Page {jobsPage} of {jobsPageCount} ({avgViewJobs.length} jobs)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                        disabled={jobsPage <= 1}
                        className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setJobsPage((p) => Math.min(jobsPageCount, p + 1))}
                        disabled={jobsPage >= jobsPageCount}
                        className="px-3 py-1 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
                </>
              )}
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
              <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Filter className="w-5 h-5 text-gray-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => loadOrders()}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh Orders
                  </button>
                  <button onClick={clearFilters} className="text-sm text-blue-600 hover:text-blue-700">
                    Clear filters
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Search Creator</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => {
                        setCurrentPage(1);
                        setSearch(e.target.value);
                      }}
                      placeholder="Username or link"
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Owner / Employee</label>
                  <input
                    type="text"
                    value={ownerFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setOwnerFilter(e.target.value);
                    }}
                    placeholder="e.g. Ryan"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Approved Vendor</label>
                  <select
                    value={approvedFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setApprovedFilter(e.target.value);
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Payment Status</label>
                  <select
                    value={paidFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setPaidFilter(e.target.value);
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">All</option>
                    <option value="paid">Paid</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Matched to Scraper</label>
                  <select
                    value={matchedFilter}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setMatchedFilter(e.target.value);
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">All creators</option>
                    <option value="true">Matched influencers</option>
                    <option value="false">Not in database</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date From</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setDateFrom(e.target.value);
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date To</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setCurrentPage(1);
                      setDateTo(e.target.value);
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
              </div>
            </div>

            {/* Owner leaderboard */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-900">Top Employees by Orders</h3>
              </div>
              {ownerStats.length === 0 ? (
                <p className="text-sm text-gray-500">No owner data available yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {ownerStats.map((owner) => (
                    <div key={owner.owner_name} className="border border-gray-200 rounded-lg p-4">
                      <p className="text-sm text-gray-500">Owner</p>
                      <p className="text-lg font-semibold text-gray-900">{owner.owner_name || 'Unassigned'}</p>
                      <p className="text-sm text-gray-500">{owner.total_orders} orders</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Orders Table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
                </div>
              ) : orders.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-gray-500 mb-2">No reference orders found.</p>
                  <p className="text-sm text-gray-400">
                    Try adjusting your filters or import the completed-orders sheet to populate this view.
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Select</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Creator</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">
                            <button
                              onClick={() => toggleSort('owner_name')}
                              className="inline-flex items-center gap-1 hover:text-primary-600 transition-colors"
                            >
                              Owner
                              {sortBy === 'owner_name' ? (
                                sortOrder === 'asc' ? (
                                  <ArrowUp className="w-3 h-3" />
                                ) : (
                                  <ArrowDown className="w-3 h-3" />
                                )
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40" />
                              )}
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Date Paid</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Price / Video</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Approved</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Paid</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Account</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">
                            <button
                              onClick={() => toggleSort('avg_views')}
                              className="inline-flex items-center gap-1 hover:text-primary-600 transition-colors"
                            >
                              Avg Views
                              {sortBy === 'avg_views' ? (
                                sortOrder === 'asc' ? (
                                  <ArrowUp className="w-3 h-3" />
                                ) : (
                                  <ArrowDown className="w-3 h-3" />
                                )
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-40" />
                              )}
                            </button>
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Videos</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((order) => {
                          const normalized = normalizeHandle(order.normalized_username || order.username);
                          const isSelected = normalized ? Boolean(selectedCreators[normalized]) : false;
                          return (
                            <tr key={order.id} className="border-b border-gray-100 last:border-b-0">
                              <td className="px-4 py-4 text-sm">
                                {normalized ? (
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 text-primary-600 border-gray-300 rounded"
                                    checked={isSelected}
                                    onChange={() => handleToggleCreatorSelection(order)}
                                  />
                                ) : (
                                  <span className="text-xs text-gray-400">N/A</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <p className="text-sm font-semibold text-gray-900">@{order.username}</p>
                                <p className="text-xs text-gray-500">{order.email || 'No email'}</p>
                                {order.influencer_id ? (
                                  <span className="inline-flex items-center px-2 py-0.5 mt-1 bg-green-100 text-green-700 text-xs rounded-full">
                                    Matched
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 mt-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                                    Not in DB
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-700">{order.owner_name || 'Unassigned'}</td>
                              <td className="px-6 py-4 text-sm text-gray-700">
                                <div className="flex items-center gap-2">
                                  <CalendarDays className="w-4 h-4 text-blue-500" />
                                  <span>{formatDateValue(order.date_paid)}</span>
                                </div>
                                {order.video_count ? (
                                  <p className="text-xs text-gray-500">{order.video_count} videos</p>
                                ) : null}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-700">
                                <div className="flex items-center gap-2">
                                  <DollarSign className="w-4 h-4 text-green-500" />
                                  <span>{formatCurrencyValue(order.price_per_video)}</span>
                                </div>
                                {order.final_price ? (
                                  <p className="text-xs text-gray-500">Total: {formatCurrencyValue(order.final_price)}</p>
                                ) : null}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                <span
                                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${order.approved_vendor
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600'
                                    }`}
                                >
                                  {order.approved_vendor ? 'Yes' : 'No'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm">
                                <span
                                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${order.paid ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                                    }`}
                                >
                                  {order.paid ? 'Paid' : 'Pending'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm">
                                {order.account_link ? (
                                  <a
                                    href={order.account_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    View
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                {order.avg_views ? (
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">
                                      {numberFormatter.format(order.avg_views)}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      Updated {formatDateValue(order.avg_views_updated_at)}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-500">
                                    {order.avg_views_status === 'no_data' ? 'No data yet' : 'Not calculated'}
                                  </p>
                                )}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                {order.video_links && order.video_links.trim() ? (
                                  <button
                                    onClick={() => {
                                      setSelectedVideoLinks(order.video_links || '');
                                      setVideoLinksModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    <Video className="w-4 h-4" />
                                    View ({order.video_links.split('\n').filter(l => l.trim()).length})
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-400">No videos</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                  <button
                                    onClick={() => openEditModal(order)}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteOrder(order.id)}
                                    disabled={deletingOrderId === order.id}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {deletingOrderId === order.id ? (
                                      <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Deleting...
                                      </>
                                    ) : (
                                      <>
                                        <Trash2 className="w-4 h-4" />
                                        Delete
                                      </>
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      Showing {(currentPage - 1) * limit + 1} – {Math.min(currentPage * limit, (currentPage - 1) * limit + orders.length)} of{' '}
                      {numberFormatter.format(totalRecords)} orders
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Prev
                      </button>
                      <span className="text-sm text-gray-600">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Song Analytics Tab */}
        {activeTab === 'songs' && (
          <div>
            {/* Refresh Button */}
            <div className="flex justify-end mb-4">
              <button
                onClick={handleRefreshSongAnalytics}
                disabled={refreshingSongs}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {refreshingSongs ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Refreshing Cache...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Refresh Analytics
                  </>
                )}
              </button>
            </div>

            {/* Song Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Total Songs</p>
                <p className="text-2xl font-bold text-gray-900">{numberFormatter.format(songTotals.total_songs)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Total Videos</p>
                <p className="text-2xl font-bold text-gray-900">{numberFormatter.format(songTotals.total_videos)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Total Orders</p>
                <p className="text-2xl font-bold text-gray-900">{numberFormatter.format(songTotals.total_orders)}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-sm text-gray-500 mb-1">Total Spend</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrencyValue(
                    songAnalytics.reduce((sum, song) => sum + (song.total_spend || 0), 0)
                  )}
                </p>
              </div>
            </div>

            {loadingSongs ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
              </div>
            ) : songAnalytics.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-gray-200">
                <Music className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 mb-2">No song data available</p>
                <p className="text-sm text-gray-400">Import reference orders with song information to see analytics</p>
              </div>
            ) : (
              <>
                {/* Visualizations */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="w-full md:max-w-md">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Search Song Name</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={songSearch}
                          onChange={(e) => {
                            setSongPage(1);
                            setSongSearch(e.target.value);
                          }}
                          placeholder="Type to filter by song name"
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-2 md:mt-6">
                      <button
                        onClick={() => setSongSearch('')}
                        disabled={!songSearch}
                        className="text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                      >
                        Clear search
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                  {/* Orders by Song */}
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <Users className="w-5 h-5 text-green-600" />
                      Orders by Song (Top 10)
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={filteredSongs.slice(0, 10)}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="song_name" angle={-45} textAnchor="end" height={120} />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="order_count" fill="#10b981" name="Orders" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Videos by Song */}
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-blue-600" />
                      Videos by Song (Top 10)
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={filteredSongs.slice(0, 10)}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="song_name" angle={-45} textAnchor="end" height={120} />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="total_videos" fill="#3b82f6" name="Total Videos" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Song Breakdown Table */}
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
                  <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Music className="w-5 h-5" />
                      <h2 className="text-lg font-semibold text-gray-900">Song Breakdown</h2>
                    </div>
                    <p className="text-sm text-gray-500">
                      Showing {(songPage - 1) * SONGS_PER_PAGE + 1}-
                      {Math.min(songPage * SONGS_PER_PAGE, filteredSongs.length)} of{' '}
                      {numberFormatter.format(filteredSongs.length)}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Song Name</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Total Videos</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Number of Orders</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Avg Price/Video</th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600">Total Spend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedSongs.map((song, idx) => (
                          <tr key={`${song.song_name}-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-6 py-4 text-sm font-medium text-gray-900">{song.song_name}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{numberFormatter.format(song.total_videos)}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{song.order_count}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{formatCurrencyValue(song.avg_price_per_video)}</td>
                            <td className="px-6 py-4 text-sm font-semibold text-gray-900">{formatCurrencyValue(song.total_spend)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-white">
                    <button
                      onClick={() => setSongPage((prev) => Math.max(1, prev - 1))}
                      disabled={songPage === 1}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <span className="text-sm text-gray-600">
                      Page {songPage} of {songPageCount}
                    </span>
                    <button
                      onClick={() => setSongPage((prev) => Math.min(songPageCount, prev + 1))}
                      disabled={songPage === songPageCount}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {manualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Add Creator Order</h2>
                <p className="text-sm text-gray-500">Log a new collaboration manually to keep totals up to date.</p>
              </div>
              <button onClick={closeManualModal} className="text-gray-500 hover:text-gray-700" aria-label="Close modal">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleManualOrderSubmit} className="px-6 py-6 space-y-6">
              {manualError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{manualError}</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Creator Handle *</label>
                  <input
                    type="text"
                    value={manualOrder.username}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="@creator"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Owner / Employee *</label>
                  <input
                    type="text"
                    value={manualOrder.ownerName}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, ownerName: e.target.value }))}
                    placeholder="Ryan"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={manualOrder.email}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="creator@email.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Link</label>
                  <input
                    type="url"
                    value={manualOrder.accountLink}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, accountLink: e.target.value }))}
                    placeholder="https://www.tiktok.com/@creator"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price per Video (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualOrder.pricePerVideo}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, pricePerVideo: e.target.value }))}
                    placeholder="750"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quoted Price (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualOrder.priceUsd}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, priceUsd: e.target.value }))}
                    placeholder="1000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Fee / Import</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualOrder.totalFeePerImport}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, totalFeePerImport: e.target.value }))}
                    placeholder="1500"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Final Price Paid</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualOrder.finalPrice}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, finalPrice: e.target.value }))}
                    placeholder="1500"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"># of Videos</label>
                  <input
                    type="number"
                    min="1"
                    value={manualOrder.videoCount}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, videoCount: e.target.value }))}
                    placeholder="2"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Song / Notes</label>
                  <input
                    type="text"
                    value={manualOrder.songs}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, songs: e.target.value }))}
                    placeholder="Artist - Song"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Video Links</label>
                  <textarea
                    value={manualOrder.videoLinks}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, videoLinks: e.target.value }))}
                    placeholder="Paste video URLs here (one per line)&#10;https://www.tiktok.com/@creator/video/123456789&#10;https://www.tiktok.com/@creator/video/987654321"
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">Add TikTok video URLs to track delivered content (one URL per line)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date Paid</label>
                  <input
                    type="date"
                    value={manualOrder.datePaid}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, datePaid: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                    checked={manualOrder.approvedVendor}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, approvedVendor: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-700">Approved vendor</span>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                    checked={manualOrder.paid}
                    onChange={(e) => setManualOrder((prev) => ({ ...prev, paid: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-700">Payment received</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeManualModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
                  disabled={manualSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manualSaving}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {manualSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {manualSaving ? 'Saving...' : 'Save order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Edit Order</h2>
                <p className="text-sm text-gray-500">Adjust pricing, ownership, or payment info directly from this panel.</p>
              </div>
              <button onClick={closeEditModal} className="text-gray-500 hover:text-gray-700" aria-label="Close edit modal">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditOrderSubmit} className="px-6 py-6 space-y-6">
              {editError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{editError}</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Creator Handle *</label>
                  <input
                    type="text"
                    value={editForm.username}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder="@creator"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Owner / Employee</label>
                  <input
                    type="text"
                    value={editForm.ownerName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, ownerName: e.target.value }))}
                    placeholder="Ryan"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="creator@email.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Link</label>
                  <input
                    type="url"
                    value={editForm.accountLink}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, accountLink: e.target.value }))}
                    placeholder="https://www.tiktok.com/@creator"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price per Video (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.pricePerVideo}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, pricePerVideo: e.target.value }))}
                    placeholder="750"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quoted Price (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.priceUsd}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, priceUsd: e.target.value }))}
                    placeholder="1000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Fee / Import</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.totalFeePerImport}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, totalFeePerImport: e.target.value }))}
                    placeholder="1500"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Final Price Paid</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.finalPrice}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, finalPrice: e.target.value }))}
                    placeholder="1500"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1"># of Videos</label>
                  <input
                    type="number"
                    min="1"
                    value={editForm.videoCount}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, videoCount: e.target.value }))}
                    placeholder="2"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Song / Notes</label>
                  <input
                    type="text"
                    value={editForm.songs}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, songs: e.target.value }))}
                    placeholder="Artist - Song"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Video Links</label>
                  <textarea
                    value={editForm.videoLinks}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, videoLinks: e.target.value }))}
                    placeholder="Paste video URLs here (one per line)&#10;https://www.tiktok.com/@creator/video/123456789&#10;https://www.tiktok.com/@creator/video/987654321"
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">Add TikTok video URLs to track delivered content (one URL per line)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date Paid</label>
                  <input
                    type="date"
                    value={editForm.datePaid}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, datePaid: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                    checked={editForm.approvedVendor}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, approvedVendor: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-700">Approved vendor</span>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                    checked={editForm.paid}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, paid: e.target.checked }))}
                  />
                  <span className="text-sm text-gray-700">Payment received</span>
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

      {/* Video Links Modal */}
      {videoLinksModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Video className="w-5 h-5 text-blue-600" />
                Video Links
              </h3>
              <button
                onClick={() => setVideoLinksModalOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="px-6 py-6 overflow-y-auto flex-1">
              {selectedVideoLinks && selectedVideoLinks.trim() ? (
                <div className="space-y-3">
                  {selectedVideoLinks.split('\n').filter(link => link.trim()).map((link, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <span className="text-sm font-medium text-gray-500 min-w-[30px]">#{index + 1}</span>
                      <a
                        href={link.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-sm text-blue-600 hover:text-blue-800 hover:underline truncate font-mono"
                        title={link.trim()}
                      >
                        {link.trim()}
                      </a>
                      <a
                        href={link.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 hover:bg-white rounded-lg transition-colors"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-4 h-4 text-gray-500" />
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">No video links available</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setVideoLinksModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

