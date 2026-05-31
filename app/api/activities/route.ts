import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
    const sourceLimit = Math.max(20, page * limit * 2);

    // Fetch recent scraper runs
    const [
      { data: scraperRuns, error: scraperError },
      { data: outreachLogs, error: outreachError },
      { data: campaigns, error: campaignError },
    ] = await Promise.all([
      supabase
        .from('scraper_runs')
        .select('id, scraper_type, status, started_at, completed_at, total_results, new_influencers, updated_influencers, input_data')
        .order('started_at', { ascending: false })
        .limit(sourceLimit),
      supabase
        .from('outreach_logs')
        .select('id, campaign_id, influencer_id, channel, to_address, subject, sent_at, status')
        .order('sent_at', { ascending: false })
        .limit(sourceLimit),
      supabase
        .from('campaigns')
        .select('id, name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(sourceLimit),
    ]);

    if (scraperError) throw scraperError;
    if (outreachError) throw outreachError;
    if (campaignError) throw campaignError;

    // Combine and format activities
    const activities: any[] = [];

    // Add scraper runs
    if (scraperRuns) {
      scraperRuns.forEach(run => {
        const inputData = run.input_data || {};
        let description = '';
        if (run.scraper_type === 'hashtag') {
          const hashtags = inputData.hashtags || [];
          description = `Scraped hashtags: ${hashtags.join(', ')}`;
        } else if (run.scraper_type === 'sound') {
          const sounds = inputData.sound_urls || [];
          description = `Scraped sounds: ${sounds.length} sound(s)`;
        } else if (run.scraper_type === 'profile') {
          const usernames = inputData.usernames || [];
          description = `Scraped profiles: ${usernames.length} profile(s)`;
        }

        activities.push({
          id: run.id,
          type: 'scraper',
          title: `${run.scraper_type.charAt(0).toUpperCase() + run.scraper_type.slice(1)} Scraper`,
          description: description,
          status: run.status,
          timestamp: run.started_at,
          metadata: {
            total_results: run.total_results,
            new_influencers: run.new_influencers,
            updated_influencers: run.updated_influencers
          }
        });
      });
    }

    // Add outreach logs
    if (outreachLogs) {
      outreachLogs.forEach(log => {
        activities.push({
          id: log.id,
          type: 'outreach',
          title: 'Email Sent',
          description: log.to_address ? `Sent email to ${log.to_address}` : 'Sent email',
          status: log.status || 'sent',
          timestamp: log.sent_at,
          metadata: {
            subject: log.subject,
            channel: log.channel
          }
        });
      });
    }

    // Add campaigns
    if (campaigns) {
      campaigns.forEach(campaign => {
        activities.push({
          id: campaign.id,
          type: 'campaign',
          title: 'Campaign Created',
          description: `Created campaign: ${campaign.name}`,
          status: campaign.status,
          timestamp: campaign.created_at
        });
      });
    }

    // Sort by timestamp (most recent first), then paginate
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = activities.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const paginatedActivities = activities.slice(start, start + limit);

    return Response.json({
      activities: paginatedActivities,
      page,
      limit,
      total,
      totalPages,
    });
  } catch (error: any) {
    console.error('API error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
