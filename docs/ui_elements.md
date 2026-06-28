# Radiant Mendeleev UI Elements Guide

This document serves as a shared vocabulary for the different user interface elements in the game, to help avoid confusion when discussing features like "progress bars" and "timing needles".

## 1. Global HUD & Layout
These elements are always visible at the top level of the game.

- **Global Progress Bar** (`#global-progress-bar` / `.progress-bar-container`)
  - The thin bar running across the very top of the screen that tracks the overall video playback.
- **Session Markers** (`.session-marker`)
  - The glowing vertical lines on the global progress bar that indicate when a guessing session will start.
- **Score HUD** (`#score-hud` / `.score-hud`)
  - The box in the top right corner displaying the player's current score.

## 2. Lyrics Display Area
The central area where the lyrics flow during playback.

- **Lyrics Display Container** (`#lyrics-display-container` / `.lyrics-display`)
  - The main wrapper for the lyrics.
- **Active Lyric** (`#active-lyric` / `.lyric-line.active`)
  - The brightly lit, current line of the song being sung.
- **Upcoming Lyric** (`#upcoming-lyric` / `.lyric-line`)
  - The dimmed line waiting to be sung next.
- **Multiline Phrase** (`#multiline-phrase` / `.lyric-line-multi`)
  - The stack of smaller, dimmed lines used to build up context before a guessing session.
- **Hit Effects** (`.hit-effect`)
  - The floating text (Perfect, Great, Good, Miss) that appears in the center of the screen after answering.

## 3. Question & Guessing Area
The bottom section that appears when a guessing session activates.

- **Question Area** (`#question-area` / `.question-area`)
  - The glassmorphism box that holds the timing bar and answer choices.
- **Timing Bar** (`#timing-bar` / `.timing-bar`)
  - The horizontal bar that tracks your remaining time to answer (often confused with the global progress bar).
- **Timing Zones** (`.timing-zone-perfect`, `.timing-zone-great`, `.timing-zone-good`)
  - The colored sections inside the timing bar.
- **Timing Needle** (`#timing-needle` / `.timing-needle`)
  - The vertical white line that sweeps across the timing bar to indicate the exact moment the line starts.
- **Option Button** (`.option-btn`)
  - The interactive buttons for the 4 possible answers.
- **Option Text** (`.option-text`)
  - The specific text inside the option button (which expands when the correct answer is actively playing).
- **Keybind Badge** (`.keybind-badge`)
  - The small circle on the corner of the option button indicating the keyboard shortcut.

## 4. Overlays & Menus
- **Pause Menu** (`#pause-menu` / `.pause-menu`)
- **Settings Modal** (`#settings-modal` / `.settings-modal`)
- **Calibration Overlay** (`#calibration-overlay` / `.calibration-overlay`)
