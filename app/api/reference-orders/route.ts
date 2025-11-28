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
    const searchParams = request.nextUrl.searchParams;

    const search = searchParams.get('search') || '';
    const owner = searchParams.get('owner') || '';
    const approved = searchParams.get('approved') || '';
    const paid = searchParams.get('paid') || '';
    const matched = searchParams.get('matched') || '';
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
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

    // For avg_views and owner_name sorting, we need to fetch all, sort, then paginate
    // (owner_name needs case-insensitive sorting which Supabase doesn't support easily)
    if (sortBy === 'avg_views' || sortBy === 'owner_name') {
      // Fetch ALL matching records (without pagination) to sort them properly
      const { data: allData, error: allError, count: totalCount } = await query;
      if (allError) throw allError;

      count = totalCount || 0;

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
      const enrichedAll = (allData || []).map((row) => {
        const avgViewEntry = row.normalized_username ? avgViewMap[row.normalized_username] : null;
        return {
          ...row,
          avg_views: avgViewEntry?.avg_views ?? null,
          avg_views_status: avgViewEntry?.status ?? null,
          avg_views_updated_at: avgViewEntry?.last_calculated_at ?? null,
        };
      });

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
      }

      // Apply pagination to sorted data
      data = enrichedAll.slice(offset, offset + limit);
    } else {
      // For other columns, use database sorting (more efficient)
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

