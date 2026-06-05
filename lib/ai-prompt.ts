// The prompt the user copies into another AI. The AI's output is pasted back
// into the import screen and parsed by parseCards (one card per line, "front | back").
export const CARD_PROMPT = `You are a flashcard generator for spaced repetition. I will give you a TEXT. Generate atomic flashcards from it.

OUTPUT RULES (follow strictly):
- One flashcard per line, in the EXACT format: front | back
- Use the | (vertical bar) character to separate the front from the back.
- DO NOT number, DO NOT use bullet points, DO NOT use markdown, DO NOT write titles or any text outside of the card lines.
- The front is a short question or concept; the back is the answer, as concise as possible (keywords, not long sentences).
- Atomic: each card covers ONE single fact. Break compound ideas into multiple cards.
- Write in the same language as the text. Avoid ambiguous or redundant cards.
- Generate as many cards as the text allows (from 1 to dozens).

EXAMPLE of valid output:
Capital of Japan | Tokyo
Who wrote Hamlet | William Shakespeare
Function of the mitochondrion | Produce the cell's energy (ATP)

TEXT:
"""
<paste here the text you want to turn into cards>
"""`;
