import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

// Disable caching for this route to ensure fresh data on every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const normalizeUsername = (value: string) => value.trim().toLowerCase().replace(/^@/, '');

// Helper function to filter out invalid normalized usernames
// Invalid values like "n/a", "na", "none", "null" should not be used for avg_views joins
// Also filters out entries that start with "#" followed by invalid values
const isValidNormalizedUsername = (username: string | null | undefined): boolean => {
  if (!username || typeof username !== 'string') return false;
  const normalized = username.trim().toLowerCase().replace(/^#+/, ''); // Remove leading # symbols
  const invalidValues = ['n/a', 'na', 'none', 'null', '', 'n/a (influencer agency)', 'notion management'];
  return !invalidValues.includes(normalized) && normalized.length > 1;
};

const parseNumber = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
};

const parseInteger = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = parseInt(value, 10);
  return Number.isNaN(numeric) ? null : numeric;
};

const parseBoolean = (value: any) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return ['true', '1', 'yes', 'paid'].includes(normalized);
};

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    
    // For unique creators, use a more efficient database-level approach
    // to avoid loading all 41k+ records into memory
    const searchParams = request.nextUrl.searchParams;

    const search = searchParams.get('search') || '';
    const owner = searchParams.get('owner') || '';
    const approved = searchParams.get('approved') || '';
    const paid = searchParams.get('paid') || '';
    const matched = searchParams.get('matched') || '';
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const minAvgViews = searchParams.get('min_avg_views');
    const maxAvgViews = searchParams.get('max_avg_views');
    const uniqueCreators = searchParams.get('unique_creators') === 'true';
    const sortBy = searchParams.get('sort_by') || 'date_paid';
    const sortOrder = searchParams.get('sort_order') || 'desc';
    
    console.log(`[API REQUEST] URL: ${request.nextUrl.toString()}`);
    console.log(`[API REQUEST] sort_by: ${sortBy}, sort_order: ${sortOrder}, uniqueCreators: ${uniqueCreators}`);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('reference_orders')
      .select(`
        id,
        influencer_id,
        username,
        normalized_username,
        email,
        account_link,
        owner_name,
        approved_vendor,
        total_fee_per_import,
        price_usd,
        video_count,
        final_price,
        price_per_video,
        songs,
        paid,
        date_paid,
        video_links,
        created_at
      `, { count: 'exact' })
      // Default sort: non-zero price_per_video first, then by date_paid desc
      // Use price_per_video DESC to put non-zero values first (they're higher than 0)
      .order('price_per_video', { ascending: false, nullsFirst: false })
      .order('date_paid', { ascending: false, nullsFirst: false });

    if (search) {
      const encoded = `%${search}%`;
      query = query.or(`username.ilike.${encoded},account_link.ilike.${encoded}`);
    }

    if (owner) {
      query = query.ilike('owner_name', `%${owner}%`);
    }

    if (approved === 'yes') {
      query = query.eq('approved_vendor', true);
    } else if (approved === 'no') {
      query = query.eq('approved_vendor', false);
    }

    if (paid === 'paid') {
      query = query.eq('paid', true);
    } else if (paid === 'unpaid') {
      query = query.eq('paid', false);
    }

    if (matched === 'true') {
      query = query.not('influencer_id', 'is', null);
    } else if (matched === 'false') {
      query = query.is('influencer_id', null);
    }

    if (dateFrom) {
      query = query.gte('date_paid', dateFrom);
    }
    if (dateTo) {
      query = query.lte('date_paid', dateTo);
    }

    // Apply sorting - handle avg_views separately (requires join), others can use database sorting
    const validSortColumns = ['date_paid', 'owner_name', 'username', 'price_per_video', 'final_price'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'date_paid';
    const ascending = sortOrder === 'asc';

    let data: any[] = [];
    let count = 0;

    // For price_per_video and owner_name, use simple database sorting (direct columns)
    if ((sortBy === 'price_per_video' || sortBy === 'owner_name') && !uniqueCreators && !minAvgViews && !maxAvgViews) {
      // Use efficient database sorting - only fetch what we need for current page
      console.log(`[DATABASE SORT] Using database sorting for ${sortBy}, ascending: ${ascending}`);
      
      // Rebuild query without default order, then apply custom sort
      let dbSortQuery = supabase
        .from('reference_orders')
        .select(`
          id,
          influencer_id,
          username,
          normalized_username,
          email,
          account_link,
          owner_name,
          approved_vendor,
          total_fee_per_import,
          price_usd,
          video_count,
          final_price,
          price_per_video,
          songs,
          paid,
          date_paid,
          video_links,
          created_at
        `, { count: 'exact' });
      
      // Reapply all filters
      if (search) {
        const encoded = `%${search}%`;
        dbSortQuery = dbSortQuery.or(`username.ilike.${encoded},account_link.ilike.${encoded}`);
      }
      if (owner) {
        dbSortQuery = dbSortQuery.ilike('owner_name', `%${owner}%`);
      }
      if (approved === 'yes') {
        dbSortQuery = dbSortQuery.eq('approved_vendor', true);
      } else if (approved === 'no') {
        dbSortQuery = dbSortQuery.eq('approved_vendor', false);
      }
      if (paid === 'paid') {
        dbSortQuery = dbSortQuery.eq('paid', true);
      } else if (paid === 'unpaid') {
        dbSortQuery = dbSortQuery.eq('paid', false);
      }
      if (matched === 'true') {
        dbSortQuery = dbSortQuery.not('influencer_id', 'is', null);
      } else if (matched === 'false') {
        dbSortQuery = dbSortQuery.is('influencer_id', null);
      }
      if (dateFrom) {
        dbSortQuery = dbSortQuery.gte('date_paid', dateFrom);
      }
      if (dateTo) {
        dbSortQuery = dbSortQuery.lte('date_paid', dateTo);
      }
      
      // Apply custom sort
      // When sorting by date_paid, prioritize non-zero price_per_video first
      if (sortColumn === 'date_paid') {
        dbSortQuery = dbSortQuery
          .order('price_per_video', { ascending: false, nullsFirst: false })
          .order(sortColumn, { ascending, nullsFirst: false });
      } else {
        dbSortQuery = dbSortQuery.order(sortColumn, { ascending, nullsFirst: false });
      }
      
      // Fetch only the records needed for current page
      const { data: queryData, error: queryError, count: queryCount } = await dbSortQuery.range(offset, offset + limit - 1);
      if (queryError) {
        console.error(`[DATABASE SORT ERROR]`, queryError);
        throw queryError;
      }
      
      console.log(`[DATABASE SORT] Fetched ${queryData?.length || 0} records, total count: ${queryCount || 0}`);

      data = queryData || [];
      count = queryCount || 0;

      // Enrich with avg_views for just this page
      const normalizedUsernames = Array.from(
        new Set((data || []).map((row) => row.normalized_username).filter(isValidNormalizedUsername)),
      );

      if (normalizedUsernames.length) {
        const { data: avgRows, error: avgError } = await supabase
          .from('reference_creator_avg_views')
          .select('normalized_username, avg_views, status, last_calculated_at')
          .in('normalized_username', normalizedUsernames);

        if (avgError) throw avgError;

        const avgViewMap = (avgRows || []).reduce((acc, row) => {
          const normalized = row.normalized_username;
          if (!normalized) return acc;
          acc[normalized] = {
            avg_views: row.avg_views !== null && row.avg_views !== undefined ? Number(row.avg_views) : null,
            status: row.status,
            last_calculated_at: row.last_calculated_at,
          };
          return acc;
        }, {} as Record<string, { avg_views: number | null; status?: string | null; last_calculated_at?: string | null }>);

        data = data.map((row) => {
          const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
          return {
            ...row,
            avg_views: avgViewEntry?.avg_views ?? null,
            avg_views_status: avgViewEntry?.status ?? null,
            avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
          };
        });
      } else {
        data = data.map((row) => ({
          ...row,
          avg_views: null,
          avg_views_status: null,
          avg_views_updated_at: null,
        }));
      }
    }
    // For avg_views, we need to fetch more data and sort client-side (no FK relationship for join)
    else if (sortBy === 'avg_views' && !uniqueCreators && !minAvgViews && !maxAvgViews) {
      console.log(`[AVG_VIEWS SORT] Using client-side sorting for avg_views`);
      
      // Fetch a reasonable amount of data (up to 1000 records) to sort
      const maxRecordsToFetch = 1000;
      let dbSortQuery = supabase
        .from('reference_orders')
        .select(`
          id,
          influencer_id,
          username,
          normalized_username,
          email,
          account_link,
          owner_name,
          approved_vendor,
          total_fee_per_import,
          price_usd,
          video_count,
          final_price,
          price_per_video,
          songs,
          paid,
          date_paid,
          video_links,
          created_at
        `, { count: 'exact' });
      
      // Reapply all filters
      if (search) {
        const encoded = `%${search}%`;
        dbSortQuery = dbSortQuery.or(`username.ilike.${encoded},account_link.ilike.${encoded}`);
      }
      if (owner) {
        dbSortQuery = dbSortQuery.ilike('owner_name', `%${owner}%`);
      }
      if (approved === 'yes') {
        dbSortQuery = dbSortQuery.eq('approved_vendor', true);
      } else if (approved === 'no') {
        dbSortQuery = dbSortQuery.eq('approved_vendor', false);
      }
      if (paid === 'paid') {
        dbSortQuery = dbSortQuery.eq('paid', true);
      } else if (paid === 'unpaid') {
        dbSortQuery = dbSortQuery.eq('paid', false);
      }
      if (matched === 'true') {
        dbSortQuery = dbSortQuery.not('influencer_id', 'is', null);
      } else if (matched === 'false') {
        dbSortQuery = dbSortQuery.is('influencer_id', null);
      }
      if (dateFrom) {
        dbSortQuery = dbSortQuery.gte('date_paid', dateFrom);
      }
      if (dateTo) {
        dbSortQuery = dbSortQuery.lte('date_paid', dateTo);
      }
      
      // Fetch records (up to maxRecordsToFetch) for sorting
      const { data: allData, error: queryError, count: queryCount } = await dbSortQuery.range(0, maxRecordsToFetch - 1);
      if (queryError) {
        console.error(`[AVG_VIEWS SORT ERROR]`, queryError);
        throw queryError;
      }
      
      // Get all normalized usernames for avg_views enrichment
      const normalizedUsernames = Array.from(
        new Set((allData || []).map((row) => row.normalized_username).filter(isValidNormalizedUsername)),
      );

      let avgViewMap: Record<
        string,
        { avg_views: number | null; status?: string | null; last_calculated_at?: string | null }
      > = {};

      if (normalizedUsernames.length) {
        const { data: avgRows, error: avgError } = await supabase
          .from('reference_creator_avg_views')
          .select('normalized_username, avg_views, status, last_calculated_at')
          .in('normalized_username', normalizedUsernames);

        if (avgError) throw avgError;
        avgViewMap = (avgRows || []).reduce((acc, row) => {
          const normalized = row.normalized_username;
          if (!normalized) return acc;
          acc[normalized] = {
            avg_views: row.avg_views !== null && row.avg_views !== undefined ? Number(row.avg_views) : null,
            status: row.status,
            last_calculated_at: row.last_calculated_at,
          };
          return acc;
        }, {} as typeof avgViewMap);
      }
      
      // Enrich data with avg_views
      let enrichedData = (allData || []).map((row: any) => {
        const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
        return {
          ...row,
          avg_views: avgViewEntry?.avg_views ?? null,
          avg_views_status: avgViewEntry?.status ?? null,
          avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
        };
      });
      
      // Sort by avg_views
      enrichedData.sort((a: any, b: any) => {
        const aAvgViews = a.avg_views;
        const bAvgViews = b.avg_views;
        if (aAvgViews === null && bAvgViews === null) return 0;
        if (aAvgViews === null) return 1;
        if (bAvgViews === null) return -1;
        return ascending ? Number(aAvgViews) - Number(bAvgViews) : Number(bAvgViews) - Number(aAvgViews);
      });
      
      // Update count
      count = queryCount || enrichedData.length;
      
      // Apply pagination
      const paginationOffset = (page - 1) * limit;
      data = enrichedData.slice(paginationOffset, paginationOffset + limit);
      
      console.log(`[AVG_VIEWS SORT] Fetched ${enrichedData.length} records, sorted, returning page ${page} (${data.length} records)`);
    }
    // If uniqueCreators is true, use the efficient database function
    else if (uniqueCreators) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_unique_reference_orders', {
          p_limit: limit,
          p_offset: offset,
          p_sort_by: sortBy,
          p_sort_order: sortOrder
        });
        
        if (rpcError) throw rpcError;
        
        if (rpcData && rpcData.length > 0) {
          // Get total count from first row
          count = rpcData[0].total_count || 0;
          
          // Remove total_count from data
          data = rpcData.map((row: any) => {
            const { total_count, ...rest } = row;
            return rest;
          });
          
          // Enrich with avg_views
          const normalizedUsernames = Array.from(
            new Set(data.map((row) => row.normalized_username).filter(isValidNormalizedUsername)),
          );
          
          if (normalizedUsernames.length) {
            const { data: avgRows, error: avgError } = await supabase
              .from('reference_creator_avg_views')
              .select('normalized_username, avg_views, status, last_calculated_at')
              .in('normalized_username', normalizedUsernames);
            
            if (!avgError && avgRows) {
              const avgViewMap = avgRows.reduce((acc: any, row: any) => {
                const normalized = row.normalized_username;
                if (!normalized) return acc;
                acc[normalized] = {
                  avg_views: row.avg_views !== null && row.avg_views !== undefined ? Number(row.avg_views) : null,
                  status: row.status,
                  last_calculated_at: row.last_calculated_at,
                };
                return acc;
              }, {});
              
              data = data.map((row) => {
                const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
                return {
                  ...row,
                  avg_views: avgViewEntry?.avg_views ?? null,
                  avg_views_status: avgViewEntry?.status ?? null,
                  avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
                };
              });
            }
          }
          
          // Apply client-side filters (search, owner, etc.) if needed
          if (search) {
            const encoded = search.toLowerCase();
            data = data.filter((row) => {
              const username = (row.username || '').toLowerCase();
              const accountLink = (row.account_link || '').toLowerCase();
              return username.includes(encoded) || accountLink.includes(encoded);
            });
            count = data.length; // Update count after filtering
          }
          if (owner) {
            const ownerLower = owner.toLowerCase();
            data = data.filter((row) => (row.owner_name || '').toLowerCase().includes(ownerLower));
            count = data.length;
          }
          if (approved === 'yes') {
            data = data.filter((row) => row.approved_vendor === true);
            count = data.length;
          } else if (approved === 'no') {
            data = data.filter((row) => row.approved_vendor === false);
            count = data.length;
          }
          if (paid === 'paid') {
            data = data.filter((row) => row.paid === true);
            count = data.length;
          } else if (paid === 'unpaid') {
            data = data.filter((row) => row.paid === false);
            count = data.length;
          }
          if (matched === 'true') {
            data = data.filter((row) => row.influencer_id !== null);
            count = data.length;
          } else if (matched === 'false') {
            data = data.filter((row) => row.influencer_id === null);
            count = data.length;
          }
          if (dateFrom) {
            data = data.filter((row) => row.date_paid && row.date_paid >= dateFrom);
            count = data.length;
          }
          if (dateTo) {
            data = data.filter((row) => row.date_paid && row.date_paid <= dateTo);
            count = data.length;
          }
          if (minAvgViews) {
            const minVal = parseFloat(minAvgViews);
            if (!isNaN(minVal)) {
              data = data.filter((row) => row.avg_views !== null && row.avg_views >= minVal);
              count = data.length;
            }
          }
          if (maxAvgViews) {
            const maxVal = parseFloat(maxAvgViews);
            if (!isNaN(maxVal)) {
              data = data.filter((row) => row.avg_views !== null && row.avg_views <= maxVal);
              count = data.length;
            }
          }
        } else {
          count = 0;
          data = [];
        }
      } catch (rpcErr: any) {
        console.error('RPC error:', rpcErr);
        throw new Error(`Failed to fetch unique creators: ${rpcErr.message || 'Unknown error'}`);
      }
    } else if (sortBy === 'avg_views') {
      // For avg_views, we need to join with reference_creator_avg_views, so we still need custom logic
      console.log(`[ENTERING CUSTOM SORT BRANCH] sortBy: ${sortBy}, sortOrder: ${sortOrder}, ascending: ${ascending}`);
      // Build a fresh query without the default order for custom sorting
      let customSortQuery = supabase
        .from('reference_orders')
        .select(`
          id,
          influencer_id,
          username,
          normalized_username,
          email,
          account_link,
          owner_name,
          approved_vendor,
          total_fee_per_import,
          price_usd,
          video_count,
          final_price,
          price_per_video,
          songs,
          paid,
          date_paid,
          video_links,
          created_at
        `, { count: 'exact' });
      
      // If uniqueCreators is true, fetch ALL data first (without other filters) to find unique creators
      // Then apply other filters after deduplication
      if (!uniqueCreators) {
        // Reapply all filters to the custom sort query
        if (search) {
          const encoded = `%${search}%`;
          customSortQuery = customSortQuery.or(`username.ilike.${encoded},account_link.ilike.${encoded}`);
        }
        if (owner) {
          customSortQuery = customSortQuery.ilike('owner_name', `%${owner}%`);
        }
        if (approved === 'yes') {
          customSortQuery = customSortQuery.eq('approved_vendor', true);
        } else if (approved === 'no') {
          customSortQuery = customSortQuery.eq('approved_vendor', false);
        }
        if (paid === 'paid') {
          customSortQuery = customSortQuery.eq('paid', true);
        } else if (paid === 'unpaid') {
          customSortQuery = customSortQuery.eq('paid', false);
        }
        if (matched === 'true') {
          customSortQuery = customSortQuery.not('influencer_id', 'is', null);
        } else if (matched === 'false') {
          customSortQuery = customSortQuery.is('influencer_id', null);
        }
        if (dateFrom) {
          customSortQuery = customSortQuery.gte('date_paid', dateFrom);
        }
        if (dateTo) {
          customSortQuery = customSortQuery.lte('date_paid', dateTo);
        }
      }
      
      // Fetch ALL matching records (without pagination) to sort them properly
      // Supabase has a default limit of 1000, so we need to fetch in batches
      // Add ORDER BY to help Supabase optimize the query (even though we'll sort in memory)
      // Use id for consistent ordering to avoid Supabase query issues
      customSortQuery = customSortQuery.order('id', { ascending: true });
      
      let allData: any[] = [];
      let totalCount = 0;
      
      // Fetch total count first (this is faster than fetching all data)
      // Build a separate query just for count (can't reuse customSortQuery since select() was already called)
      try {
        let countQuery = supabase
          .from('reference_orders')
          .select('*', { count: 'exact', head: true });
        
        // Apply same filters as customSortQuery
        if (!uniqueCreators) {
          if (search) {
            const encoded = `%${search}%`;
            countQuery = countQuery.or(`username.ilike.${encoded},account_link.ilike.${encoded}`);
          }
          if (owner) {
            countQuery = countQuery.ilike('owner_name', `%${owner}%`);
          }
          if (approved === 'yes') {
            countQuery = countQuery.eq('approved_vendor', true);
          } else if (approved === 'no') {
            countQuery = countQuery.eq('approved_vendor', false);
          }
          if (paid === 'paid') {
            countQuery = countQuery.eq('paid', true);
          } else if (paid === 'unpaid') {
            countQuery = countQuery.eq('paid', false);
          }
          if (matched === 'true') {
            countQuery = countQuery.not('influencer_id', 'is', null);
          } else if (matched === 'false') {
            countQuery = countQuery.is('influencer_id', null);
          }
          if (dateFrom) {
            countQuery = countQuery.gte('date_paid', dateFrom);
          }
          if (dateTo) {
            countQuery = countQuery.lte('date_paid', dateTo);
          }
        }
        
        const { count: totalCountResult, error: countError } = await countQuery;
        if (countError) {
          console.error(`[Count Error]`, countError);
          // Continue anyway, we'll use the fetched data length
        } else {
          totalCount = totalCountResult || 0;
          console.log(`[Total Count] ${totalCount} records to fetch`);
        }
      } catch (err: any) {
        console.error(`[Count Exception]`, err);
        // Continue anyway
      }
      
      // Always fetch in batches to handle datasets larger than 1000 records
      // Limit to reasonable number to avoid timeouts (e.g., 10k records max for sorting)
      const maxRecordsToFetch = 10000;
      const batchSize = 1000;
      let batchOffset = 0;
      let hasMore = true;
      let firstBatchCount = 0;
      
      while (hasMore && allData.length < maxRecordsToFetch) {
        try {
          const { data: batchData, error: batchError, count: batchCount } = await customSortQuery.range(batchOffset, batchOffset + batchSize - 1);
          
          if (batchError) {
            console.error(`[Batch Fetch Error] Offset: ${batchOffset}, Error:`, batchError);
            // If we have some data, continue with what we have
            if (allData.length > 0) {
              console.log(`[Batch Fetch] Stopping due to error, but continuing with ${allData.length} records`);
              break;
            }
            throw batchError;
          }
          
          // Get total count from first batch if we didn't get it earlier
          if (batchOffset === 0 && batchCount !== null && totalCount === 0) {
            firstBatchCount = batchCount;
            totalCount = firstBatchCount;
            console.log(`[Batch Fetch] Total count from first batch: ${firstBatchCount}`);
          }
          
          if (batchData && batchData.length > 0) {
            allData = allData.concat(batchData);
            console.log(`[Batch Fetch] Fetched ${batchData.length} records, total so far: ${allData.length}`);
            batchOffset += batchSize;
            hasMore = batchData.length === batchSize && allData.length < maxRecordsToFetch;
          } else {
            hasMore = false;
          }
        } catch (err: any) {
          console.error(`[Batch Fetch Exception] Offset: ${batchOffset}, Error:`, err);
          // If we have some data, continue with what we have
          if (allData.length > 0) {
            console.log(`[Batch Fetch] Stopping due to exception, but continuing with ${allData.length} records`);
            break;
          }
          throw err;
        }
      }
      
      if (allData.length >= maxRecordsToFetch) {
        console.warn(`[Batch Fetch] Hit max records limit (${maxRecordsToFetch}), sorting will be limited to these records`);
      }
      
      console.log(`[Batch Fetch Complete] Total records fetched: ${allData.length}`);
      
      // Use the count from first batch, or fallback to actual length
      totalCount = firstBatchCount > 0 ? firstBatchCount : allData.length;

      // Get all normalized usernames for avg_views enrichment
      const normalizedUsernames = Array.from(
        new Set((allData || []).map((row) => row.normalized_username).filter(isValidNormalizedUsername)),
      );

      let avgViewMap: Record<
        string,
        { avg_views: number | null; status?: string | null; last_calculated_at?: string | null }
      > = {};

      if (normalizedUsernames.length) {
        const { data: avgRows, error: avgError } = await supabase
          .from('reference_creator_avg_views')
          .select('normalized_username, avg_views, status, last_calculated_at')
          .in('normalized_username', normalizedUsernames);

        if (avgError) throw avgError;
        avgViewMap = (avgRows || []).reduce((acc, row) => {
          const normalized = row.normalized_username;
          if (!normalized) return acc;
          acc[normalized] = {
            avg_views: row.avg_views !== null && row.avg_views !== undefined ? Number(row.avg_views) : null,
            status: row.status,
            last_calculated_at: row.last_calculated_at,
          };
          return acc;
        }, {} as typeof avgViewMap);
      }

      // Enrich all data with avg_views
      let enrichedAll = (allData || []).map((row) => {
        const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
        return {
          ...row,
          avg_views: avgViewEntry?.avg_views ?? null,
          avg_views_status: avgViewEntry?.status ?? null,
          avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
        };
      });

      // Apply unique creators filter FIRST - keep only latest order per normalized_username
      if (uniqueCreators) {
        const beforeCount = enrichedAll.length;
        const creatorMap = new Map<string, any>();
        for (const row of enrichedAll) {
          if (!row.normalized_username) continue;
          const existing = creatorMap.get(row.normalized_username);
          if (!existing) {
            creatorMap.set(row.normalized_username, row);
          } else {
            // Compare dates: prefer row with date_paid, or if both have dates, prefer the later one
            const rowDate = row.date_paid ? new Date(row.date_paid).getTime() : 0;
            const existingDate = existing.date_paid ? new Date(existing.date_paid).getTime() : 0;
            // If row has a date and existing doesn't, use row. If both have dates, use the later one.
            // If neither has a date, prefer row with later created_at
            if (rowDate > existingDate) {
              creatorMap.set(row.normalized_username, row);
            } else if (rowDate === 0 && existingDate === 0) {
              // Both have no date_paid, use created_at as fallback
              const rowCreated = row.created_at ? new Date(row.created_at).getTime() : 0;
              const existingCreated = existing.created_at ? new Date(existing.created_at).getTime() : 0;
              if (rowCreated > existingCreated) {
                creatorMap.set(row.normalized_username, row);
              }
            }
          }
        }
        enrichedAll = Array.from(creatorMap.values());
        console.log(`[Unique Creators Filter] Before: ${beforeCount}, After: ${enrichedAll.length}, Unique creators: ${creatorMap.size}`);
      }

      // Apply other filters AFTER unique creators filter
      if (search) {
        const encoded = search.toLowerCase();
        enrichedAll = enrichedAll.filter((row) => {
          const username = (row.username || '').toLowerCase();
          const accountLink = (row.account_link || '').toLowerCase();
          return username.includes(encoded) || accountLink.includes(encoded);
        });
      }
      if (owner) {
        const ownerLower = owner.toLowerCase();
        enrichedAll = enrichedAll.filter((row) => (row.owner_name || '').toLowerCase().includes(ownerLower));
      }
      if (approved === 'yes') {
        enrichedAll = enrichedAll.filter((row) => row.approved_vendor === true);
      } else if (approved === 'no') {
        enrichedAll = enrichedAll.filter((row) => row.approved_vendor === false);
      }
      if (paid === 'paid') {
        enrichedAll = enrichedAll.filter((row) => row.paid === true);
      } else if (paid === 'unpaid') {
        enrichedAll = enrichedAll.filter((row) => row.paid === false);
      }
      if (matched === 'true') {
        enrichedAll = enrichedAll.filter((row) => row.influencer_id !== null);
      } else if (matched === 'false') {
        enrichedAll = enrichedAll.filter((row) => row.influencer_id === null);
      }
      if (dateFrom) {
        enrichedAll = enrichedAll.filter((row) => row.date_paid && row.date_paid >= dateFrom);
      }
      if (dateTo) {
        enrichedAll = enrichedAll.filter((row) => row.date_paid && row.date_paid <= dateTo);
      }

      // Apply avg views filters
      if (minAvgViews) {
        const minVal = parseFloat(minAvgViews);
        if (!isNaN(minVal)) {
          enrichedAll = enrichedAll.filter((row) => row.avg_views !== null && row.avg_views >= minVal);
        }
      }
      if (maxAvgViews) {
        const maxVal = parseFloat(maxAvgViews);
        if (!isNaN(maxVal)) {
          enrichedAll = enrichedAll.filter((row) => row.avg_views !== null && row.avg_views <= maxVal);
        }
      }

      // Update count after filtering
      count = enrichedAll.length;
      console.log(`[Count Update] Final count after all filters: ${count}, uniqueCreators: ${uniqueCreators}`);
      console.log(`[Sort Params] sortBy: ${sortBy}, sortOrder: ${sortOrder}, ascending: ${ascending}`);

      // Sort based on the selected column
      // Use consistent null handling: null values go to the end (or beginning) based on sort order
      console.log(`[Before Sort] First 5 records:`, enrichedAll.slice(0, 5).map(r => ({ 
        username: r.username, 
        price_per_video: r.price_per_video,
        avg_views: r.avg_views,
        owner_name: r.owner_name
      })));
      
      if (sortBy === 'avg_views') {
        enrichedAll.sort((a, b) => {
          // Convert to numbers, handling strings and nulls
          const aNum = a.avg_views != null ? Number(a.avg_views) : null;
          const bNum = b.avg_views != null ? Number(b.avg_views) : null;
          // Handle null values: put them at the end
          if (aNum === null || aNum === undefined || isNaN(aNum)) return 1;
          if (bNum === null || bNum === undefined || isNaN(bNum)) return -1;
          // Both have valid numeric values, compare them
          return ascending ? aNum - bNum : bNum - aNum;
        });
      } else if (sortBy === 'owner_name') {
        // Case-insensitive string sorting
        enrichedAll.sort((a, b) => {
          const aVal = (a.owner_name || '').toLowerCase();
          const bVal = (b.owner_name || '').toLowerCase();
          // Handle empty strings: put them at the end
          if (!aVal && !bVal) return 0;
          if (!aVal) return 1;
          if (!bVal) return -1;
          // Both have values, compare them
          if (aVal < bVal) return ascending ? -1 : 1;
          if (aVal > bVal) return ascending ? 1 : -1;
          return 0;
        });
      } else if (sortBy === 'price_per_video') {
        // Numeric sorting for price_per_video
        console.log(`[Price Per Video Sort] Starting sort, ascending: ${ascending}`);
        console.log(`[Price Per Video Sort] Sample values before sort:`, enrichedAll.slice(0, 10).map(r => r.price_per_video));
        
        enrichedAll.sort((a, b) => {
          // Convert to numbers, handling strings and nulls
          // Note: 0 is a valid value, only null/undefined/NaN should be treated as missing
          const aNum = a.price_per_video != null && !isNaN(Number(a.price_per_video)) ? Number(a.price_per_video) : null;
          const bNum = b.price_per_video != null && !isNaN(Number(b.price_per_video)) ? Number(b.price_per_video) : null;
          // Handle null/undefined/NaN values: put them at the end
          if (aNum === null) return 1;
          if (bNum === null) return -1;
          // Both have valid numeric values (including 0), compare them
          const result = ascending ? aNum - bNum : bNum - aNum;
          return result;
        });
        
        console.log(`[Price Per Video Sort] Sample values after sort:`, enrichedAll.slice(0, 10).map(r => r.price_per_video));
        console.log(`[Price Per Video Sort] Last 10 values after sort:`, enrichedAll.slice(-10).map(r => r.price_per_video));
      } else if (sortBy === 'date_paid') {
        // When sorting by date_paid, prioritize non-zero price_per_video first
        enrichedAll.sort((a, b) => {
          // First compare by price_per_video (non-zero first)
          const aPrice = a.price_per_video != null && !isNaN(Number(a.price_per_video)) ? Number(a.price_per_video) : 0;
          const bPrice = b.price_per_video != null && !isNaN(Number(b.price_per_video)) ? Number(b.price_per_video) : 0;
          // Non-zero prices come first
          if (aPrice > 0 && bPrice === 0) return -1;
          if (aPrice === 0 && bPrice > 0) return 1;
          
          // If both are non-zero or both are zero, sort by date_paid
          const aDate = a.date_paid ? new Date(a.date_paid).getTime() : 0;
          const bDate = b.date_paid ? new Date(b.date_paid).getTime() : 0;
          if (aDate === 0 && bDate === 0) return 0;
          if (aDate === 0) return 1;
          if (bDate === 0) return -1;
          return ascending ? aDate - bDate : bDate - aDate;
        });
      }
      
      console.log(`[After Sort] sortBy: ${sortBy}, sortOrder: ${ascending ? 'asc' : 'desc'}, total records: ${enrichedAll.length}`);
      console.log(`[After Sort] First 5 records:`, enrichedAll.slice(0, 5).map(r => ({ 
        username: r.username, 
        price_per_video: r.price_per_video,
        avg_views: r.avg_views,
        owner_name: r.owner_name
      })));
      console.log(`[After Sort] Last 5 records:`, enrichedAll.slice(-5).map(r => ({ 
        username: r.username, 
        price_per_video: r.price_per_video,
        avg_views: r.avg_views,
        owner_name: r.owner_name
      })));

      // Apply pagination to sorted data (use the original offset from query params, not batchOffset)
      const paginationOffset = (page - 1) * limit;
      console.log(`[Pagination] page: ${page}, limit: ${limit}, paginationOffset: ${paginationOffset}, slice: [${paginationOffset}, ${paginationOffset + limit}]`);
      console.log(`[Before Pagination] First 10 price_per_video values:`, enrichedAll.slice(0, 10).map(r => ({ username: r.username, price_per_video: r.price_per_video })));
      data = enrichedAll.slice(paginationOffset, paginationOffset + limit);
      console.log(`[Final Data] Returning ${data.length} records`);
      console.log(`[Final Data] First 5 records price_per_video:`, data.slice(0, 5).map(r => ({ username: r.username, price_per_video: r.price_per_video })));
    } else {
      // For other columns, use database sorting (more efficient)
      // OPTIMIZATION: If avg_views filters are present, filter at database level first
      let matchingNormalizedUsernames: string[] | null = null;
      
      if (minAvgViews || maxAvgViews) {
        console.log(`[AVG_VIEWS FILTER] Filtering avg_views at database level first`);
        // First, get normalized_usernames that match the avg_views filter
        let avgViewsQuery = supabase
          .from('reference_creator_avg_views')
          .select('normalized_username');
        
        if (minAvgViews) {
          const minVal = parseFloat(minAvgViews);
          if (!isNaN(minVal)) {
            avgViewsQuery = avgViewsQuery.gte('avg_views', minVal);
          }
        }
        if (maxAvgViews) {
          const maxVal = parseFloat(maxAvgViews);
          if (!isNaN(maxVal)) {
            avgViewsQuery = avgViewsQuery.lte('avg_views', maxVal);
          }
        }
        
        // Also filter out null avg_views
        avgViewsQuery = avgViewsQuery.not('avg_views', 'is', null);
        
        // Fetch ALL matching usernames in batches (Supabase default limit is 1000)
        // This is critical - we need ALL matching creators, not just the first 1000
        let allAvgViewsData: any[] = [];
        let avgViewsOffset = 0;
        const avgViewsBatchSize = 1000;
        let hasMoreAvgViews = true;
        
        while (hasMoreAvgViews) {
          const { data: batchData, error: batchError } = await avgViewsQuery
            .range(avgViewsOffset, avgViewsOffset + avgViewsBatchSize - 1);
          
          if (batchError) {
            console.error(`[AVG_VIEWS FILTER ERROR]`, batchError);
            throw batchError;
          }
          
          if (batchData && batchData.length > 0) {
            allAvgViewsData = allAvgViewsData.concat(batchData);
            avgViewsOffset += avgViewsBatchSize;
            hasMoreAvgViews = batchData.length === avgViewsBatchSize;
          } else {
            hasMoreAvgViews = false;
          }
        }
        
        matchingNormalizedUsernames = allAvgViewsData.map((row) => row.normalized_username).filter(Boolean);
        console.log(`[AVG_VIEWS FILTER] Found ${matchingNormalizedUsernames.length} creators matching avg_views filter (fetched in batches)`);
        
        // If no creators match, return empty result early
        if (matchingNormalizedUsernames.length === 0) {
          return Response.json({
            data: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
            stats: {
              totalOrders: 0,
              totalCreators: 0,
              avgPricePerVideo: 0,
              totalSpend: 0,
            },
            owners: [],
          }, {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0',
            },
          });
        }
      }
      
      // Build the main query
      let baseQuery = supabase
        .from('reference_orders')
        .select(`
          id,
          influencer_id,
          username,
          normalized_username,
          email,
          account_link,
          owner_name,
          approved_vendor,
          total_fee_per_import,
          price_usd,
          video_count,
          final_price,
          price_per_video,
          songs,
          paid,
          date_paid,
          video_links,
          created_at
        `, { count: 'exact' });
      
      // Apply avg_views filter at database level (if present)
      // If we have more than 1000 matching creators, we need to fetch in batches
      const chunkSize = 1000; // Supabase .in() limit
      if (matchingNormalizedUsernames && matchingNormalizedUsernames.length > 0) {
        
        if (matchingNormalizedUsernames.length <= chunkSize) {
          // Simple case: <= 1000 creators, use .in() directly
          baseQuery = baseQuery.in('normalized_username', matchingNormalizedUsernames);
        } else {
          // Complex case: > 1000 creators, need to fetch in batches and combine
          console.log(`[AVG_VIEWS FILTER] ${matchingNormalizedUsernames.length} matching creators (exceeds ${chunkSize} limit), fetching in batches`);
          
          // Fetch all matching orders in batches
          const usernameChunks: string[][] = [];
          for (let i = 0; i < matchingNormalizedUsernames.length; i += chunkSize) {
            usernameChunks.push(matchingNormalizedUsernames.slice(i, i + chunkSize));
          }
          
          let allMatchingOrders: any[] = [];
          let totalCount = 0;
          
          // Helper function to fetch orders for a single chunk
          const fetchChunkOrders = async (chunk: string[]): Promise<{ orders: any[], count: number }> => {
            let chunkQuery = supabase
              .from('reference_orders')
              .select(`
                id,
                influencer_id,
                username,
                normalized_username,
                email,
                account_link,
                owner_name,
                approved_vendor,
                total_fee_per_import,
                price_usd,
                video_count,
                final_price,
                price_per_video,
                songs,
                paid,
                date_paid,
                video_links,
                created_at
              `, { count: 'exact' })
              .in('normalized_username', chunk);
            
            // Apply all other filters to each chunk
            if (search) {
              const encoded = `%${search}%`;
              chunkQuery = chunkQuery.or(`username.ilike.${encoded},account_link.ilike.${encoded}`);
            }
            if (owner) {
              chunkQuery = chunkQuery.ilike('owner_name', `%${owner}%`);
            }
            if (approved === 'yes') {
              chunkQuery = chunkQuery.eq('approved_vendor', true);
            } else if (approved === 'no') {
              chunkQuery = chunkQuery.eq('approved_vendor', false);
            }
            if (paid === 'paid') {
              chunkQuery = chunkQuery.eq('paid', true);
            } else if (paid === 'unpaid') {
              chunkQuery = chunkQuery.eq('paid', false);
            }
            if (matched === 'true') {
              chunkQuery = chunkQuery.not('influencer_id', 'is', null);
            } else if (matched === 'false') {
              chunkQuery = chunkQuery.is('influencer_id', null);
            }
            if (dateFrom) {
              chunkQuery = chunkQuery.gte('date_paid', dateFrom);
            }
            if (dateTo) {
              chunkQuery = chunkQuery.lte('date_paid', dateTo);
            }
            
            // Apply ordering: prioritize non-zero price_per_video when sorting by date_paid
            if (sortColumn === 'date_paid') {
              chunkQuery = chunkQuery
                .order('price_per_video', { ascending: false, nullsFirst: false })
                .order(sortColumn, { ascending, nullsFirst: false });
            } else {
              chunkQuery = chunkQuery.order(sortColumn, { ascending, nullsFirst: false });
            }
            
            // Fetch all records from this chunk (no pagination yet)
            let chunkData: any[] = [];
            let chunkOffset = 0;
            const chunkBatchSize = 1000;
            let hasMore = true;
            let chunkCount = 0;
            
            while (hasMore) {
              const { data: batchData, error: batchError, count: batchCount } = await chunkQuery.range(chunkOffset, chunkOffset + chunkBatchSize - 1);
              if (batchError) throw batchError;
              
              if (chunkOffset === 0 && batchCount !== null) {
                chunkCount = batchCount;
              }
              
              if (batchData && batchData.length > 0) {
                chunkData = chunkData.concat(batchData);
                chunkOffset += chunkBatchSize;
                hasMore = batchData.length === chunkBatchSize;
              } else {
                hasMore = false;
              }
            }
            
            return { orders: chunkData, count: chunkCount };
          };
          
          // Process chunks in parallel (15 at a time)
          const parallelBatchSize = 15;
          for (let i = 0; i < usernameChunks.length; i += parallelBatchSize) {
            const chunkBatch = usernameChunks.slice(i, i + parallelBatchSize);
            console.log(`[AVG_VIEWS FILTER BATCH] Processing chunks ${i + 1}-${Math.min(i + parallelBatchSize, usernameChunks.length)} of ${usernameChunks.length} in parallel`);
            
            const results = await Promise.allSettled(
              chunkBatch.map(chunk => fetchChunkOrders(chunk))
            );
            
            // Collect successful results
            for (let j = 0; j < results.length; j++) {
              const result = results[j];
              if (result.status === 'fulfilled') {
                allMatchingOrders = allMatchingOrders.concat(result.value.orders);
                totalCount += result.value.count;
                console.log(`[AVG_VIEWS FILTER BATCH] Fetched ${result.value.orders.length} orders from chunk (${chunkBatch[j].length} creators), total so far: ${allMatchingOrders.length}`);
              } else {
                console.error(`[AVG_VIEWS FILTER BATCH] Error processing chunk (${chunkBatch[j].length} creators):`, result.reason);
              }
            }
          }
          
          console.log(`[AVG_VIEWS FILTER] Total matching orders fetched: ${allMatchingOrders.length}, total count: ${totalCount}`);
          
          // Now we have all matching orders, need to sort and paginate
          // Enrich with avg_views first
          const normalizedUsernames = Array.from(
            new Set(allMatchingOrders.map((row) => row.normalized_username).filter(isValidNormalizedUsername)),
          );
          
          let avgViewMap: Record<string, { avg_views: number | null; status?: string | null; last_calculated_at?: string | null }> = {};
          
          if (normalizedUsernames.length) {
            // Fetch avg_views in chunks too (if needed)
            const avgViewChunks: string[][] = [];
            for (let i = 0; i < normalizedUsernames.length; i += chunkSize) {
              avgViewChunks.push(normalizedUsernames.slice(i, i + chunkSize));
            }
            
            for (const avgChunk of avgViewChunks) {
              const { data: avgRows, error: avgError } = await supabase
                .from('reference_creator_avg_views')
                .select('normalized_username, avg_views, status, last_calculated_at')
                .in('normalized_username', avgChunk);
              
              if (avgError) throw avgError;
              
              (avgRows || []).forEach((row) => {
                const normalized = row.normalized_username;
                if (!normalized) return;
                avgViewMap[normalized] = {
                  avg_views: row.avg_views !== null && row.avg_views !== undefined ? Number(row.avg_views) : null,
                  status: row.status,
                  last_calculated_at: row.last_calculated_at,
                };
              });
            }
          }
          
          // Enrich all data with avg_views
          let enrichedData = allMatchingOrders.map((row: any) => {
            const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
            return {
              ...row,
              avg_views: avgViewEntry?.avg_views ?? null,
              avg_views_status: avgViewEntry?.status ?? null,
              avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
            };
          });
          
          // Handle uniqueCreators filter if needed
          if (uniqueCreators) {
            const beforeCount = enrichedData.length;
            const creatorMap = new Map<string, any>();
            for (const row of enrichedData) {
              if (!row.normalized_username) continue;
              const existing = creatorMap.get(row.normalized_username);
              if (!existing) {
                creatorMap.set(row.normalized_username, row);
              } else {
                const rowDate = row.date_paid ? new Date(row.date_paid).getTime() : 0;
                const existingDate = existing.date_paid ? new Date(existing.date_paid).getTime() : 0;
                if (rowDate > existingDate) {
                  creatorMap.set(row.normalized_username, row);
                } else if (rowDate === 0 && existingDate === 0) {
                  const rowCreated = row.created_at ? new Date(row.created_at).getTime() : 0;
                  const existingCreated = existing.created_at ? new Date(existing.created_at).getTime() : 0;
                  if (rowCreated > existingCreated) {
                    creatorMap.set(row.normalized_username, row);
                  }
                }
              }
            }
            enrichedData = Array.from(creatorMap.values());
            console.log(`[UNIQUE CREATORS] Before: ${beforeCount}, After: ${enrichedData.length}`);
          }
          
          // Sort the data
          // When sorting by date_paid, prioritize non-zero price_per_video first
          enrichedData.sort((a: any, b: any) => {
            // If sorting by date_paid, first compare by price_per_video (non-zero first)
            if (sortColumn === 'date_paid') {
              const aPrice = a.price_per_video != null && !isNaN(Number(a.price_per_video)) ? Number(a.price_per_video) : 0;
              const bPrice = b.price_per_video != null && !isNaN(Number(b.price_per_video)) ? Number(b.price_per_video) : 0;
              // Non-zero prices come first
              if (aPrice > 0 && bPrice === 0) return -1;
              if (aPrice === 0 && bPrice > 0) return 1;
              // If both are non-zero or both are zero, sort by date_paid
            }
            
            const aVal = a[sortColumn];
            const bVal = b[sortColumn];
            if (aVal === null || aVal === undefined) return 1;
            if (bVal === null || bVal === undefined) return -1;
            if (sortColumn === 'owner_name' || sortColumn === 'username') {
              if (!aVal && !bVal) return 0;
              if (!aVal) return 1;
              if (!bVal) return -1;
            }
            if (aVal < bVal) return ascending ? -1 : 1;
            if (aVal > bVal) return ascending ? 1 : -1;
            return 0;
          });
          
          // Update count and paginate
          count = enrichedData.length;
          const paginationOffset = (page - 1) * limit;
          data = enrichedData.slice(paginationOffset, paginationOffset + limit);
          
          // Skip the rest of the standard query logic
          // Jump to stats calculation
          const { data: summaryRow } = await supabase
            .from('reference_orders_stats')
            .select('*')
            .single();

          const { data: ownerStats } = await supabase
            .from('reference_orders_owner_stats')
            .select('owner_name, total_orders')
            .order('total_orders', { ascending: false })
            .limit(6);

          return Response.json({
            data: data,
            total: count || 0,
            page,
            limit,
            totalPages: Math.ceil((count || 0) / limit),
            stats: {
              totalOrders: summaryRow?.total_orders || 0,
              totalCreators: summaryRow?.total_creators || 0,
              avgPricePerVideo: summaryRow?.avg_price_per_video || 0,
              totalSpend: summaryRow?.total_spend || 0,
            },
            owners: ownerStats || [],
          }, {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0',
            },
          });
        }
      }
      
      // Apply all other filters (only if we didn't already handle batching above)
      // If we have > 1000 matching creators, we already returned early, so this only runs for <= 1000 or no avg_views filter
      if (!matchingNormalizedUsernames || matchingNormalizedUsernames.length <= chunkSize) {
        if (search) {
          const encoded = `%${search}%`;
          baseQuery = baseQuery.or(`username.ilike.${encoded},account_link.ilike.${encoded}`);
        }
        if (owner) {
          baseQuery = baseQuery.ilike('owner_name', `%${owner}%`);
        }
        if (approved === 'yes') {
          baseQuery = baseQuery.eq('approved_vendor', true);
        } else if (approved === 'no') {
          baseQuery = baseQuery.eq('approved_vendor', false);
        }
        if (paid === 'paid') {
          baseQuery = baseQuery.eq('paid', true);
        } else if (paid === 'unpaid') {
          baseQuery = baseQuery.eq('paid', false);
        }
        if (matched === 'true') {
          baseQuery = baseQuery.not('influencer_id', 'is', null);
        } else if (matched === 'false') {
          baseQuery = baseQuery.is('influencer_id', null);
        }
        if (dateFrom) {
          baseQuery = baseQuery.gte('date_paid', dateFrom);
        }
        if (dateTo) {
          baseQuery = baseQuery.lte('date_paid', dateTo);
        }
      }
      
      // Handle uniqueCreators filter - need to fetch all matching records first
      if (uniqueCreators) {
        console.log(`[UNIQUE CREATORS] Fetching all records for unique creators filter`);
        // Fetch all matching records (with avg_views filter already applied)
        let allData: any[] = [];
        const batchSize = 1000;
        let batchOffset = 0;
        let hasMore = true;
        let firstBatchCount = 0;
        
        // Apply ordering: prioritize non-zero price_per_video when sorting by date_paid
        if (sortColumn === 'date_paid') {
          baseQuery = baseQuery
            .order('price_per_video', { ascending: false, nullsFirst: false })
            .order(sortColumn, { ascending, nullsFirst: false });
        } else {
          baseQuery = baseQuery.order(sortColumn, { ascending, nullsFirst: false });
        }
        
        while (hasMore) {
          const { data: batchData, error: batchError, count: batchCount } = await baseQuery.range(batchOffset, batchOffset + batchSize - 1);
          if (batchError) throw batchError;
          
          if (batchOffset === 0 && batchCount !== null) {
            firstBatchCount = batchCount;
          }
          
          if (batchData && batchData.length > 0) {
            allData = allData.concat(batchData);
            batchOffset += batchSize;
            hasMore = batchData.length === batchSize;
          } else {
            hasMore = false;
          }
        }
        
        // Enrich with avg_views
        const normalizedUsernames = Array.from(
          new Set(allData.map((row) => row.normalized_username).filter(isValidNormalizedUsername)),
        );

        let avgViewMap: Record<string, { avg_views: number | null; status?: string | null; last_calculated_at?: string | null }> = {};

        if (normalizedUsernames.length) {
          const { data: avgRows, error: avgError } = await supabase
            .from('reference_creator_avg_views')
            .select('normalized_username, avg_views, status, last_calculated_at')
            .in('normalized_username', normalizedUsernames);

          if (avgError) throw avgError;
          avgViewMap = (avgRows || []).reduce((acc, row) => {
            const normalized = row.normalized_username;
            if (!normalized) return acc;
            acc[normalized] = {
              avg_views: row.avg_views !== null && row.avg_views !== undefined ? Number(row.avg_views) : null,
              status: row.status,
              last_calculated_at: row.last_calculated_at,
            };
            return acc;
          }, {} as typeof avgViewMap);
        }

        let enrichedData = allData.map((row: any) => {
          const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
          return {
            ...row,
            avg_views: avgViewEntry?.avg_views ?? null,
            avg_views_status: avgViewEntry?.status ?? null,
            avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
          };
        });

        // Apply unique creators filter
        const beforeCount = enrichedData.length;
        const creatorMap = new Map<string, any>();
        for (const row of enrichedData) {
          if (!row.normalized_username) continue;
          const existing = creatorMap.get(row.normalized_username);
          if (!existing) {
            creatorMap.set(row.normalized_username, row);
          } else {
            const rowDate = row.date_paid ? new Date(row.date_paid).getTime() : 0;
            const existingDate = existing.date_paid ? new Date(existing.date_paid).getTime() : 0;
            if (rowDate > existingDate) {
              creatorMap.set(row.normalized_username, row);
            } else if (rowDate === 0 && existingDate === 0) {
              const rowCreated = row.created_at ? new Date(row.created_at).getTime() : 0;
              const existingCreated = existing.created_at ? new Date(existing.created_at).getTime() : 0;
              if (rowCreated > existingCreated) {
                creatorMap.set(row.normalized_username, row);
              }
            }
          }
        }
        enrichedData = Array.from(creatorMap.values());
        console.log(`[UNIQUE CREATORS] Before: ${beforeCount}, After: ${enrichedData.length}`);

        // Sort and paginate
        // When sorting by date_paid, prioritize non-zero price_per_video first
        enrichedData.sort((a: any, b: any) => {
          // If sorting by date_paid, first compare by price_per_video (non-zero first)
          if (sortColumn === 'date_paid') {
            const aPrice = a.price_per_video != null && !isNaN(Number(a.price_per_video)) ? Number(a.price_per_video) : 0;
            const bPrice = b.price_per_video != null && !isNaN(Number(b.price_per_video)) ? Number(b.price_per_video) : 0;
            // Non-zero prices come first
            if (aPrice > 0 && bPrice === 0) return -1;
            if (aPrice === 0 && bPrice > 0) return 1;
            // If both are non-zero or both are zero, sort by date_paid
          }
          
          const aVal = a[sortColumn];
          const bVal = b[sortColumn];
          if (aVal === null || aVal === undefined) return 1;
          if (bVal === null || bVal === undefined) return -1;
          if (sortColumn === 'owner_name' || sortColumn === 'username') {
            if (!aVal && !bVal) return 0;
            if (!aVal) return 1;
            if (!bVal) return -1;
          }
          if (aVal < bVal) return ascending ? -1 : 1;
          if (aVal > bVal) return ascending ? 1 : -1;
          return 0;
        });

        count = enrichedData.length;
        const paginationOffset = (page - 1) * limit;
        data = enrichedData.slice(paginationOffset, paginationOffset + limit);
      } else {
        // Standard path: use database sorting (more efficient)
        // Apply sorting
        // When sorting by date_paid (default), prioritize non-zero price_per_video first
        if (sortColumn === 'date_paid') {
          baseQuery = baseQuery
            .order('price_per_video', { ascending: false, nullsFirst: false })
            .order(sortColumn, { ascending, nullsFirst: false });
        } else {
          baseQuery = baseQuery.order(sortColumn, { ascending, nullsFirst: false });
        }
        
        // Fetch only the records needed for current page
        const { data: queryData, error: queryError, count: queryCount } = await baseQuery.range(offset, offset + limit - 1);
        if (queryError) {
          console.error(`[STANDARD QUERY ERROR]`, queryError);
          throw queryError;
        }

      data = queryData || [];
      count = queryCount || 0;

        // Enrich with avg_views for just this page
      const normalizedUsernames = Array.from(
        new Set((data || []).map((row) => row.normalized_username).filter(isValidNormalizedUsername)),
      );

      if (normalizedUsernames.length) {
        const { data: avgRows, error: avgError } = await supabase
          .from('reference_creator_avg_views')
          .select('normalized_username, avg_views, status, last_calculated_at')
          .in('normalized_username', normalizedUsernames);

        if (avgError) throw avgError;

        const avgViewMap = (avgRows || []).reduce((acc, row) => {
          const normalized = row.normalized_username;
          if (!normalized) return acc;
          acc[normalized] = {
            avg_views: row.avg_views !== null && row.avg_views !== undefined ? Number(row.avg_views) : null,
            status: row.status,
            last_calculated_at: row.last_calculated_at,
          };
          return acc;
        }, {} as Record<string, { avg_views: number | null; status?: string | null; last_calculated_at?: string | null }>);

        data = data.map((row) => {
          const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
          return {
            ...row,
            avg_views: avgViewEntry?.avg_views ?? null,
            avg_views_status: avgViewEntry?.status ?? null,
            avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
          };
        });
      } else {
        data = data.map((row) => ({
          ...row,
          avg_views: null,
          avg_views_status: null,
          avg_views_updated_at: null,
        }));
        }
      }
    }

    const { data: summaryRow } = await supabase
      .from('reference_orders_stats')
      .select('*')
      .single();

    const { data: ownerStats } = await supabase
      .from('reference_orders_owner_stats')
      .select('owner_name, total_orders')
      .order('total_orders', { ascending: false })
      .limit(6);

    return Response.json({
      data: data,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
      stats: {
        totalOrders: summaryRow?.total_orders || 0,
        totalCreators: summaryRow?.total_creators || 0,
        avgPricePerVideo: summaryRow?.avg_price_per_video || 0,
        totalSpend: summaryRow?.total_spend || 0,
      },
      owners: ownerStats || [],
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error: any) {
    console.error('Reference orders API error:', error);
    return Response.json({ error: error.message || 'Failed to load reference orders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    const username = (body.username || '').trim();

    if (!username) {
      return Response.json({ error: 'Creator handle is required' }, { status: 400 });
    }

    const normalized = normalizeUsername(username);
    const ownerName = (body.ownerName || body.owner_name || '').trim();
    const datePaid = body.datePaid || body.date_paid || null;

    let influencerId: string | null = null;
    if (normalized) {
      const { data: influencerRows, error: influencerError } = await supabase
        .from('influencers')
        .select('id, username')
        .or(`username.eq.${normalized},username.eq.@${normalized}`)
        .limit(1);

      if (influencerError) throw influencerError;
      influencerId = influencerRows?.[0]?.id || null;
    }

    const orderHash = createHash('sha256')
      .update(
        `${normalized}|${(datePaid || '').toString()}|${(body.pricePerVideo ?? body.price_per_video ?? '').toString()}|${ownerName}`.toLowerCase(),
      )
      .digest('hex');

    const payload = {
      influencer_id: influencerId,
      username,
      normalized_username: normalized,
      email: body.email || null,
      account_link: body.accountLink || body.account_link || null,
      approved_vendor: parseBoolean(body.approvedVendor ?? body.approved_vendor),
      total_fee_per_import: parseNumber(body.totalFeePerImport ?? body.total_fee_per_import),
      price_usd: parseNumber(body.priceUsd ?? body.price_usd),
      video_count: parseInteger(body.videoCount ?? body.video_count),
      final_price: parseNumber(body.finalPrice ?? body.final_price),
      price_per_video: parseNumber(body.pricePerVideo ?? body.price_per_video),
      songs: body.songs || null,
      video_links: body.videoLinks || body.video_links || null,
      paid: parseBoolean(body.paid ?? body.isPaid ?? body.paid_status) ?? false,
      owner_name: ownerName || null,
      date_paid: datePaid || null,
      order_hash: orderHash,
    };

    const { data, error } = await supabase.from('reference_orders').insert([payload]).select().single();
    if (error) throw error;

    // Refresh song analytics cache using backend asyncpg (non-blocking)
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    fetch(`${backendUrl}/api/v1/song-analytics/refresh-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(() => {
        console.log('Song cache refresh initiated via backend');
      })
      .catch((err) => {
        console.error('Failed to refresh song cache:', err);
        // Don't fail the insert if cache refresh fails
      });

    return Response.json({ success: true, order: data });
  } catch (error: any) {
    console.error('Manual reference order error:', error);
    return Response.json({ error: error.message || 'Failed to create order' }, { status: 500 });
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
    const orderId = body.id;
    if (!orderId) {
      return Response.json({ error: 'Order ID is required' }, { status: 400 });
    }

    const updatePayload: Record<string, any> = {};
    let normalizedUsername: string | null = null;

    if (body.username !== undefined) {
      const username = (body.username || '').trim();
      if (!username) {
        return Response.json({ error: 'Username cannot be empty' }, { status: 400 });
      }
      normalizedUsername = normalizeUsername(username);
      updatePayload.username = username;
      updatePayload.normalized_username = normalizedUsername;

      const { data: influencerRows, error: influencerError } = await supabase
        .from('influencers')
        .select('id, username')
        .or(`username.eq.${normalizedUsername},username.eq.@${normalizedUsername}`)
        .limit(1);

      if (influencerError) throw influencerError;
      updatePayload.influencer_id = influencerRows?.[0]?.id || null;
    }

    if (body.email !== undefined) {
      updatePayload.email = body.email || null;
    }

    if (body.accountLink !== undefined || body.account_link !== undefined) {
      updatePayload.account_link = body.accountLink || body.account_link || null;
    }

    if (body.ownerName !== undefined || body.owner_name !== undefined) {
      updatePayload.owner_name = body.ownerName || body.owner_name || null;
    }

    if (body.songs !== undefined) {
      updatePayload.songs = body.songs || null;
    }

    if (body.videoLinks !== undefined || body.video_links !== undefined) {
      updatePayload.video_links = body.videoLinks || body.video_links || null;
    }

    if (body.approvedVendor !== undefined || body.approved_vendor !== undefined) {
      updatePayload.approved_vendor = parseBoolean(body.approvedVendor ?? body.approved_vendor) ?? false;
    }

    if (body.paid !== undefined || body.isPaid !== undefined || body.paid_status !== undefined) {
      updatePayload.paid = parseBoolean(body.paid ?? body.isPaid ?? body.paid_status) ?? false;
    }

    if (body.totalFeePerImport !== undefined || body.total_fee_per_import !== undefined) {
      updatePayload.total_fee_per_import = parseNumber(body.totalFeePerImport ?? body.total_fee_per_import);
    }

    if (body.priceUsd !== undefined || body.price_usd !== undefined) {
      updatePayload.price_usd = parseNumber(body.priceUsd ?? body.price_usd);
    }

    if (body.videoCount !== undefined || body.video_count !== undefined) {
      updatePayload.video_count = parseInteger(body.videoCount ?? body.video_count);
    }

    if (body.finalPrice !== undefined || body.final_price !== undefined) {
      updatePayload.final_price = parseNumber(body.finalPrice ?? body.final_price);
    }

    if (body.pricePerVideo !== undefined || body.price_per_video !== undefined) {
      updatePayload.price_per_video = parseNumber(body.pricePerVideo ?? body.price_per_video);
    }

    if (body.datePaid !== undefined || body.date_paid !== undefined) {
      updatePayload.date_paid = body.datePaid || body.date_paid || null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return Response.json({ error: 'No updates provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('reference_orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select()
      .single();

    if (error) throw error;

    // Refresh song analytics cache using backend asyncpg (non-blocking)
    // This bypasses Supabase REST API timeouts
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    fetch(`${backendUrl}/api/v1/song-analytics/refresh-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(() => {
        console.log('Song cache refresh initiated via backend');
      })
      .catch((err) => {
        console.error('Failed to refresh song cache:', err);
        // Don't fail the update if cache refresh fails
      });

    return Response.json({ success: true, order: data });
  } catch (error: any) {
    console.error('Update reference order error:', error);
    return Response.json({ error: error.message || 'Failed to update order' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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

    const orderId = request.nextUrl.searchParams.get('id');
    if (!orderId) {
      return Response.json({ error: 'Order ID is required' }, { status: 400 });
    }

    const { error } = await supabase.from('reference_orders').delete().eq('id', orderId);
    if (error) throw error;

    // Refresh song analytics cache using backend asyncpg (non-blocking)
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    fetch(`${backendUrl}/api/v1/song-analytics/refresh-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(() => {
        console.log('Song cache refresh initiated via backend');
      })
      .catch((err) => {
        console.error('Failed to refresh song cache:', err);
        // Don't fail the delete if cache refresh fails
      });

    return Response.json({ success: true });
  } catch (error: any) {
    console.error('Delete reference order error:', error);
    return Response.json({ error: error.message || 'Failed to delete order' }, { status: 500 });
  }
}

