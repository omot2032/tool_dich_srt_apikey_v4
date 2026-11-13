import { CharacterItem } from '../types';

/**
 * Làm sạch phần ghi chú nhân vật, loại bỏ các cụm xưng hô hoặc ký tự thừa
 */
export function cleanNoteWithoutFormsOfAddress(note: string): string {
  if (!note) return '';
  return note
    .replace(/^[\s\:\;\,\.\-]+|[\s\:\;\,\.\-]+$/g, '')
    .trim();
}

/**
 * Tách và làm sạch danh sách các biến thể chữ Hán từ một chuỗi
 * (có thể ngăn cách bởi / , ; | hoặc ngoặc đơn).
 * Giữ nguyên thứ tự xuất hiện, loại bỏ trùng lặp.
 */
export function extractChineseVariants(str: string): string[] {
  if (!str) return [];
  // Tìm các cụm chữ Hán (Hanzi)
  const matches = str.match(/[\u4e00-\u9fa5]+/g);
  if (!matches) return [];
  const unique = new Set<string>();
  const result: string[] = [];
  for (const m of matches) {
    const trimmed = m.trim();
    if (trimmed && !unique.has(trimmed)) {
      unique.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Gom gộp các biến thể chữ Hán từ nhiều nguồn thành một chuỗi duy nhất cách nhau bằng ' / '
 * Ví dụ: "常青", "长青 / 尝青" -> "常青 / 长青 / 尝青"
 */
export function mergeChineseVariants(...sources: (string | undefined | null)[]): string {
  const unique = new Set<string>();
  const list: string[] = [];
  for (const s of sources) {
    if (!s) continue;
    const variants = extractChineseVariants(s);
    for (const v of variants) {
      if (!unique.has(v)) {
        unique.add(v);
        list.push(v);
      }
    }
  }
  return list.join(' / ');
}

/**
 * Trích xuất mẫu ngữ cảnh từ các dòng truyện (Cột B / file SRT)
 * để gửi cho AI phân tích nhân vật và biến thể
 */
export function extractContextSample(
  rows: { content?: string }[],
  maxChars: number = 18000
): string {
  if (!rows || rows.length === 0) return '';
  let sample = '';
  for (let i = 0; i < rows.length; i++) {
    const c = (rows[i]?.content || '').trim();
    if (!c) continue;
    if (sample.length + c.length + 1 > maxChars) {
      if (sample.length > 5000) break;
    }
    sample += (sample ? '\n' : '') + c;
  }
  return sample;
}

/**
 * Kiểm tra xem trường tên Hán Việt có bị nhét nhiều nhân vật khác nhau không
 * (chứa dấu gạch chéo '/', phẩy ',', hoặc chấm phẩy ';')
 */
export function hasMultipleHanViets(rawHanViet: string): boolean {
  if (!rawHanViet) return false;
  const parts = rawHanViet
    .split(/[/,;|\n\r]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return parts.length >= 2;
}

/**
 * Tách chuỗi tên Hán Việt thành danh sách các tên riêng biệt
 */
export function extractHanVietList(rawHanViet: string): string[] {
  if (!rawHanViet) return [];
  const parts = rawHanViet
    .split(/[/,;|\n\r]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  const unique = new Set<string>();
  const result: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!unique.has(key)) {
      unique.add(key);
      result.push(p);
    }
  }
  return result;
}

/**
 * Chuẩn hóa Tên Hán Việt chuẩn: BẮT BUỘC chỉ giữ lại ĐÚNG 1 TÊN DUY NHẤT.
 * Nếu chuỗi chứa dấu gạch chéo '/', phẩy ',', v.v... thì chỉ lấy tên chuẩn đầu tiên.
 */
export function sanitizeSingleHanViet(rawHanViet: string): string {
  if (!rawHanViet) return '';
  const names = extractHanVietList(rawHanViet);
  if (names.length === 0) return rawHanViet.trim();
  return names[0].trim(); // Chỉ lấy đúng 1 tên duy nhất!
}

// Bảng tra cứu âm Hán Việt của các chữ Hán phổ biến trong tên nhân vật và họ tiếng Trung
const SINO_VIETNAMESE_CHAR_MAP: Record<string, string[]> = {
  // Họ & Tên phổ biến
  '姬': ['cơ'],
  '希': ['hi', 'hy'],
  '吴': ['ngô'],
  '蒼': ['thương'],
  '苍': ['thương'],
  '无': ['vô'],
  '無': ['vô'],
  '常': ['thường'],
  '长': ['trường', 'thường', 'trưởng'],
  '長': ['trường', 'thường', 'trưởng'],
  '尝': ['thường'],
  '嘗': ['thường'],
  '畅': ['sướng'],
  '清': ['thanh'],
  '青': ['thanh'],
  '阴': ['âm'],
  '陰': ['âm'],
  '爵': ['tước'],
  '情': ['tình'],
  '发': ['phát'],
  '發': ['phát'],
  '苏': ['tô'],
  '蘇': ['tô'],
  '念': ['niệm'],
  '雪': ['tuyết'],
  '林': ['lâm'],
  '剑': ['kiếm'],
  '劍': ['kiếm'],
  '行': ['hành', 'hàng'],
  '端': ['đoan'],
  '段': ['đoàn', 'đoạn'],
  '沧': ['thương'],
  '海': ['hải'],
  '尹': ['doãn'],
  '竹': ['trúc'],
  '琴': ['cầm'],
  '芹': ['cần'],
  '卿': ['khanh'],
  '李': ['lý'],
  '王': ['vương'],
  '张': ['trương'],
  '張': ['trương'],
  '陈': ['trần'],
  '陳': ['trần'],
  '刘': ['lưu'],
  '劉': ['lưu'],
  '杨': ['dương'],
  '楊': ['dương'],
  '赵': ['triệu'],
  '趙': ['triệu'],
  '黄': ['hoàng', 'huỳnh'],
  '黃': ['hoàng', 'huỳnh'],
  '周': ['chu', 'châu'],
  '徐': ['từ'],
  '孙': ['tôn'],
  '孫': ['tôn'],
  '胡': ['hồ'],
  '朱': ['chu'],
  '高': ['cao'],
  '梁': ['lương'],
  '谢': ['tạ'],
  '謝': ['tạ'],
  '宋': ['tống'],
  '唐': ['đường'],
  '许': ['hứa'],
  '許': ['hứa'],
  '韩': ['hàn'],
  '韓': ['hàn'],
  '冯': ['phùng'],
  '馮': ['phùng'],
  '邓': ['đặng'],
  '鄧': ['đặng'],
  '曹': ['tào'],
  '彭': ['bành'],
  '曾': ['tăng'],
  '萧': ['tiêu'],
  '蕭': ['tiêu'],
  '肖': ['tiêu'],
  '田': ['điền'],
  '董': ['đổng'],
  '袁': ['viên'],
  '潘': ['phan'],
  '于': ['vu'],
  '蒋': ['tưởng'],
  '蔣': ['tưởng'],
  '蔡': ['thái'],
  '余': ['dư'],
  '杜': ['đỗ'],
  '叶': ['diệp'],
  '葉': ['diệp'],
  '程': ['trình'],
  '魏': ['ngụy'],
  '吕': ['lữ'],
  '呂': ['lữ'],
  '丁': ['đinh'],
  '任': ['nhậm'],
  '卢': ['lư'],
  '盧': ['lư'],
  '姚': ['diêu'],
  '沈': ['thẩm'],
  '钟': ['chung'],
  '鍾': ['chung'],
  '姜': ['khương'],
  '崔': ['thôi'],
  '谭': ['đàm'],
  '譚': ['đàm'],
  '陆': ['lục'],
  '陸': ['lục'],
  '范': ['phạm'],
  '汪': ['uông'],
  '廖': ['liêu'],
  '石': ['thạch'],
  '金': ['kim'],
  '韦': ['vi'],
  '韋': ['vi'],
  '贾': ['giả'],
  '賈': ['giả'],
  '夏': ['hạ'],
  '付': ['phó'],
  '方': ['phương'],
  '白': ['bạch'],
  '邹': ['trâu'],
  '鄒': ['trâu'],
  '孟': ['mạnh'],
  '熊': ['hùng'],
  '秦': ['tần'],
  '邱': ['khâu'],
  '江': ['giang'],
  '毛': ['mao'],
  '雷': ['lôi'],
  '钱': ['tiền'],
  '錢': ['tiền'],
  '汤': ['thang'],
  '湯': ['thang'],
  '易': ['dịch'],
  '武': ['vũ', 'võ'],
  '顾': ['cố'],
  '顧': ['cố'],
  '乔': ['kiều'],
  '喬': ['kiều'],
  '贺': ['hạ'],
  '賀': ['hạ'],
  '赖': ['lại'],
  '賴': ['lại'],
  '龚': ['cung'],
  '龔': ['cung'],
  '文': ['văn'],
  '庞': ['bàng'],
  '龐': ['bàng'],
  '樊': ['phàn'],
  '兰': ['lan'],
  '蘭': ['lan'],
  '殷': ['ân'],
  '陶': ['đào'],
  '洪': ['hồng'],
  '翟': ['trạch'],
  '安': ['an'],
  '颜': ['nhan'],
  '顏': ['nhan'],
  '倪': ['nghê'],
  '严': ['nghiêm'],
  '嚴': ['nghiêm'],
  '牛': ['ngưu'],
  '温': ['ôn'],
  '溫': ['ôn'],
  '芦': ['lô'],
  '蘆': ['lô'],
  '季': ['quý'],
  '俞': ['du'],
  '章': ['chương'],
  '鲁': ['lỗ'],
  '魯': ['lỗ'],
  '葛': ['cát'],
  '伍': ['ngũ'],
  '申': ['thân'],
  '尤': ['vưu'],
  '毕': ['tất'],
  '畢': ['tất'],
  '聂': ['nhiếp'],
  '聶': ['nhiếp'],
  '焦': ['tiêu'],
  '向': ['hướng'],
  '柳': ['liễu'],
  '邢': ['hình'],
  '路': ['lộ'],
  '岳': ['nhạc'],
  '齐': ['tề'],
  '齊': ['tề'],
  '祝': ['chúc'],
  '裴': ['bùi'],
  '柴': ['sài'],
  '牟': ['mâu'],
  '纪': ['kỷ'],
  '紀': ['kỷ'],
  '南': ['nam'],
  '宫': ['cung'],
  '慕': ['mộ'],
  '容': ['dung'],
  '欧': ['âu'],
  '阳': ['dương'],
  '陽': ['dương'],
  '司': ['tư'],
  '马': ['mã'],
  '馬': ['mã'],
  '诸': ['gia', 'chư'],
  '东': ['đông'],
  '東': ['đông'],
  '上': ['thượng'],
  '官': ['quan'],
  '飞': ['phi'],
  '飛': ['phi'],
  '龙': ['long'],
  '龍': ['long'],
  '天': ['thiên'],
  '玄': ['huyền'],
  '冥': ['minh'],
  '炎': ['viêm'],
  '冰': ['băng'],
  '寒': ['hàn'],
  '风': ['phong'],
  '風': ['phong'],
  '云': ['vân'],
  '雲': ['vân'],
  '雨': ['vũ'],
  '月': ['nguyệt'],
  '星': ['tinh'],
  '瑶': ['dao'],
  '瑤': ['dao'],
  '灵': ['linh'],
  '靈': ['linh'],
  '梦': ['mộng'],
  '夢': ['mộng'],
  '仙': ['tiên'],
  '尊': ['tôn'],
};

/**
 * Tính điểm tương đồng giữa một chuỗi chữ Hán và tên Hán Việt
 */
function scoreHanziWithHanViet(hanziStr: string, hanVietName: string): number {
  if (!hanziStr || !hanVietName) return 0;
  const hvWords = hanVietName.toLowerCase().trim().split(/\s+/);
  if (hvWords.length === 0) return 0;

  let score = 0;
  const chars = Array.from(hanziStr);

  // 1. So khớp âm đọc từng chữ
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const readings = SINO_VIETNAMESE_CHAR_MAP[ch];
    if (readings) {
      for (const r of readings) {
        if (hvWords.includes(r)) {
          score += 30;
          // Thưởng điểm cao nếu đúng vị trí (ví dụ họ đứng đầu)
          if (i === 0 && hvWords[0] === r) {
            score += 40;
          }
          break;
        }
      }
    }
  }

  // 2. So khớp độ dài âm tiết (ví dụ: tên 3 chữ khớp chuỗi 3 chữ Hán)
  if (chars.length === hvWords.length) {
    score += 10;
  }

  return score;
}

/**
 * Tự động phân tách 1 dòng nhân vật bị gom nhầm nhiều người thành các dòng riêng biệt.
 * Ví dụ:
 * HanViet: "Cơ Vô Thường / Âm Tước Tình / Âm Phát Tình"
 * Chinese: "姬无常 / 阴爵情 / 姬常 / 阴发情 / 希吴苍"
 * -> Tách thành:
 * Dòng 1: HanViet: "Cơ Vô Thường", Chinese: "姬无常 / 姬常 / 希吴苍"
 * Dòng 2: HanViet: "Âm Tước Tình", Chinese: "阴爵情 / 阴发情"
 */
export function splitMultiCharacterRow(char: CharacterItem): CharacterItem[] {
  if (!hasMultipleHanViets(char.hanViet)) {
    return [{ ...char, hanViet: sanitizeSingleHanViet(char.hanViet) }];
  }

  const rawNames = extractHanVietList(char.hanViet);
  if (rawNames.length <= 1) {
    return [{ ...char, hanViet: sanitizeSingleHanViet(char.hanViet) }];
  }

  const allHanzi = extractChineseVariants(char.chinese);

  // 1. Phân loại các tên Hán Việt thành các nhóm nhân vật thực sự khác nhau
  // (Những tên cùng họ hoặc biến thể nhỏ như "Âm Tước Tình" & "Âm Phát Tình" gom chung vào 1 người)
  const distinctGroups: {
    standardName: string;
    aliases: string[];
    assignedHanzi: string[];
  }[] = [];

  for (const name of rawNames) {
    const words = name.toLowerCase().trim().split(/\s+/);
    const firstWord = words[0];
    const lastWord = words[words.length - 1];

    const existingGroup = distinctGroups.find((g) => {
      const gWords = g.standardName.toLowerCase().trim().split(/\s+/);
      const gFirst = gWords[0];
      const gLast = gWords[gWords.length - 1];

      // Cùng họ (firstWord) VÀ cùng tên (lastWord) hoặc trùng họ & độ tương đồng cao
      if (firstWord && gFirst && firstWord === gFirst) {
        if (lastWord === gLast) return true; // VD: Âm Tước Tình vs Âm Phát Tình
        if (words.length === gWords.length && words.length >= 3) {
          // 2/3 chữ trùng nhau
          let shared = 0;
          words.forEach((w) => {
            if (gWords.includes(w)) shared++;
          });
          if (shared >= 2) return true;
        }
      }
      return (
        g.standardName.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(g.standardName.toLowerCase())
      );
    });

    if (existingGroup) {
      if (!existingGroup.aliases.includes(name)) {
        existingGroup.aliases.push(name);
      }
    } else {
      distinctGroups.push({
        standardName: name,
        aliases: [name],
        assignedHanzi: [],
      });
    }
  }

  // 2. Phân bổ các biến thể chữ Hán về từng nhóm nhân vật
  if (allHanzi.length > 0) {
    for (const hz of allHanzi) {
      let bestGroup = distinctGroups[0];
      let maxScore = -1;

      for (const group of distinctGroups) {
        // Tính điểm với tên chuẩn và cả các bí danh
        let groupScore = scoreHanziWithHanViet(hz, group.standardName);
        for (const alias of group.aliases) {
          const aliasScore = scoreHanziWithHanViet(hz, alias);
          if (aliasScore > groupScore) groupScore = aliasScore;
        }

        // Kiểm tra xem chữ Hán đầu có trùng với chữ Hán đầu tiên đã được gán của nhóm này không
        if (group.assignedHanzi.length > 0) {
          const firstCharOfGroup = group.assignedHanzi[0].charAt(0);
          if (hz.charAt(0) === firstCharOfGroup) {
            groupScore += 50;
          }
        }

        if (groupScore > maxScore) {
          maxScore = groupScore;
          bestGroup = group;
        }
      }

      if (bestGroup && !bestGroup.assignedHanzi.includes(hz)) {
        bestGroup.assignedHanzi.push(hz);
      }
    }
  }

  // 3. Nếu có nhóm nào chưa có chữ Hán gán vào, cố gắng lấy chữ Hán chưa được dùng hoặc clone chữ đầu
  distinctGroups.forEach((group, idx) => {
    if (group.assignedHanzi.length === 0 && allHanzi.length > idx) {
      group.assignedHanzi.push(allHanzi[idx]);
    }
  });

  return distinctGroups.map((group, idx) => ({
    id: idx === 0 ? char.id : `char-split-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
    stt: char.stt,
    chinese: group.assignedHanzi.length > 0 ? group.assignedHanzi.join(' / ') : (idx === 0 ? char.chinese : ''),
    hanViet: sanitizeSingleHanViet(group.standardName), // BẮT BUỘC ĐÚNG 1 TÊN DUY NHẤT
    gender: char.gender || 'Chưa rõ',
    note: char.note || '',
  }));
}
