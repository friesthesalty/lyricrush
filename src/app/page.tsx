'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface iTunesResult {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<iTunesResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const router = useRouter();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=5`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Failed to search:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (song: iTunesResult) => {
    const params = new URLSearchParams({
      trackName: song.trackName,
      artistName: song.artistName,
      offset: offsetMs.toString(),
    });
    router.push(`/game?${params.toString()}`);
  };

  return (
    <main className="container">
      <h1 className="title">LyricRush</h1>
      <p className="subtitle">Can you guess the next line before it drops?</p>

      <div className="settings-box">
        <label htmlFor="offset">Global Audio Sync Offset (ms)</label>
        <input 
          type="number" 
          id="offset" 
          value={offsetMs} 
          onChange={(e) => setOffsetMs(Number(e.target.value) || 0)} 
          step="100"
        />
      </div>

      <form onSubmit={handleSearch} className="input-group">
        <input
          type="text"
          className="input"
          placeholder="Search for a song..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {loading && <div className="spinner"></div>}

      <div className="results">
        {results.map((song) => (
          <div key={song.trackId} className="result-card" onClick={() => handlePlay(song)}>
            <img src={song.artworkUrl100} alt={song.trackName} className="result-image" />
            <div className="result-info">
              <div className="result-title">{song.trackName}</div>
              <div className="result-artist">{song.artistName}</div>
            </div>
            <div className="btn" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>Play</div>
          </div>
        ))}
      </div>
    </main>
  );
}
