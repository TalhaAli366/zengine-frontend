import { NextRequest } from 'next/server';
import { getServerClient } from '@/lib/supabase/server-singleton';

export async function GET(request: NextRequest) {
  try {
    const supabase = getServerClient();
    const searchParams = request.nextUrl.searchParams;

    const type = searchParams.get('type'); // 'campaign' | 'hashtag' | 'sound'
    const q = searchParams.get('q') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

    if (!type || !['campaign', 'hashtag', 'sound'].includes(type)) {
      return Response.json({ error: 'Invalid type. Use campaign, hashtag, or sound.' }, { status: 400 });
    }

    const pattern = `%${q}%`;

    if (type === 'campaign') {
      let query = supabase
        .from('campaigns')
        .select('id, name')
        .ilike('name', pattern)
        .order('name')
        .limit(limit);

      const { data, error } = await query;
      if (error) throw error;
      return Response.json({ data: data || [] });

    } else if (type === 'hashtag') {
      let query = supabase
        .from('hashtags')
        .select('id, tag')
        .ilike('tag', pattern)
        .order('tag')
        .limit(limit);

      const { data, error } = await query;
      if (error) throw error;
      return Response.json({ data: data || [] });

    } else if (type === 'sound') {
      let query = supabase
        .from('sounds')
        .select('id, sound_id, name')
        .or(`name.ilike.${pattern},sound_id.ilike.${pattern}`)
        .order('name')
        .limit(limit);

      const { data, error } = await query;
      if (error) throw error;
      return Response.json({ data: data || [] });
    }

    return Response.json({ data: [] });
  } catch (error: any) {
    console.error('Filter search error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}