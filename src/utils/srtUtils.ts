import { StoryRow, MergedChunk, SubtitleMappingItem } from '../types';

/**
 * Standardize SRT timestamp into "HH:MM:SS,mmm" format.
 * Fixes period vs comma, ensures 2 digits for hours/minutes/seconds and 3 digits for milliseconds.
 */
export function normalizeSrtTimestamp(timeStr: string): string {
  if (!timeStr) return '00:00:00,000';
  const clean = timeStr.trim().replace('.', ',');
  const match = clean.match(/^(\d{1,2}):(\d{2}):(\d{2}),(\d{1,3})$/);
  if (!match) return clean;

  const hours = match[1].padStart(2, '0');
  const minutes = match[2].padStart(2, '0');
  const seconds = match[3].padStart(2, '0');
  const millis = match[4].padEnd(3, '0').slice(0, 3);

  return `${hours}:${minutes}:${seconds},${millis}`;
}

/**
 * Parses raw SRT file text into SubtitleMappingItem array.
 * Robust against BOM, Windows/Unix line endings, multi-line subtitles, and formatting quirks.
 */
export function parseSrtContent(content: string): SubtitleMappingItem[] {
  if (!content || !content.trim()) return [];

  // Remove UTF-8 BOM if present
  let normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into potential subtitle blocks
  // Subtitle blocks are separated by one or more blank lines
  const rawBlocks = normalized.split(/\n\s*\n+/);
  const items: SubtitleMappingItem[] = [];

  const timecodeRegex = /(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/;

  let runningIndex = 1;

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    let timecodeLineIndex = -1;
    let startTime = '';
    let endTime = '';

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(timecodeRegex);
      if (match) {
        timecodeLineIndex = i;
        startTime = normalizeSrtTimestamp(match[1]);
        endTime = normalizeSrtTimestamp(match[2]);
        break;
      }
    }

    if (timecodeLineIndex === -1 || !startTime || !endTime) {
      // If no valid timecode line found in block, skip or continue
      continue;
    }

    // Number index is usually the line right before timecode line
    let subtitleNumber = runningIndex;
    if (timecodeLineIndex > 0) {
      const parsedNum = parseInt(lines[timecodeLineIndex - 1].replace(/\D/g, ''), 10);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        subtitleNumber = parsedNum;
      }
    }

    // Subtitle text is all lines after the timecode line
    const textLines = lines.slice(timecodeLineIndex + 1);
    const subtitleText = textLines.join(' ').trim();

    if (!subtitleText) {
      // Keep empty subtitle or placeholder if present
      continue;
    }

    items.push({
      id: `srt-${runningIndex}-${Date.now()}`,
      index: runningIndex,
      startTime,
      endTime,
      originalText: subtitleText,
    });

    runningIndex++;
  }

  return items;
}

/**
 * Converts SubtitleMappingItem list to StoryRow list for compatibility
 */
export function srtSubtitlesToStoryRows(subtitles: SubtitleMappingItem[]): StoryRow[] {
  return subtitles.map((sub, idx) => ({
    id: sub.id || `row-${idx + 1}-${Date.now()}`,
    originalIndex: sub.index,
    chapter: `[${sub.startTime} --> ${sub.endTime}]`,
    content: sub.originalText,
    charCount: sub.originalText.length,
    startTime: sub.startTime,
    endTime: sub.endTime,
  }));
}

/**
 * Parse an uploaded SRT (.srt) file
 */
export async function parseSrtFile(file: File): Promise<{
  rows: StoryRow[];
  subtitles: SubtitleMappingItem[];
  fileName: string;
  totalChars: number;
}> {
  const text = await file.text();
  const subtitles = parseSrtContent(text);

  if (subtitles.length === 0) {
    throw new Error(
      'Không tìm thấy mốc thời gian phụ đề hợp lệ trong file SRT. Vui lòng kiểm tra định dạng file .srt (ví dụ: 00:00:01,000 --> 00:00:04,000).'
    );
  }

  const rows = srtSubtitlesToStoryRows(subtitles);
  const totalChars = rows.reduce((sum, r) => sum + r.charCount, 0);

  return {
    rows,
    subtitles,
    fileName: file.name,
    totalChars,
  };
}

