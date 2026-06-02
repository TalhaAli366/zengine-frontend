import { NextRequest } from 'next/server';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getServerClient } from '@/lib/supabase/server-singleton';

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
  const t0 = Date.now();
  try {
    const supabase = getServerClient();
    const searchParams = request.nextUrl.searchParams;
    console.log(`[INFLUENCERS API] === START REQUEST === page=${searchParams.get('page')} limit=${searchParams.get('limit')} filters=${JSON.stringify(Object.fromEntries(searchParams.entries()))}`);

    const t1 = Date.now();
    console.log(`[INFLUENCERS API] Supabase client init: ${t1 - t0}ms`);

    // Get filter parameters
    const campaignId = searchParams.get('campaign');
    const searchQuery = searchParams.get('search'); // For username/name search
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
    const onlyPersonalEmail = searchParams.get('only_personal_email');
    const sortBy = searchParams.get('sort_by') || 'last_scraped';
    const sortOrder = searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc';
    const sortAscending = sortOrder === 'asc';

    const sortInfluencers = (list: any[]) => {
      return list.sort((a, b) => {
        if (sortBy === 'followers') {
          const aValue = a.followers ?? 0;
          const bValue = b.followers ?? 0;
          return sortAscending ? aValue - bValue : bValue - aValue;
        }

        if (sortBy === 'avg_views') {
          const aValue = a.avg_views ?? 0;
          const bValue = b.avg_views ?? 0;
          return sortAscending ? aValue - bValue : bValue - aValue;
        }

        if (sortBy === 'engagement_rate') {
          const aValue = a.engagement_rate ?? 0;
          const bValue = b.engagement_rate ?? 0;
          return sortAscending ? aValue - bValue : bValue - aValue;
        }

        const aDate = a.last_scraped ? new Date(a.last_scraped).getTime() : 0;
        const bDate = b.last_scraped ? new Date(b.last_scraped).getTime() : 0;
        return sortAscending ? aDate - bDate : bDate - aDate;
      });
    };

    // Personal email domains list (non-business)
    const personalEmailDomains = [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
      'aol.com', 'mail.com', 'protonmail.com', 'yandex.com', 'mail.ru',
      'live.com', 'msn.com', 'gmx.com', 'zoho.com', 'inbox.com',
      'rediffmail.com', 'qq.com', '163.com', 'sina.com', 'naver.com'
    ];

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
        if (country) {
          dataQuery = dataQuery.ilike('country', `%${country}%`);
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

        // Apply personal email filter in-memory (Supabase can't do complex domain matching)
        if (onlyPersonalEmail === 'true') {
          chunkData = chunkData.filter((inf: any) => {
            if (!inf.email) return false;
            const domain = inf.email.toLowerCase().split('@')[1];
            return domain && personalEmailDomains.includes(domain);
          });
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

      sortInfluencers(allMatchingInfluencers);

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
          if (country) {
            chunkQuery = chunkQuery.ilike('country', `%${country}%`);
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

          // Apply personal email filter in-memory (Supabase can't do complex domain matching)
          if (onlyPersonalEmail === 'true') {
            chunkData = chunkData.filter((inf: any) => {
              if (!inf.email) return false;
              const domain = inf.email.toLowerCase().split('@')[1];
              return domain && personalEmailDomains.includes(domain);
            });
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

        sortInfluencers(allMatchingInfluencers);

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
          .select('*')
          .in('id', influencerIds);
      }
    } else if (onlyPersonalEmail === 'true') {
      // Personal email filter requires batch processing for in-memory domain filtering
      // We use is_business=false for initial DB filtering, then verify domains in-memory
      console.log(`[INFLUENCERS API] Personal email filter active - using batch processing`);

      // Fetch all influencers with is_business=false in batches
      let allMatchingInfluencers: any[] = [];
      let batchOffset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        let batchQuery = supabase
          .from('influencers')
          .select('*')
          .eq('is_business', false)
          .not('email', 'is', null)
          .not('email', 'eq', '');

        // Apply other filters
        if (searchQuery) {
          batchQuery = batchQuery.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
        }
        if (minFollowers) {
          batchQuery = batchQuery.gte('followers', parseInt(minFollowers));
        }
        if (maxFollowers) {
          batchQuery = batchQuery.lte('followers', parseInt(maxFollowers));
        }
        if (minEngagementRate) {
          batchQuery = batchQuery.gte('engagement_rate', parseFloat(minEngagementRate));
        }
        if (maxEngagementRate) {
          batchQuery = batchQuery.lte('engagement_rate', parseFloat(maxEngagementRate));
        }
        if (minAvgViews) {
          batchQuery = batchQuery.gte('avg_views', parseFloat(minAvgViews));
        }
        if (maxAvgViews) {
          batchQuery = batchQuery.lte('avg_views', parseFloat(maxAvgViews));
        }
        if (country) {
          batchQuery = batchQuery.ilike('country', `%${country}%`);
        }
        if (reachedOut === 'true') {
          batchQuery = batchQuery.eq('has_outreach', true);
        } else if (reachedOut === 'false') {
          batchQuery = batchQuery.eq('has_outreach', false);
        }

        const { data: batchData, error: batchError } = await batchQuery.range(batchOffset, batchOffset + batchSize - 1);

        if (batchError) {
          console.error(`[INFLUENCERS API] Batch error:`, batchError);
          throw batchError;
        }

        if (batchData && batchData.length > 0) {
          // Filter by personal email domains in-memory
          const filteredBatch = batchData.filter((inf: any) => {
            if (!inf.email) return false;
            const domain = inf.email.toLowerCase().split('@')[1];
            return domain && personalEmailDomains.includes(domain);
          });
          allMatchingInfluencers = allMatchingInfluencers.concat(filteredBatch);
          batchOffset += batchSize;
          hasMore = batchData.length === batchSize;
        } else {
          hasMore = false;
        }
      }

      console.log(`[INFLUENCERS API] Found ${allMatchingInfluencers.length} influencers with personal emails`);

      sortInfluencers(allMatchingInfluencers);

      // Apply pagination
      const paginatedData = allMatchingInfluencers.slice(offset, offset + limit);

      // Fetch associations for paginated data
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
        total: allMatchingInfluencers.length,
        page: page,
        limit: limit,
        totalPages: Math.ceil(allMatchingInfluencers.length / limit)
      });
    } else {
      console.log(`[INFLUENCERS API] Building query without influencer ID filter`);
      query = supabase
        .from('influencers')
        .select('*');
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

    if (country) {
      query = query.ilike('country', `%${country}%`);
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

    if (sortBy === 'followers' || sortBy === 'avg_views' || sortBy === 'engagement_rate') {
      query = query.order(sortBy, { ascending: sortAscending, nullsFirst: false });
    } else {
      query = query.order('last_scraped', { ascending: sortAscending });
    }

    // Apply pagination to main query
    query = query.range(offset, offset + limit - 1);

    console.log(`[INFLUENCERS API] Executing main query with offset: ${offset}, limit: ${limit}`);
    let influencers: any[] = [];
    let queryError: any = null;

    try {
      const tDataStart = Date.now();
      const result = await query;
      influencers = result.data || [];
      queryError = result.error;
      console.log(`[INFLUENCERS API] Data query: ${Date.now() - tDataStart}ms (rows=${influencers.length})`);

      // count comes from countQuery only; main query is data-only for performance
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
    const tAssocStart = Date.now();
    const allInfluencerIds = (influencers || []).map(inf => inf.id);
    const { campaignMap, orderMap } = await fetchAssociations(supabase, allInfluencerIds);
    console.log(`[INFLUENCERS API] fetchAssociations: ${Date.now() - tAssocStart}ms`);

    // Transform data to include campaign names
    const transformedData = (influencers || []).map((inf: any) => ({
      ...inf,
      reference_order: orderMap[inf.id] || null,
      campaigns: campaignMap[inf.id] || [],
      campaign_count: (campaignMap[inf.id] || []).length
    }));

    console.log(`[INFLUENCERS API] === TOTAL REQUEST TIME: ${Date.now() - t0}ms === Fetched: ${transformedData?.length}, Total: pending (count loaded separately)`);
    return Response.json({
      data: transformedData || [],
      total: -1,
      page: page,
      limit: limit,
      totalPages: -1
    });
  } catch (error: any) {
    console.error('API error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Helper function to fetch campaign associations and orders (with batching for >1000 IDs)
async function fetchAssociations(supabase: any, influencerIds: string[]) {
  const t0 = Date.now();
  let campaignMap: Record<string, string[]> = {};
  let orderMap: Record<string, any> = {};

  if (influencerIds.length === 0) {
  console.log(`[INFLUENCERS API] fetchAssociations TOTAL: ${Date.now() - t0}ms`);
  return { campaignMap, orderMap };
  }

  const chunkSize = 1000;

  // Fetch campaign links in batches if needed
  if (influencerIds.length <= chunkSize) {
    // Simple case: <= 1000 influencers
    // Fire campaign_influencers and orders IN PARALLEL since they're independent
    const tParallel = Date.now();
    const [campaignLinksResult, orderRowsResult] = await Promise.all([
        supabase
          .from('campaign_influencers')
          .select('influencer_id, campaign_id')
          .in('influencer_id', influencerIds),
        supabase
          .from('reference_orders')
          .select('influencer_id, date_paid, price_per_video, owner_name, created_at')
          .in('influencer_id', influencerIds),
      ]);
    console.log(`[INFLUENCERS API] fetchAssociations - parallel (campaign_links + orders): ${Date.now() - tParallel}ms`);

    const { data: campaignLinks, error: linkError } = campaignLinksResult;
    const { data: orderRows, error: orderError } = orderRowsResult;

    if (!orderError && orderRows) {
      orderRows.forEach((row: any) => {
        if (!row.influencer_id) return;
        const current = orderMap[row.influencer_id];
        const rowDate = row.date_paid ? new Date(row.date_paid).getTime() : 0;
        const currentDate = current?.date_paid ? new Date(current.date_paid).getTime() : 0;
        const rowCreated = row.created_at ? new Date(row.created_at).getTime() : 0;
        const currentCreated = current?.created_at ? new Date(current.created_at).getTime() : 0;
        const totalOrders = (current?.total_orders || 0) + 1;

        if (!current || rowDate > currentDate || (rowDate === currentDate && rowCreated > currentCreated)) {
          orderMap[row.influencer_id] = {
            ...row,
            total_orders: totalOrders,
          };
        } else {
          orderMap[row.influencer_id] = {
            ...current,
            total_orders: totalOrders,
          };
        }
      });
    }

    if (!linkError && campaignLinks && campaignLinks.length > 0) {
      const campaignIds = [...new Set(campaignLinks.map((link: any) => link.campaign_id))];

      const t3 = Date.now();
      const { data: campaigns, error: campaignError } = await supabase
        .from('campaigns')
        .select('id, name')
        .in('id', campaignIds);
      console.log(`[INFLUENCERS API] fetchAssociations - campaigns query: ${Date.now() - t3}ms`);

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
        .from('reference_orders')
        .select('influencer_id, date_paid, price_per_video, owner_name, created_at')
        .in('influencer_id', chunk);

      if (!orderError && orderRows) {
        orderRows.forEach((row: any) => {
          if (!row.influencer_id) return;
          const current = chunkOrderMap[row.influencer_id];
          const rowDate = row.date_paid ? new Date(row.date_paid).getTime() : 0;
          const currentDate = current?.date_paid ? new Date(current.date_paid).getTime() : 0;
          const rowCreated = row.created_at ? new Date(row.created_at).getTime() : 0;
          const currentCreated = current?.created_at ? new Date(current.created_at).getTime() : 0;
          const totalOrders = (current?.total_orders || 0) + 1;

          if (!current || rowDate > currentDate || (rowDate === currentDate && rowCreated > currentCreated)) {
            chunkOrderMap[row.influencer_id] = {
              ...row,
              total_orders: totalOrders,
            };
          } else {
            chunkOrderMap[row.influencer_id] = {
              ...current,
              total_orders: totalOrders,
            };
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
