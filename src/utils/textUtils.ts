import * as XLSX from 'xlsx';
import { StoryRow, MergedChunk, AudioPart, CharacterItem } from '../types';

/**
 * Clean special characters like in the Apps Script cleanColumns:
 * regex /[~@#$^&*]/g
 */
export function cleanSpecialChars(text: string): string {
  if (!text) return '';
  return text.replace(/[~@#$^&*]/g, '');
}

/**
 * Parse string like "1, 3, 5" or "1-4, 7, 9" into 0-based chunk indices
 */
export function parseSelectionInput(input: string, totalChunks: number): number[] {
  if (!input || !input.trim()) return [];
  const selected = new Set<number>();
  const parts = input.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(totalChunks, Math.max(start, end));
        for (let i = min; i <= max; i++) {
          selected.add(i - 1); // 0-based
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= totalChunks) {
        selected.add(num - 1); // 0-based
      }
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

/**
 * Automatically merge rows in column B based on maxChars limit
 * (Replication of tuDongGopCotB from Apps Script)
 */
export function mergeRowsByCharLimit(
  rows: StoryRow[],
  maxChars: number = 35000,
  cleanCharsBeforeMerge: boolean = false
): MergedChunk[] {
  const validRows = rows.filter((r) => r.content && r.content.trim() !== '');
  if (validRows.length === 0) return [];

  const chunks: MergedChunk[] = [];
  let currentText = '';
  let startIdx = 0;
  let startChapter = validRows[0].chapter || `Dòng 1`;

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    let rowText = row.content.trim();
    if (cleanCharsBeforeMerge) {
      rowText = cleanSpecialChars(rowText);
    }
    if (!rowText) continue;

    const joinStr = currentText === '' ? '' : '\n';
    const newLen = currentText.length + joinStr.length + rowText.length;

    if (newLen > maxChars && currentText !== '') {
      const endChapter = validRows[i - 1].chapter || `Dòng ${i}`;
      const chapterLabel =
        startChapter === endChapter ? startChapter : `${startChapter} → ${endChapter}`;

      chunks.push({
        id: `chunk-${chunks.length + 1}-${Date.now()}`,
        chunkIndex: chunks.length + 1,
        chapterLabel,
        startRowIndex: startIdx,
        endRowIndex: i - 1,
        content: currentText,
        charCount: currentText.length,
        status: 'idle',
      });

      // Start new chunk
      currentText = rowText;
      startIdx = i;
      startChapter = row.chapter || `Dòng ${i + 1}`;
    } else {
      currentText += joinStr + rowText;
    }
  }

  // Push final chunk
  if (currentText !== '') {
    const lastRow = validRows[validRows.length - 1];
    const endChapter = lastRow.chapter || `Dòng ${validRows.length}`;
    const chapterLabel =
      startChapter === endChapter ? startChapter : `${startChapter} → ${endChapter}`;

    chunks.push({
      id: `chunk-${chunks.length + 1}-${Date.now()}`,
      chunkIndex: chunks.length + 1,
      chapterLabel,
      startRowIndex: startIdx,
      endRowIndex: validRows.length - 1,
      content: currentText,
      charCount: currentText.length,
      status: 'idle',
    });
  }

  return chunks;
}

/**
 * Split text into parts around maxLen (default 2900) by sentence boundaries
 * (Replication of splitTextIntoParts from Apps Script)
 */
export function splitTextIntoAudioParts(text: string, maxLen: number = 2900): AudioPart[] {
  if (!text || !text.trim()) return [];

  // Regex matching sentence plus trailing punctuation and whitespaces
  const regex = /[^.!?]+[.!?]+["'”’\)\]}]*[\s]*|[^.!?]+$/g;
  let sentences = text.match(regex);

  if (!sentences || sentences.length === 0) {
    sentences = [text];
  }

  const parts: string[] = [];
  let current = '';

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (current.length + s.length <= maxLen) {
      current += s;
    } else {
      if (current) {
        parts.push(current.trim());
      }
      current = s;
    }
  }

  if (current && current.trim()) {
    parts.push(current.trim());
  }

  return parts.map((p, idx) => ({
    partIndex: idx + 1,
    text: p,
    charCount: p.length,
  }));
}

/**
 * Parse an uploaded Excel (.xlsx, .xls) file.
 * Expects Column A to be Chapter/File Name, Column B to be Text Content.
 */
export async function parseExcelFile(file: File): Promise<{
  rows: StoryRow[];
  fileName: string;
  totalChars: number;
}> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('File Excel không có sheet nào.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  // Parse raw rows as 2D array
  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('File Excel không chứa dữ liệu.');
  }

  // Check if first row is header
  let startIndex = 0;
  const firstRow = rawRows[0];
  const colA = String(firstRow[0] || '').toLowerCase();
  const colB = String(firstRow[1] || '').toLowerCase();

  const isHeader =
    colA.includes('chương') ||
    colA.includes('tên') ||
    colA.includes('chapter') ||
    colA.includes('cột') ||
    colB.includes('nội dung') ||
    colB.includes('content') ||
    colB.includes('văn bản') ||
    colB.includes('original');

  if (isHeader) {
    startIndex = 1;
  }

  const rows: StoryRow[] = [];
  let totalChars = 0;

  for (let i = startIndex; i < rawRows.length; i++) {
    const row = rawRows[i];
    const chapter = String(row[0] || '').trim();
    const content = String(row[1] || '').trim();

    if (!content && !chapter) continue;

    const charCount = content.length;
    totalChars += charCount;

    rows.push({
      id: `row-${i}-${Date.now()}`,
      originalIndex: i + 1,
      chapter: chapter || `Đoạn ${i + 1}`,
      content,
      charCount,
    });
  }

  if (rows.length === 0) {
    throw new Error('Không tìm thấy nội dung văn bản nào ở Cột B.');
  }

  return {
    rows,
    fileName: file.name,
    totalChars,
  };
}

/**
 * Helper to trigger browser file download safely
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
      // ignore cleanup error
    }
  }, 2000);
}

/**
 * Split text into chunks that strictly fit within Excel cell character limit (32,767 characters).
 * Uses a safe threshold (default 30,000 characters) and splits at paragraph / sentence boundaries.
 */
export function splitTextForExcelCell(text: string, maxLen: number = 30000): string[] {
  if (!text || text.length <= maxLen) return [text || ''];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let breakPoint = -1;

    // 1. Try double line break (\n\n) between [maxLen - 6000, maxLen]
    const searchStartDouble = Math.max(0, maxLen - 6000);
    const subDouble = remaining.substring(searchStartDouble, maxLen);
    const lastDoubleLine = subDouble.lastIndexOf('\n\n');
    if (lastDoubleLine !== -1) {
      breakPoint = searchStartDouble + lastDoubleLine + 2;
    }

    // 2. Try single line break (\n) between [maxLen - 4000, maxLen]
    if (breakPoint === -1) {
      const searchStartSingle = Math.max(0, maxLen - 4000);
      const subSingle = remaining.substring(searchStartSingle, maxLen);
      const lastSingleLine = subSingle.lastIndexOf('\n');
      if (lastSingleLine !== -1) {
        breakPoint = searchStartSingle + lastSingleLine + 1;
      }
    }

    // 3. Try sentence punctuation (. ! ? 。 ！ ？) between [maxLen - 3000, maxLen]
    if (breakPoint === -1) {
      const searchStartPunct = Math.max(0, maxLen - 3000);
      const subPunct = remaining.substring(searchStartPunct, maxLen);
      // Look for sentence endings followed by whitespace or end
      const matches = [...subPunct.matchAll(/[.!?。！？](\s+|$)/g)];
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        if (lastMatch.index !== undefined) {
          breakPoint = searchStartPunct + lastMatch.index + lastMatch[0].length;
        }
      }
    }

    // 4. Try last space character between [maxLen - 1500, maxLen]
    if (breakPoint === -1) {
      const searchStartSpace = Math.max(0, maxLen - 1500);
      const subSpace = remaining.substring(searchStartSpace, maxLen);
      const lastSpace = subSpace.lastIndexOf(' ');
      if (lastSpace !== -1) {
        breakPoint = searchStartSpace + lastSpace + 1;
      }
    }

    // 5. Fallback hard cut at maxLen if no suitable break point found
    if (breakPoint <= 0 || breakPoint > maxLen) {
      breakPoint = maxLen;
    }

    const chunk = remaining.substring(0, breakPoint).trim();
    if (chunk) {
      parts.push(chunk);
    }
    remaining = remaining.substring(breakPoint).trim();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts.length > 0 ? parts : [''];
}