/**
 * Convert SRT timestamp "HH:MM:SS,mmm" or "HH:MM:SS.mmm" to milliseconds.
 */
export function srtTimeToMilliseconds(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace('.', ',');
  const parts = clean.split(':');
  if (parts.length < 3) return 0;
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const secParts = parts[2].split(',');
  const seconds = parseInt(secParts[0], 10) || 0;
  const millis = parseInt((secParts[1] || '0').padEnd(3, '0').slice(0, 3), 10) || 0;
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
}

/**
 * Calculate duration in seconds between startTime and endTime.
 */
export function getSubtitleDurationInSeconds(startTime: string, endTime: string): number {
  const startMs = srtTimeToMilliseconds(startTime);
  const endMs = srtTimeToMilliseconds(endTime);
  const diffSec = Math.max(0, (endMs - startMs) / 1000);
  return Math.round(diffSec * 10) / 10;
}

/**
 * Merge SRT subtitles into chunks suitable for Gemini translation.
 * Defaults to 100 subtitles per chunk for optimal batch processing.
 * Formats each subtitle with a numbered tag [1] and duration only:
 * e.g. [1] ( 3.3s): <câu gốc>
 * so Gemini can accurately gauge dialogue pacing without wasting tokens on start/end timestamps.
 */
export function mergeSrtSubtitlesIntoChunks(
  subtitles: SubtitleMappingItem[],
  maxLinesPerChunk: number = 100,
  maxCharsPerChunk: number = 15000
): MergedChunk[] {
  if (!subtitles || subtitles.length === 0) return [];

  const chunks: MergedChunk[] = [];
  let currentSubs: SubtitleMappingItem[] = [];
  let currentChars = 0;
  let startRowIndex = 0;

  const finalizeCurrentChunk = (endRowIndex: number) => {
    if (currentSubs.length === 0) return;

    const firstSub = currentSubs[0];
    const lastSub = currentSubs[currentSubs.length - 1];

    // Format prompt content with numbered tags and duration only (token-saving format: [1] ( 3.3s): <câu gốc>)
    const formattedLines = currentSubs.map((sub, idx) => {
      const durationSec = getSubtitleDurationInSeconds(sub.startTime, sub.endTime);
      const durationStr = `${durationSec.toFixed(1)}s`;
      const subtitleId = sub.index || idx + 1;
      return `[${subtitleId}] ( ${durationStr}): ${sub.originalText}`;
    });
    const chunkContent = formattedLines.join('\n');

    const startLabel = firstSub.startTime.replace(/,000$/, '');
    const endLabel = lastSub.endTime.replace(/,000$/, '');
    const chapterLabel = `[${startLabel} → ${endLabel}] (Câu #${firstSub.index} - #${lastSub.index})`;

    chunks.push({
      id: `chunk-${chunks.length + 1}-${Date.now()}`,
      chunkIndex: chunks.length + 1,
      chapterLabel,
      startRowIndex,
      endRowIndex,
      content: chunkContent,
      charCount: chunkContent.length,
      subtitles: currentSubs.map((s) => ({ ...s })),
      status: 'idle',
    });

    currentSubs = [];
    currentChars = 0;
  };

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    const lineLen = sub.originalText.length + 45; // account for timestamp prefix

    const willExceedLines = currentSubs.length >= maxLinesPerChunk;
    const willExceedChars = currentSubs.length > 0 && currentChars + lineLen > maxCharsPerChunk;

    if (willExceedLines || willExceedChars) {
      finalizeCurrentChunk(i - 1);
      startRowIndex = i;
    }

    currentSubs.push(sub);
    currentChars += lineLen;
  }

  // Finalize remaining
  if (currentSubs.length > 0) {
    finalizeCurrentChunk(subtitles.length - 1);
  }

  return chunks;
}

/**
 * Extracts and maps AI translation response back to individual subtitle items.
 * Guaranteed to preserve exact start time, end time, and subtitle index.
 * Handles diverse AI response formats: [1], **[1]**, 1., 1), #1, Câu 1:, standard SRT blocks, or line-by-line.
/**
 * Computes affinity score between an original Chinese subtitle and a Vietnamese translated line
 * to align lines correctly without shifts even when AI skips lines or renumbers.
 */
