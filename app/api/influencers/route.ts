import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

// Disable caching for this route to ensure fresh data on every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Helper function to fetch all records in batches (handles Supabase 1000 row limit)
async function fetchAllInBatches<T>(
  supabase: any,
  table: string,
  select: string,
  filters: (query: any) => any,
  batchSize: number = 1000
): Promise<T[]> {
  let allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let batchQuery = supabase.from(table).select(select);
    batchQuery = filters(batchQuery);
    const { data: batchData, error: batchError } = await batchQuery.range(offset, offset + batchSize - 1);

    if (batchError) throw batchError;

    if (batchData && batchData.length > 0) {
      allData = allData.concat(batchData);
      offset += batchSize;
      hasMore = batchData.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

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
    // CRITICAL: Fetch ALL matching IDs in batches (Supabase default limit is 1000)
    let influencerIds: string[] | null = null;
    
    if (campaignId) {
      console.log(`[INFLUENCERS API] Fetching campaign influencers for campaign: ${campaignId}`);
      try {
        const campaignLinks = await fetchAllInBatches(
          supabase,
          'campaign_influencers',
          'influencer_id',
          (query) => query.eq('campaign_id', campaignId)
        );
        
        influencerIds = campaignLinks
          .map((link: any) => link.influencer_id)
          .filter((id: any) => id != null && id !== undefined && id !== '');
        console.log(`[INFLUENCERS API] Found ${influencerIds.length} influencers in campaign (after filtering nulls)`);
        
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
      } catch (err: any) {
        console.error(`[INFLUENCERS API] Error fetching campaign influencers:`, err);
        throw new Error(`Failed to fetch campaign influencers: ${err.message || 'Unknown error'}`);
      }
    }
    
    // Filter by hashtag
    if (hashtagId) {
      console.log(`[INFLUENCERS API] Fetching hashtag influencers for hashtag: ${hashtagId}`);
      try {
        const hashtagLinks = await fetchAllInBatches(
          supabase,
          'influencer_hashtags',
          'influencer_id',
          (query) => query.eq('hashtag_id', parseInt(hashtagId))
        );
        
        const hashtagInfluencerIds = hashtagLinks
          .map((link: any) => link.influencer_id)
          .filter((id: any) => id != null && id !== undefined && id !== '');
        console.log(`[INFLUENCERS API] Found ${hashtagInfluencerIds.length} influencers with hashtag`);
        
        if (influencerIds) {
          // Intersect with existing filter
          const beforeCount = influencerIds.length;
          influencerIds = influencerIds.filter(id => hashtagInfluencerIds.includes(id));
          console.log(`[INFLUENCERS API] After intersection: ${influencerIds.length} (was ${beforeCount})`);
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
      } catch (err: any) {
        console.error(`[INFLUENCERS API] Error fetching hashtag influencers:`, err);
        throw new Error(`Failed to fetch hashtag influencers: ${err.message || 'Unknown error'}`);
      }
    }
    
    // Filter by sound
    if (soundId) {
      console.log(`[INFLUENCERS API] Fetching sound influencers for sound: ${soundId}`);
      try {
        const soundLinks = await fetchAllInBatches(
          supabase,
          'influencer_sounds',
          'influencer_id',
          (query) => query.eq('sound_id', parseInt(soundId))
        );
        
        const soundInfluencerIds = soundLinks
          .map((link: any) => link.influencer_id)
          .filter((id: any) => id != null && id !== undefined && id !== '');
        console.log(`[INFLUENCERS API] Found ${soundInfluencerIds.length} influencers with sound`);
        
        if (influencerIds) {
          // Intersect with existing filter
          const beforeCount = influencerIds.length;
          influencerIds = influencerIds.filter(id => soundInfluencerIds.includes(id));
          console.log(`[INFLUENCERS API] After intersection: ${influencerIds.length} (was ${beforeCount})`);
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
      } catch (err: any) {
        console.error(`[INFLUENCERS API] Error fetching sound influencers:`, err);
        throw new Error(`Failed to fetch sound influencers: ${err.message || 'Unknown error'}`);
      }
    }
    
    // Build query for influencers
    // CRITICAL: Supabase .in() has a limit of 1000 items - split into chunks if needed
    const chunkSize = 1000;
    let query: any;
    
    // If we have influencer IDs and they're > 1000, we need to fetch in batches
    // Use very small chunks (50) to avoid HTTP header overflow errors
    // HeadersOverflowError occurs when URL/headers are too large with many IDs + filters
    const batchChunkSize = 50;
    if (influencerIds && influencerIds.length > chunkSize) {
      console.log(`[INFLUENCERS API] ${influencerIds.length} matching influencers (exceeds ${chunkSize} limit), fetching in batches of ${batchChunkSize}`);
      
      // Split influencer IDs into smaller chunks to avoid URL length issues
      const idChunks: string[][] = [];
      for (let i = 0; i < influencerIds.length; i += batchChunkSize) {
        idChunks.push(influencerIds.slice(i, i + batchChunkSize));
      }
      
      // Process chunks in parallel for speed (Supabase Pro plan can handle this)
      // Process in groups of 15 chunks at a time to balance speed and connection limits
      const parallelBatchSize = 15;
      let allMatchingInfluencers: any[] = [];
      
      // Helper function to fetch a single chunk
      const fetchChunk = async (chunk: string[]): Promise<any[]> => {
        // Build data query for this chunk
        let dataQuery = supabase
          .from('influencers')
          .select('*')
          .in('id', chunk);
        
        // Apply all other filters to each chunk
        if (searchQuery) {
          dataQuery = dataQuery.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
        }
        if (minFollowers) {
          dataQuery = dataQuery.gte('followers', parseInt(minFollowers));
        }
        if (maxFollowers) {
          dataQuery = dataQuery.lte('followers', parseInt(maxFollowers));
        }
        if (minEngagementRate) {
          dataQuery = dataQuery.gte('engagement_rate', parseFloat(minEngagementRate));
        }
        if (maxEngagementRate) {
          dataQuery = dataQuery.lte('engagement_rate', parseFloat(maxEngagementRate));
        }
        if (minAvgViews) {
          dataQuery = dataQuery.gte('avg_views', parseFloat(minAvgViews));
        }
        if (maxAvgViews) {
          dataQuery = dataQuery.lte('avg_views', parseFloat(maxAvgViews));
        }
        if (reachedOut === 'true') {
          dataQuery = dataQuery.eq('has_outreach', true);
        } else if (reachedOut === 'false') {
          dataQuery = dataQuery.eq('has_outreach', false);
        }
        if (hasEmail === 'true') {
          dataQuery = dataQuery.not('email', 'is', null).not('email', 'eq', '');
        }
        
        // Fetch all records from this chunk in batches
        let chunkData: any[] = [];
        let chunkOffset = 0;
        const chunkBatchSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
          const { data: batchData, error: batchError } = await dataQuery.range(chunkOffset, chunkOffset + chunkBatchSize - 1);
          
          if (batchError) {
            console.error(`[INFLUENCERS API BATCH] Error fetching chunk batch at offset ${chunkOffset}:`, batchError);
            throw batchError;
          }
          
          if (batchData && batchData.length > 0) {
            chunkData = chunkData.concat(batchData);
            chunkOffset += chunkBatchSize;
            hasMore = batchData.length === chunkBatchSize;
          } else {
            hasMore = false;
          }
        }
        
        return chunkData;
      };
      
      // Process chunks in parallel batches
      for (let i = 0; i < idChunks.length; i += parallelBatchSize) {
        const chunkBatch = idChunks.slice(i, i + parallelBatchSize);
        console.log(`[INFLUENCERS API BATCH] Processing chunks ${i + 1}-${Math.min(i + parallelBatchSize, idChunks.length)} of ${idChunks.length} in parallel`);
        
        const results = await Promise.allSettled(
          chunkBatch.map(chunk => fetchChunk(chunk))
        );
        
        // Collect successful results
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled') {
            allMatchingInfluencers = allMatchingInfluencers.concat(result.value);
            console.log(`[INFLUENCERS API BATCH] Fetched ${result.value.length} influencers from chunk (${chunkBatch[j].length} IDs), total so far: ${allMatchingInfluencers.length}`);
          } else {
            console.error(`[INFLUENCERS API BATCH] Error processing chunk (${chunkBatch[j].length} IDs):`, result.reason);
            // Continue with other chunks - partial results are better than none
          }
        }
      }
      
      // Use fetched length as total count (we fetched all matching records)
      const totalCount = allMatchingInfluencers.length;
      
      console.log(`[INFLUENCERS API] Total matching influencers fetched: ${allMatchingInfluencers.length}, total count: ${totalCount}`);
      
      // Sort all data by last_scraped
      allMatchingInfluencers.sort((a, b) => {
        const aDate = a.last_scraped ? new Date(a.last_scraped).getTime() : 0;
        const bDate = b.last_scraped ? new Date(b.last_scraped).getTime() : 0;
        return bDate - aDate; // Descending
      });
      
      // Apply pagination
      const paginatedData = allMatchingInfluencers.slice(offset, offset + limit);
      
      // Fetch campaign associations and orders for paginated data only
      const paginatedIds = paginatedData.map(inf => inf.id);
      const { campaignMap, orderMap } = await fetchAssociations(supabase, paginatedIds);
      
      // Transform data
      const transformedData = paginatedData.map((inf: any) => ({
        ...inf,
        reference_order: orderMap[inf.id] || null,
        campaigns: campaignMap[inf.id] || [],
        campaign_count: (campaignMap[inf.id] || []).length
      }));
      
      return Response.json({
        data: transformedData,
        total: totalCount || allMatchingInfluencers.length,
        page: page,
        limit: limit,
        totalPages: Math.ceil((totalCount || allMatchingInfluencers.length) / limit)
      });
    }
    
    // Build normal query (either no influencer IDs, or <= 1000 influencer IDs)
    // Note: Even with < 1000 IDs, we might hit URL length limits, so use batching for > 50 IDs
    if (influencerIds && influencerIds.length > 0) {
      if (influencerIds.length > 50) {
        // Use batching even for < 1000 IDs to avoid URL length issues
        // Use small chunks (50) to prevent header overflow
        console.log(`[INFLUENCERS API] ${influencerIds.length} influencer IDs - using batching to avoid URL length limits`);
        
        // Split into chunks of 50
        const idChunks: string[][] = [];
        for (let i = 0; i < influencerIds.length; i += 50) {
          idChunks.push(influencerIds.slice(i, i + 50));
        }
        
        // Process chunks in parallel for speed
        const parallelBatchSize = 15;
        let allMatchingInfluencers: any[] = [];
        
        // Helper function to fetch a single chunk
        const fetchChunk = async (chunk: string[]): Promise<any[]> => {
          let chunkQuery = supabase
            .from('influencers')
            .select('*')
            .in('id', chunk);
          
          // Apply all other filters to each chunk
          if (searchQuery) {
            chunkQuery = chunkQuery.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
          }
          if (minFollowers) {
            chunkQuery = chunkQuery.gte('followers', parseInt(minFollowers));
          }
          if (maxFollowers) {
            chunkQuery = chunkQuery.lte('followers', parseInt(maxFollowers));
          }
          if (minEngagementRate) {
            chunkQuery = chunkQuery.gte('engagement_rate', parseFloat(minEngagementRate));
          }
          if (maxEngagementRate) {
            chunkQuery = chunkQuery.lte('engagement_rate', parseFloat(maxEngagementRate));
          }
          if (minAvgViews) {
            chunkQuery = chunkQuery.gte('avg_views', parseFloat(minAvgViews));
          }
          if (maxAvgViews) {
            chunkQuery = chunkQuery.lte('avg_views', parseFloat(maxAvgViews));
          }
          if (reachedOut === 'true') {
            chunkQuery = chunkQuery.eq('has_outreach', true);
          } else if (reachedOut === 'false') {
            chunkQuery = chunkQuery.eq('has_outreach', false);
          }
          if (hasEmail === 'true') {
            chunkQuery = chunkQuery.not('email', 'is', null).not('email', 'eq', '');
          }
          
          // Fetch all records from this chunk
          let chunkData: any[] = [];
          let chunkOffset = 0;
          const chunkBatchSize = 1000;
          let hasMore = true;
          
          while (hasMore) {
            const { data: batchData, error: batchError } = await chunkQuery.range(chunkOffset, chunkOffset + chunkBatchSize - 1);
            if (batchError) throw batchError;
            
            if (batchData && batchData.length > 0) {
              chunkData = chunkData.concat(batchData);
              chunkOffset += chunkBatchSize;
              hasMore = batchData.length === chunkBatchSize;
            } else {
              hasMore = false;
            }
          }
          
          return chunkData;
        };
        
        // Process chunks in parallel batches
        for (let i = 0; i < idChunks.length; i += parallelBatchSize) {
          const chunkBatch = idChunks.slice(i, i + parallelBatchSize);
          console.log(`[INFLUENCERS API BATCH] Processing chunks ${i + 1}-${Math.min(i + parallelBatchSize, idChunks.length)} of ${idChunks.length} in parallel`);
          
          const results = await Promise.allSettled(
            chunkBatch.map(chunk => fetchChunk(chunk))
          );
          
          // Collect successful results
          for (let j = 0; j < results.length; j++) {
            const result = results[j];
            if (result.status === 'fulfilled') {
              allMatchingInfluencers = allMatchingInfluencers.concat(result.value);
              console.log(`[INFLUENCERS API BATCH] Fetched ${result.value.length} influencers from chunk (${chunkBatch[j].length} IDs), total so far: ${allMatchingInfluencers.length}`);
            } else {
              console.error(`[INFLUENCERS API BATCH] Error processing chunk (${chunkBatch[j].length} IDs):`, result.reason);
            }
          }
        }
        
        const totalCount = allMatchingInfluencers.length;
        console.log(`[INFLUENCERS API] Total matching influencers fetched: ${allMatchingInfluencers.length}, total count: ${totalCount}`);
        
        // Sort all data by last_scraped
        allMatchingInfluencers.sort((a, b) => {
          const aDate = a.last_scraped ? new Date(a.last_scraped).getTime() : 0;
          const bDate = b.last_scraped ? new Date(b.last_scraped).getTime() : 0;
          return bDate - aDate; // Descending
        });
        
        // Apply pagination
        const paginatedData = allMatchingInfluencers.slice(offset, offset + limit);
        
        // Fetch campaign associations and orders for paginated data only
        const paginatedIds = paginatedData.map(inf => inf.id);
        const { campaignMap, orderMap } = await fetchAssociations(supabase, paginatedIds);
        
        // Transform data
        const transformedData = paginatedData.map((inf: any) => ({
          ...inf,
          reference_order: orderMap[inf.id] || null,
          campaigns: campaignMap[inf.id] || [],
          campaign_count: (campaignMap[inf.id] || []).length
        }));
        
        return Response.json({
          data: transformedData,
          total: totalCount || allMatchingInfluencers.length,
          page: page,
          limit: limit,
          totalPages: Math.ceil((totalCount || allMatchingInfluencers.length) / limit)
        });
      } else {
        // <= 100 IDs, use simple .in() query
        console.log(`[INFLUENCERS API] Using simple path with ${influencerIds.length} influencer IDs`);
        query = supabase
          .from('influencers')
          .select('*', { count: 'exact' })
          .in('id', influencerIds);
      }
    } else {
      console.log(`[INFLUENCERS API] Building query without influencer ID filter`);
      query = supabase
        .from('influencers')
        .select('*', { count: 'exact' });
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
    let countQuery = supabase
      .from('influencers')
      .select('*', { count: 'exact', head: true });
    
    // Apply same filters to count query
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
    if (reachedOut === 'true') {
      countQuery = countQuery.eq('has_outreach', true);
    } else if (reachedOut === 'false') {
      countQuery = countQuery.eq('has_outreach', false);
    }
    if (hasEmail === 'true') {
      countQuery = countQuery.not('email', 'is', null).not('email', 'eq', '');
    }
    
    let count = 0;
    try {
      const countResult = await countQuery;
      count = countResult.count || 0;
      console.log(`[INFLUENCERS API] Count query result: ${count}`);
    } catch (countError: any) {
      console.error(`[INFLUENCERS API] Count query error:`, countError);
      // Continue with main query, we'll use the count from the main query if available
    }
    
    // Apply pagination to main query
    query = query.range(offset, offset + limit - 1);
    
    console.log(`[INFLUENCERS API] Executing main query with offset: ${offset}, limit: ${limit}`);
    let influencers: any[] = [];
    let queryError: any = null;
    
    try {
      const result = await query;
      influencers = result.data || [];
      queryError = result.error;
      
      // If we got data but no count from count query, use the count from main query
      if (count === 0 && result.count !== null && result.count !== undefined) {
        count = result.count;
        console.log(`[INFLUENCERS API] Using count from main query: ${count}`);
      }
    } catch (err: any) {
      console.error(`[INFLUENCERS API] Main query execution error:`, err);
      queryError = err;
    }
    
    if (queryError) {
      console.error(`[INFLUENCERS API] Supabase error details:`, {
        message: queryError.message,
        details: queryError.details,
        hint: queryError.hint,
        code: queryError.code
      });
      throw queryError;
    }
    
    // Fetch campaign associations and orders for paginated influencers only
    const allInfluencerIds = (influencers || []).map(inf => inf.id);
    const { campaignMap, orderMap } = await fetchAssociations(supabase, allInfluencerIds);
    
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

// Helper function to fetch campaign associations and orders (with batching for >1000 IDs)
async function fetchAssociations(supabase: any, influencerIds: string[]) {
  let campaignMap: Record<string, string[]> = {};
  let orderMap: Record<string, any> = {};
  
  if (influencerIds.length === 0) {
    return { campaignMap, orderMap };
  }
  
  const chunkSize = 1000;
  
  // Fetch campaign links in batches if needed
  if (influencerIds.length <= chunkSize) {
    // Simple case: <= 1000 influencers
    const { data: campaignLinks, error: linkError } = await supabase
      .from('campaign_influencers')
      .select('influencer_id, campaign_id')
      .in('influencer_id', influencerIds);
    
    if (!linkError && campaignLinks && campaignLinks.length > 0) {
      const campaignIds = [...new Set(campaignLinks.map((link: any) => link.campaign_id))];
      
      const { data: campaigns, error: campaignError } = await supabase
        .from('campaigns')
        .select('id, name')
        .in('id', campaignIds);
      
      if (!campaignError && campaigns) {
        const campaignNameMap: Record<string, string> = {};
        campaigns.forEach((camp: any) => {
          campaignNameMap[camp.id] = camp.name;
        });
        
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
    
    // Fetch orders
    const { data: orderRows, error: orderError } = await supabase
      .from('reference_order_overview')
      .select('influencer_id, date_paid, price_per_video, owner_name, total_orders')
      .in('influencer_id', influencerIds);
    
    if (!orderError && orderRows) {
      orderRows.forEach((row: any) => {
        if (row.influencer_id) {
          orderMap[row.influencer_id] = row;
        }
      });
    }
  } else {
    // Complex case: > 1000 influencers, fetch in batches in parallel
    const idChunks: string[][] = [];
    for (let i = 0; i < influencerIds.length; i += chunkSize) {
      idChunks.push(influencerIds.slice(i, i + chunkSize));
    }
    
    // Helper function to fetch associations for a single chunk
    const fetchChunkAssociations = async (chunk: string[]): Promise<{ campaignMap: Record<string, string[]>, orderMap: Record<string, any> }> => {
      const chunkCampaignMap: Record<string, string[]> = {};
      const chunkOrderMap: Record<string, any> = {};
      
      // Fetch campaign links for this chunk
      const { data: campaignLinks, error: linkError } = await supabase
        .from('campaign_influencers')
        .select('influencer_id, campaign_id')
        .in('influencer_id', chunk);
      
      if (!linkError && campaignLinks && campaignLinks.length > 0) {
        const campaignIds = [...new Set(campaignLinks.map((link: any) => link.campaign_id))];
        
        const { data: campaigns, error: campaignError } = await supabase
          .from('campaigns')
          .select('id, name')
          .in('id', campaignIds);
        
        if (!campaignError && campaigns) {
          const campaignNameMap: Record<string, string> = {};
          campaigns.forEach((camp: any) => {
            campaignNameMap[camp.id] = camp.name;
          });
          
          campaignLinks.forEach((link: any) => {
            const infId = link.influencer_id;
            const campaignName = campaignNameMap[link.campaign_id];
            if (campaignName) {
              if (!chunkCampaignMap[infId]) {
                chunkCampaignMap[infId] = [];
              }
              if (!chunkCampaignMap[infId].includes(campaignName)) {
                chunkCampaignMap[infId].push(campaignName);
              }
            }
          });
        }
      }
      
      // Fetch orders for this chunk
      const { data: orderRows, error: orderError } = await supabase
        .from('reference_order_overview')
        .select('influencer_id, date_paid, price_per_video, owner_name, total_orders')
        .in('influencer_id', chunk);
      
      if (!orderError && orderRows) {
        orderRows.forEach((row: any) => {
          if (row.influencer_id) {
            chunkOrderMap[row.influencer_id] = row;
          }
        });
      }
      
      return { campaignMap: chunkCampaignMap, orderMap: chunkOrderMap };
    };
    
    // Process chunks in parallel (15 at a time)
    const parallelBatchSize = 15;
    for (let i = 0; i < idChunks.length; i += parallelBatchSize) {
      const chunkBatch = idChunks.slice(i, i + parallelBatchSize);
      const results = await Promise.allSettled(
        chunkBatch.map(chunk => fetchChunkAssociations(chunk))
      );
      
      // Merge results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          // Merge campaign map
          Object.keys(result.value.campaignMap).forEach(infId => {
            if (!campaignMap[infId]) {
              campaignMap[infId] = [];
            }
            result.value.campaignMap[infId].forEach((campName: string) => {
              if (!campaignMap[infId].includes(campName)) {
                campaignMap[infId].push(campName);
              }
            });
          });
          
          // Merge order map
          Object.assign(orderMap, result.value.orderMap);
        }
      }
    }
  }
  
  return { campaignMap, orderMap };
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

    const normalizeInteger = (value: any) => {
      if (value === null || value === undefined || value === '') return null;
      const numeric = Number(value);
      return Number.isNaN(numeric) ? null : Math.floor(numeric);
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
      payload.avg_views = normalizeInteger(avgViews);
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

