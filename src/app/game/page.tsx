'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface LyricLine {
  time: number;
  text: string;
}

interface Question {
  targetIndex: number;
  options: string[];
  correctIndex: number;
  status: 'pending' | 'correct' | 'wrong';
  createdAt: number;
  targetTime: number;
}

interface HitEffect {
  id: number;
  text: string;
  type: 'perfect' | 'great' | 'good' | 'miss';
}

interface Stats {
  perfect: number;
  great: number;
  good: number;
  miss: number;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export default function GamePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const trackName = searchParams.get('trackName');
  const artistName = searchParams.get('artistName');
  const offsetMs = parseInt(searchParams.get('offset') || '0', 10);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [videoId, setVideoId] = useState('');
  
  const [gameState, setGameState] = useState<'playing' | 'ended'>('playing');
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<Stats>({ perfect: 0, great: 0, good: 0, miss: 0 });
  const [hitEffects, setHitEffects] = useState<HitEffect[]>([]);

  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [question, setQuestion] = useState<Question | null>(null);

  const playerRef = useRef<any>(null);
  const reqRef = useRef<number | undefined>(undefined);
  const progressRef = useRef<HTMLDivElement>(null);
  const lyricsRef = useRef<LyricLine[]>([]);
  const questionRef = useRef<Question | null>(null);
  const askedQuestionsRef = useRef<Set<number>>(new Set());

