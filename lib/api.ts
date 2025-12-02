const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface Influencer {
  id: string;
  username: string;
  display_name?: string;
  followers?: number;
  total_likes?: number;
  avg_views?: number;
  engagement_rate?: number;
  email?: string;
  country?: string;
  is_business?: boolean;
  last_scraped?: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  created_at?: string;
  influencer_count?: number;
}

export interface ImportResult {
  success: boolean;
  total_rows: number;
  imported: number;
  updated: number;
  failed: number;
  errors: string[];
}

export interface ReferenceImportResult {
  success: boolean;
  total_rows: number;
  inserted: number;
  skipped: number;
}

export interface DashboardStats {
  total_influencers: number;
  active_campaigns: number;
  emails_sent: number;
  total_spent: number;
}

export interface Activity {
  id: string;
  type: 'scraper' | 'outreach' | 'campaign';
  title: string;
  description: string;
  status: string;
  timestamp: string;
  metadata?: any;
}

// Influencer API calls
export async function getInfluencers(): Promise<Influencer[]> {
  try {
    const response = await fetch(`/api/influencers`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error('Failed to fetch influencers');
    return await response.json();
  } catch (error) {
    console.error('Error fetching influencers:', error);
    return [];
  }
}

export async function getCampaigns(): Promise<Campaign[]> {
  try {
    const response = await fetch(`/api/campaigns`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error('Failed to fetch campaigns');
    return await response.json();
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return [];
  }
}

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const response = await fetch(`/api/stats`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error('Failed to fetch stats');
    return await response.json();
  } catch (error) {
    console.error('Error fetching stats:', error);
    return {
      total_influencers: 0,
      active_campaigns: 0,
      emails_sent: 0,
      total_spent: 0,
    };
  }
}

export async function importInfluencers(file: File): Promise<ImportResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_URL}/api/v1/import-export/import`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Import failed');
    }

    return await response.json();
  } catch (error: any) {
    throw new Error(error.message || 'Import failed');
  }
}

export async function importReferenceOrders(file: File): Promise<ReferenceImportResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_URL}/api/v1/reference-orders/import`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Import failed');
    }

    return await response.json();
  } catch (error: any) {
    throw new Error(error.message || 'Import failed');
  }
}

export async function exportInfluencers(format: 'csv' | 'excel'): Promise<Blob> {
  try {
    const endpoint = format === 'csv' ? 'export/csv' : 'export/excel';
    const response = await fetch(`${API_URL}/api/v1/import-export/${endpoint}`);

    if (!response.ok) throw new Error('Export failed');
    return await response.blob();
  } catch (error: any) {
    throw new Error(error.message || 'Export failed');
  }
}

export async function downloadTemplate(format: 'csv' | 'excel'): Promise<Blob> {
  try {
    const endpoint = format === 'csv' ? 'template/csv' : 'template/excel';
    const response = await fetch(`${API_URL}/api/v1/import-export/${endpoint}`);

    if (!response.ok) throw new Error('Download failed');
    return await response.blob();
  } catch (error: any) {
    throw new Error(error.message || 'Download failed');
  }
}

export async function exportReferenceOrders(format: 'csv' | 'excel'): Promise<Blob> {
  try {
    const endpoint = format === 'csv' ? 'export/csv' : 'export/excel';
    const response = await fetch(`${API_URL}/api/v1/reference-orders/${endpoint}`);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Export failed');
    }
    return await response.blob();
  } catch (error: any) {
    throw new Error(error.message || 'Export failed');
  }
}

export async function detectRegion(influencerIds: string[]): Promise<{ status: string; message: string; processed: number; total: number }> {
  try {
    const response = await fetch(`${API_URL}/api/v1/scrapers/detect-region`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ influencer_ids: influencerIds }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Region detection failed');
    }

    return await response.json();
  } catch (error: any) {
    throw new Error(error.message || 'Region detection failed');
  }
}

export async function getRecentActivities(): Promise<Activity[]> {
  try {
    const response = await fetch(`/api/activities`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) throw new Error('Failed to fetch activities');
    const data = await response.json();
    return data.activities || [];
  } catch (error) {
    console.error('Error fetching activities:', error);
    return [];
  }
}

