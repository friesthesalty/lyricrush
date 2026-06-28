import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
  }

  try {
    const [itunesRes, deezerRes] = await Promise.allSettled([
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=5`),
      fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`)
    ]);

    const results = [];

    // Process iTunes results
    if (itunesRes.status === 'fulfilled' && itunesRes.value.ok) {
      const data = await itunesRes.value.json();
      if (data.results) {
        results.push(...data.results.map((item: any) => ({
          trackId: `itunes-${item.trackId}`,
          trackName: item.trackName,
          artistName: item.artistName,
          artworkUrl100: item.artworkUrl100,
          source: 'itunes'
        })));
      }
    } else {
      console.error('iTunes search failed:', itunesRes.status === 'rejected' ? itunesRes.reason : 'Request failed');
    }

    // Process Deezer results
    if (deezerRes.status === 'fulfilled' && deezerRes.value.ok) {
      const data = await deezerRes.value.json();
      if (data.data) {
        results.push(...data.data.map((item: any) => ({
          trackId: `deezer-${item.id}`,
          trackName: item.title,
          artistName: item.artist.name,
          artworkUrl100: item.album.cover_medium,
          source: 'deezer'
        })));
      }
    } else {
      console.error('Deezer search failed:', deezerRes.status === 'rejected' ? deezerRes.reason : 'Request failed');
    }

    // Deduplicate by artist and track name (case-insensitive)
    const seen = new Set();
    const uniqueResults = [];
    
    // Interleave results from both sources to ensure diversity in top results
    let itunesCount = 0;
    let deezerCount = 0;
    
    for (const res of results) {
      const key = `${res.artistName.toLowerCase().trim()}-${res.trackName.toLowerCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueResults.push(res);
      }
    }
    
    // Actually interleaving would require separating them first, let's just use the deduplicated list since iTunes is appended first.
    // To make it interleaved:
    const itunesItems = uniqueResults.filter(r => r.source === 'itunes');
    const deezerItems = uniqueResults.filter(r => r.source === 'deezer');
    const interleaved = [];
    const maxLen = Math.max(itunesItems.length, deezerItems.length);
    
    for (let i = 0; i < maxLen; i++) {
      if (i < itunesItems.length) interleaved.push(itunesItems[i]);
      if (i < deezerItems.length) interleaved.push(deezerItems[i]);
    }

    // Return top 10 results
    return NextResponse.json({ results: interleaved.slice(0, 10) });
  } catch (error) {
    console.error('Search API error:', error);
    return NextResponse.json({ error: 'Failed to fetch search results' }, { status: 500 });
  }
}
