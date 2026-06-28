# Radiant Mendeleev (Lyric Rush) - Project Guidelines

## Game Introduction
Radiant Mendeleev is a rhythm-based lyric guessing web application. The core loop consists of a user selecting a song, which is played via the YouTube Iframe API while synchronized lyrics scroll on the screen. Periodically, the game hides an upcoming lyric and enters a "guessing session", forcing the player to choose the correct lyric from 4 generated options within a strict time limit to earn points. 

## Set in Stone (Core Architecture Rules)
The following design decisions and constraints are strictly set in stone. Do **not** attempt to change them without explicit permission from the user:

1. **No Spotify API:** The Spotify API is strictly prohibited due to its limitations on 30-second previews and complicated authentication. All track metadata, album art, and searches are handled via the **Deezer API**, and the actual audio playback is handled exclusively by the **YouTube Iframe API**.
2. **Game Loop Engine:** The core game logic runs inside a highly optimized `requestAnimationFrame` loop in `page.tsx`. It constantly compares the YouTube player's `getCurrentTime()` (plus the user's `offsetMs`) against the parsed `.lrc` timestamps. Do not try to replace this with `setInterval` or standard React state for timing, as it will destroy the precision.
3. **Simulation Loop:** The game pre-simulates all future guessing sessions when the component mounts to plot glowing markers on the global progress bar (`sessionTargets`). If you ever modify the logic for when a question spawns (`generateQuestion`), you **must** perfectly mirror those logic changes in the simulation loop `useEffect`.
4. **Multiline Phrase Timing:** When lyrics are close together (< 5s gaps), they are bundled into "multiline phrases". The UI unlocks the guessing options precisely when the **first** line of the phrase begins playing, but the timing needle (which dictates the Perfect/Great/Good score) locks strictly onto the **last** line of the phrase. 
5. **Calibration System:** Because YouTube videos often have intros, the game relies on an `offsetMs` system to sync lyrics. During calibration, the game loop pauses. Users can use Left/Right Arrows to seek the audio backward/forward by 5 seconds, and tap Space to calculate their offset against a frozen lyric on the screen. The calibrated offset **must** be pushed to the Next.js URL (`?offset=X`) so it persists on re-renders.

## UI Documentation
Whenever adding or modifying UI elements in the game, make sure to document their corresponding IDs and class names in `docs/ui_elements.md`. This ensures all future agents maintain a shared vocabulary (e.g. separating the "Global Progress Bar" from the "Timing Bar") to avoid confusion.
