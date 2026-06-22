import { NextResponse } from 'next/server';
import yt from 'youtube-sr';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  
  if (!q) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    const video = await yt.searchOne(q);
    if (!video) {
      return NextResponse.json({ error: 'No video found' }, { status: 404 });
    }
    return NextResponse.json({ videoId: video.id });
  } catch (error) {
    console.error('Error searching YouTube:', error);
    return NextResponse.json({ error: 'Failed to search YouTube' }, { status: 500 });
  }
}
