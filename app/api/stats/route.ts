import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServerComponentClient({ cookies });

    // Get unique scraped influencers count
    const { count: scrapedInfluencersCount } = await supabase
      .from('influencers')
      .select('*', { count: 'exact' });

    // Get reference orders stats (includes unique creators count)
    const { data: orderStats } = await supabase
      .from('reference_orders_stats')
      .select('total_orders, total_creators, total_spend')
      .single();

    // Total influencers = unique scraped influencers + unique creators from orders
    const totalInfluencers = (scrapedInfluencersCount || 0) + (orderStats?.total_creators || 0);

    // Get active campaigns count (non-closed campaigns: draft or active)
    const { count: campaignsCount } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact' })
      .neq('status', 'closed');

    // Get outreach logs count (all email attempts, all time)
    const { count: outreachLogsCount } = await supabase
      .from('outreach_logs')
      .select('*', { count: 'exact' })
      .eq('channel', 'email');

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

