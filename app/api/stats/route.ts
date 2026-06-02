import { cookies } from 'next/headers';
import { getServerClient } from '@/lib/supabase/server-singleton';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getServerClient();

    const [
      { count: scrapedInfluencersCount },
      { data: orderStats },
      { count: campaignsCount },
      { count: outreachLogsCount },
    ] = await Promise.all([
      supabase
        .from('influencers')
        .select('*', { count: 'exact', head: true }),
      supabase
        .from('reference_orders_stats')
        .select('total_orders, total_creators, total_spend')
        .single(),
      supabase
        .from('campaigns')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'closed'),
      supabase
        .from('outreach_logs')
        .select('*', { count: 'exact', head: true })
        .eq('channel', 'email'),
    ]);

    // Total influencers = unique scraped influencers + unique creators from orders
    const totalInfluencers = (scrapedInfluencersCount || 0) + (orderStats?.total_creators || 0);

    // Total emails sent = outreach logs + reference orders (each order represents a reach-out)
    const emailsCount = (outreachLogsCount || 0) + (orderStats?.total_orders || 0);
    const totalSpent = orderStats?.total_spend || 0;

    return Response.json({
      total_influencers: totalInfluencers,
      active_campaigns: campaignsCount || 0,
      emails_sent: emailsCount || 0,
      total_spent: totalSpent,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