function computeSubtitleAffinity(zhSub: SubtitleMappingItem, viText: string): number {
  let score = 0;
  const zh = (zhSub.originalText || '').trim();
  const vi = (viText || '').toLowerCase().trim();
  const lenZh = zh.length;
  const lenVi = viText.trim().length;

  // 1. Length ratio compatibility
  // Very short Chinese (<= 2 chars e.g. "查", "好", "走") must match short Vietnamese (<= 15 chars)
  if (lenZh <= 2) {
    if (lenVi <= 15) score += 8;
    else score -= 12; // Penalty for matching 1 Chinese character with a huge sentence
  } else if (lenZh >= 12) {
    if (lenVi >= 20) score += 6;
    else score -= 6;
  }

  // 2. Question / Exclamation mark compatibility
  const hasZhQuestion = /[吗？?呢]/.test(zh);
  const hasViQuestion = viText.includes('?');
  if (hasZhQuestion && hasViQuestion) score += 6;
  else if (hasZhQuestion && !hasViQuestion) score -= 3;

  const hasZhExclamation = /[！!]/.test(zh) || zh.startsWith('哼') || zh.startsWith('好') || zh === '查';
  const hasViExclamation = viText.includes('!') || vi.startsWith('hừ') || vi.startsWith('được');
  if (hasZhExclamation && hasViExclamation) score += 5;

  // 3. Keyword / Pronoun / Proper noun matching
  const keywordPairs: [RegExp, RegExp, number][] = [
    [/老夫/, /lão phu/, 10],
    [/大人/, /đại nhân/, 10],
    [/钱谦益|谦益/, /tiền khiêm ích|khiêm ích/, 15],
    [/沈廷章|沈廷|廷章/, /thẩm đình|đình chương|đình dương/, 15],
    [/江南/, /giang nam/, 12],
    [/火票/, /hỏa phiếu/, 12],
    [/查抄|抄家/, /tra án|tịch thu|sao gia/, 10],
    [/查/, /tra|xét/, 8],
    [/提|提出来/, /áp giải|dẫn ra|lôi ra/, 10],
    [/你/, /ngươi|anh|bạn|mày/, 3],
    [/他/, /hắn|nó|ông ấy/, 3],
    [/屁/, /rắm/, 10],
    [/哼/, /hừ/, 8],
    [/借/, /mượn/, 8],
    [/明白/, /hiểu|rõ/, 6],
    [/走/, /đi|mau/, 5],
  ];

  for (const [zhRe, viRe, weight] of keywordPairs) {
    const matchZh = zhRe.test(zh);
    const matchVi = viRe.test(vi);
    if (matchZh && matchVi) {
      score += weight;
    } else if (matchZh && !matchVi) {
      score -= 3;
    }
  }

  return score;
}

/**
 * Aligns a list of translated texts to subtitle items when line count is smaller than subtitle count.
 * Uses dynamic programming to find the optimal monotonic alignment so omitted lines leave empty gaps
 * without shifting subsequent lines.
 */
function alignExtractedTranslations(
  extractedTexts: string[],
  subtitles: SubtitleMappingItem[]
): Map<number, string> {
  const result = new Map<number, string>();
  const M = extractedTexts.length;
  const N = subtitles.length;

  if (M === 0 || N === 0) return result;

  // If counts match exactly, 1-to-1 sequential match
  if (M === N) {
    for (let i = 0; i < N; i++) {
      result.set(subtitles[i].index, extractedTexts[i]);
    }
    return result;
  }

  // If M > N, take first N
  if (M > N) {
    for (let i = 0; i < N; i++) {
      result.set(subtitles[i].index, extractedTexts[i]);
    }
    return result;
  }

  // When M < N: DP Matrix to find the optimal monotonic alignment
  // dp[i][j]: best alignment score of first i translations among first j subtitles
  const dp: number[][] = Array.from({ length: M + 1 }, () => Array(N + 1).fill(-Infinity));
  const choice: number[][] = Array.from({ length: M + 1 }, () => Array(N + 1).fill(0));

  dp[0].fill(0);

  for (let i = 1; i <= M; i++) {
    for (let j = i; j <= N - (M - i); j++) {
      // Option 1: subtitle j-1 is skipped
      let best = dp[i][j - 1];
      let bestChoice = 0; // skip j-1

      // Option 2: translation i-1 aligns to subtitle j-1
      const matchScore = dp[i - 1][j - 1] + computeSubtitleAffinity(subtitles[j - 1], extractedTexts[i - 1]);
      if (matchScore > best) {
        best = matchScore;
        bestChoice = 1; // match (i-1, j-1)
      }

      dp[i][j] = best;
      choice[i][j] = bestChoice;
    }
  }

  // Backtrack to recover optimal alignment
  let curI = M;
  let curJ = N;

  while (curI > 0 && curJ > 0) {
    if (choice[curI][curJ] === 1) {
      result.set(subtitles[curJ - 1].index, extractedTexts[curI - 1]);
      curI--;
      curJ--;
    } else {
      curJ--;
    }
  }

  return result;
}

