import { CharacterItem } from '../types';

export interface GlossarySection {
  name: string;
  items: CharacterItem[];
}

export interface ParsedGlossaryResult {
  totalItems: number;
  characters: CharacterItem[];
  sections: GlossarySection[];
}

/**
 * Parses user glossary text (like Glossary_46_db7e6eb0.txt) into CharacterItem[].
 * Supports sections: === CHARACTERS ===, === TERMS ===, === LOCATIONS ===, === SURNAMES ===, === TITLES ===
 * Formats:
 * - raw_name = translated_name [gender]: description
 * - raw_name = translated_name: description
 * - raw_name = translated_name [gender]
 * - raw_name = translated_name
 */
export function parseGlossaryContent(content: string): ParsedGlossaryResult {
  if (!content || !content.trim()) {
    return { totalItems: 0, characters: [], sections: [] };
  }

  const lines = content.split(/\r?\n/);
  const items: CharacterItem[] = [];
  const sectionsMap = new Map<string, CharacterItem[]>();

  let currentCategory = 'Nhân vật';
  let runningIndex = 1;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const rawLine = lines[lineIndex].trim();
    if (!rawLine) continue;

    // Skip preamble header if present
    if (rawLine.toLowerCase().startsWith('glossary columns:') || rawLine.startsWith('#')) {
      continue;
    }

    // Check for Section Header: === SECTION_NAME ===
    const sectionMatch = rawLine.match(/^===\s*([A-Za-z0-9_\s\u00C0-\u1EF9\-]+)\s*===$/i);
    if (sectionMatch) {
      const headerTitle = sectionMatch[1].trim().toUpperCase();
      if (headerTitle.includes('CHARACTER') || headerTitle.includes('NHÂN VẬT')) {
        currentCategory = 'Nhân vật';
      } else if (headerTitle.includes('TERM') || headerTitle.includes('THUẬT NGỮ')) {
        currentCategory = 'Thuật ngữ';
      } else if (headerTitle.includes('LOCATION') || headerTitle.includes('ĐỊA DANH')) {
        currentCategory = 'Địa danh';
      } else if (headerTitle.includes('SURNAME') || headerTitle.includes('HỌ')) {
        currentCategory = 'Họ';
      } else if (headerTitle.includes('TITLE') || headerTitle.includes('CHỨC DANH') || headerTitle.includes('TƯỚC VỊ')) {
        currentCategory = 'Chức danh';
      } else {
        currentCategory = sectionMatch[1].trim();
      }
      continue;
    }

    // Must contain "=" to separate raw_name and translated info
    if (!rawLine.includes('=')) {
      continue;
    }

    const equalPos = rawLine.indexOf('=');
    const rawName = rawLine.substring(0, equalPos).trim();
    const rightPart = rawLine.substring(equalPos + 1).trim();

    if (!rawName || !rightPart) continue;

    let translatedName = '';
    let gender = 'Chưa rõ';
    let description = '';

    // Check if there is a colon ":" separating name/gender and description
    let leftSide = rightPart;
    if (rightPart.includes(':')) {
      const colonPos = rightPart.indexOf(':');
      leftSide = rightPart.substring(0, colonPos).trim();
      description = rightPart.substring(colonPos + 1).trim();
    }

    // Check for [Gender] tag, e.g. [Male], [Female], [Nam], [Nữ]
    const genderMatch = leftSide.match(/\[([A-Za-z0-9_\s\u00C0-\u1EF9]+)\]/);
    if (genderMatch) {
      const gRaw = genderMatch[1].trim().toLowerCase();
      if (gRaw === 'male' || gRaw === 'nam') {
        gender = 'Nam';
      } else if (gRaw === 'female' || gRaw === 'nu' || gRaw === 'nữ') {
        gender = 'Nữ';
      } else if (gRaw.includes('linh thú') || gRaw.includes('thú')) {
        gender = 'Linh thú';
      } else {
        gender = genderMatch[1].trim();
      }
      // Remove [Gender] from translatedName
      translatedName = leftSide.replace(genderMatch[0], '').trim();
    } else {
      translatedName = leftSide.trim();

      // If category has intrinsic type, label gender or keep sensible default
      if (currentCategory === 'Thuật ngữ') {
        gender = 'Thuật ngữ';
      } else if (currentCategory === 'Địa danh') {
        gender = 'Địa danh';
      } else if (currentCategory === 'Họ') {
        gender = 'Họ';
      } else if (currentCategory === 'Chức danh') {
        gender = 'Chức danh';
      } else {
        gender = 'Chưa rõ';
      }
    }

    // Format note with category prefix if not already present
    let finalNote = description.trim();
    if (currentCategory === 'Thuật ngữ' && !finalNote.startsWith('[Thuật ngữ]')) {
      finalNote = finalNote ? `[Thuật ngữ] ${finalNote}` : '[Thuật ngữ]';
    } else if (currentCategory === 'Địa danh' && !finalNote.startsWith('[Địa danh]')) {
      finalNote = finalNote ? `[Địa danh] ${finalNote}` : '[Địa danh]';
    } else if (currentCategory === 'Họ' && !finalNote.startsWith('[Họ]')) {
      finalNote = finalNote ? `[Họ] ${finalNote}` : '[Họ người]';
    } else if (currentCategory === 'Chức danh' && !finalNote.startsWith('[Chức danh]')) {
      finalNote = finalNote ? `[Chức danh] ${finalNote}` : '[Chức danh]';
    }

    const item: CharacterItem = {
      id: `glossary-${runningIndex}-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      stt: runningIndex,
      chinese: rawName,
      hanViet: translatedName,
      gender,
      note: finalNote,
    };

    items.push(item);

    const secList = sectionsMap.get(currentCategory) || [];
    secList.push(item);
    sectionsMap.set(currentCategory, secList);

    runningIndex++;
  }

  const sections: GlossarySection[] = Array.from(sectionsMap.entries()).map(([name, secItems]) => ({
    name,
    items: secItems,
  }));

  return {
    totalItems: items.length,
    characters: items,
    sections,
  };
}

/**
 * Path to default bundled glossary asset
 */
export const DEFAULT_GLOSSARY_ASSET_PATH = '/assets/aistudio/Glossary_46_db7e6eb0.txt';