/**
 * Export translated story chunks to Excel (.xlsx) file.
 * Handles Excel's 32,767 character per cell hard limit by automatically
 * splitting any cell exceeding 30,000 characters into sequential rows.
 */
export function exportTranslatedToXlsx(
  chunks: MergedChunk[],
  fileName: string = 'KetQua_TruyenAudio',
  options?: {
    onlyCompleted?: boolean;
    maxCellChars?: number;
  }
): {
  success: boolean;
  count: number;
  totalRows: number;
  splitCount: number;
  downloadFileName: string;
} {
  const onlyCompleted = options?.onlyCompleted !== false; // default true
  const maxCellChars = Math.min(options?.maxCellChars || 30000, 32000);

  const targetChunks = onlyCompleted
    ? chunks.filter((c) => c.status === 'done' && Boolean(c.translatedText && c.translatedText.trim()))
    : chunks;

  if (targetChunks.length === 0) {
    throw new Error(
      onlyCompleted
        ? 'Chưa có cụm nào được viết lại hoàn thành để xuất file Excel. Vui lòng dịch ít nhất một cụm.'
        : 'Không có dữ liệu cụm truyện nào để xuất file Excel.'
    );
  }

  // Header row
  const excelRows: any[][] = [
    [
      'STT',
      'Chương / Nhãn Cụm',
      'Nội dung gốc (Cột B)',
      'Bản dịch viết lại (Cột C)',
      'Số ký tự dịch',
      'Ghi chú / Trạng thái',
    ],
  ];

  let totalSplits = 0;

  targetChunks.forEach((c) => {
    const origText = (c.content || '').trim();
    const transText = (c.translatedText || '').trim();

    // Split translation if it exceeds safe Excel cell limit (30,000 chars)
    const transParts = splitTextForExcelCell(transText, maxCellChars);
    // Split original content if it also exceeds safe Excel cell limit
    const origParts = splitTextForExcelCell(origText, maxCellChars);

    const maxParts = Math.max(transParts.length, origParts.length, 1);

    if (maxParts > 1) {
      totalSplits++;
    }

    for (let p = 0; p < maxParts; p++) {
      const isSplit = maxParts > 1;
      const stt = isSplit ? `${c.chunkIndex}.${p + 1}` : `${c.chunkIndex}`;
      const baseLabel = c.chapterLabel || `Cụm #${c.chunkIndex}`;
      const chapterLabel = isSplit ? `${baseLabel} (Phần ${p + 1}/${maxParts})` : baseLabel;

      const rowOriginal = origParts[p] || (p === 0 ? origText : '');
      const rowTranslated = transParts[p] || '';
      const charCount = rowTranslated.length;

      let note = '';
      if (isSplit) {
        note = `Tự động tách phần ${p + 1}/${maxParts} (chống tràn giới hạn 32k ký tự của Excel)`;
      } else if (c.status === 'done' && rowTranslated) {
        note = 'Hoàn thành';
      } else if (c.status === 'error') {
        note = c.errorMsg ? `Lỗi: ${c.errorMsg}` : 'Lỗi dịch';
      } else {
        note = 'Chưa viết lại';
      }

      excelRows.push([stt, chapterLabel, rowOriginal, rowTranslated, charCount, note]);
    }
  });

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(excelRows);

  // Column width settings for Excel
  ws['!cols'] = [
    { wch: 8 },  // STT
    { wch: 26 }, // Chương / Nhãn
    { wch: 45 }, // Nội dung gốc
    { wch: 65 }, // Bản dịch viết lại
    { wch: 15 }, // Số ký tự
    { wch: 32 }, // Ghi chú
  ];

  // Create workbook and append sheet
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BanDich_VietLai');

  // Generate binary XLSX data
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const safeName = (fileName || 'Truyen_Audio')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .trim();
  const downloadFileName = `${safeName || 'Truyen'}_BanDich_VietLai.xlsx`;

  triggerFileDownload(blob, downloadFileName);

  return {
    success: true,
    count: targetChunks.length,
    totalRows: excelRows.length - 1, // exclude header
    splitCount: totalSplits,
    downloadFileName,
  };
}

