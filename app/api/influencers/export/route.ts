import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { getServerClient } from '@/lib/supabase/server-singleton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Helper to fetch all records in batches
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
        const supabase = getServerClient();
        const searchParams = request.nextUrl.searchParams;

        // Get all filters (same as search API)
        const format = searchParams.get('format') || 'csv';
        const campaignId = searchParams.get('campaign');
        const searchQuery = searchParams.get('search');
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
        const onlyPersonalEmail = searchParams.get('only_personal_email');
        const country = searchParams.get('country');

        // Personal email domains list (non-business)
        const personalEmailDomains = [
            'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
            'aol.com', 'mail.com', 'protonmail.com', 'yandex.com', 'mail.ru',
            'live.com', 'msn.com', 'gmx.com', 'zoho.com', 'inbox.com',
            'rediffmail.com', 'qq.com', '163.com', 'sina.com', 'naver.com'
        ];

        console.log(`[INFLUENCERS EXPORT] Starting ${format} export with filters.`);

        const headers = [
            'Username',
            'Display Name',
            'Followers',
            'Engagement Rate (%)',
            'Avg Views',
            'Total Playcount',
            'Likes',
            'Shares',
            'Comments',
            'Campaigns',
            'Country',
            'Latest Order Date',
            'Order Price',
            'Order Owner',
            'Approached Status',
            'Last Outreach At',
            'Reached By',
            'Email',
            'Type',
            'Profile URL',
            'Bio',
            'Song/Tags'
        ];

        const escapeCsv = (val: any) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // 1. Get filtered influencer IDs (Intersection logic)
        let influencerIds: string[] | null = null;

        if (campaignId) {
            const campaignLinks = await fetchAllInBatches(supabase, 'campaign_influencers', 'influencer_id', (q) => q.eq('campaign_id', campaignId));
            influencerIds = campaignLinks.map((l: any) => l.influencer_id).filter(id => !!id);
        }

        if (hashtagId) {
            const hashtagLinks = await fetchAllInBatches(supabase, 'influencer_hashtags', 'influencer_id', (q) => q.eq('hashtag_id', parseInt(hashtagId)));
            const ids = hashtagLinks.map((l: any) => l.influencer_id).filter(id => !!id);
            if (!influencerIds && campaignId) influencerIds = []; // If campaign had results but hashtag has none
            influencerIds = influencerIds ? influencerIds.filter(id => ids.includes(id)) : ids;
        }

        if (soundId) {
            const soundLinks = await fetchAllInBatches(supabase, 'influencer_sounds', 'influencer_id', (q) => q.eq('sound_id', parseInt(soundId)));
            const ids = soundLinks.map((l: any) => l.influencer_id).filter(id => !!id);
            influencerIds = influencerIds ? influencerIds.filter(id => ids.includes(id)) : ids;
        }

        // Return empty with headers if filtered to nothing
        if (influencerIds && influencerIds.length === 0) {
            if (format === 'excel') {
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Influencers');
                worksheet.addRow(headers);
                const buffer = await workbook.xlsx.writeBuffer();
                return new Response(buffer, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
            }
            return new Response('\uFEFF' + headers.join(',') + '\n', { headers: { 'Content-Type': 'text/csv' } });
        }

        // 2. Fetch all matching influencers
        let allInfluencers: any[] = [];
        const idBatchSize = 100;

        if (influencerIds) {
            for (let i = 0; i < influencerIds.length; i += idBatchSize) {
                const chunk = influencerIds.slice(i, i + idBatchSize);
                let query = supabase.from('influencers').select('*').in('id', chunk);

                if (searchQuery) query = query.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
                if (minFollowers) query = query.gte('followers', parseInt(minFollowers));
                if (maxFollowers) query = query.lte('followers', parseInt(maxFollowers));
                if (minEngagementRate) query = query.gte('engagement_rate', parseFloat(minEngagementRate));
                if (maxEngagementRate) query = query.lte('engagement_rate', parseFloat(maxEngagementRate));
                if (minAvgViews) query = query.gte('avg_views', parseFloat(minAvgViews));
                if (maxAvgViews) query = query.lte('avg_views', parseFloat(maxAvgViews));
                if (reachedOut === 'true') query = query.eq('has_outreach', true);
                else if (reachedOut === 'false') query = query.eq('has_outreach', false);
                if (hasEmail === 'true') query = query.not('email', 'is', null).not('email', 'eq', '');
                if (country) query = query.eq('country', country);

                const { data, error } = await query;
                if (error) throw error;
                if (data) allInfluencers = allInfluencers.concat(data);
            }
        } else {
            const data = await fetchAllInBatches(supabase, 'influencers', '*', (q) => {
                let modQuery = q;
                if (searchQuery) modQuery = modQuery.or(`username.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
                if (minFollowers) modQuery = modQuery.gte('followers', parseInt(minFollowers));
                if (maxFollowers) modQuery = modQuery.lte('followers', parseInt(maxFollowers));
                if (minEngagementRate) modQuery = modQuery.gte('engagement_rate', parseFloat(minEngagementRate));
                if (maxEngagementRate) modQuery = modQuery.lte('engagement_rate', parseFloat(maxEngagementRate));
                if (minAvgViews) modQuery = modQuery.gte('avg_views', parseFloat(minAvgViews));
                if (maxAvgViews) modQuery = modQuery.lte('avg_views', parseFloat(maxAvgViews));
                if (reachedOut === 'true') modQuery = modQuery.eq('has_outreach', true);
                else if (reachedOut === 'false') modQuery = modQuery.eq('has_outreach', false);
                if (hasEmail === 'true') modQuery = modQuery.not('email', 'is', null).not('email', 'eq', '');
                if (country) modQuery = modQuery.eq('country', country);
                return modQuery;
            });
            allInfluencers = data;
        }

        // Apply personal email filter in-memory (Supabase can't do complex domain matching)
        if (onlyPersonalEmail === 'true') {
            allInfluencers = allInfluencers.filter((inf: any) => {
                if (!inf.email) return false;
                const domain = inf.email.toLowerCase().split('@')[1];
                return domain && personalEmailDomains.includes(domain);
            });
        }

        if (allInfluencers.length === 0) {
            // Same as above
            if (format === 'excel') {
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Influencers');
                worksheet.addRow(headers);
                const buffer = await workbook.xlsx.writeBuffer();
                return new Response(buffer, { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
            }
            return new Response('\uFEFF' + headers.join(',') + '\n', { headers: { 'Content-Type': 'text/csv' } });
        }

        // 3. Associations
        const allIds = allInfluencers.map(i => i.id);
        const associationMap: Record<string, any> = {};

        for (let i = 0; i < allIds.length; i += 1000) {
            const chunk = allIds.slice(i, i + 1000);
            const { data: campaigns } = await supabase.from('campaign_influencers').select('influencer_id, outreach_status, price, notes').in('influencer_id', chunk);
            (campaigns || []).forEach((c: any) => {
                if (!associationMap[c.influencer_id]) associationMap[c.influencer_id] = { campaigns: [] };
                associationMap[c.influencer_id].campaigns.push(c);
            });

            const { data: infSounds } = await supabase.from('influencer_sounds').select('influencer_id, sound_id').in('influencer_id', chunk);
            if (infSounds?.length) {
                const sIds = [...new Set(infSounds.map((s: any) => s.sound_id))];
                const { data: ss } = await supabase.from('sounds').select('id, sound_id').in('id', sIds);
                const sl = ss?.reduce((acc: any, s: any) => ({ ...acc, [s.id]: s.sound_id }), {}) || {};
                infSounds.forEach((rel: any) => {
                    if (!associationMap[rel.influencer_id]) associationMap[rel.influencer_id] = {};
                    if (!associationMap[rel.influencer_id].songs) associationMap[rel.influencer_id].songs = [];
                    if (sl[rel.sound_id]) associationMap[rel.influencer_id].songs.push(`https://www.tiktok.com/music/${sl[rel.sound_id]}`);
                });
            }

            const { data: infTags } = await supabase.from('influencer_hashtags').select('influencer_id, hashtag_id').in('influencer_id', chunk);
            if (infTags?.length) {
                const tIds = [...new Set(infTags.map((t: any) => t.hashtag_id))];
                const { data: ts } = await supabase.from('hashtags').select('id, tag').in('id', tIds);
                const tl = ts?.reduce((acc: any, t: any) => ({ ...acc, [t.id]: t.tag }), {}) || {};
                infTags.forEach((rel: any) => {
                    if (!associationMap[rel.influencer_id]) associationMap[rel.influencer_id] = {};
                    if (!associationMap[rel.influencer_id].hashtags) associationMap[rel.influencer_id].hashtags = [];
                    if (tl[rel.hashtag_id]) associationMap[rel.influencer_id].hashtags.push(`#${tl[rel.hashtag_id]}`);
                });
            }
        }

        // 4. Construct Data
        allInfluencers.sort((a, b) => (new Date(b.last_scraped || 0)).getTime() - (new Date(a.last_scraped || 0)).getTime());

        const rows = allInfluencers.map(inf => {
            const assoc = associationMap[inf.id] || {};
            const campLinks = assoc.campaigns || [];
            const latestCamp = campLinks.find((c: any) => c.outreach_status !== 'pending') || campLinks[0] || null;
            const campaignNames = inf.campaigns ? (Array.isArray(inf.campaigns) ? inf.campaigns.join(', ') : inf.campaigns) : '';

            const followers = inf.followers || 0;
            const avgViews = inf.avg_views || 0;
            const engagement = inf.engagement_rate || 0;
            const metadata = inf.metadata || {};
            const videoCount = metadata.video_count || 0;
            const playcount = avgViews && videoCount ? Math.floor(avgViews * videoCount) : (avgViews || 0);
            const vMetrics = metadata.video_metrics || {};

            let approached = inf.has_outreach ? 'yes' : '';
            if (latestCamp?.outreach_status && latestCamp.outreach_status !== 'pending') approached = latestCamp.outreach_status;

            const order = inf.reference_order || {};

            return [
                inf.username, inf.display_name || '', followers, engagement, avgViews, playcount,
                vMetrics.diggCount || '', vMetrics.shareCount || '', vMetrics.commentCount || '',
                campaignNames, inf.country || '', order.date_paid || '', order.price_per_video || '',
                order.owner_name || '', approached, inf.last_outreach_at || '', inf.reached_by || '',
                inf.email || '', inf.is_business ? 'Business' : 'Personal',
                inf.profile_url || `https://www.tiktok.com/@${inf.username}`, inf.bio || '',
                assoc.songs?.[0] || assoc.hashtags?.join(', ') || ''
            ];
        });

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Influencers');
            worksheet.addRow(headers);
            rows.forEach(row => worksheet.addRow(row));

            // Basic styling
            worksheet.getRow(1).font = { bold: true };
            worksheet.columns.forEach(col => { col.width = 20; });

            const buffer = await workbook.xlsx.writeBuffer();
            return new Response(buffer, {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="influencers_export_${new Date().toISOString().split('T')[0]}.xlsx"`,
                },
            });
        } else {
            const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n') + '\n';
            return new Response(csvContent, {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="influencers_export_${new Date().toISOString().split('T')[0]}.csv"`,
                },
            });
        }

    } catch (error: any) {
        console.error('Export API error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
}
