import { truncateChars } from '../util/text';

export const EMBED_CONTENT_MAX_CHARS = 16_000; // ~4k tokens of body text (spec §6.2 embed)

export interface EmbeddingInputSource {
  title: string;
  rawContent: string | null | undefined;
}

export interface EmbeddingInputs {
  docText: string;
  titleText: string;
  bodyText: string;
}

export function buildEmbeddingInputs(item: EmbeddingInputSource): EmbeddingInputs {
  const bodyText = truncateChars(item.rawContent, EMBED_CONTENT_MAX_CHARS);
  return {
    docText: bodyText ? `${item.title}\n\n${bodyText}` : item.title,
    titleText: item.title,
    bodyText,
  };
}