/**
 * Export translated chunks to plain text (.txt) file
 * Only exports parts that have been translated / rewritten
 */
export function exportTranslatedToTxt(
  chunks: MergedChunk[],
  fileName: string = 'KetQua_TruyenAudio',
  options?: {
    includeHeaders?: boolean;
    onlyCompleted?: boolean;
  }
): { success: boolean; count: number; totalChars: number } {
  // Only export translated chunks
  const translatedChunks = chunks.filter(
    (c) => c.status === 'done' && Boolean(c.translatedText && c.translatedText.trim())
  );

  if (translatedChunks.length === 0) {
    throw new Error('Chưa có cụm nào được viết lại hoàn thành để xuất file TXT. Vui lòng dịch ít nhất một cụm.');
  }

  const includeHeaders = options?.includeHeaders !== false; // default true
  let fullText = '';

  translatedChunks.forEach((c, idx) => {
    const label = c.chapterLabel || `Cụm #${c.chunkIndex}`;
    if (includeHeaders) {
      fullText += `========================================\n`;
      fullText += `${label} (Cụm #${c.chunkIndex})\n`;
      fullText += `========================================\n\n`;
    }
    fullText += `${c.translatedText!.trim()}\n\n`;
    if (idx < translatedChunks.length - 1) {
      fullText += `\n`;
    }
  });

  const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8;' });
  const safeName = (fileName || 'Truyen_Audio')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .trim();
  const downloadFileName = `${safeName || 'Truyen'}_BanDich_VietLai.txt`;

  triggerFileDownload(blob, downloadFileName);

  return {
    success: true,
    count: translatedChunks.length,
    totalChars: fullText.length,
  };
}