/**
 * Extracts and maps AI translation response back to individual subtitle items.
 * Guaranteed to preserve exact start time, end time, and subtitle index.
 * Handles diverse AI response formats: [990], [#990], 990., standard SRT blocks, or line-by-line.
 * Prevents line shifting when AI drops sentences.
 */
export function mapAiResponseToSubtitles(
  rawResponse: string,
  chunkSubtitles: SubtitleMappingItem[]
): {
  updatedSubtitles: SubtitleMappingItem[];
  formattedTranslatedText: string;
} {
  if (!chunkSubtitles || chunkSubtitles.length === 0) {
    return {
      updatedSubtitles: [],
      formattedTranslatedText: rawResponse || '',
    };
  }

  const cleanResponse = (rawResponse || '').trim();
  if (!cleanResponse) {
    return {
      updatedSubtitles: chunkSubtitles.map((s) => ({ ...s, translatedText: '' })),
      formattedTranslatedText: '',
    };
  }

  // 1. Check if AI returned full standard SRT format (contains "-->")
  if (cleanResponse.includes('-->')) {
    const srtItems = parseSrtContent(cleanResponse);
    if (srtItems.length > 0) {
      const updatedSubtitles: SubtitleMappingItem[] = chunkSubtitles.map((orig, i) => {
        const matchingSrt = srtItems.find((s) => s.index === orig.index) || srtItems[i];
        const translated = matchingSrt ? matchingSrt.originalText.trim() : '';
        return {
          ...orig,
          translatedText: translated,
        };
      });

      const formattedLines = updatedSubtitles.map((sub, i) => {
        const text = sub.translatedText ? sub.translatedText : `[Chưa dịch] ${sub.originalText}`;
        return `[${sub.index || i + 1}] (${sub.startTime} --> ${sub.endTime})\n${text}`;
      });

      return {
        updatedSubtitles,
        formattedTranslatedText: formattedLines.join('\n\n'),
      };
    }
  }

  // 2. Parse lines with tag matching: [990], [#990], 990., etc.
  // Supports multi-line tags (where tag line has no text, and text is on the following line)
  const rawLines = cleanResponse.split(/\r?\n/).map((l) => l.trim());
  const parsedTaggedItems: { index: number; text: string }[] = [];
  const untaggedLines: string[] = [];

  let currentTagIndex: number | null = null;
  let currentAccumulatedText: string[] = [];

  const flushCurrentTag = () => {
    if (currentTagIndex !== null) {
      let cleanText = currentAccumulatedText.join(' ').trim();
      cleanText = cleanText.replace(/^[\*\_`"']+|[\*\_`"']+$/g, '').trim();

      if (cleanText.includes('->')) {
        const parts = cleanText.split('->');
        cleanText = parts[parts.length - 1].trim();
      } else if (cleanText.includes('=>')) {
        const parts = cleanText.split('=>');
        cleanText = parts[parts.length - 1].trim();
      }

      cleanText = cleanText
        .replace(/[\(\[]\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}(?:\s*\|\s*[\d\.]+s)?\s*[\)\]][\:\-\—\s]*/g, '')
        .replace(/\(\s*[\d\.]+s\s*\)[\:\-\—\s]*/g, '')
        .replace(/^[\:\-\—\s]+/, '')
        .trim();

      parsedTaggedItems.push({
        index: currentTagIndex,
        text: cleanText,
      });

      currentTagIndex = null;
      currentAccumulatedText = [];
    }
  };

  for (const line of rawLines) {
    if (!line || line.startsWith('```') || line.startsWith('---')) continue;

    // Check if line starts with a tag like [990], [#990], **[990]**, 990., etc.
    const tagMatch =
      line.match(/^(?:\[\s*#?|\*\*\[\s*#?|#)(\d+)(?:\]|\*\*\])?[\s\:\.\-—\)](.*)$/) ||
      line.match(/^(?:câu|cau|line|sub|subtitle|dòng)\s*#?\s*(\d+)[\s\:\.\-—\)](.*)$/i) ||
      line.match(/^(\d+)[\.\)\:\-—]\s+(.*)$/);

    if (tagMatch) {
      flushCurrentTag();
      const num = parseInt(tagMatch[1], 10);
      let rest = (tagMatch[2] || '').trim();

      // Clean timecode if repeated in tag line e.g. (05:52:38,433 --> 05:52:41,233 | 2.8s):
      rest = rest
        .replace(/[\(\[]\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3}(?:\s*\|\s*[\d\.]+s)?\s*[\)\]][\:\-\—\s]*/g, '')
        .replace(/\(\s*[\d\.]+s\s*\)[\:\-\—\s]*/g, '')
        .replace(/^[\:\-\—\s]+/, '')
        .trim();

      currentTagIndex = num;
      if (rest) {
        currentAccumulatedText.push(rest);
      }
    } else {
      if (currentTagIndex !== null) {
        currentAccumulatedText.push(line);
      } else {
        const lower = line.toLowerCase();
        if (
          !lower.startsWith('dưới đây là') &&
          !lower.startsWith('bản dịch:') &&
          !lower.startsWith('here is') &&
          !lower.startsWith('note:') &&
          !lower.startsWith('chúc bạn')
        ) {
          untaggedLines.push(line);
        }
      }
    }
  }
  flushCurrentTag();

  // Map to hold subtitle.index -> translated text
  const finalTranslationsMap = new Map<number, string>();

  // Determine if parsed tags match global subtitle indices
  const chunkIndexSet = new Set(chunkSubtitles.map((s) => s.index));
  let globalMatchesCount = 0;
  let localMatchesCount = 0;

  parsedTaggedItems.forEach((item) => {
    if (chunkIndexSet.has(item.index)) {
      globalMatchesCount++;
    }
    if (item.index >= 1 && item.index <= chunkSubtitles.length) {
      localMatchesCount++;
    }
  });

  const useGlobalTags = globalMatchesCount > 0 && globalMatchesCount >= localMatchesCount;

  if (useGlobalTags) {
    // 100% PRECISE GLOBAL TAG MATCH:
    // Subtitles are mapped directly to their exact index (e.g. 990 -> 990, 993 -> 993).
    // Omitted lines remain empty and are NEVER overwritten or shifted!
    parsedTaggedItems.forEach((item) => {
      if (chunkIndexSet.has(item.index)) {
        finalTranslationsMap.set(item.index, item.text);
      }
    });
  } else if (parsedTaggedItems.length > 0) {
    // Tags are local (1..M):
    const extractedTexts = parsedTaggedItems.map((p) => p.text);
    if (extractedTexts.length === chunkSubtitles.length) {
      // 1-to-1 match
      chunkSubtitles.forEach((s, idx) => {
        finalTranslationsMap.set(s.index, extractedTexts[idx]);
      });
    } else {
      // Line count mismatch (e.g. AI dropped 3 lines and renumbered 1..8):
      // Use semantic affinity & length alignment to lock each line to its true subtitle!
      const aligned = alignExtractedTranslations(extractedTexts, chunkSubtitles);
      aligned.forEach((val, key) => finalTranslationsMap.set(key, val));
    }
  } else if (untaggedLines.length > 0) {
    // No tags found: use sequential alignment
    const aligned = alignExtractedTranslations(untaggedLines, chunkSubtitles);
    aligned.forEach((val, key) => finalTranslationsMap.set(key, val));
  }

  // Build updatedSubtitles with clean text and no shifting
  const updatedSubtitles: SubtitleMappingItem[] = chunkSubtitles.map((orig) => {
    let translated = finalTranslationsMap.get(orig.index) || '';
    translated = translated.replace(/^\[\s*#?\d+\s*\][\s\:\.\-]*/, '').trim();

    return {
      ...orig,
      translatedText: translated,
    };
  });

  // Build formatted text preview for user inspection & modal editing
  const formattedLines = updatedSubtitles.map((sub, i) => {
    const text = sub.translatedText ? sub.translatedText : `[Chưa dịch] ${sub.originalText}`;
    return `[${sub.index || i + 1}] (${sub.startTime} --> ${sub.endTime})\n${text}`;
  });

  return {
    updatedSubtitles,
    formattedTranslatedText: formattedLines.join('\n\n'),
  };
}

/**
 * Trigger file download helper
 */
function triggerFileDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      // ignore
    }
  }, 2000);
}

/**
 * Export translated subtitles to standard .SRT format.
 * TIME ACCURACY GUARANTEE:
 * Timestamps (startTime --> endTime) are taken DIRECTLY from the original parsed SRT items,
 * completely independent of AI, ensuring 100.0% accurate timestamps down to the millisecond.
 *
 * CRITICAL FAILSAFE:
 * If a chunk's status is 'done' or has translatedText, but individual subtitles were not yet mapped,
 * this function automatically maps and extracts the translations on the fly, preventing empty/old exports!
 */
export function exportTranslatedToSrt(
  chunks: MergedChunk[],
  originalRows: StoryRow[],
  fileName: string = 'PhuDe_Dich_TiengViet',
  options?: {
    bilingual?: boolean;
    onlyCompleted?: boolean;
  }
): { success: boolean; count: number; downloadFileName: string; translatedCount: number } {
  const bilingual = options?.bilingual === true;
  const onlyCompleted = options?.onlyCompleted === true;

  // Collect all subtitles from chunks
  const allSubtitles: SubtitleMappingItem[] = [];

  // Check if chunks exist
  if (chunks && chunks.length > 0) {
    chunks.forEach((c) => {
      if (onlyCompleted && c.status !== 'done') {
        return;
      }

      let chunkSubs: SubtitleMappingItem[] = [];

      if (c.subtitles && c.subtitles.length > 0) {
        chunkSubs = c.subtitles.map((s) => ({ ...s }));
      } else if (originalRows && originalRows.length > 0) {
        // Reconstruct from originalRows for this chunk's slice
        const start = c.startRowIndex;
        const end = c.endRowIndex;
        const sliced = originalRows.slice(start, end + 1);
        chunkSubs = sliced.map((r, idx) => ({
          id: r.id,
          index: r.originalIndex || start + idx + 1,
          startTime: r.startTime || '00:00:00,000',
          endTime: r.endTime || '00:00:03,000',
          originalText: r.content,
          translatedText: '',
        }));
      }

      // FAILSAFE CHECK:
      // If the chunk has translatedText and was translated,
      // verify if chunkSubs actually has non-empty translatedText.
      // If not, dynamically extract it using mapAiResponseToSubtitles!
      const hasAnyTranslatedSub = chunkSubs.some(
        (s) => s.translatedText && s.translatedText.trim().length > 0
      );

      if (!hasAnyTranslatedSub && c.translatedText && c.translatedText.trim().length > 0) {
        const mapping = mapAiResponseToSubtitles(c.translatedText, chunkSubs);
        chunkSubs = mapping.updatedSubtitles;
      }

      chunkSubs.forEach((s) => allSubtitles.push(s));
    });
  } else if (originalRows.length > 0) {
    // Fallback: build directly from original rows
    originalRows.forEach((r, idx) => {
      allSubtitles.push({
        id: r.id,
        index: r.originalIndex || idx + 1,
        startTime: r.startTime || '00:00:00,000',
        endTime: r.endTime || '00:00:03,000',
        originalText: r.content,
        translatedText: '',
      });
    });
  }

  if (allSubtitles.length === 0) {
    throw new Error('Không có dữ liệu phụ đề nào để xuất file SRT.');
  }

  // Sort chronologically by original index
  allSubtitles.sort((a, b) => a.index - b.index);

  let srtOutput = '';
  let translatedCount = 0;

  allSubtitles.forEach((item, idx) => {
    const srtIndex = idx + 1;
    const timecode = `${item.startTime} --> ${item.endTime}`;
    const translated = (item.translatedText || '').trim();
    const original = (item.originalText || '').trim();

    if (translated) {
      translatedCount++;
    }

    let textContent = '';
    if (bilingual) {
      // Line 1: Vietnamese translation, Line 2: Original source text
      textContent = translated ? `${translated}\n${original}` : original;
    } else {
      // Export translated text if available, otherwise original text
      textContent = translated || original;
    }

    srtOutput += `${srtIndex}\n${timecode}\n${textContent}\n\n`;
  });

  // Prepend UTF-8 BOM (\uFEFF) to guarantee proper Vietnamese unicode rendering
  // in all media players and video editing software (Premiere, CapCut, DaVinci, Aegisub, VLC)
  const blob = new Blob(['\uFEFF' + srtOutput.trim() + '\n'], {
    type: 'text/plain;charset=utf-8;',
  });

  const safeName = (fileName || 'PhuDe_Dich')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-\u00C0-\u1EF9]/g, '_')
    .trim();

  const suffix = bilingual ? '_SongNgu.srt' : '_Dich_TiengViet.srt';
  const downloadFileName = `${safeName || 'PhuDe'}${suffix}`;

  triggerFileDownload(blob, downloadFileName);

  return {
    success: true,
    count: allSubtitles.length,
    downloadFileName,
    translatedCount,
  };
}

