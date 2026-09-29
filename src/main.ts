import "./style.css";

// ---------------------------------------------------------------------------
// Frequencies (12-tone equal temperament)
// ---------------------------------------------------------------------------

const A4_FREQUENCY = 440;
const NOTE_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteToFrequency(note: string): number {
  const match = /^([A-G]#?)(\d)$/.exec(note);
  if (!match) throw new Error(`Invalid note name: ${note}`);
  const [, pitchClass, octaveStr] = match;
  const semitonesFromA4 =
    NOTE_ORDER.indexOf(pitchClass) - NOTE_ORDER.indexOf("A") + (Number(octaveStr) - 4) * 12;
  return A4_FREQUENCY * 2 ** (semitonesFromA4 / 12);
}

// ---------------------------------------------------------------------------
// Piano range + keyboard mapping
// ---------------------------------------------------------------------------

// Full 88-key range, same as a real piano.
const PIANO_FIRST_NOTE = "A0";
const PIANO_LAST_NOTE = "C8";

interface BlackKeySpec {
  note: string;
  afterWhiteIndex: number;
}

function buildPianoKeys(): { whiteNotes: string[]; blackKeys: BlackKeySpec[] } {
  const allNotes: string[] = [];
  for (let octave = 0; octave <= 8; octave++) {
    for (const pitchClass of NOTE_ORDER) allNotes.push(`${pitchClass}${octave}`);
  }
  const range = allNotes.slice(
    allNotes.indexOf(PIANO_FIRST_NOTE),
    allNotes.indexOf(PIANO_LAST_NOTE) + 1,
  );

  const whiteNotes: string[] = [];
  const blackKeys: BlackKeySpec[] = [];
  for (const note of range) {
    if (note.includes("#")) {
      blackKeys.push({ note, afterWhiteIndex: whiteNotes.length - 1 });
    } else {
      whiteNotes.push(note);
    }
  }
  return { whiteNotes, blackKeys };
}

const { whiteNotes: PIANO_WHITE_NOTES, blackKeys: PIANO_BLACK_KEYS } = buildPianoKeys();

// QWERTY key -> pitch class + octave offset from the current base octave.
const KEY_DEGREES: Record<string, { pitchClass: string; octaveOffset: number }> = {
  a: { pitchClass: "C", octaveOffset: 0 },
  s: { pitchClass: "D", octaveOffset: 0 },
  d: { pitchClass: "E", octaveOffset: 0 },
  f: { pitchClass: "F", octaveOffset: 0 },
  g: { pitchClass: "G", octaveOffset: 0 },
  h: { pitchClass: "A", octaveOffset: 0 },
  j: { pitchClass: "B", octaveOffset: 0 },
  k: { pitchClass: "C", octaveOffset: 1 },
  w: { pitchClass: "C#", octaveOffset: 0 },
  e: { pitchClass: "D#", octaveOffset: 0 },
  t: { pitchClass: "F#", octaveOffset: 0 },
  y: { pitchClass: "G#", octaveOffset: 0 },
  u: { pitchClass: "A#", octaveOffset: 0 },
};

// The octave the QWERTY row currently plays. Clamped so `k` never passes C8
// and `a` never drops below the piano's lowest full octave.
let baseOctave = 4;
const MIN_BASE_OCTAVE = 1;
const MAX_BASE_OCTAVE = 7;

// `octaveShift` comes from the modifier keys: +1 while Shift is held, -1
// while Ctrl is held.
function noteForPhysicalKey(key: string, octaveShift = 0): string | undefined {
  const degree = KEY_DEGREES[key];
  if (!degree) return undefined;
  return `${degree.pitchClass}${baseOctave + degree.octaveOffset + octaveShift}`;
}

// ---------------------------------------------------------------------------
// Audio engine
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

// ADSR envelope. Times are in seconds; `sustainLevel`/`peakGain` are gain
// multipliers (0-1).
const ENVELOPE = {
  attackTime: 0.01,
  decayTime: 0.15,
  sustainLevel: 0.4,
  releaseTime: 0.15,
  peakGain: 0.5,
};

interface VoiceHandle {
  oscillator: OscillatorNode;
  gain: GainNode;
}

const activeVoices = new Map<string, VoiceHandle>();

function noteOn(note: string): void {
  if (activeVoices.has(note)) return;

  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.value = noteToFrequency(note);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();

  const attackEnd = ctx.currentTime + ENVELOPE.attackTime;
  gain.gain.linearRampToValueAtTime(ENVELOPE.peakGain, attackEnd);
  // exponentialRamp can't target 0, but the sustain level is always > 0.
  gain.gain.exponentialRampToValueAtTime(
    ENVELOPE.peakGain * ENVELOPE.sustainLevel,
    attackEnd + ENVELOPE.decayTime,
  );

  activeVoices.set(note, { oscillator, gain });
}

function noteOff(note: string): void {
  const voice = activeVoices.get(note);
  if (!voice) return;
  activeVoices.delete(note);

  const ctx = getAudioContext();
  const { oscillator, gain } = voice;

  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + ENVELOPE.releaseTime);

  oscillator.stop(ctx.currentTime + ENVELOPE.releaseTime + 0.02);
  oscillator.addEventListener("ended", () => {
    oscillator.disconnect();
    gain.disconnect();
  });
}