/**
 * Copy all translated text directly to clipboard
 */
export async function copyTranslatedTextToClipboard(
  chunks: MergedChunk[],
  options?: { includeHeaders?: boolean }
): Promise<{ count: number; totalChars: number }> {
  const translatedChunks = chunks.filter(
    (c) => c.status === 'done' && Boolean(c.translatedText && c.translatedText.trim())
  );

  if (translatedChunks.length === 0) {
    throw new Error('Chưa có cụm nào được viết lại hoàn thành để sao chép.');
  }

  const includeHeaders = options?.includeHeaders !== false;
  let fullText = '';

  translatedChunks.forEach((c, idx) => {
    const label = c.chapterLabel || `Cụm #${c.chunkIndex}`;
    if (includeHeaders) {
      fullText += `=== ${label} ===\n\n`;
    }
    fullText += `${c.translatedText!.trim()}\n\n`;
  });

  await navigator.clipboard.writeText(fullText.trim());
  return { count: translatedChunks.length, totalChars: fullText.length };
}

/**
 * Export character table to plain text (.txt) file
 */
export function exportCharactersToTxt(
  characters: CharacterItem[],
  fileName: string = 'Bang_Ten_Nhan_Vat'
): { success: boolean; count: number } {
  if (characters.length === 0) {
    throw new Error('Bảng tên nhân vật đang trống. Không có dữ liệu để xuất file TXT.');
  }

  const dateStr = new Date().toLocaleString('vi-VN');
  let content = `================================================================================\n`;
  content += `BẢNG TÊN NHÂN VẬT DỊCH TRUYỆN (${characters.length} nhân vật)\n`;
  content += `Thời gian xuất: ${dateStr}\n`;
  content += `================================================================================\n\n`;
  content += `STT\tTên gốc tiếng Trung\tTên Hán Việt\tGiới tính\n`;
  content += `--------------------------------------------------------------------------------\n`;

  characters.forEach((c, idx) => {
    const stt = idx + 1;
    const chinese = c.chinese || '-';
    const hanViet = c.hanViet || '-';
    const gender = c.gender || 'Chưa rõ';
    content += `${stt}\t${chinese}\t${hanViet}\t${gender}\n`;
  });

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const safeName = (fileName || 'Bang_Ten_Nhan_Vat')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .trim();
  const downloadFileName = `${safeName || 'Bang_Ten_Nhan_Vat'}.txt`;

  triggerFileDownload(blob, downloadFileName);
  return { success: true, count: characters.length };
}

