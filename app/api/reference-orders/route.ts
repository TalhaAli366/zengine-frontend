import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

const normalizeUsername = (value: string) => value.trim().toLowerCase().replace(/^@/, '');

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

    // Apply sorting - handle avg_views and owner_name separately
    const validSortColumns = ['date_paid', 'owner_name', 'username', 'price_per_video', 'final_price'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'date_paid';
    const ascending = sortOrder === 'asc';

    let data: any[] = [];
    let count = 0;

    // If uniqueCreators is true, use the efficient database function
    if (uniqueCreators) {
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
            new Set(data.map((row) => row.normalized_username).filter(Boolean)),
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
    } else if (sortBy === 'avg_views' || sortBy === 'owner_name' || sortBy === 'price_per_video') {
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
      // Supabase has a default limit of 1000, so we need to fetch in batches or use a high limit
      let allData: any[] = [];
      let totalCount = 0;
      
      if (uniqueCreators) {
        // When uniqueCreators is true, we need ALL data, so fetch in batches
        const batchSize = 1000;
        let offset = 0;
        let hasMore = true;
        let firstBatchCount = 0;
        
        while (hasMore) {
          const { data: batchData, error: batchError, count: batchCount } = await customSortQuery.range(offset, offset + batchSize - 1);
          if (batchError) throw batchError;
          
          // Get total count from first batch
          if (offset === 0 && batchCount !== null) {
            firstBatchCount = batchCount;
          }
          
          if (batchData && batchData.length > 0) {
            allData = allData.concat(batchData);
            offset += batchSize;
            hasMore = batchData.length === batchSize;
          } else {
            hasMore = false;
          }
        }
        
        // Use the count from first batch, or fallback to actual length
        totalCount = firstBatchCount > 0 ? firstBatchCount : allData.length;
      } else {
        // For non-unique queries, use the regular fetch (but still might need pagination for large datasets)
        const { data: queryData, error: queryError, count: queryCount } = await customSortQuery.limit(10000);
        if (queryError) throw queryError;
        allData = queryData || [];
        totalCount = queryCount || allData.length;
      }

      // Get all normalized usernames for avg_views enrichment
      const normalizedUsernames = Array.from(
        new Set((allData || []).map((row) => row.normalized_username).filter(Boolean)),
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

      // Sort based on the selected column
      if (sortBy === 'avg_views') {
        enrichedAll.sort((a, b) => {
          const aVal = a.avg_views ?? -1;
          const bVal = b.avg_views ?? -1;
          return ascending ? aVal - bVal : bVal - aVal;
        });
      } else if (sortBy === 'owner_name') {
        // Case-insensitive string sorting
        enrichedAll.sort((a, b) => {
          const aVal = (a.owner_name || '').toLowerCase();
          const bVal = (b.owner_name || '').toLowerCase();
          if (aVal < bVal) return ascending ? -1 : 1;
          if (aVal > bVal) return ascending ? 1 : -1;
          return 0;
        });
      } else if (sortBy === 'price_per_video') {
        // Numeric sorting for price_per_video - same pattern as avg_views
        enrichedAll.sort((a, b) => {
          const aVal = a.price_per_video ?? -1;
          const bVal = b.price_per_video ?? -1;
          return ascending ? aVal - bVal : bVal - aVal;
        });
      }

      // Apply pagination to sorted data
      data = enrichedAll.slice(offset, offset + limit);
    } else {
      // For other columns, use database sorting (more efficient)
      // But if uniqueCreators is true, we still need to fetch all data first
      if (uniqueCreators || minAvgViews || maxAvgViews) {
        // Fetch all matching records first (without pagination)
        // Supabase has a default limit of 1000, so we need to fetch in batches
        let allData: any[] = [];
        let totalCount = 0;
        
        if (uniqueCreators) {
          // When uniqueCreators is true, fetch ALL data in batches
          const batchSize = 1000;
          let offset = 0;
          let hasMore = true;
          let firstBatchCount = 0;
          
          // Build a query without filters for unique creators
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
          
          while (hasMore) {
            const { data: batchData, error: batchError, count: batchCount } = await baseQuery.range(offset, offset + batchSize - 1);
            if (batchError) throw batchError;
            
            // Get total count from first batch
            if (offset === 0 && batchCount !== null) {
              firstBatchCount = batchCount;
            }
            
            if (batchData && batchData.length > 0) {
              allData = allData.concat(batchData);
              offset += batchSize;
              hasMore = batchData.length === batchSize;
            } else {
              hasMore = false;
            }
          }
          
          // Use the count from first batch, or fallback to actual length
          totalCount = firstBatchCount > 0 ? firstBatchCount : allData.length;
        } else {
          // For non-unique queries with avg views filters, use regular fetch
          const { data: queryData, error: queryError, count: queryCount } = await query.limit(10000);
          if (queryError) throw queryError;
          allData = queryData || [];
          totalCount = queryCount || allData.length;
        }
        
        // Don't set count here - it will be set after filtering
        let enrichedData = allData || [];

        // Enrich with avg_views
        const normalizedUsernames = Array.from(
          new Set(enrichedData.map((row) => row.normalized_username).filter(Boolean)),
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

          enrichedData = enrichedData.map((row) => {
            const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
            return {
              ...row,
              avg_views: avgViewEntry?.avg_views ?? null,
              avg_views_status: avgViewEntry?.status ?? null,
              avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
            };
          });
        } else {
          enrichedData = enrichedData.map((row) => ({
            ...row,
            avg_views: null,
            avg_views_status: null,
            avg_views_updated_at: null,
          }));
        }

        // Apply unique creators filter FIRST
        if (uniqueCreators) {
          const beforeCount = enrichedData.length;
          const creatorMap = new Map<string, any>();
          for (const row of enrichedData) {
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
          enrichedData = Array.from(creatorMap.values());
          console.log(`[Unique Creators Filter - Branch 2] Before: ${beforeCount}, After: ${enrichedData.length}, Unique creators: ${creatorMap.size}`);
        }

        // Apply avg views filters AFTER unique creators
        if (minAvgViews) {
          const minVal = parseFloat(minAvgViews);
          if (!isNaN(minVal)) {
            enrichedData = enrichedData.filter((row: any) => row.avg_views !== null && row.avg_views >= minVal);
          }
        }
        if (maxAvgViews) {
          const maxVal = parseFloat(maxAvgViews);
          if (!isNaN(maxVal)) {
            enrichedData = enrichedData.filter((row: any) => row.avg_views !== null && row.avg_views <= maxVal);
          }
        }

        // Update count after filtering
        count = enrichedData.length;
        console.log(`[Count Update - Branch 2] Final count after all filters: ${count}, uniqueCreators: ${uniqueCreators}`);

        // Sort and paginate
        enrichedData.sort((a: any, b: any) => {
          const aVal = a[sortColumn];
          const bVal = b[sortColumn];
          if (aVal === null || aVal === undefined) return 1;
          if (bVal === null || bVal === undefined) return -1;
          if (aVal < bVal) return ascending ? -1 : 1;
          if (aVal > bVal) return ascending ? 1 : -1;
          return 0;
        });

        data = enrichedData.slice(offset, offset + limit);
      } else {
        // Standard path: use database sorting (more efficient)
        query = query.order(sortColumn, { ascending, nullsFirst: false });
        const { data: queryData, error: queryError, count: queryCount } = await query.range(offset, offset + limit - 1);
        if (queryError) throw queryError;

        data = queryData || [];
        count = queryCount || 0;

        // Enrich with avg_views
        const normalizedUsernames = Array.from(
          new Set((data || []).map((row) => row.normalized_username).filter(Boolean)),
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

    return Response.json({ success: true });
  } catch (error: any) {
    console.error('Delete reference order error:', error);
    return Response.json({ error: error.message || 'Failed to delete order' }, { status: 500 });
  }
}

