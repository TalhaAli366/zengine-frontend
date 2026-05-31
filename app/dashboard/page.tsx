'use client';

import { Users, TrendingUp, Mail, DollarSign, Plus, Search, Send, FolderPlus, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getDashboardStats, getRecentActivities, Activity } from '@/lib/api';

const ACTIVITY_PAGE_SIZE = 10;

interface Stats {
  total_influencers: number;
  active_campaigns: number;
  emails_sent: number;
  total_spent: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    total_influencers: 0,
    active_campaigns: 0,
    emails_sent: 0,
    total_spent: 0,
  });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPageCount, setActivityPageCount] = useState(1);

  useEffect(() => {
    const loadStats = async () => {
      setLoadingStats(true);
      const statsData = await getDashboardStats();
      setStats(statsData);
      setLoadingStats(false);
    };

    loadStats();
  }, []);

  useEffect(() => {
    const loadActivities = async () => {
      setLoadingActivities(true);
      const result = await getRecentActivities(activityPage, ACTIVITY_PAGE_SIZE);
      setActivities(result.activities);
      setActivityTotal(result.total);
      setActivityPageCount(result.totalPages);
      setLoadingActivities(false);
    };

    loadActivities();
  }, [activityPage]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'scraper':
        return <Search className="w-5 h-5" />;
      case 'outreach':
        return <Send className="w-5 h-5" />;
      case 'campaign':
        return <FolderPlus className="w-5 h-5" />;
      default:
        return <Clock className="w-5 h-5" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'sent':
      case 'active':
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'running':
      case 'pending':
        return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Dashboard</h1>
        <p className="text-gray-600">Welcome back! Here's an overview of your campaigns.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
              <Users className="w-6 h-6 text-primary-600" />
            </div>
          </div>
          <h3 className="text-gray-600 text-sm font-medium mb-1">Total Influencers</h3>
          <p className="text-3xl font-bold text-gray-900">{loadingStats ? '...' : stats.total_influencers}</p>
          <p className="text-sm text-green-600 mt-2">Ready to reach out</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-purple-600" />
            </div>
          </div>
          <h3 className="text-gray-600 text-sm font-medium mb-1">Active Campaigns</h3>
          <p className="text-3xl font-bold text-gray-900">{loadingStats ? '...' : stats.active_campaigns}</p>
          <p className="text-sm text-gray-500 mt-2">In progress</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Mail className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <h3 className="text-gray-600 text-sm font-medium mb-1">Emails Sent</h3>
          <p className="text-3xl font-bold text-gray-900">{loadingStats ? '...' : stats.emails_sent}</p>
          <p className="text-sm text-gray-500 mt-2">All time</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <h3 className="text-gray-600 text-sm font-medium mb-1">Total Spent</h3>
          <p className="text-3xl font-bold text-gray-900">{loadingStats ? '...' : `$${stats.total_spent}`}</p>
          <p className="text-sm text-gray-500 mt-2">Across all campaigns</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200 mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/dashboard/scrapers" className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-all text-left">
            <h3 className="font-semibold text-gray-900 mb-1">🔍 Run Scraper</h3>
            <p className="text-sm text-gray-600">Discover new influencers</p>
          </Link>
          <Link href="/dashboard/influencers" className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-all text-left">
            <h3 className="font-semibold text-gray-900 mb-1">👥 Influencers</h3>
            <p className="text-sm text-gray-600">View and manage database</p>
          </Link>
          <Link href="/dashboard/campaigns" className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-all text-left">
            <h3 className="font-semibold text-gray-900 mb-1">📊 Campaigns</h3>
            <p className="text-sm text-gray-600">Track active campaigns</p>
          </Link>
          <Link href="/dashboard/outreach" className="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-all text-left">
            <h3 className="font-semibold text-gray-900 mb-1">✉️ Outreach</h3>
            <p className="text-sm text-gray-600">Send bulk emails</p>
          </Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Activity</h2>
        {loadingActivities ? (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
          </div>
        ) : activities.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No recent activity yet</p>
          <p className="text-sm text-gray-400 mt-2">Your activity will appear here once you start using the platform</p>
        </div>
        ) : (
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 flex-shrink-0">
                  {getActivityIcon(activity.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{activity.title}</h3>
                    {getStatusIcon(activity.status)}
                  </div>
                  <p className="text-sm text-gray-600 mb-1">{activity.description}</p>
                  {activity.metadata && (
                    <div className="text-xs text-gray-500">
                      {activity.metadata.total_results !== undefined && (
                        <span>{activity.metadata.total_results} results</span>
                      )}
                      {activity.metadata.new_influencers !== undefined && activity.metadata.new_influencers > 0 && (
                        <span className="ml-2">{activity.metadata.new_influencers} new</span>
                      )}
                      {activity.metadata.updated_influencers !== undefined && activity.metadata.updated_influencers > 0 && (
                        <span className="ml-2">{activity.metadata.updated_influencers} updated</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-400 flex-shrink-0">
                  {formatTimestamp(activity.timestamp)}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-gray-200 pt-4 mt-4">
              <p className="text-sm text-gray-600">
                Showing {(activityPage - 1) * ACTIVITY_PAGE_SIZE + 1}-
                {Math.min(activityPage * ACTIVITY_PAGE_SIZE, activityTotal)} of {activityTotal} activities
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActivityPage((prev) => Math.max(1, prev - 1))}
                  disabled={activityPage === 1}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="text-sm text-gray-600">
                  Page {activityPage} of {activityPageCount}
                </span>
                <button
                  onClick={() => setActivityPage((prev) => Math.min(activityPageCount, prev + 1))}
                  disabled={activityPage === activityPageCount}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
