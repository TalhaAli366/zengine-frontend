import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Note: Cache refresh is now handled by backend asyncpg endpoint
    // No need to process queue here - backend handles it directly

    // Check if cache exists and is recent
    const { data: cacheCheck, error: cacheCheckError } = await supabase
      .from('song_analytics_cache')
      .select('song_name')
      .limit(1);

    // If cache doesn't exist or refresh requested, refresh it via backend
    if (cacheCheckError || !cacheCheck || cacheCheck.length === 0 || forceRefresh) {
      console.log('Refreshing song analytics cache...');
      
      try {
        // Call backend endpoint that uses asyncpg for reliable refresh
        const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(`${backendUrl}/api/v1/song-analytics/refresh-cache`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        
        if (response.ok) {
        console.log('Song analytics cache refreshed successfully');
        } else {
          console.error('Failed to refresh cache:', await response.text());
        }
      } catch (refreshError: any) {
        console.error('Error refreshing cache:', refreshError);
        // Continue anyway - try to read whatever data exists
      }
    }

    const pageSize = 1000;
    let from = 0;
    const songs: any[] = [];

    while (true) {
      const to = from + pageSize - 1;
      const { data: batch, error } = await supabase
        .from('song_analytics_cache')
        .select('*')
        .order('total_videos', { ascending: false })
        .range(from, to);

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      songs.push(...batch);

      if (batch.length < pageSize) {
        break;
      }

      from += pageSize;
    }

    // Calculate totals
    const sanitizedSongs = songs
      .filter((song) => {
        if (!song?.song_name) return false;
        return song.song_name.trim().length > 0;
      })
      .map((song) => ({
        ...song,
        song_name: song.song_name.trim(),
      }));

    const totals = {
      total_songs: sanitizedSongs.length || 0,
      total_videos: sanitizedSongs.reduce((sum: number, song: any) => sum + (parseInt(song.total_videos) || 0), 0) || 0,
      total_orders: 0, // Will get from reference_orders count
    };

    // Get total orders count
    const { count } = await supabase
      .from('reference_orders')
      .select('*', { count: 'exact', head: true });
    
    totals.total_orders = count || 0;

    return Response.json({
      songs: sanitizedSongs || [],
      totals,
      cached: true,
    });
  } catch (error: any) {
    console.error('Songs analytics API error:', error);
    return Response.json({ error: error.message || 'Failed to load song analytics' }, { status: 500 });
  }
}

// POST endpoint to manually refresh the cache
export async function POST() {
  try {
    const supabase = createServerComponentClient({ cookies });
    
    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Manually refreshing song analytics cache...');
    
    // Call backend endpoint that uses asyncpg for reliable refresh
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    try {
      const response = await fetch(`${backendUrl}/api/v1/song-analytics/refresh-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to refresh cache');
      }
      
      const result = await response.json();
    console.log('Song analytics cache refreshed successfully');

    return Response.json({ 
      success: true, 
        message: result.message || 'Song analytics cache refreshed successfully'
    });
    } catch (err: any) {
      console.error('Refresh cache error:', err);
      return Response.json({ 
        error: err.message || 'Failed to refresh cache' 
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Refresh cache error:', error);
    return Response.json({ error: error.message || 'Failed to queue cache refresh' }, { status: 500 });
  }
}

