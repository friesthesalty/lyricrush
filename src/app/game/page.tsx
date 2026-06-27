'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface LyricLine {
  time: number;
  text: string;
}

interface Question {
  targetIndex: number;
  precedingIndices: number[];
  options: string[];
  correctIndex: number;
  status: 'pending' | 'correct' | 'wrong';
  createdAt: number;
  targetTime: number;
  activateTime: number;
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

function GameContent() {
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
  const timingNeedleRef = useRef<HTMLDivElement>(null);
  const lyricsRef = useRef<LyricLine[]>([]);
  const questionRef = useRef<Question | null>(null);
  const askedQuestionsRef = useRef<Set<number>>(new Set());
  const pastTargetsRef = useRef<Set<number>>(new Set());
  const markovChainRef = useRef<Map<string, string[]>>(new Map());
  const markovStartsRef = useRef<string[]>([]);

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

  const buildMarkovChain = (parsed: LyricLine[]) => {
    const chain = new Map<string, string[]>();
    const starts: string[] = [];
    
    for (const line of parsed) {
      const words = line.text.split(/\s+/).filter(w => w.length > 0);
      if (words.length === 0) continue;
      
      if (words.length === 1) {
        starts.push(words[0]);
        continue;
      }
      
      starts.push(`${words[0]} ${words[1]}`);
      
      for (let i = 0; i < words.length - 2; i++) {
        const state = `${words[i]} ${words[i + 1]}`;
        if (!chain.has(state)) chain.set(state, []);
        chain.get(state)!.push(words[i + 2]);
      }
    }
    
    markovChainRef.current = chain;
    markovStartsRef.current = starts;
  };

  useEffect(() => {
    const init = async () => {
      const mode = searchParams.get('mode') || 'auto';
      
      if (mode === 'manual') {
        const rawLrc = sessionStorage.getItem('manual_lrc');
        const ytId = sessionStorage.getItem('manual_youtube_id');
        
        if (!rawLrc || !ytId) {
          setError('Missing manual input data.');
          setLoading(false);
          return;
        }

        const parsedLyrics = parseLrc(rawLrc);
        if (parsedLyrics.length === 0) {
          setError('Could not parse the provided LRC data.');
          setLoading(false);
          return;
        }

        setLyrics(parsedLyrics);
        lyricsRef.current = parsedLyrics;
        buildMarkovChain(parsedLyrics);
        setVideoId(ytId);
        setLoading(false);
        return;
      }

      // Auto Mode
      if (!trackName || !artistName) {
        setError('Missing track details');
        setLoading(false);
        return;
      }

      try {
        let ytId: string | null = sessionStorage.getItem('manual_youtube_id');
        if (!ytId) {
          const ytRes = await fetch(`/api/yt-search?q=${encodeURIComponent(artistName + ' ' + trackName + ' audio')}`);
          const ytData = await ytRes.json();
          if (!ytData.videoId) throw new Error('Video not found');
          ytId = ytData.videoId as string;
        }
        
        let rawLrc = sessionStorage.getItem('manual_lrc');
        if (!rawLrc) {
          const lrcRes = await fetch(`/api/lyrics?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`);
          const lrcData = await lrcRes.json();
          
          if (!lrcData.length || !lrcData[0].syncedLyrics) {
            throw new Error('synced lyrics not found');
          }
          rawLrc = lrcData[0].syncedLyrics;
        }

        const parsedLyrics = parseLrc(rawLrc as string);
        if (parsedLyrics.length === 0) {
          throw new Error('Could not parse synced lyrics');
        }

        setLyrics(parsedLyrics);
        lyricsRef.current = parsedLyrics;
        buildMarkovChain(parsedLyrics);
        setVideoId(ytId as string);
      } catch (err: any) {
        setError(err.message || 'Failed to load game');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [trackName, artistName, searchParams]);

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
    const currentTime = playerRef.current.getCurrentTime() + (offsetMs / 1000);
    const targetText = allLyrics[targetIndex].text;

    // Group all consecutive preceding lines (gap < 5s) into the same phrase block
    // Stop if we hit a line that was already the target of a previous question
    const precedingIndices: number[] = [];
    if (targetIndex > 0) {
      let currentIdx = targetIndex - 1;
      while (currentIdx >= 0 && !pastTargetsRef.current.has(currentIdx)) {
        if (currentIdx === targetIndex - 1) {
          precedingIndices.unshift(currentIdx);
        } else {
          const gap = allLyrics[currentIdx + 1].time - allLyrics[currentIdx].time;
          if (gap < 5.0) {
            precedingIndices.unshift(currentIdx);
          } else {
            break;
          }
        }
        currentIdx--;
      }
    }

    // Collect texts to exclude from wrong options (currently visible + preceding lyrics)
    const excludedTexts = new Set<string>();
    excludedTexts.add(targetText);
    for (let i = Math.max(0, targetIndex - 2); i < targetIndex; i++) {
      excludedTexts.add(allLyrics[i].text);
    }
    for (const idx of precedingIndices) {
      excludedTexts.add(allLyrics[idx].text);
    }

    // Generate wrong options
    const wrongOptions = new Set<string>();
    let attempts = 0;
    
    // Check if the song has very few unique lines
    const uniqueLinesCount = new Set(allLyrics.map(l => l.text.toLowerCase().trim())).size;
    const useMarkov = uniqueLinesCount < 20;
    
    // First pass: Try to generate strictly non-substring options
    const targetLength = targetText.split(/\s+/).length;
    
    while (wrongOptions.size < 3 && attempts < 150) {
      attempts++;
      
      let randomLine = '';
      if (useMarkov && markovStartsRef.current.length > 0) {
        let state = markovStartsRef.current[Math.floor(Math.random() * markovStartsRef.current.length)];
        const result = state.split(' ');
        const len = Math.max(2, targetLength + Math.floor(Math.random() * 3) - 1); 
        
        while (result.length < len) {
          const currentState = `${result[result.length - 2]} ${result[result.length - 1]}`;
          const nextWords = markovChainRef.current.get(currentState);
          if (!nextWords || nextWords.length === 0) break;
          const nextWord = nextWords[Math.floor(Math.random() * nextWords.length)];
          result.push(nextWord);
        }
        randomLine = result.join(' ');
      } else {
        // Fallback to real random lines if not using Markov or if Markov is empty
        randomLine = allLyrics[Math.floor(Math.random() * allLyrics.length)].text;
      }
      
      if (excludedTexts.has(randomLine) || randomLine.length === 0) continue;
      
      let isSubstring = false;
      const lowerRandom = randomLine.toLowerCase();
      const lowerTarget = targetText.toLowerCase();
      
      if (lowerRandom.includes(lowerTarget) || lowerTarget.includes(lowerRandom)) {
        isSubstring = true;
      }
      
      if (!isSubstring) {
        for (const option of wrongOptions) {
          const lowerOption = option.toLowerCase();
          if (lowerRandom.includes(lowerOption) || lowerOption.includes(lowerRandom)) {
            isSubstring = true;
            break;
          }
        }
      }
      
      if (!isSubstring) {
        wrongOptions.add(randomLine);
      }
    }

    // Fallback pass: If song is too repetitive and we couldn't generate 3, relax the substring rule
    // and just pick random real lines
    if (wrongOptions.size < 3) {
      let fallbackAttempts = 0;
      while (wrongOptions.size < 3 && fallbackAttempts < 100) {
        fallbackAttempts++;
        const randomLine = allLyrics[Math.floor(Math.random() * allLyrics.length)].text;
        if (!excludedTexts.has(randomLine) && randomLine.length > 0) {
          wrongOptions.add(randomLine);
        }
      }
    }

    const options = [targetText, ...Array.from(wrongOptions)];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    // Choices activate when the preceding phrase starts playing, or immediately if single-line
    let activateTime = currentTime;
    if (precedingIndices.length > 1) {
      activateTime = allLyrics[precedingIndices[0]].time;
    } else {
      activateTime = currentTime;
    }

    const q: Question = {
      targetIndex,
      precedingIndices,
      options,
      correctIndex: options.indexOf(targetText),
      status: 'pending',
      createdAt: currentTime,
      targetTime: allLyrics[targetIndex].time,
      activateTime,
    };

    questionRef.current = q;
    setQuestion(q);
    askedQuestionsRef.current.add(targetIndex);
    pastTargetsRef.current.add(targetIndex);
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

      // Update timing bar needle
      if (timingNeedleRef.current && questionRef.current && questionRef.current.status === 'pending') {
        const q = questionRef.current;
        if (playerTime >= q.activateTime) {
          const effectiveDuration = q.targetTime - q.activateTime;
          const elapsed = playerTime - q.activateTime;
          const ratio = effectiveDuration > 0 ? Math.min(Math.max(elapsed / effectiveDuration, 0), 1) : 0;
          timingNeedleRef.current.style.left = `${ratio * 100}%`;
        } else {
          timingNeedleRef.current.style.left = '0%';
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
      // (This keeps the red/green screen visible naturally until the next lyric begins)
      if (questionRef.current && questionRef.current.targetIndex < newIndex) {
        questionRef.current = null;
        setQuestion(null);
      }

      // Scan ahead for the next line to ask about
      // Skip lines that are too close (<5s) — let them play through
      if (!questionRef.current) {
        for (let i = newIndex + 1; i < allLyrics.length; i++) {
          if (askedQuestionsRef.current.has(i)) continue;
          
          // Force a breather: if the previous line was just guessed, skip this one
          // so it plays naturally and breaks up the pacing
          if (pastTargetsRef.current.has(i - 1)) {
            askedQuestionsRef.current.add(i);
            continue;
          }

          const timeUntil = allLyrics[i].time - playerTime;
          if (timeUntil > 30.0) break;
          if (timeUntil >= 5.0) {
            generateQuestion(i);
            break;
          }
          // < 5 seconds away — skip, let it play through
          askedQuestionsRef.current.add(i);
        }
      }

      reqRef.current = requestAnimationFrame(loop);
    };
    reqRef.current = requestAnimationFrame(loop);
  };

  const handleAnswer = useCallback((index: number) => {
    const q = questionRef.current;
    if (!q || q.status !== 'pending' || !playerRef.current) return;
    // Block answers until activated (last preceding line has started)
    const currentTime = playerRef.current.getCurrentTime() + (offsetMs / 1000);
    if (currentTime < q.activateTime) return;

    if (index === q.correctIndex) {
      const answeredAt = playerRef.current.getCurrentTime() + (offsetMs / 1000);
      const providedTime = q.targetTime - q.activateTime;
      const reactionTime = answeredAt - q.activateTime;
      const ratio = providedTime > 0 ? reactionTime / providedTime : 1;

      let category: HitEffect['type'] = 'good';
      let points = 50;

      if (ratio < 0.50) {
        category = 'perfect';
        points = 100;
      } else if (ratio < 0.80) {
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
      setScore(s => s + 25);
      setStats(s => ({ ...s, miss: s.miss + 1 }));
      spawnHitEffect('MISS +25', 'miss');

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

  const restartSong = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(0, true);
    playerRef.current.playVideo();
    setIsPaused(false);
    setScore(0);
    setStats({ perfect: 0, great: 0, good: 0, miss: 0 });
    setCurrentLineIndex(-1);
    setQuestion(null);
    questionRef.current = null;
    askedQuestionsRef.current = new Set();
  }, []);

  const skipToNextLyrics = useCallback(() => {
    if (!playerRef.current) return;
    const allLyrics = lyricsRef.current;
    const currentTime = playerRef.current.getCurrentTime() + (offsetMs / 1000);
    // Find the next lyric line that hasn't started yet
    let nextIdx = -1;
    for (let i = 0; i < allLyrics.length; i++) {
      if (allLyrics[i].time > currentTime) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx === -1) {
      // No more lyrics to skip to, seek to the end of the video
      const duration = playerRef.current.getDuration?.();
      if (duration) {
        playerRef.current.seekTo(duration - 1);
      }
      return;
    }
    // Seek to 6 seconds before the next lyric so the question has time to spawn
    // (The game loop requires timeUntil >= 5.0 to spawn a question)
    const seekTime = Math.max(0, allLyrics[nextIdx].time - 6) - (offsetMs / 1000);
    playerRef.current.seekTo(seekTime, true);
  }, [offsetMs]);

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
        {error === 'synced lyrics not found' && (
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '1rem', borderRadius: '8px', marginBottom: '2rem', maxWidth: '500px', lineHeight: '1.5' }}>
            <strong>Tip:</strong> If you'd like to help, you can contribute your own synced lyrics for this song at <a href="https://lrclib.net/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>lrclib.net</a>! They will automatically appear here once approved. Alternatively, you can play right now by searching on <a href="https://lrclib.net/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>lcrlib.net</a> and inputting the data manually via the <strong>Manual Input</strong> tab on the search page.
          </div>
        )}
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
            <button className="btn" onClick={restartSong} style={{ background: '#f59e0b' }}>Restart Song</button>
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
        {question && question.precedingIndices.length > 1 ? (
          // Multi-line display: show all preceding lines, highlight on beat
          <div className="multi-lyrics">
            {question.precedingIndices.map(lineIdx => {
              const isOnBeat = lineIdx === currentLineIndex;
              const isPast = lineIdx < currentLineIndex;
              return (
                <div
                  key={lineIdx}
                  className={`lyric-line-multi${isOnBeat ? ' on-beat' : ''}${isPast ? ' past' : ''}`}
                >
                  {lyrics[lineIdx].text}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {(question && currentLineIndex >= question.targetIndex) || pastTargetsRef.current.has(currentLineIndex) ? (
              // When the answer choice line is playing, keep the preceding line on screen but grayed out
              <div className="lyric-line">
                {currentLineIndex > 0 ? lyrics[currentLineIndex - 1].text : ''}
              </div>
            ) : (
              // Normal single-line state: brightly lit active lyric
              <div className="lyric-line active">{activeLyric}</div>
            )}
            {(!question || question.status !== 'pending') && <div className="lyric-line">{nextLyric ? '...' : ''}</div>}
            {(!question || question.status !== 'pending') && gameState === 'playing' && (() => {
              const nextIdx = lyrics.findIndex(l => l.time > (playerRef.current?.getCurrentTime?.() ?? 0) + (offsetMs / 1000));
              const gap = nextIdx >= 0 ? lyrics[nextIdx].time - ((playerRef.current?.getCurrentTime?.() ?? 0) + (offsetMs / 1000)) : Infinity;
              return gap >= 10;
            })() && (
              <button
                className="skip-btn"
                onClick={skipToNextLyrics}
                title="Skip to next lyrics"
              >
                Skip ⏭
              </button>
            )}
          </>
        )}
      </div>

      {question && (
        <div className="question-area">
          <h3 className="question-title">What's the next line?</h3>

          {/* Timing Bar */}
          <div className="timing-bar">
            <div className="timing-zone timing-zone-perfect" style={{ width: '50%' }}>
              <span className="timing-zone-label">PERFECT</span>
            </div>
            <div className="timing-zone timing-zone-great" style={{ width: '30%' }}>
              <span className="timing-zone-label">GREAT</span>
            </div>
            <div className="timing-zone timing-zone-good" style={{ width: '20%' }}>
              <span className="timing-zone-label">GOOD</span>
            </div>
            <div className="timing-needle" ref={timingNeedleRef} />
          </div>

          <div className="options-grid">
            {question.options.map((opt, i) => {
              let btnClass = 'option-btn';
              const isMultiline = question.precedingIndices.length > 1;
              const waitingForActivation = question.status === 'pending' && isMultiline && currentLineIndex < question.targetIndex - 1;
              if (waitingForActivation) {
                btnClass += ' waiting';
              } else if (question.status !== 'pending') {
                if (i === question.correctIndex) btnClass += ' correct';
                else if (question.status === 'wrong') btnClass += ' wrong';
              }

              return (
                <button 
                  key={i} 
                  className={btnClass}
                  onClick={() => handleAnswer(i)}
                  disabled={question.status !== 'pending' || waitingForActivation}
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

export default function GamePage() {
  return (
    <Suspense fallback={
      <main className="game-container">
        <h2 className="title">Loading Game...</h2>
        <div className="spinner"></div>
      </main>
    }>
      <GameContent />
    </Suspense>
  );
}