/**
 * Sample SRT subtitle data for immediate testing
 */
export const SAMPLE_SRT_CONTENT = `1
00:00:01,200 --> 00:00:04,500
常青缓缓睁开双眼，看着周围熟悉的陈设。

2
00:00:04,800 --> 00:00:08,200
九天十地的青帝，竟然真的重生在常家了。

3
00:00:08,500 --> 00:00:12,100
“这一世，我绝不会让当年的悲剧重演。”

4
00:00:12,400 --> 00:00:15,600
门外忽然传来了急促的脚步声。

5
00:00:15,900 --> 00:00:19,800
苏念雪推门而入，眼神复杂地看着常青。

6
00:00:20,100 --> 00:00:23,700
“常青，听说你刚才在演武场昏倒了？”

7
00:00:24,000 --> 00:00:27,500
常青淡然一笑：“无妨，只是偶有所感而已。”

8
00:00:27,800 --> 00:00:32,000
苏念雪心中暗惊，眼前的少年似乎多了一种说不出的威严。

9
00:00:32,300 --> 00:00:36,100
“林家的人已经到了前厅，这次他们是来退婚的。”

10
00:00:36,400 --> 00:00:40,500
常青眼中掠过一丝冷意：“退婚？正好，我也正有此意。”

11
00:00:40,800 --> 00:00:44,900
两人并肩走向常家议事大厅。

12
00:00:45,200 --> 00:00:49,300
大厅内，林家大长老林剑行神色倨傲。

13
00:00:49,600 --> 00:00:54,200
“常老家主，令孙常青资质平平，恐难配我家天骄。”

14
00:00:54,500 --> 00:00:58,800
林无双站在一旁，嘴角噙着一抹讥诮。

15
00:00:59,100 --> 00:01:03,400
常青迈步踏入大厅，朗声道：“林长老此言差矣。”

16
00:01:03,700 --> 00:01:08,200
“不是你林家退婚，而是我常青休妻！”

17
00:01:08,500 --> 00:01:12,600
话音未落，全场瞬间陷入一片死寂。

18
00:01:12,900 --> 00:01:17,100
林剑行拍案而起：“放肆！区区黄口小儿，安敢狂妄！”

19
00:01:17,400 --> 00:01:21,500
恐怖的金丹期威压铺天盖地般向常青碾压而来。

20
00:01:21,800 --> 00:01:26,000
常青面不改色，衣袍无风自动。

21
00:01:26,300 --> 00:01:30,700
他体内沉睡的青帝剑意微微一震，瞬间化解了漫天气势。

22
00:01:31,000 --> 00:01:35,200
林剑行脸色骤变，连退三步，眼中写满了难以置信。

23
00:01:35,500 --> 00:01:39,800
“你……你到底是什么人？！”

24
00:01:40,100 --> 00:01:44,500
常青负手而立：“林家，今日之辱，来日定当奉还。”

25
00:01:44,800 --> 00:01:49,200
苏念雪看着常青挺拔的背影，美眸中泛起异彩。
`;
