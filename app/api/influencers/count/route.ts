import { NextRequest } from 'next/server';
import { getServerClient } from '@/lib/supabase/server-singleton';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  try {
    const supabase = getServerClient();
    const searchParams = request.nextUrl.searchParams;

    const campaignId = searchParams.get('campaign');
    const searchQuery = searchParams.get('search');
    const minFollowers = searchParams.get('min_followers');
    const maxFollowers = searchParams.get('max_followers');
    const minEngagementRate = searchParams.get('min_engagement_rate');
    const maxEngagementRate = searchParams.get('max_engagement_rate');
    const minAvgViews = searchParams.get('min_avg_views');
    const maxAvgViews = searchParams.get('max_avg_views');
    const country = searchParams.get('country');
    const hashtagId = searchParams.get('hashtag_id');
    const soundId = searchParams.get('sound_id');
    const reachedOut = searchParams.get('reached_out');
    const hasEmail = searchParams.get('has_email');

    // For personal email filter, skip count (too expensive)
    if (searchParams.get('only_personal_email') === 'true') {
      return Response.json({ total: -1, approximate: true });
    }

    const chunkSize = 1000;

    // Resolve influencer IDs if filtering by campaign/hashtag/sound
    let influencerIds: string[] | null = null;

    if (campaignId) {
      const { data: campaignLinks } = await supabase
        .from('campaign_influencers')
        .select('influencer_id')
        .eq('campaign_id', campaignId);
      influencerIds = (campaignLinks || []).map((l: any) => l.influencer_id).filter(Boolean);
    }

    if (hashtagId) {
      const { data: hashtagLinks } = await supabase
        .from('influencer_hashtags')
        .select('influencer_id')
        .eq('hashtag_id', parseInt(hashtagId));
      const hashtagIds = (hashtagLinks || []).map((l: any) => l.influencer_id).filter(Boolean);
      if (influencerIds) {
        influencerIds = influencerIds.filter(id => hashtagIds.includes(id));
      } else {
        influencerIds = hashtagIds;
      }
    }

    if (soundId) {
      const { data: soundLinks } = await supabase
        .from('influencer_sounds')
        .select('influencer_id')
        .eq('sound_id', parseInt(soundId));
      const soundIds = (soundLinks || []).map((l: any) => l.influencer_id).filter(Boolean);
      if (influencerIds) {
        influencerIds = influencerIds.filter(id => soundIds.includes(id));
      } else {
        influencerIds = soundIds;
      }
    }

    // If we have influencer IDs and none match, skip count query
    if (influencerIds && influencerIds.length === 0) {
      return Response.json({ total: 0, approximate: false });
    }

    // For unfiltered queries, try pg_class.reltuples via RPC for instant count
    const hasFilters = searchQuery || minFollowers || maxFollowers || minEngagementRate || maxEngagementRate || minAvgViews || maxAvgViews || country || campaignId || hashtagId || soundId || reachedOut || hasEmail;

    if (!hasFilters) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_influencer_count');
        if (!rpcError && rpcData !== null && rpcData !== undefined) {
          console.log(`[INFLUENCERS COUNT API] pg_class.reltuples: ${Date.now() - t0}ms (count=${rpcData}, approximate)`);
          return Response.json({ total: rpcData, approximate: true });
        }
      } catch {
        // RPC not available, fall through to exact count
      }
    }

    // Build count query with filters
    let countQuery = supabase
      .from('influencers')
      .select('*', { count: 'exact', head: true });

    if (influencerIds && influencerIds.length > 0 && influencerIds.length <= chunkSize) {
      countQuery = countQuery.in('id', influencerIds);
    }
    if (searchQuery) {
      countQuery = countQuery.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
    }
    if (minFollowers) {
      countQuery = countQuery.gte('followers', parseInt(minFollowers));
    }
    if (maxFollowers) {
      countQuery = countQuery.lte('followers', parseInt(maxFollowers));
    }
    if (minEngagementRate) {
      countQuery = countQuery.gte('engagement_rate', parseFloat(minEngagementRate));
    }
    if (maxEngagementRate) {
      countQuery = countQuery.lte('engagement_rate', parseFloat(maxEngagementRate));
    }
    if (minAvgViews) {
      countQuery = countQuery.gte('avg_views', parseFloat(minAvgViews));
    }
    if (maxAvgViews) {
      countQuery = countQuery.lte('avg_views', parseFloat(maxAvgViews));
    }
    if (country) {
      countQuery = countQuery.ilike('country', `%${country}%`);
    }
    if (reachedOut === 'true') {
      countQuery = countQuery.eq('has_outreach', true);
    } else if (reachedOut === 'false') {
      countQuery = countQuery.eq('has_outreach', false);
    }
    if (hasEmail === 'true') {
      countQuery = countQuery.not('email', 'is', null).not('email', 'eq', '');
    }

    const { count, error } = await countQuery;
    if (error) throw error;

    console.log(`[INFLUENCERS COUNT API] Exact count: ${Date.now() - t0}ms (count=${count})`);
    return Response.json({ total: count || 0, approximate: false });
  } catch (error: any) {
    console.error('[INFLUENCERS COUNT API] Error:', error);
    return Response.json({ total: -1, approximate: true, error: error.message }, { status: 500 });
  }
}