  // Parse LRC format
  const parseLrc = (lrc: string) => {
    const lines = lrc.split('\n');
    const parsed: LyricLine[] = [];
    for (const line of lines) {
      const match = line.match(/^\[(\d+):(\d+\.\d+|\d+)\](.*)/);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseFloat(match[2]);
        const text = match[3].trim();
        if (text && !text.includes('♪')) {
          parsed.push({ time: minutes * 60 + seconds, text });
        }
      }
    }
    return parsed;
  };

  useEffect(() => {
    if (!trackName || !artistName) {
      setError('Missing track details');
      setLoading(false);
      return;
    }

    const init = async () => {
      try {
        const ytRes = await fetch(`/api/yt-search?q=${encodeURIComponent(artistName + ' ' + trackName + ' audio')}`);
        const ytData = await ytRes.json();
        if (!ytData.videoId) throw new Error('Video not found');
        
        const lrcRes = await fetch(`/api/lyrics?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`);
        const lrcData = await lrcRes.json();
        
        if (!lrcData.length || !lrcData[0].syncedLyrics) {
          throw new Error('Synced lyrics not available for this song');
        }

        const parsedLyrics = parseLrc(lrcData[0].syncedLyrics);
        if (parsedLyrics.length === 0) {
          throw new Error('Could not parse synced lyrics');
        }

        setLyrics(parsedLyrics);
        lyricsRef.current = parsedLyrics;
        setVideoId(ytData.videoId);
      } catch (err: any) {
        setError(err.message || 'Failed to load game');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [trackName, artistName]);

  // Load YT Player
  useEffect(() => {
    if (!videoId) return;

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    const onReady = () => {
      if (!document.getElementById('yt-player')) return;
      
      playerRef.current = new window.YT.Player('yt-player', {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
        },
        events: {
          onReady: (event: any) => {
            event.target.playVideo();
            startGameLoop();
          },
          onStateChange: (event: any) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              if (!reqRef.current) startGameLoop();
            } else if (event.data === window.YT.PlayerState.ENDED) {
              if (reqRef.current) {
                cancelAnimationFrame(reqRef.current);
                reqRef.current = undefined;
              }
              setGameState('ended');
            } else {
              if (reqRef.current) {
                cancelAnimationFrame(reqRef.current);
                reqRef.current = undefined;
              }
            }
          }
        }
      });
    };

    if (window.YT && window.YT.Player) {
      onReady();
    } else {
      window.onYouTubeIframeAPIReady = onReady;
    }

    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
      if (playerRef.current) playerRef.current.destroy();
    };
  }, [videoId]);

  const generateQuestion = (targetIndex: number) => {
    const allLyrics = lyricsRef.current;
    const targetText = allLyrics[targetIndex].text;
    
    const wrongOptions = new Set<string>();
    while (wrongOptions.size < 3 && wrongOptions.size < allLyrics.length - 1) {
      const randomLine = allLyrics[Math.floor(Math.random() * allLyrics.length)].text;
      if (randomLine !== targetText && randomLine.length > 0) {
        wrongOptions.add(randomLine);
      }
    }

    const options = [targetText, ...Array.from(wrongOptions)];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    const q: Question = {
      targetIndex,
      options,
      correctIndex: options.indexOf(targetText),
      status: 'pending',
      createdAt: playerRef.current.getCurrentTime() + (offsetMs / 1000),
      targetTime: allLyrics[targetIndex].time
    };
    
    questionRef.current = q;
    setQuestion(q);
    askedQuestionsRef.current.add(targetIndex);
  };

  const spawnHitEffect = (text: string, type: HitEffect['type']) => {
    const id = Date.now() + Math.random();
    setHitEffects(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setHitEffects(prev => prev.filter(h => h.id !== id));
    }, 1000);
  };

  const startGameLoop = () => {
    const loop = () => {
      if (!playerRef.current || !playerRef.current.getCurrentTime) return;
      
      const playerTime = playerRef.current.getCurrentTime() + (offsetMs / 1000);
      const allLyrics = lyricsRef.current;

      if (progressRef.current && playerRef.current.getDuration) {
        const duration = playerRef.current.getDuration();
        if (duration > 0) {
          progressRef.current.style.width = `${(playerRef.current.getCurrentTime() / duration) * 100}%`;
        }
      }

      let newIndex = -1;
      for (let i = 0; i < allLyrics.length; i++) {
        if (playerTime >= allLyrics[i].time) {
          newIndex = i;
        } else {
          break;
        }
      }

      if (newIndex !== currentLineIndex) {
        setCurrentLineIndex(newIndex);
      }

      const nextIndex = newIndex + 1;
      
      // If the lyric line has started and they haven't answered, mark it as missed
      if (questionRef.current && questionRef.current.targetIndex <= newIndex) {
        if (questionRef.current.status === 'pending') {
          const missedQ = { ...questionRef.current, status: 'wrong' as const };
          questionRef.current = missedQ;
          setQuestion(missedQ);
          setStats(s => ({ ...s, miss: s.miss + 1 }));
          spawnHitEffect('Miss!', 'miss');
        }
      }

      // Clear the question once we reach the line AFTER its target lyric line
      if (questionRef.current && questionRef.current.targetIndex < newIndex) {
        questionRef.current = null;
        setQuestion(null);
      }

      if (nextIndex < allLyrics.length) {
        const nextTime = allLyrics[nextIndex].time;
        const timeUntilNext = nextTime - playerTime;
        
        const isShowingResult = questionRef.current && questionRef.current.targetIndex === newIndex && questionRef.current.status !== 'pending';
        
        if (timeUntilNext > 0 && timeUntilNext <= 4.0 && !isShowingResult) {
          if (!askedQuestionsRef.current.has(nextIndex)) {
            generateQuestion(nextIndex);
          }
        }
      }

      reqRef.current = requestAnimationFrame(loop);
    };
    reqRef.current = requestAnimationFrame(loop);
  };

  const handleAnswer = useCallback((index: number) => {
    const q = questionRef.current;
    if (!q || q.status !== 'pending' || !playerRef.current) return;

    if (index === q.correctIndex) {
      const answeredAt = playerRef.current.getCurrentTime() + (offsetMs / 1000);
      const providedTime = q.targetTime - q.createdAt;
      const reactionTime = answeredAt - q.createdAt;
      const ratio = reactionTime / providedTime;

      let category: HitEffect['type'] = 'good';
      let points = 50;

      if (ratio < 0.33) {
        category = 'perfect';
        points = 100;
      } else if (ratio < 0.66) {
        category = 'great';
        points = 75;
      }

      setScore(s => s + points);
      setStats(s => ({ ...s, [category]: s[category] + 1 }));
      spawnHitEffect(`${category.toUpperCase()}! +${points}`, category);

      const updated: Question = { ...q, status: 'correct' };
      questionRef.current = updated;
      setQuestion(updated);
    } else {
      setStats(s => ({ ...s, miss: s.miss + 1 }));
      spawnHitEffect('MISS!', 'miss');

      const updated: Question = { ...q, status: 'wrong' };
      questionRef.current = updated;
      setQuestion(updated);
    }
  }, [offsetMs]);

  const togglePause = useCallback(() => {
    if (gameState !== 'playing') return;
    setIsPaused(prev => {
      const next = !prev;
      if (next) {
        playerRef.current?.pauseVideo();
      } else {
        playerRef.current?.playVideo();
      }
      return next;
    });
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        togglePause();
        return;
      }
      
      if (isPaused) return;

      const keyMap: Record<string, number> = {
        'd': 0,
        'f': 1,
        'j': 2,
        'k': 3
      };
      const index = keyMap[e.key.toLowerCase()];
      if (index !== undefined && questionRef.current?.status === 'pending') {
        handleAnswer(index);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAnswer, isPaused, togglePause]);

  if (loading) {
    return (
      <main className="game-container">
        <h2 className="title">Loading Game...</h2>
        <div className="spinner"></div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="game-container">
        <h2 className="title" style={{ color: 'var(--error)' }}>Error</h2>
        <p style={{ fontSize: '1.2rem', marginBottom: '2rem' }}>{error}</p>
        <button className="btn" onClick={() => router.push('/')}>Back to Menu</button>
      </main>
    );
  }

  if (gameState === 'ended') {
    return (
      <main className="game-container">
        <div className="scoreboard">
          <h2>Song Complete!</h2>
          <div className="stat-row perfect">
            <span>Perfect</span>
            <span>{stats.perfect}</span>
          </div>
          <div className="stat-row great">
            <span>Great</span>
            <span>{stats.great}</span>
          </div>
          <div className="stat-row good">
            <span>Good</span>
            <span>{stats.good}</span>
          </div>
          <div className="stat-row miss">
            <span>Miss</span>
            <span>{stats.miss}</span>
          </div>
          <div className="stat-row" style={{ fontWeight: 800, marginTop: '2rem' }}>
            <span>Total Score</span>
            <span>{score}</span>
          </div>
          <button className="btn" style={{ width: '100%', marginTop: '2rem' }} onClick={() => router.push('/')}>
            Play Again
          </button>
        </div>
      </main>
    );
  }

  const activeLyric = currentLineIndex >= 0 ? lyrics[currentLineIndex].text : '...';
  const nextLyric = currentLineIndex + 1 < lyrics.length ? lyrics[currentLineIndex + 1].text : '';
  const keyLabels = ['D', 'F', 'J', 'K'];

  return (
    <main className="game-container">
      <div className="progress-bar-container">
        <div className="progress-bar-fill" ref={progressRef}></div>
      </div>

      {isPaused && (
        <div className="pause-overlay">
          <div className="pause-menu">
            <h2>Paused</h2>
            <button className="btn" onClick={togglePause}>Resume</button>
            <button className="btn" onClick={() => router.push('/')} style={{ background: 'var(--surface-hover)' }}>Quit to Menu</button>
          </div>
        </div>
      )}

      <button 
        className="btn" 
        style={{ position: 'absolute', top: '2rem', left: '2rem', padding: '0.5rem 1rem', fontSize: '1rem' }}
        onClick={() => router.push('/')}
      >
        &larr; Back
      </button>
      <div className="score-hud">Score: {score}</div>
      
      {/* Hidden YT Player wrapped to prevent React from resetting the iframe during re-renders */}
      <div 
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} 
        ref={(el) => {
          if (el && !document.getElementById('yt-player')) {
            const child = document.createElement('div');
            child.id = 'yt-player';
            el.appendChild(child);
          }
        }}
      />

      {hitEffects.map(hit => (
        <div key={hit.id} className={`hit-effect hit-${hit.type}`}>
          {hit.text}
        </div>
      ))}

      <div className="lyrics-display">
        <div className="lyric-line active">{activeLyric}</div>
        {!question && <div className="lyric-line">{nextLyric ? '...' : ''}</div>}
      </div>

      {question && (
        <div className="question-area">
          <h3 className="question-title">What's the next line?</h3>
          <div className="options-grid">
            {question.options.map((opt, i) => {
              let btnClass = 'option-btn';
              if (question.status !== 'pending') {
                if (i === question.correctIndex) btnClass += ' correct';
                else if (question.status === 'wrong') btnClass += ' wrong';
              }

              return (
                <button 
                  key={i} 
                  className={btnClass}
                  onClick={() => handleAnswer(i)}
                  disabled={question.status !== 'pending'}
                >
                  <div className="keybind-badge">{keyLabels[i]}</div>
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
