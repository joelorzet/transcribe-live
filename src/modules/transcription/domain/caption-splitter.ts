export const MAX_CAPTION_CHARS = 90;

const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+/;
const CLAUSE_BOUNDARY = /(?<=[,;:])\s+/;

export function splitIntoCaptions(text: string, maxChars = MAX_CAPTION_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const captions: string[] = [];
  for (const sentence of trimmed.split(SENTENCE_BOUNDARY)) {
    for (const piece of packPieces(splitLongPiece(sentence, maxChars), maxChars)) {
      captions.push(piece);
    }
  }
  return captions.filter((caption) => caption !== '');
}

function splitLongPiece(piece: string, maxChars: number): string[] {
  const trimmed = piece.trim();
  if (trimmed.length <= maxChars) return [trimmed];

  const byClause = trimmed.split(CLAUSE_BOUNDARY);
  if (byClause.length > 1) {
    return byClause.flatMap((clause) => splitLongPiece(clause, maxChars));
  }

  const words = trimmed.split(/\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length > maxChars && current !== '') {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

function packPieces(pieces: string[], maxChars: number): string[] {
  const packed: string[] = [];
  let current = '';

  for (const piece of pieces) {
    const candidate = current === '' ? piece : `${current} ${piece}`;
    if (candidate.length > maxChars && current !== '') {
      packed.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current !== '') packed.push(current);
  return packed;
}
