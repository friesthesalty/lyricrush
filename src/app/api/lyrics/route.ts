import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trackName = searchParams.get('track_name');
  const artistName = searchParams.get('artist_name');
  
  if (!trackName || !artistName) {
    return NextResponse.json({ error: 'track_name and artist_name required' }, { status: 400 });
  }

  try {
    const res = await fetch(`https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`, {
      headers: { 'User-Agent': 'LyricGame/1.0.0' }
    });
    
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch lyrics' }, { status: res.status });
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching lyrics:', error);
    return NextResponse.json({ error: 'Server error fetching lyrics' }, { status: 500 });
  }
}
