import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getServerClient } from '@/lib/supabase/server-singleton';

export async function GET() {
  try {
    const supabase = getServerClient();

    // Fetch ALL campaigns with pagination (in case there are >1000)
    let allCampaigns: any[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const start = page * pageSize;
      const end = start + pageSize - 1;

    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
        .order('created_at', { ascending: false })
        .range(start, end);

    if (error) throw error;

      if (data && data.length > 0) {
        allCampaigns = allCampaigns.concat(data);
        page++;
        if (data.length < pageSize) hasMore = false;
      } else {
        hasMore = false;
      }
    }

    return Response.json(allCampaigns);
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { data, error } = await supabase
      .from('campaigns')
      .insert([
        {
          name: body.name,
          status: body.status || 'draft',
          created_by: user.id,
        },
      ])
      .select();

    if (error) throw error;

    return Response.json(data?.[0] || {});
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('id');
    const deleteInfluencers = searchParams.get('delete_influencers') === 'true';

    if (!campaignId) {
      return Response.json({ error: 'Campaign ID is required' }, { status: 400 });
    }

    // If deleteInfluencers is true, delete influencers associated with this campaign
    if (deleteInfluencers) {
      // Get influencer IDs from campaign_influencers
      const { data: campaignLinks } = await supabase
        .from('campaign_influencers')
        .select('influencer_id')
        .eq('campaign_id', campaignId);

      if (campaignLinks && campaignLinks.length > 0) {
        const influencerIds = campaignLinks.map(link => link.influencer_id);
        
        // Delete influencers (cascade will handle campaign_influencers, influencer_hashtags, influencer_sounds)
        const { error: deleteError } = await supabase
          .from('influencers')
          .delete()
          .in('id', influencerIds);

        if (deleteError) throw deleteError;
      }
    }

    // Delete campaign (cascade will handle campaign_influencers, outreach_logs, scraper_runs)
    const { data: deletedData, error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', campaignId)
      .select();

    if (error) {
      console.error('Delete campaign error:', error);
      throw new Error(error.message || 'Failed to delete campaign. Make sure RLS policies allow deletion.');
    }

    if (!deletedData || deletedData.length === 0) {
      throw new Error('Campaign not found or already deleted');
    }

    return Response.json({ 
      success: true, 
      message: `Campaign deleted${deleteInfluencers ? ' along with associated influencers' : ''}` 
    });
  } catch (error: any) {
    console.error('Campaign delete error:', error);
    return Response.json({ error: error.message || 'Failed to delete campaign' }, { status: 500 });
  }
}

