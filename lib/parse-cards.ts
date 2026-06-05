export type ParsedCard = { front: string; back: string };

// Parse pasted text into cards. Format: one card per line, "front | back".
// Tolerant: strips leading list markers (-, *, •, "1.") and ignores any line
// without a "|" (so stray prose/headers from an AI are skipped, not imported).
export function parseCards(text: string): ParsedCard[] {
  const out: ParsedCard[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, '');
    const idx = line.indexOf('|');
    if (idx === -1) continue;
    const front = line.slice(0, idx).trim();
    const back = line.slice(idx + 1).trim();
    if (front && back) out.push({ front, back });
  }
  return out;
}
