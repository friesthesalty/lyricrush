'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '../lib/useSettings';
import SettingsPanel from '../components/SettingsPanel';
import versionInfo from '../version.json';

interface SearchResult {
  trackId: string | number;
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  source?: string;
}

function extractYoutubeId(input: string): string {
  const match = input.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : input.trim();
}

export default function Home() {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [showSettings, setShowSettings] = useState(false);
  const { settings, updateSettings } = useSettings();
  
  // Auto mode state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const router = useRouter();

  // Manual mode state
  const [manualYoutubeId, setManualYoutubeId] = useState('');
  const [manualLrc, setManualLrc] = useState('');

  useEffect(() => {
    const savedMode = sessionStorage.getItem('home_mode');
    if (savedMode === 'auto' || savedMode === 'manual') setMode(savedMode);
    
    const savedQuery = sessionStorage.getItem('home_query');
    if (savedQuery) setQuery(savedQuery);
    
    const savedResults = sessionStorage.getItem('home_results');
    if (savedResults) {
      try { setResults(JSON.parse(savedResults)); } catch (e) {}
    }
    
    const savedOffset = sessionStorage.getItem('home_offset');
    if (savedOffset) setOffsetMs(Number(savedOffset));

    const savedManualYt = sessionStorage.getItem('manual_youtube_id');
    if (savedManualYt) setManualYoutubeId(savedManualYt);

    const savedManualLrc = sessionStorage.getItem('manual_lrc');
    if (savedManualLrc) setManualLrc(savedManualLrc);
  }, []);

  useEffect(() => {
    sessionStorage.setItem('home_mode', mode);
    sessionStorage.setItem('home_query', query);
    sessionStorage.setItem('home_results', JSON.stringify(results));
    sessionStorage.setItem('home_offset', offsetMs.toString());
    sessionStorage.setItem('manual_youtube_id', manualYoutubeId);
    sessionStorage.setItem('manual_lrc', manualLrc);
  }, [mode, query, results, offsetMs, manualYoutubeId, manualLrc]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Failed to search:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAuto = (song: SearchResult) => {
    // If the user pasted custom data in the manual tab, use it for this auto song
    if (manualLrc.trim()) {
      sessionStorage.setItem('manual_lrc', manualLrc);
    } else {
      sessionStorage.removeItem('manual_lrc');
    }
    
    if (manualYoutubeId.trim()) {
      sessionStorage.setItem('manual_youtube_id', extractYoutubeId(manualYoutubeId));
    } else {
      sessionStorage.removeItem('manual_youtube_id');
    }

    const params = new URLSearchParams({
      mode: 'auto',
      trackName: song.trackName,
      artistName: song.artistName,
      offset: offsetMs.toString(),
    });
    router.push(`/game?${params.toString()}`);
  };

  const handlePlayManual = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedId = extractYoutubeId(manualYoutubeId);
    if (!parsedId || !manualLrc.trim()) return;
    
    // Save the potentially large LRC string to sessionStorage
    sessionStorage.setItem('manual_lrc', manualLrc);
    sessionStorage.setItem('manual_youtube_id', parsedId);
    
    const params = new URLSearchParams({
      mode: 'manual',
      offset: offsetMs.toString(),
    });
    router.push(`/game?${params.toString()}`);
  };

  return (
    <main className="container" style={{ position: 'relative' }}>
      <button 
        style={{ position: 'fixed', top: '2rem', right: '2rem', background: 'none', border: 'none', fontSize: '2rem', cursor: 'pointer', transition: 'transform 0.2s', zIndex: 10 }} 
        onClick={() => setShowSettings(true)}
        title="Settings"
        onMouseOver={(e) => e.currentTarget.style.transform = 'rotate(45deg)'}
        onMouseOut={(e) => e.currentTarget.style.transform = 'rotate(0deg)'}
      >
        ⚙️
      </button>
      <div style={{ position: 'fixed', top: '1rem', left: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', zIndex: 10, pointerEvents: 'none' }}>
        Commit: {versionInfo.hash} - {versionInfo.message}
      </div>
      {showSettings && <SettingsPanel settings={settings} updateSettings={updateSettings} onClose={() => setShowSettings(false)} />}
      <h1 className="title">LyricRush</h1>
      <p className="subtitle">Can you guess the next line before it drops?</p>

      <div className="settings-box" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1rem' }}>
          <button 
            className={`btn ${mode === 'auto' ? '' : 'secondary'}`} 
            onClick={() => setMode('auto')}
            style={{ opacity: mode === 'auto' ? 1 : 0.6 }}
          >
            Auto Find
          </button>
          <button 
            className={`btn ${mode === 'manual' ? '' : 'secondary'}`} 
            onClick={() => setMode('manual')}
            style={{ opacity: mode === 'manual' ? 1 : 0.6 }}
          >
            Manual Input
          </button>
        </div>

        <label htmlFor="offset">Global Audio Sync Offset (ms)</label>
        <input 
          type="number" 
          id="offset" 
          value={offsetMs} 
          onChange={(e) => setOffsetMs(Number(e.target.value) || 0)} 
          step="100"
        />
      </div>

      {mode === 'auto' && (
        <>
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
              <div key={song.trackId} className="result-card" onClick={() => handlePlayAuto(song)}>
                <img src={song.artworkUrl100} alt={song.trackName} className="result-image" />
                <div className="result-info">
                  <div className="result-title">{song.trackName}</div>
                  <div className="result-artist">{song.artistName}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                  {song.source && (
                    <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '1px' }}>
                      {song.source}
                    </span>
                  )}
                  <div className="btn" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>Play</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {mode === 'manual' && (
        <form onSubmit={handlePlayManual} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '600px' }}>
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '1rem', borderRadius: '8px', fontSize: '0.9rem', color: '#ccc', borderLeft: '4px solid var(--primary)' }}>
            <strong>Tip:</strong> You don't have to fill out both fields! If you only want to provide custom lyrics (and auto-find the video), OR if you only want to provide a custom YouTube video (and auto-find the lyrics), just fill what you want here and then search for your song using the <strong>Auto Find</strong> tab!
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text)' }}>YouTube Video ID or URL</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. dQw4w9WgXcQ or https://youtube.com/watch?v=..."
              value={manualYoutubeId}
              onChange={(e) => setManualYoutubeId(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text)' }}>LRC Data</label>
            <textarea
              className="input"
              placeholder="[00:00.00] Lyrics here..."
              value={manualLrc}
              onChange={(e) => setManualLrc(e.target.value)}
              style={{ minHeight: '200px', resize: 'vertical', fontFamily: 'monospace' }}
            />
          </div>
          <button type="submit" className="btn">
            Play Custom Song
          </button>
        </form>
      )}
    </main>
  );
}
