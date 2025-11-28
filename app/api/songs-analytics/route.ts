import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Check if cache exists and is recent
    const { data: cacheCheck, error: cacheCheckError } = await supabase
      .from('song_analytics_cache')
      .select('song_name')
      .limit(1);

    // If cache doesn't exist or refresh requested, refresh it
    if (cacheCheckError || !cacheCheck || cacheCheck.length === 0 || forceRefresh) {
      console.log('Refreshing song analytics cache...');
      
      try {
        // Call the refresh function
        await supabase.rpc('refresh_song_analytics_cache');
        console.log('Song analytics cache refreshed successfully');
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
    
    // Call the refresh function
    const { error } = await supabase.rpc('refresh_song_analytics_cache');
    
    if (error) throw error;

    console.log('Song analytics cache refreshed successfully');

    return Response.json({ 
      success: true, 
      message: 'Song analytics cache refreshed successfully' 
    });
  } catch (error: any) {
    console.error('Refresh cache error:', error);
    return Response.json({ error: error.message || 'Failed to refresh cache' }, { status: 500 });
  }
}

