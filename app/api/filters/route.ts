import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const supabase = createServerComponentClient({ cookies });
    
    // Fetch ALL hashtags with pagination (could be >1000)
    let allHashtags: any[] = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const start = page * pageSize;
      const end = start + pageSize - 1;
      
      const { data, error } = await supabase
        .from('hashtags')
        .select('id, tag')
        .order('tag')
        .range(start, end);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        allHashtags = allHashtags.concat(data);
        page++;
        if (data.length < pageSize) hasMore = false;
      } else {
        hasMore = false;
      }
    }

    // Fetch ALL sounds with pagination
    let allSounds: any[] = [];
    page = 0;
    hasMore = true;

    while (hasMore) {
      const start = page * pageSize;
      const end = start + pageSize - 1;
      
      const { data, error } = await supabase
        .from('sounds')
        .select('id, sound_id, name')
        .order('sound_id')
        .range(start, end);
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        allSounds = allSounds.concat(data);
        page++;
        if (data.length < pageSize) hasMore = false;
      } else {
        hasMore = false;
      }
    }
    
    return Response.json({
      hashtags: allHashtags,
      sounds: allSounds
    });
  } catch (error: any) {
    console.error('API error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

