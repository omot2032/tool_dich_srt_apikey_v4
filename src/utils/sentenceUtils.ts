/**
 * Tiện ích trích xuất câu đầu - câu cuối và so sánh độ tương đồng giữa các bản dịch
 */

// Phân tách văn bản tiếng Trung thành danh sách các câu
export function splitChineseSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  // Tách theo các dấu kết thúc câu tiếng Trung: 。！？!?\n
  // Giữ lại dấu ngoặc đóng nếu có liền kề
  const rawSegments = text
    .split(/([。！？!?\n]+[”’」』》）]*)/g)
    .filter(Boolean);

  const sentences: string[] = [];
  let current = '';

  for (const seg of rawSegments) {
    current += seg;
    if (/[。！？!?\n]/.test(seg)) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        sentences.push(trimmed);
      }
      current = '';
    }
  }

  if (current.trim().length > 0) {
    sentences.push(current.trim());
  }

  return sentences.filter((s) => s.length > 0);
}

// Phân tách văn bản tiếng Việt thành danh sách các câu
export function splitVietnameseSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  // Tách theo các dấu kết thúc câu tiếng Việt: . ! ? … \n
  const rawSegments = text
    .split(/([.!?…\n]+[”’"'\)\]]*\s*)/g)
    .filter(Boolean);

  const sentences: string[] = [];
  let current = '';

  for (const seg of rawSegments) {
    current += seg;
    if (/[.!?…\n]/.test(seg)) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        sentences.push(trimmed);
      }
      current = '';
    }
  }

  if (current.trim().length > 0) {
    sentences.push(current.trim());
  }

  return sentences.filter((s) => s.length > 0);
}

// Trích xuất câu đầu và câu cuối từ văn bản
export function extractBoundarySentences(
  content: string,
  translatedText?: string
): {
  firstChinese: string;
  lastChinese: string;
  firstPrevTranslation: string;
  lastPrevTranslation: string;
} {
  const zhSentences = splitChineseSentences(content);
  const viSentences = splitVietnameseSentences(translatedText || '');

  const firstChinese = zhSentences.length > 0 ? zhSentences[0] : '';
  const lastChinese = zhSentences.length > 0 ? zhSentences[zhSentences.length - 1] : '';

  const firstPrevTranslation = viSentences.length > 0 ? viSentences[0] : '';
  const lastPrevTranslation = viSentences.length > 0 ? viSentences[viSentences.length - 1] : '';

  return {
    firstChinese,
    lastChinese,
    firstPrevTranslation,
    lastPrevTranslation,
  };
}

// Chuẩn hóa văn bản để so sánh (chữ thường, bỏ dấu câu và khoảng trắng thừa)
export function normalizeForComparison(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'“”…–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Thuật toán khoảng cách Levenshtein
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // xóa
        dp[i][j - 1] + 1, // chèn
        dp[i - 1][j - 1] + cost // thay thế
      );
    }
  }

  return dp[m][n];
}

// Tính độ tương đồng giữa 2 chuỗi (kết hợp cấp độ từ và ký tự)
export function calculateTextSimilarity(
  str1: string,
  str2: string
): {
  score: number; // 0 - 100%
  charScore: number;
  wordScore: number;
  label: string;
  colorClass: string;
  matchedWords: string[];
  uniqueWords1: string[];
  uniqueWords2: string[];
} {
  const norm1 = normalizeForComparison(str1);
  const norm2 = normalizeForComparison(str2);

  if (!norm1 && !norm2) {
    return {
      score: 100,
      charScore: 100,
      wordScore: 100,
      label: 'Khớp hoàn toàn',
      colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      matchedWords: [],
      uniqueWords1: [],
      uniqueWords2: [],
    };
  }

  if (!norm1 || !norm2) {
    return {
      score: 0,
      charScore: 0,
      wordScore: 0,
      label: 'Không có dữ liệu',
      colorClass: 'text-slate-500 bg-slate-100 border-slate-200',
      matchedWords: [],
      uniqueWords1: norm1 ? norm1.split(' ') : [],
      uniqueWords2: norm2 ? norm2.split(' ') : [],
    };
  }

  // 1. Tính toán tương đồng theo ký tự (Levenshtein)
  const maxLen = Math.max(norm1.length, norm2.length);
  const distance = levenshteinDistance(norm1, norm2);
  const charScore = Math.max(0, Math.round((1 - distance / maxLen) * 100));

  // 2. Tính toán tương đồng theo từ (Jaccard + Token Overlap)
  const words1 = norm1.split(' ').filter(Boolean);
  const words2 = norm2.split(' ').filter(Boolean);

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  const matchedWords: string[] = [];
  const uniqueWords1: string[] = [];
  const uniqueWords2: string[] = [];

  set1.forEach((w) => {
    if (set2.has(w)) {
      matchedWords.push(w);
    } else {
      uniqueWords1.push(w);
    }
  });

  set2.forEach((w) => {
    if (!set1.has(w)) {
      uniqueWords2.push(w);
    }
  });

  const unionSize = new Set([...words1, ...words2]).size;
  const wordScore =
    unionSize > 0 ? Math.round((matchedWords.length / unionSize) * 100) : 0;

  // 3. Tổng hợp điểm số (Trọng số: 50% từ ngữ + 50% ký tự)
  const score = Math.round(wordScore * 0.5 + charScore * 0.5);

  let label = 'Khác biệt nhiều';
  let colorClass = 'text-rose-700 bg-rose-50 border-rose-200';

  if (score >= 90) {
    label = 'Rất khớp (Chuẩn xác)';
    colorClass = 'text-emerald-700 bg-emerald-50 border-emerald-200';
  } else if (score >= 75) {
    label = 'Độ tương đồng cao';
    colorClass = 'text-teal-700 bg-teal-50 border-teal-200';
  } else if (score >= 55) {
    label = 'Tương đồng trung bình';
    colorClass = 'text-amber-700 bg-amber-50 border-amber-200';
  } else if (score >= 35) {
    label = 'Khác cách diễn đạt';
    colorClass = 'text-orange-700 bg-orange-50 border-orange-200';
  }

  return {
    score,
    charScore,
    wordScore,
    label,
    colorClass,
    matchedWords,
    uniqueWords1,
    uniqueWords2,
  };
}
