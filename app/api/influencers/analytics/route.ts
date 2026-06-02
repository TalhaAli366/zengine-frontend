import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { getServerClient } from '@/lib/supabase/server-singleton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const supabase = getServerClient();
    const searchParams = request.nextUrl.searchParams;

    const args = {
      search_query: searchParams.get('search') || null,
      min_followers: searchParams.get('min_followers') ? parseInt(searchParams.get('min_followers') as string, 10) : null,
      max_followers: searchParams.get('max_followers') ? parseInt(searchParams.get('max_followers') as string, 10) : null,
      min_engagement_rate: searchParams.get('min_engagement_rate') ? parseFloat(searchParams.get('min_engagement_rate') as string) : null,
      max_engagement_rate: searchParams.get('max_engagement_rate') ? parseFloat(searchParams.get('max_engagement_rate') as string) : null,
      min_avg_views: searchParams.get('min_avg_views') ? parseFloat(searchParams.get('min_avg_views') as string) : null,
      max_avg_views: searchParams.get('max_avg_views') ? parseFloat(searchParams.get('max_avg_views') as string) : null,
      reached_out: searchParams.get('reached_out') === 'true' ? true : searchParams.get('reached_out') === 'false' ? false : null,
      has_email: searchParams.get('has_email') === 'true' ? true : null,
      only_personal_email: searchParams.get('only_personal_email') === 'true' ? true : null,
      country: searchParams.get('country') || null,
    };

    const personalEmailDomains = new Set([
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
      'aol.com', 'mail.com', 'protonmail.com', 'yandex.com', 'mail.ru',
      'live.com', 'msn.com', 'gmx.com', 'zoho.com', 'inbox.com',
      'rediffmail.com', 'qq.com', '163.com', 'sina.com', 'naver.com',
    ]);

    const isPersonalEmail = (email?: string | null) => {
      if (!email) return false;
      const domain = String(email).toLowerCase().split('@')[1];
      return Boolean(domain && personalEmailDomains.has(domain));
    };

    const [{ data: analyticsRows, error: analyticsError }, { data: scatterRows, error: scatterError }] = await Promise.all([
      supabase.rpc('get_influencer_analytics', args),
      (() => {
        let scatterQuery = supabase
          .from('influencers')
          .select('followers, engagement_rate, username, display_name, country, email')
          .order('last_scraped', { ascending: false })
          .range(0, 999);

        if (args.search_query) {
          scatterQuery = scatterQuery.or(`username.ilike.%${args.search_query}%,display_name.ilike.%${args.search_query}%`);
        }
        if (args.min_followers !== null) {
          scatterQuery = scatterQuery.gte('followers', args.min_followers);
        }
        if (args.max_followers !== null) {
          scatterQuery = scatterQuery.lte('followers', args.max_followers);
        }
        if (args.min_engagement_rate !== null) {
          scatterQuery = scatterQuery.gte('engagement_rate', args.min_engagement_rate);
        }
        if (args.max_engagement_rate !== null) {
          scatterQuery = scatterQuery.lte('engagement_rate', args.max_engagement_rate);
        }
        if (args.min_avg_views !== null) {
          scatterQuery = scatterQuery.gte('avg_views', args.min_avg_views);
        }
        if (args.max_avg_views !== null) {
          scatterQuery = scatterQuery.lte('avg_views', args.max_avg_views);
        }
        if (args.reached_out !== null) {
          scatterQuery = scatterQuery.eq('has_outreach', args.reached_out);
        }
        if (args.has_email === true) {
          scatterQuery = scatterQuery.not('email', 'is', null).not('email', 'eq', '');
        }
        if (args.country) {
          scatterQuery = scatterQuery.ilike('country', `%${args.country}%`);
        }
        if (args.only_personal_email === true) {
          scatterQuery = scatterQuery.not('email', 'is', null);
        }

        return scatterQuery;
      })(),
    ]);

    if (analyticsError) throw analyticsError;
    if (scatterError) throw scatterError;

    const analytics = Array.isArray(analyticsRows) ? analyticsRows[0]?.payload ?? analyticsRows[0] : analyticsRows;

    return Response.json({
      ...analytics,
      scatterData: (scatterRows || [])
        .filter((inf) => args.only_personal_email !== true || isPersonalEmail(inf.email))
        .filter((inf) => inf.engagement_rate && inf.followers && inf.followers > 0)
        .map((inf) => ({
          followers: inf.followers || 0,
          engagement: inf.engagement_rate || 0,
        })),
      meta: {
        ...(analytics?.meta || {}),
        scatterSampled: true,
        scatterSampleLimit: 1000,
      },
    });
  } catch (error: any) {
    console.error('Influencer analytics API error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
