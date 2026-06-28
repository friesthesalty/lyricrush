'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSettings } from '../../lib/useSettings';
import SettingsPanel from '../../components/SettingsPanel';

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
  const [offsetMsState, setOffsetMsState] = useState(() => parseInt(searchParams.get('offset') || '0', 10));
  const offsetMsRef = useRef(offsetMsState);
  
  const setOffsetMs = useCallback((val: number | ((prev: number) => number)) => {
    setOffsetMsState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      offsetMsRef.current = next;
      return next;
    });
  }, []);
  const offsetMs = offsetMsState;

  useEffect(() => {
    const urlOffset = searchParams.get('offset');
    if (urlOffset) {
      setOffsetMs(parseInt(urlOffset, 10));
    }
  }, [searchParams, setOffsetMs]);

  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(10);
  const [loadMessage, setLoadMessage] = useState('Initializing...');
  const [error, setError] = useState('');
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [videoId, setVideoId] = useState('');
  const [ytDebug, setYtDebug] = useState<any>(null);
  
  const [gameState, setGameState] = useState<'playing' | 'ended' | 'calibration'>('playing');
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<Stats>({ perfect: 0, great: 0, good: 0, miss: 0 });
  const [hitEffects, setHitEffects] = useState<HitEffect[]>([]);

  const { settings, updateSettings } = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [calibrationTaps, setCalibrationTaps] = useState<number[]>([]);
  const [calibrationLyricIndex, setCalibrationLyricIndex] = useState(0);
  const calibrationLyricIndexRef = useRef(0);
  useEffect(() => {
    calibrationLyricIndexRef.current = calibrationLyricIndex;
  }, [calibrationLyricIndex]);
  
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const ignoreGameLogicUntilRef = useRef(0);

  const [sessionTargets, setSessionTargets] = useState<{ target: number; activate: number }[]>([]);
  const durationRef = useRef(0);
  const [videoDuration, setVideoDuration] = useState(0);

  useEffect(() => {
    if (!lyrics.length) return;
    const targets: { target: number; activate: number }[] = [];
    let baseTime = 0;
    let scanStart = 0;
    
    while (scanStart < lyrics.length) {
      let found = false;
      for (let i = scanStart; i < lyrics.length; i++) {
        const timeUntil = lyrics[i].time - baseTime;
        if (timeUntil >= 5.0) {
          const precedingIndices: number[] = [];
          if (i > 0) {
            let currentIdx = i - 1;
            const pastTargets = targets.map(t => t.target);
            while (currentIdx >= 0 && !pastTargets.includes(currentIdx)) {
              if (currentIdx === i - 1) {
                precedingIndices.unshift(currentIdx);
              } else {
                const gap = lyrics[currentIdx + 1].time - lyrics[currentIdx].time;
                if (gap < 5.0) {
                  precedingIndices.unshift(currentIdx);
                } else {
                  break;
                }
              }
              currentIdx--;
            }
          }

          const generateTime = Math.max(baseTime, lyrics[i].time - 30.0);
          let activateTime = generateTime;
          if (precedingIndices.length > 1) {
            activateTime = lyrics[precedingIndices[0]].time;
          }

          targets.push({ target: i, activate: activateTime });
          found = true;
          if (i + 1 < lyrics.length) {
            baseTime = lyrics[i + 1].time;
            scanStart = i + 2;
          } else {
            scanStart = lyrics.length;
          }
          break;
        }
      }
      if (!found) break;
    }
    setSessionTargets(targets);
  }, [lyrics]);

  // Apply volume changes
  useEffect(() => {
    if (playerRef.current && playerRef.current.setVolume) {
      playerRef.current.setVolume(settings.volume);
    }
  }, [settings.volume]);
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
  const [skippedToIndex, setSkippedToIndex] = useState<number>(-1);

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

        setLoadProgress(50);
        setLoadMessage('Parsing manual input...');

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
        setLoadProgress(100);
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
        setLoadProgress(30);
        setLoadMessage('Fetching song data...');
        
        let ytId: string | null = sessionStorage.getItem('manual_youtube_id');
        let rawLrc: string | null = sessionStorage.getItem('manual_lrc');

        const fetchPromises = [];
        
        // Setup YouTube fetch promise
        if (!ytId) {
          const safeArtist = artistName || '';
          const safeTrack = trackName || '';
          fetchPromises.push(
            fetch(`/api/yt-search?q=${encodeURIComponent(safeArtist + ' ' + safeTrack + ' audio')}&artist=${encodeURIComponent(safeArtist)}&track=${encodeURIComponent(safeTrack)}`)
              .then(res => res.json())
              .then(data => {
                if (!data.videoId) throw new Error('Video not found');
                return { type: 'yt', data };
              })
          );
        } else {
          fetchPromises.push(Promise.resolve({ type: 'yt', data: { videoId: ytId } }));
        }

        // Setup Lyrics fetch promise
        if (!rawLrc) {
          fetchPromises.push(
            fetch(`/api/lyrics?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`)
              .then(res => res.json())
              .then(data => {
                if (!data.length || !data[0].syncedLyrics) throw new Error('synced lyrics not found');
                return { type: 'lrc', data };
              })
          );
        } else {
          fetchPromises.push(Promise.resolve({ type: 'lrc', data: [{ syncedLyrics: rawLrc }] }));
        }

        setLoadProgress(60);
        const results = await Promise.allSettled(fetchPromises);
        
        const ytResult = results[0];
        const lrcResult = results[1];

        if (ytResult.status === 'rejected' && lrcResult.status === 'rejected') {
          throw new Error('Neither the video nor synced lyrics could be found.');
        } else if (ytResult.status === 'rejected') {
          throw new Error('Video not found (But lyrics are ready! Use the Manual Input tab to supply a YouTube link)');
        } else if (lrcResult.status === 'rejected') {
          throw new Error('synced lyrics not found (But video was found! Use the Manual Input tab to supply custom lyrics)');
        }

        ytId = (ytResult.value as any).data.videoId;
        if ((ytResult.value as any).data.debug) setYtDebug((ytResult.value as any).data.debug);

        rawLrc = (lrcResult.value as any).data[0].syncedLyrics;

        setLoadProgress(90);
        setLoadMessage('Building game data...');
        const parsedLyrics = parseLrc(rawLrc as string);
        if (parsedLyrics.length === 0) {
          throw new Error('Could not parse synced lyrics');
        }

        setLyrics(parsedLyrics);
        lyricsRef.current = parsedLyrics;
        buildMarkovChain(parsedLyrics);
        setVideoId(ytId as string);
        setLoadProgress(100);
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
            event.target.setVolume(settings.volume);
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
    const currentTime = playerRef.current.getCurrentTime() + (offsetMsRef.current / 1000);
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
      activateTime = allLyrics[precedingIndices[precedingIndices.length - 1]].time;
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
      
      if (gameStateRef.current === 'calibration' || Date.now() < ignoreGameLogicUntilRef.current) {
        reqRef.current = requestAnimationFrame(loop);
        return;
      }

      const playerTime = playerRef.current.getCurrentTime() + (offsetMsRef.current / 1000);
      const allLyrics = lyricsRef.current;

      if (progressRef.current && playerRef.current.getDuration) {
        const duration = playerRef.current.getDuration();
        if (duration > 0) {
          progressRef.current.style.width = `${(playerRef.current.getCurrentTime() / duration) * 100}%`;
          if (durationRef.current === 0) {
            durationRef.current = duration;
            setVideoDuration(duration);
          }
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
    const currentTime = playerRef.current.getCurrentTime() + (offsetMsRef.current / 1000);
    if (currentTime < q.activateTime) return;

    if (index === q.correctIndex) {
      const answeredAt = playerRef.current.getCurrentTime() + (offsetMsRef.current / 1000);
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
  }, []);

  const togglePause = useCallback(() => {
    if (gameState !== 'playing') return;
    setIsPaused(prev => {
      const next = !prev;
      if (next) {
        playerRef.current?.pauseVideo?.();
      } else {
        playerRef.current?.playVideo?.();
      }
      return next;
    });
  }, [gameState]);

  const restartSong = useCallback(() => {
    if (!playerRef.current) return;
    ignoreGameLogicUntilRef.current = Date.now() + 1500; // Ignore logic for 1.5s to allow seek to settle
    playerRef.current.seekTo(0, true);
    playerRef.current.playVideo();
    setGameState('playing');
    setIsPaused(false);
    setScore(0);
    setStats({ perfect: 0, great: 0, good: 0, miss: 0 });
    setCurrentLineIndex(-1);
    setQuestion(null);
    questionRef.current = null;
    askedQuestionsRef.current = new Set();
    pastTargetsRef.current = new Set();
    setSkippedToIndex(-1);
  }, []);

  const enterCalibration = useCallback(() => {
    setIsPaused(false);
    setGameState('calibration');
    setCalibrationTaps([]);
    
    // Find the next upcoming lyric line based on current time + current offset
    if (playerRef.current && lyricsRef.current.length) {
      const currentTime = playerRef.current.getCurrentTime() + (offsetMsRef.current / 1000);
      let nextIdx = 0;
      for (let i = 0; i < lyricsRef.current.length; i++) {
        if (lyricsRef.current[i].time > currentTime) {
          nextIdx = i;
          break;
        }
      }
      setCalibrationLyricIndex(nextIdx);
      playerRef.current.playVideo();
    }
  }, []);

  const finishCalibration = useCallback(() => {
    setGameState('playing');
    
    // Sync the newly calibrated offset to the URL so it persists
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set('offset', offsetMsRef.current.toString());
    router.replace(`?${newParams.toString()}`);

    restartSong();
  }, [restartSong, searchParams, router]);

  const skipToNextLyrics = useCallback(() => {
    if (!playerRef.current) return;
    const allLyrics = lyricsRef.current;
    const currentTime = playerRef.current.getCurrentTime() + (offsetMsRef.current / 1000);
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
    const seekTime = Math.max(0, allLyrics[nextIdx].time - 6) - (offsetMsRef.current / 1000);
    setSkippedToIndex(nextIdx);
    playerRef.current.seekTo(seekTime, true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'calibration') {
        if (e.code === 'ArrowRight') {
          e.preventDefault();
          if (playerRef.current) {
            playerRef.current.seekTo(playerRef.current.getCurrentTime() + 5, true);
          }
          return;
        }
        if (e.code === 'ArrowLeft') {
          e.preventDefault();
          if (playerRef.current) {
            playerRef.current.seekTo(Math.max(0, playerRef.current.getCurrentTime() - 5), true);
          }
          return;
        }
        
        if (e.code === 'Space') {
          e.preventDefault();
          if (!playerRef.current || !lyricsRef.current.length) return;
          if (calibrationLyricIndex >= lyricsRef.current.length) return;

          const rawTime = playerRef.current.getCurrentTime(); // time in seconds without offset
          const targetLyric = lyricsRef.current[calibrationLyricIndex];
          const newOffsetMs = Math.round((targetLyric.time - rawTime) * 1000);
          
          const nextTaps = [...calibrationTaps, newOffsetMs].slice(-5);
          const avg = Math.round(nextTaps.reduce((a, b) => a + b, 0) / nextTaps.length);
          
          setCalibrationTaps(nextTaps);
          setOffsetMs(avg);
          spawnHitEffect(`Avg Offset: ${avg}ms`, 'good');

          setCalibrationLyricIndex(prev => prev + 1);
        }
        return;
      }

      if (e.key === 'Escape') {
        togglePause();
        return;
      }
      
      if (isPaused) return;

      const index = settings.keybinds.indexOf(e.key.toLowerCase());
      if (index !== -1 && questionRef.current?.status === 'pending') {
        handleAnswer(index);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAnswer, isPaused, togglePause, settings.keybinds, gameState, calibrationLyricIndex, calibrationTaps, setOffsetMs]);

  if (loading) {
    return (
      <main className="game-container">
        <h2 className="title">Loading Game...</h2>
        <div style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{loadMessage}</div>
        <div style={{ width: '100%', maxWidth: '300px', height: '6px', background: 'var(--surface-hover)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ width: `${loadProgress}%`, height: '100%', background: 'var(--primary)', transition: 'width 0.3s ease-out' }}></div>
        </div>
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
    const totalNotes = stats.perfect + stats.great + stats.good + stats.miss;
    const maxScore = totalNotes * 100;
    const accuracy = maxScore > 0 ? (score / maxScore) * 100 : 0;
    
    let grade = 'F';
    let gradeColor = 'var(--error)';
    if (accuracy >= 95) { grade = 'S'; gradeColor = 'var(--perfect)'; }
    else if (accuracy >= 85) { grade = 'A'; gradeColor = 'var(--great)'; }
    else if (accuracy >= 75) { grade = 'B'; gradeColor = 'var(--good)'; }
    else if (accuracy >= 65) { grade = 'C'; gradeColor = '#f59e0b'; }
    else if (accuracy >= 50) { grade = 'D'; gradeColor = 'var(--text-main)'; }

    const isFC = totalNotes > 0 && stats.miss === 0;
    const isAP = totalNotes > 0 && stats.perfect === totalNotes;

    return (
      <main className="game-container">
        <div className="scoreboard">
          <h2>Song Complete!</h2>
          
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ fontSize: '5rem', fontWeight: 900, color: gradeColor, textShadow: `0 0 20px ${gradeColor}80` }}>
              {grade}
            </div>
            <div style={{ fontSize: '1.5rem', color: 'var(--text-main)', marginTop: '0.5rem' }}>
              {accuracy.toFixed(2)}%
            </div>
            {isAP ? (
              <div style={{ marginTop: '1rem', color: 'var(--perfect)', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '2px', animation: 'pulse-glow 1.5s infinite' }}>ALL PERFECT</div>
            ) : isFC ? (
              <div style={{ marginTop: '1rem', color: 'var(--good)', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '2px' }}>FULL COMBO</div>
            ) : null}
          </div>

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
          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button className="btn" style={{ flex: 1 }} onClick={restartSong}>
              Play Again
            </button>
            <button className="btn" style={{ flex: 1, background: 'var(--surface-hover)' }} onClick={() => router.push('/')}>
              Go Home
            </button>
          </div>
        </div>
      </main>
    );
  }

  const activeLyric = currentLineIndex >= 0 ? lyrics[currentLineIndex].text : '...';
  const nextLyric = currentLineIndex + 1 < lyrics.length ? lyrics[currentLineIndex + 1].text : '';
  const keyLabels = settings.keybinds.map(k => k.toUpperCase());
  
  const currentTotalNotes = stats.perfect + stats.great + stats.good + stats.miss;
  const currentMaxScore = currentTotalNotes * 100;
  const currentAccuracy = currentMaxScore > 0 ? (score / currentMaxScore) * 100 : 100;

  return (
    <main className="game-container">
      <div className="progress-bar-container">
        <div className="progress-bar-fill" ref={progressRef}></div>
        {videoDuration > 0 && sessionTargets.map((session, idx) => {
          const adjustedActivate = session.activate - (offsetMs / 1000);
          const leftPercent = Math.max(0, Math.min((adjustedActivate / videoDuration) * 100, 100));
          return (
            <div 
              key={idx}
              style={{
                position: 'absolute',
                left: `${leftPercent}%`,
                top: 0,
                bottom: 0,
                width: '3px',
                background: 'rgba(255, 255, 255, 0.4)',
                boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)',
                zIndex: 60,
                transform: 'translateX(-50%)'
              }}
            />
          );
        })}
      </div>

      {isPaused && (
        <div className="pause-overlay">
          <div className="pause-menu">
            <h2>Paused</h2>
            <button className="btn" onClick={togglePause}>Resume</button>
            <button className="btn" onClick={restartSong} style={{ background: '#f59e0b' }}>Restart Song</button>
            <button className="btn" onClick={enterCalibration} style={{ background: '#3b82f6' }}>Calibrate Offset</button>
            <button className="btn" onClick={() => setShowSettings(true)} style={{ background: 'var(--primary)' }}>Settings</button>
            <button className="btn" onClick={() => router.push('/')} style={{ background: 'var(--surface-hover)' }}>Quit to Menu</button>
          </div>
        </div>
      )}

      {gameState === 'calibration' && (
        <div className="calibration-overlay" style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem', color: 'var(--primary)' }}>Calibration Mode</h2>
          <p style={{ fontSize: '1.2rem', marginBottom: '2rem', textAlign: 'center', maxWidth: '600px', lineHeight: 1.5 }}>
            Listen to the song and press <strong style={{ color: 'var(--good)' }}>SPACE</strong> exactly when you hear the singer start this lyric line:<br/>
          </p>
          <div style={{ fontSize: '4rem', fontWeight: 'bold', marginBottom: '1rem', color: 'var(--good)', textShadow: '0 0 20px rgba(74, 222, 128, 0.5)' }}>
            {offsetMs > 0 ? '+' : ''}{offsetMs} ms
          </div>
          <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '3rem' }}>
            ({calibrationTaps.length > 0 ? `Averaged over last ${calibrationTaps.length} taps` : 'Tap SPACE to start calibrating'})
            <br/>
            <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>(Use Left/Right Arrows to seek audio backward/forward)</span>
          </div>
          <button className="btn" onClick={finishCalibration} style={{ padding: '1rem 3rem', fontSize: '1.2rem' }}>Done</button>
          
          <div style={{ marginTop: '3rem', fontSize: '1.5rem', color: 'var(--text-main)', background: 'rgba(255,255,255,0.1)', padding: '1.5rem 3rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.2)' }}>
             {lyrics[calibrationLyricIndex]?.text || '...'}
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsPanel 
          settings={settings} 
          updateSettings={updateSettings} 
          onClose={() => setShowSettings(false)}
          debugInfo={{
            videoId,
            gameState,
            score,
            lyricsCount: lyrics.length,
            firstFewLyrics: lyrics.slice(0, 2),
            playerState: playerRef.current?.getPlayerState?.() ?? 'not ready',
            youtubeSearchData: ytDebug
          }}
        />
      )}

      <button 
        className="btn" 
        style={{ position: 'absolute', top: '2rem', left: '2rem', padding: '0.5rem 1rem', fontSize: '1rem', zIndex: 100 }}
        onClick={() => {
          if (gameState === 'calibration') {
             const urlOffset = searchParams.get('offset');
             setOffsetMs(urlOffset ? parseInt(urlOffset, 10) : 0);
             setGameState('playing');
             setIsPaused(true);
             playerRef.current?.pauseVideo?.();
          } else {
             togglePause();
          }
        }}
      >
        &larr; Back
      </button>
      <div className="score-hud">
        Score: {score} 
        <span style={{ fontSize: '1rem', marginLeft: '10px', color: 'var(--text-muted)' }}>
          {currentAccuracy.toFixed(2)}%
        </span>
      </div>
      
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
            {!question && <div className="lyric-line">{nextLyric ? '...' : ''}</div>}
            {(!question || question.status !== 'pending') && gameState === 'playing' && (() => {
              const nextIdx = lyrics.findIndex(l => l.time > (playerRef.current?.getCurrentTime?.() ?? 0) + (offsetMsRef.current / 1000));
              if (skippedToIndex === nextIdx) return false;
              const gap = nextIdx >= 0 ? lyrics[nextIdx].time - ((playerRef.current?.getCurrentTime?.() ?? 0) + (offsetMsRef.current / 1000)) : Infinity;
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
                if (i === question.correctIndex) {
                  btnClass += ' correct';
                  if (currentLineIndex === question.targetIndex) {
                    btnClass += ' is-playing';
                  }
                } else if (question.status === 'wrong') {
                  btnClass += ' wrong';
                }
              }

              return (
                <button 
                  key={i} 
                  className={btnClass}
                  onClick={() => handleAnswer(i)}
                  disabled={question.status !== 'pending' || waitingForActivation}
                >
                  <div className="keybind-badge">{keyLabels[i]}</div>
                  <span className="option-text">{opt}</span>
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
