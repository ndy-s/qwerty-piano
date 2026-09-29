# QWERTY Piano

A full 88-key piano you play with your keyboard. No audio libraries, no samples, every note is synthesized live with the Web Audio API.

## Why I Built This

I wanted to actually understand how sound works in the browser instead of dropping in a library. Turns out a piano is a good excuse: every note is just a frequency you can derive from math (12-tone equal temperament), and every "pluck" is an oscillator with a volume envelope. No mp3s, no soundfont, nothing to load. The whole instrument is under 6kb of TypeScript.

## What It Does

- **Full range**: all 88 keys, A0 to C8, laid out like a real piano.
- **Play by keyboard**: `A`–`K` are the white keys, `W E T Y U` are the black keys.
- **Move around**: `Z`/`X` or the on-screen +/− buttons shift which octave your keyboard row plays. Hold `Shift`/`Ctrl` to bump a single key up/down an octave without losing your place.
- **Play by mouse/touch**: click or tap any key directly; the piano scrolls to reach the rest.
- **Real envelope**: each note has an attack, decay, sustain, and release, not just an on/off beep.

## Getting Started

```bash
git clone https://github.com/ndy-s/qwerty-piano.git
cd qwerty-piano
npm install
npm run dev
```

Open the printed local URL and start playing.

```bash
npm run build     # production build
npm run preview   # preview the production build
```

## Console Demo

Open devtools and run:

```js
playSequence(jingleBells)
```

It plays a short public-domain melody through the same engine as the keyboard, useful as a reference for writing your own `{ note, duration }` sequences.

## Tech Stack

- **TypeScript**, no framework
- **Vite** for dev server + build
- **Web Audio API** for everything audio

## License

MIT
