import { NextResponse } from 'next/server';
import yt from 'youtube-sr';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  
  if (!q) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    let videos = await yt.search(q, { limit: 5 });
    videos = videos.filter(v => v && v.id && v.title);
    if (!videos || videos.length === 0) {
      return NextResponse.json({ error: 'No video found' }, { status: 404 });
    }
    const artist = searchParams.get('artist')?.toLowerCase() || '';
    const track = searchParams.get('track')?.toLowerCase() || '';

    // Score the videos
    const scoredVideos = videos.map(video => {
      let score = 0;
      const title = video.title?.toLowerCase() || '';
      const channel = video.channel?.name?.toLowerCase() || '';

      // Channel Match (+50)
      if (artist && channel.includes(artist)) score += 50;
      
      // Official Channels (+20)
      if (channel.includes('topic') || channel.includes('vevo') || channel.includes('official')) score += 20;

      // Track Match (+30)
      // Strip parenthesis and brackets to get the core song name for matching
      const cleanTrack = track.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
      if (cleanTrack && title.includes(cleanTrack)) score += 30;

      // Keywords (+10)
      if (title.includes('official audio') || title.includes('official video') || title.includes('lyric')) score += 10;

      // Penalize common bad video types (-100) if they aren't part of the original track name
      const negativeKeywords = ['accompaniment', 'instrumental', 'karaoke', 'cover', 'live ', ' 8d', 'slowed', 'reverb', 'sped up'];
      for (const kw of negativeKeywords) {
        if (title.includes(kw) && !track.includes(kw)) {
          score -= 100;
        }
      }

      return { ...video, score };
    });

    // Find the maximum score achieved
    const maxScore = Math.max(...scoredVideos.map(v => v.score));

    let bestVideo;
    if (maxScore === 0) {
      // Fallback to the old algorithm: just take the first organic search result
      bestVideo = scoredVideos[0];
    } else {
      // Pick the video with the highest score. If tied, pick the one with highest views.
      bestVideo = scoredVideos.reduce((prev, current) => {
        if (prev.score > current.score) return prev;
        if (current.score > prev.score) return current;
        // Tiebreaker
        return (prev.views > current.views) ? prev : current;
      });
    }

    return NextResponse.json({ 
      videoId: bestVideo.id,
      debug: {
        query: q,
        results: scoredVideos.map(v => ({
          id: v.id,
          url: `https://youtube.com/watch?v=${v.id}`,
          title: v.title,
          channel: v.channel?.name,
          score: v.score,
          views: v.views
        }))
      }
    });
  } catch (error) {
    console.error('Error searching YouTube:', error);
    return NextResponse.json({ error: 'Failed to search YouTube' }, { status: 500 });
  }
}