/**
 * Parse characters from an imported TXT file.
 * Supports standard 3-column format (STT, Tên gốc tiếng Trung, Tên Hán Việt)
 * as well as 2-column or legacy 4/5-column formats.
 */
export function parseCharactersFromTxt(txtContent: string): CharacterItem[] {
  if (!txtContent || !txtContent.trim()) return [];

  const lines = txtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const items: CharacterItem[] = [];

  let autoStt = 1;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Skip decoration and header lines
    if (line.startsWith('=') || line.startsWith('-') || line.startsWith('#')) continue;
    if (line.includes('BẢNG TÊN NHÂN VẬT') || line.includes('Thời gian xuất')) continue;
    if (
      line.toLowerCase().includes('tên hán việt') &&
      (line.toLowerCase().includes('stt') || line.toLowerCase().includes('tên gốc'))
    ) {
      continue;
    }

    // Split by tab, pipe, or multiple spaces
    let parts = line.includes('\t')
      ? line.split('\t').map((p) => p.trim())
      : line.includes('|')
      ? line.split('|').map((p) => p.trim()).filter(Boolean)
      : line.split(/\s{2,}/).map((p) => p.trim());

    if (parts.length < 2) continue;

    let stt = autoStt;
    let chinese = '';
    let hanViet = '';
    let gender = 'Chưa rõ';

    // Check if the first column is a sequence number (STT)
    const isFirstNum = /^\d+$/.test(parts[0]);

    if (isFirstNum) {
      stt = parseInt(parts[0], 10) || autoStt;
      chinese = parts[1] === '-' ? '' : parts[1] || '';
      hanViet = parts[2] === '-' ? '' : parts[2] || '';
      if (parts.length >= 4 && parts[3]) {
        gender = parts[3].trim() === '-' ? 'Chưa rõ' : parts[3].trim();
      }
    } else {
      chinese = parts[0] === '-' ? '' : parts[0] || '';
      hanViet = parts[1] === '-' ? '' : parts[1] || '';
      if (parts.length >= 3 && parts[2]) {
        gender = parts[2].trim() === '-' ? 'Chưa rõ' : parts[2].trim();
      }
    }

    // Must have at least a Chinese or Han Viet name
    if (chinese || hanViet) {
      items.push({
        id: `char-txt-${Date.now()}-${autoStt}-${Math.random().toString(36).substr(2, 4)}`,
        stt: stt || autoStt,
        chinese,
        hanViet,
        gender: gender || 'Chưa rõ',
      });
      autoStt++;
    }
  }

  return items;
}

