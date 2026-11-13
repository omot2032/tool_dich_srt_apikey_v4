import { CharacterItem } from '../types';

// Default characters list is EMPTY for new projects as requested by the user.
export const INITIAL_CHARACTERS: CharacterItem[] = [];

export function formatCharactersForPrompt(characters: CharacterItem[]): string {
  if (!characters || characters.length === 0) {
    return '(Đoạn này không phát hiện nhân vật hoặc thuật ngữ cụ thể nào trong bảng từ điển. Hãy dịch tự nhiên, giữ tính nhất quán xưng hô và tên riêng theo ngữ cảnh.)';
  }
  const rows = characters.map(
    (c, idx) => `${idx + 1}\t${c.chinese || '-'}\t${c.hanViet || '-'}\t${c.gender || 'Chưa rõ'}\t${c.note || '-'}`
  );
  return `STT\tTên Hán / Thuật ngữ gốc\tTên Hán Việt / Bản dịch chuẩn\tPhân loại / Giới tính\tGhi chú / Thân phận / Giải nghĩa\n` + rows.join('\n');
}

/**
 * Trích xuất CHỈ những nhân vật và thuật ngữ thực sự xuất hiện trong đoạn truyện/phụ đề cần dịch.
 * Tuyệt đối không lấy hết tất cả, giúp tiết kiệm tối đa token, tăng tốc độ dịch
 * và tránh việc AI nhầm lẫn danh xưng với những nhân vật không hề có mặt trong phân cảnh.
 */
export function extractRelevantCharacters(
  content: string,
  allCharacters: CharacterItem[]
): CharacterItem[] {
  if (!content || !allCharacters || allCharacters.length === 0) {
    return [];
  }

  const contentClean = content.trim();
  if (!contentClean) return [];

  const matched: CharacterItem[] = [];

  for (const char of allCharacters) {
    let isMatched = false;

    // 1. Kiểm tra tên tiếng Trung / Chữ Hán (kể cả biến thể phân cách bởi / , ;)
    if (char.chinese && char.chinese.trim()) {
      const rawVariants = char.chinese
        .split(/[/,;|\n\r\\+]+/)
        .map((v) => v.replace(/[.…]/g, '').trim())
        .filter((v) => v.length > 0);

      for (const variant of rawVariants) {
        if (contentClean.includes(variant)) {
          isMatched = true;
          break;
        }
      }
    }

    // 2. Kiểm tra tên Hán Việt (nếu chưa khớp từ tiếng Trung)
    if (!isMatched && char.hanViet && char.hanViet.trim()) {
      // Tách các tên riêng hoặc bí danh nếu có dấu phẩy, gạch chéo, ngoặc đơn:
      // Ví dụ: "Thường Thanh" -> ["Thường Thanh"]
      // "Giang Hợp (Trương Hợp)" -> ["Giang Hợp", "Trương Hợp"]
      // "Liễu Như Yên, Trần Vũ Đồng..." -> ["Liễu Như Yên", "Trần Vũ Đồng"]
      const nameParts = char.hanViet
        .split(/[,/;\n\r\(\)（）\\[\\]{}|]+/)
        .map((p) => p.replace(/[.…]/g, '').trim())
        .filter((p) => p.length >= 2);

      for (const nameCandidate of nameParts) {
        try {
          const escaped = nameCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
          if (regex.test(contentClean)) {
            isMatched = true;
            break;
          }
        } catch {
          if (contentClean.toLowerCase().includes(nameCandidate.toLowerCase())) {
            isMatched = true;
            break;
          }
        }
      }
    }

    // 3. Kiểm tra các biệt hiệu, đạo hiệu đặc biệt trong phần Ghi chú (nếu có)
    if (!isMatched && char.note && char.note.trim()) {
      // Trích xuất từ dấu ngoặc kép: ví dụ "Hỗ"
      const quotedTitles = char.note.match(/["“]([^"”]+)["”]/g);
      if (quotedTitles) {
        for (const q of quotedTitles) {
          const cleanTitle = q.replace(/["“”]/g, '').trim();
          if (cleanTitle.length >= 2 && contentClean.toLowerCase().includes(cleanTitle.toLowerCase())) {
            isMatched = true;
            break;
          }
        }
      }

      // Trích xuất danh xưng đặc thù (ví dụ: Tửu Kiếm Tiên, Họa Trung Tiên)
      if (!isMatched) {
        const notePhrases = char.note.split(/[,;]+/).map((s) => s.trim());
        for (const phrase of notePhrases) {
          if (
            phrase.length >= 4 &&
            phrase.length <= 25 &&
            !phrase.toLowerCase().includes('người') &&
            !phrase.toLowerCase().includes('sau') &&
            !phrase.toLowerCase().includes('bị') &&
            !phrase.toLowerCase().includes('thê tử')
          ) {
            try {
              const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
              if (regex.test(contentClean)) {
                isMatched = true;
                break;
              }
            } catch {
              if (contentClean.toLowerCase().includes(phrase.toLowerCase())) {
                isMatched = true;
                break;
              }
            }
          }
        }
      }
    }

    if (isMatched) {
      matched.push(char);
    }
  }

  return matched;
}
