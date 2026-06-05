// Generates short, pleasant sound effects as WAV files (run: `npm run gen-sounds`).
// Synthesized here so the app needs no external audio assets. Output: assets/sounds/.
import fs from 'node:fs';
import path from 'node:path';

const RATE = 44100;

// Additive sine tone with a short attack/decay envelope (avoids clicks).
function tone(freqs, dur, { attack = 0.006, release = 0.08, gain = 0.4 } = {}) {
  const n = Math.floor(RATE * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t);
    v /= freqs.length;
    let env = 1;
    if (t < attack) env = t / attack;
    const relStart = dur - release;
    if (t > relStart) env = Math.max(0, (dur - t) / release);
    out[i] = v * env * gain;
  }
  return out;
}

function seq(...parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE((s * 32767) | 0, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const sounds = {
  // soft tick when revealing the answer
  reveal: tone([880, 1320], 0.07, { gain: 0.2, release: 0.05 }),
  // "Novamente" — gentle descending, not harsh
  again: seq(tone([330], 0.07, { gain: 0.28 }), tone([247], 0.14, { gain: 0.28, release: 0.1 })),
  // "Difícil" — single neutral mid tone
  hard: tone([392], 0.13, { gain: 0.28 }),
  // "Bom" — pleasant rising third
  good: seq(tone([523], 0.08, { gain: 0.3 }), tone([659], 0.15, { gain: 0.3, release: 0.1 })),
  // "Fácil" — bright C–E–G arpeggio (most satisfying)
  easy: seq(
    tone([523], 0.06, { gain: 0.28 }),
    tone([659], 0.06, { gain: 0.28 }),
    tone([784], 0.17, { gain: 0.34, release: 0.12 })
  ),
};

const dir = path.join(process.cwd(), 'assets', 'sounds');
fs.mkdirSync(dir, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) {
  const file = path.join(dir, `${name}.wav`);
  fs.writeFileSync(file, toWav(samples));
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}
console.log('done');
