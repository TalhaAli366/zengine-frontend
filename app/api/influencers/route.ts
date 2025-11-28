import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const searchParams = request.nextUrl.searchParams;
    
    // Get filter parameters
    const campaignId = searchParams.get('campaign');
    const searchQuery = searchParams.get('search'); // For username/name search
    const minFollowers = searchParams.get('min_followers');
    const maxFollowers = searchParams.get('max_followers');
    const minEngagementRate = searchParams.get('min_engagement_rate');
    const maxEngagementRate = searchParams.get('max_engagement_rate');
    const minAvgViews = searchParams.get('min_avg_views');
    const maxAvgViews = searchParams.get('max_avg_views');
    const hashtagId = searchParams.get('hashtag_id');
    const soundId = searchParams.get('sound_id');
    const reachedOut = searchParams.get('reached_out');
    const hasEmail = searchParams.get('has_email');
    
    // Pagination parameters
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;
    
    // If filtering by campaign, hashtag, or sound, first get influencer IDs
    let influencerIds: string[] | null = null;
    
    if (campaignId) {
      const { data: campaignLinks, error: linkError } = await supabase
        .from('campaign_influencers')
        .select('influencer_id')
        .eq('campaign_id', campaignId);
      
      if (linkError) throw linkError;
      influencerIds = campaignLinks?.map(link => link.influencer_id) || [];
      
      // If no influencers in campaign, return empty array
      if (influencerIds.length === 0) {
        return Response.json({
          data: [],
          total: 0,
          page: page,
          limit: limit,
          totalPages: 0
        });
      }
    }
    
    // Filter by hashtag
    if (hashtagId) {
      const { data: hashtagLinks, error: hashtagError } = await supabase
        .from('influencer_hashtags')
        .select('influencer_id')
        .eq('hashtag_id', parseInt(hashtagId));
      
      if (hashtagError) throw hashtagError;
      const hashtagInfluencerIds = hashtagLinks?.map(link => link.influencer_id) || [];
      
      if (influencerIds) {
        // Intersect with existing filter
        influencerIds = influencerIds.filter(id => hashtagInfluencerIds.includes(id));
      } else {
        influencerIds = hashtagInfluencerIds;
      }
      
      if (influencerIds.length === 0) {
        return Response.json({
          data: [],
          total: 0,
          page: page,
          limit: limit,
          totalPages: 0
        });
      }
    }
    
    // Filter by sound
    if (soundId) {
      const { data: soundLinks, error: soundError } = await supabase
        .from('influencer_sounds')
        .select('influencer_id')
        .eq('sound_id', parseInt(soundId));
      
      if (soundError) throw soundError;
      const soundInfluencerIds = soundLinks?.map(link => link.influencer_id) || [];
      
      if (influencerIds) {
        // Intersect with existing filter
        influencerIds = influencerIds.filter(id => soundInfluencerIds.includes(id));
      } else {
        influencerIds = soundInfluencerIds;
      }
      
      if (influencerIds.length === 0) {
        return Response.json({
          data: [],
          total: 0,
          page: page,
          limit: limit,
          totalPages: 0
        });
      }
    }
    
    // Build query for influencers
    let query = supabase
      .from('influencers')
      .select('*');
    
    // Filter by campaign influencer IDs if needed
    if (influencerIds && influencerIds.length > 0) {
      query = query.in('id', influencerIds);
    }
    
    // Apply search filter
    if (searchQuery) {
      query = query.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
    }
    
    // Apply follower filters
    if (minFollowers) {
      query = query.gte('followers', parseInt(minFollowers));
    }
    
    if (maxFollowers) {
      query = query.lte('followers', parseInt(maxFollowers));
    }
    
    // Apply engagement rate filters
    if (minEngagementRate) {
      query = query.gte('engagement_rate', parseFloat(minEngagementRate));
    }
    
    if (maxEngagementRate) {
      query = query.lte('engagement_rate', parseFloat(maxEngagementRate));
    }
    
    // Apply avg views filters
    if (minAvgViews) {
      query = query.gte('avg_views', parseFloat(minAvgViews));
    }
    
    if (maxAvgViews) {
      query = query.lte('avg_views', parseFloat(maxAvgViews));
    }
    
    // Filter by outreach status
    if (reachedOut === 'true') {
      query = query.eq('has_outreach', true);
    } else if (reachedOut === 'false') {
      query = query.eq('has_outreach', false);
    }

    if (hasEmail === 'true') {
      query = query.not('email', 'is', null).not('email', 'eq', '');
    }
    
    // Order by last_scraped
    query = query.order('last_scraped', { ascending: false });
    
    // Get total count with same filters (before pagination)
    const countQuery = supabase
      .from('influencers')
      .select('*', { count: 'exact', head: true });
    
    // Apply same filters to count query
    if (influencerIds && influencerIds.length > 0) {
      countQuery.in('id', influencerIds);
    }
    if (searchQuery) {
      countQuery.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
    }
    if (minFollowers) {
      countQuery.gte('followers', parseInt(minFollowers));
    }
    if (maxFollowers) {
      countQuery.lte('followers', parseInt(maxFollowers));
    }
    if (minEngagementRate) {
      countQuery.gte('engagement_rate', parseFloat(minEngagementRate));
    }
    if (maxEngagementRate) {
      countQuery.lte('engagement_rate', parseFloat(maxEngagementRate));
    }
    if (minAvgViews) {
      countQuery.gte('avg_views', parseFloat(minAvgViews));
    }
    if (maxAvgViews) {
      countQuery.lte('avg_views', parseFloat(maxAvgViews));
    }
    if (reachedOut === 'true') {
      countQuery.eq('has_outreach', true);
    } else if (reachedOut === 'false') {
      countQuery.eq('has_outreach', false);
    }
    if (hasEmail === 'true') {
      countQuery.not('email', 'is', null).not('email', 'eq', '');
    }
    
    const { count } = await countQuery;
    
    // Apply pagination to main query
    query = query.range(offset, offset + limit - 1);
    
    const { data: influencers, error } = await query;
    
    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    // Now fetch campaign associations for all influencers
    const allInfluencerIds = (influencers || []).map(inf => inf.id);
    let campaignMap: Record<string, string[]> = {};
    let orderMap: Record<string, any> = {};
    
    if (allInfluencerIds.length > 0) {
      // Fetch campaign links
      const { data: campaignLinks, error: linkError } = await supabase
        .from('campaign_influencers')
        .select('influencer_id, campaign_id')
        .in('influencer_id', allInfluencerIds);
      
      if (!linkError && campaignLinks && campaignLinks.length > 0) {
        // Get unique campaign IDs
        const campaignIds = [...new Set(campaignLinks.map(link => link.campaign_id))];
        
        // Fetch campaign names
        const { data: campaigns, error: campaignError } = await supabase
          .from('campaigns')
          .select('id, name')
          .in('id', campaignIds);
        
        if (!campaignError && campaigns) {
          // Build campaign ID -> name map
          const campaignNameMap: Record<string, string> = {};
          campaigns.forEach(camp => {
            campaignNameMap[camp.id] = camp.name;
          });
          
          // Build influencer_id -> campaign names map
          campaignLinks.forEach((link: any) => {
            const infId = link.influencer_id;
            const campaignName = campaignNameMap[link.campaign_id];
            if (campaignName) {
              if (!campaignMap[infId]) {
                campaignMap[infId] = [];
              }
              if (!campaignMap[infId].includes(campaignName)) {
                campaignMap[infId].push(campaignName);
              }
            }
          });
        }
      }

      const { data: orderRows, error: orderError } = await supabase
        .from('reference_order_overview')
        .select('influencer_id, date_paid, price_per_video, owner_name, total_orders')
        .in('influencer_id', allInfluencerIds);

      if (!orderError && orderRows) {
        orderRows.forEach((row: any) => {
          if (row.influencer_id) {
            orderMap[row.influencer_id] = row;
          }
        });
      }
    }
    
    // Transform data to include campaign names
    const transformedData = (influencers || []).map((inf: any) => ({
      ...inf,
      reference_order: orderMap[inf.id] || null,
      campaigns: campaignMap[inf.id] || [],
      campaign_count: (campaignMap[inf.id] || []).length
    }));
    
    console.log('Fetched influencers:', transformedData?.length, 'Total:', count);
    return Response.json({
      data: transformedData || [],
      total: count || 0,
      page: page,
      limit: limit,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error: any) {
    console.error('API error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const influencerId = searchParams.get('id');

    if (!influencerId) {
      return Response.json({ error: 'Influencer ID is required' }, { status: 400 });
    }

    // Delete influencer (cascade will handle campaign_influencers, influencer_hashtags, influencer_sounds)
    const { error } = await supabase
      .from('influencers')
      .delete()
      .eq('id', influencerId);

    if (error) throw error;

    return Response.json({ success: true, message: 'Influencer deleted successfully' });
  } catch (error: any) {
    console.error('API error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const influencerId = body.id;
    if (!influencerId) {
      return Response.json({ error: 'Influencer ID is required' }, { status: 400 });
    }

    const normalizeString = (value: any) => {
      if (value === null || value === undefined) return null;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };

    const normalizeNumber = (value: any) => {
      if (value === null || value === undefined || value === '') return null;
      const numeric = Number(value);
      return Number.isNaN(numeric) ? null : numeric;
    };

    const normalizeDate = (value: any) => {
      const parsed = normalizeString(value);
      if (!parsed) return null;
      const date = new Date(parsed);
      if (Number.isNaN(date.getTime())) return null;
      return date.toISOString();
    };

    const payload: Record<string, any> = {};
    const displayName = body.display_name ?? body.displayName;
    if (displayName !== undefined) {
      payload.display_name = normalizeString(displayName);
    }
    const email = body.email;
    if (email !== undefined) {
      payload.email = normalizeString(email);
    }
    const country = body.country;
    if (country !== undefined) {
      payload.country = normalizeString(country);
    }
    const followers = body.followers;
    if (followers !== undefined) {
      payload.followers = normalizeNumber(followers);
    }
    const avgViews = body.avg_views ?? body.avgViews;
    if (avgViews !== undefined) {
      payload.avg_views = normalizeNumber(avgViews);
    }
    const engagementRate = body.engagement_rate ?? body.engagementRate;
    if (engagementRate !== undefined) {
      payload.engagement_rate = normalizeNumber(engagementRate);
    }
    const hasOutreach = body.has_outreach ?? body.hasOutreach;
    if (hasOutreach !== undefined) {
      payload.has_outreach = Boolean(hasOutreach);
    }
    const lastOutreach = body.last_outreach_at ?? body.lastOutreachAt;
    if (lastOutreach !== undefined) {
      payload.last_outreach_at = normalizeDate(lastOutreach);
    }
    const isBusiness = body.is_business ?? body.isBusiness;
    if (isBusiness !== undefined) {
      payload.is_business = Boolean(isBusiness);
    }
    const reachedBy = body.reached_by ?? body.reachedBy;
    if (reachedBy !== undefined) {
      payload.reached_by = normalizeString(reachedBy);
    }

    const keys = Object.keys(payload);
    if (keys.length === 0) {
      return Response.json({ error: 'No updates provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('influencers')
      .update(payload)
      .eq('id', influencerId)
      .select()
      .single();

    if (error) throw error;
    return Response.json({ success: true, influencer: data });
  } catch (error: any) {
    console.error('API error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