// ---------------------------------------------------------------------------
// On-screen keyboard
// ---------------------------------------------------------------------------

const WHITE_KEY_WIDTH_PX = 42;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>QWERTY Piano</h1>
  <div class="controls">
    <button id="octave-down" aria-label="Octave down">−</button>
    <p id="octave-indicator"></p>
    <button id="octave-up" aria-label="Octave up">+</button>
  </div>
  <div class="piano-wrapper">
    <div class="piano" id="piano"></div>
  </div>
`;

const pianoWrapperEl = document.querySelector<HTMLDivElement>(".piano-wrapper")!;
const pianoEl = document.querySelector<HTMLDivElement>("#piano")!;
const keyElements = new Map<string, HTMLElement>();

// Which QWERTY key currently plays `note`, if any (used to label keys).
function physicalKeyForNote(note: string): string | undefined {
  for (const [key, { pitchClass, octaveOffset }] of Object.entries(KEY_DEGREES)) {
    if (`${pitchClass}${baseOctave + octaveOffset}` === note) return key.toUpperCase();
  }
  return undefined;
}

// Pointer events cover mouse and touch with one code path.
function makePlayable(el: HTMLElement, note: string): void {
  const start = (event: PointerEvent) => {
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    noteOn(note);
    setKeyVisual(note, true);
  };
  const stop = () => {
    noteOff(note);
    setKeyVisual(note, false);
  };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("pointerleave", (event) => {
    if ((event as PointerEvent).buttons > 0) stop();
  });
}

for (const note of PIANO_WHITE_NOTES) {
  const el = document.createElement("div");
  el.className = "white-key";
  pianoEl.appendChild(el);
  keyElements.set(note, el);
  makePlayable(el, note);
}
pianoEl.style.width = `${PIANO_WHITE_NOTES.length * WHITE_KEY_WIDTH_PX}px`;

const whiteKeyEls = Array.from(pianoEl.querySelectorAll<HTMLElement>(".white-key"));

// Black keys sit centered on the boundary between the white key they follow
// and the next one, measured from the rendered layout.
for (const { note, afterWhiteIndex } of PIANO_BLACK_KEYS) {
  const el = document.createElement("div");
  el.className = "black-key";
  pianoEl.appendChild(el);
  keyElements.set(note, el);
  makePlayable(el, note);

  const leftWhiteKey = whiteKeyEls[afterWhiteIndex];
  const boundaryX = leftWhiteKey.offsetLeft + leftWhiteKey.offsetWidth;
  el.style.left = `${boundaryX - el.offsetWidth / 2}px`;
}

function setKeyVisual(note: string, active: boolean): void {
  keyElements.get(note)?.classList.toggle("active", active);
}

function refreshKeyLabels(): void {
  for (const [note, el] of keyElements) {
    const shortcut = physicalKeyForNote(note);
    el.innerHTML = `<span class="key-label">${note}${shortcut ? `<br>${shortcut}` : ""}</span>`;
  }
  document.querySelector<HTMLElement>("#octave-indicator")!.textContent =
    `Row plays octave ${baseOctave}`;
}
refreshKeyLabels();

function scrollToBaseOctave(): void {
  keyElements
    .get(`C${baseOctave}`)
    ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
}
scrollToBaseOctave();

function shiftOctave(direction: -1 | 1): void {
  baseOctave = Math.min(MAX_BASE_OCTAVE, Math.max(MIN_BASE_OCTAVE, baseOctave + direction));
  refreshKeyLabels();
  scrollToBaseOctave();
}

document.querySelector("#octave-down")!.addEventListener("click", () => shiftOctave(-1));
document.querySelector("#octave-up")!.addEventListener("click", () => shiftOctave(1));

// Scroll the piano horizontally on plain wheel, so reaching any of the 88
// keys doesn't require holding Shift.
pianoWrapperEl.addEventListener(
  "wheel",
  (event) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    pianoWrapperEl.scrollLeft += event.deltaY;
  },
  { passive: false },
);

// ---------------------------------------------------------------------------
// Keyboard input
// ---------------------------------------------------------------------------

// Remembers which note each physical key started, so an octave shift
// mid-hold can't strand a note on release.
const pressedKeys = new Map<string, string>();

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();

  if (key === "z" || key === "x") {
    shiftOctave(key === "z" ? -1 : 1);
    return;
  }

  const note = noteForPhysicalKey(key, (event.shiftKey ? 1 : 0) - (event.ctrlKey ? 1 : 0));
  if (!note || pressedKeys.has(key)) return;
  event.preventDefault();

  pressedKeys.set(key, note);
  noteOn(note);
  setKeyVisual(note, true);
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  const note = pressedKeys.get(key);
  if (!note) return;

  pressedKeys.delete(key);
  noteOff(note);
  setKeyVisual(note, false);
});

// ---------------------------------------------------------------------------
// Demo mode (console-only)
// ---------------------------------------------------------------------------

interface SequenceNote {
  note: string;
  duration: number; // milliseconds
}

function playSequence(notes: SequenceNote[]): void {
  let elapsed = 0;
  for (const { note, duration } of notes) {
    const startAt = elapsed;
    const stopAt = elapsed + duration * 0.9;

    setTimeout(() => {
      noteOn(note);
      setKeyVisual(note, true);
    }, startAt);
    setTimeout(() => {
      noteOff(note);
      setKeyVisual(note, false);
    }, stopAt);

    elapsed += duration;
  }
}

// "Jingle Bells" (James Lord Pierpont, 1857, public domain).
const jingleBells: SequenceNote[] = [
  { note: "E4", duration: 300 },
  { note: "E4", duration: 300 },
  { note: "E4", duration: 600 },
  { note: "E4", duration: 300 },
  { note: "E4", duration: 300 },
  { note: "E4", duration: 600 },
  { note: "E4", duration: 300 },
  { note: "G4", duration: 300 },
  { note: "C4", duration: 300 },
  { note: "D4", duration: 300 },
  { note: "E4", duration: 900 },
  { note: "F4", duration: 300 },
  { note: "F4", duration: 300 },
  { note: "F4", duration: 300 },
  { note: "F4", duration: 300 },
  { note: "F4", duration: 300 },
  { note: "E4", duration: 300 },
  { note: "E4", duration: 300 },
  { note: "E4", duration: 300 },
  { note: "E4", duration: 300 },
  { note: "D4", duration: 300 },
  { note: "D4", duration: 300 },
  { note: "E4", duration: 300 },
  { note: "D4", duration: 600 },
  { note: "G4", duration: 900 },
];

declare global {
  interface Window {
    playSequence: typeof playSequence;
    jingleBells: SequenceNote[];
  }
}
window.playSequence = playSequence;
window.jingleBells = jingleBells;
