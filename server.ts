import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Health Check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', serverTime: new Date().toISOString() });
  });

  // Gemini API Proxy
  app.post('/api/gemini/generate', async (req, res) => {
    try {
      const { prompt, model = 'gemini-3.8-flash', apiKey, responseMimeType, responseSchema } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required and must be a string' });
      }

      const activeApiKey = (apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0)
        ? apiKey.trim()
        : process.env.GEMINI_API_KEY;

      if (!activeApiKey) {
        return res.status(400).json({
          error: 'Vui lòng cung cấp ít nhất 1 API Key hợp lệ hoặc cấu hình GEMINI_API_KEY.'
        });
      }

      const ai = new GoogleGenAI({
        apiKey: activeApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Normalize model string or fallback if preview variant needed
      let primaryModel = model.trim();
      let responseText = '';

      const buildConfig = () => {
        const cfg: any = {
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_HATE_SPEECH' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT' as any, threshold: 'BLOCK_NONE' as any },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY' as any, threshold: 'BLOCK_NONE' as any },
          ],
        };
        if (responseMimeType) {
          cfg.responseMimeType = responseMimeType;
        }
        if (responseSchema) {
          cfg.responseSchema = responseSchema;
        }
        return cfg;
      };

      // Helper function to call Gemini with smart auto-retry for 503 high demand & transient 429
      const callWithFallbackAndRetry = async (targetModel: string): Promise<string> => {
        const executeCall = async (m: string) => {
          try {
            const resp = await ai.models.generateContent({
              model: m,
              contents: prompt,
              config: buildConfig(),
            });

            const candidate = resp.candidates?.[0];
            if (candidate?.finishReason === 'SAFETY') {
              throw new Error('Nội dung văn bản bị bộ lọc kiểm duyệt (Safety Filter) của Google chặn do chứa cảnh bạo lực, nhạy cảm hoặc từ ngữ nhạy cảm.');
            }

            return resp.text || '';
          } catch (err: any) {
            const msg = (err?.message || '').toLowerCase();
            // Fallback for preview vs non-preview or deprecated model name
            if (msg.includes('not found') || msg.includes('404') || msg.includes('no longer available')) {
              const altModel = m.includes('2.5-flash')
                ? 'gemini-3.6-flash'
                : m.endsWith('-preview')
                ? m.replace('-preview', '')
                : `${m}-preview`;
              const altResp = await ai.models.generateContent({
                model: altModel,
                contents: prompt,
                config: buildConfig(),
              });
              return altResp.text || '';
            }
            throw err;
          }
        };

        let lastErr: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await executeCall(targetModel);
          } catch (err: any) {
            lastErr = err;
            const errStr = (err?.message || '') + ' ' + JSON.stringify(err?.details || '');
            const lower = errStr.toLowerCase();

            const is503 = lower.includes('503') || lower.includes('high demand') || lower.includes('unavailable');
            const isDaily =
              lower.includes('generaterequestsperday') ||
              lower.includes('generate_content_free_tier_requests') ||
              lower.includes('per day') ||
              lower.includes('daily') ||
              lower.includes('queries per day') ||
              lower.includes('free tier limit exceeded for today');
            const is429 = lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('resourceexhausted');
            const is403 = lower.includes('403') || lower.includes('permission_denied') || lower.includes('denied access');

            // If it's a 403 (blocked/denied) or daily quota limit, fail fast so caller can rotate key!
            if (is403 || isDaily) {
              throw err;
            }

            // If 503 (temporary high demand) wait with jitter and retry
            if (is503 && attempt < 2) {
              await new Promise((r) => setTimeout(r, 1500 + attempt * 1200));
              continue;
            }

            // If short 429 and attempt < 1
            if (is429 && !isDaily && attempt < 1) {
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }

            throw err;
          }
        }
        throw lastErr;
      };

      responseText = await callWithFallbackAndRetry(primaryModel);

      return res.json({
        success: true,
        text: responseText,
      });
    } catch (error: any) {
      console.error('Gemini API Error:', error);
      const statusCode = error?.status || error?.statusCode || 500;
      const errorDetailsStr = JSON.stringify(error?.details || '') + ' ' + (error?.message || '');
      const lower = errorDetailsStr.toLowerCase();

      const isPermissionDenied =
        lower.includes('403') ||
        lower.includes('permission_denied') ||
        lower.includes('denied access') ||
        lower.includes('api_key_invalid');

      const isHighDemand =
        lower.includes('503') ||
        lower.includes('high demand') ||
        lower.includes('unavailable');

      const isDailyQuotaExceeded =
        lower.includes('generaterequestsperday') ||
        lower.includes('generate_content_free_tier_requests') ||
        lower.includes('per day') ||
        lower.includes('daily') ||
        lower.includes('queries per day') ||
        lower.includes('free tier limit exceeded for today');

      const isRateLimit = !isDailyQuotaExceeded && (
        lower.includes('429') ||
        lower.includes('resource_exhausted') ||
        lower.includes('resourceexhausted') ||
        lower.includes('quota') ||
        lower.includes('queries per minute') ||
        lower.includes('rate limit')
      );

      // Parse retry delay from Google API if provided (e.g. "retry in 17.944s" or "17s")
      let retryAfterSeconds = 15;
      const matchSeconds = lower.match(/retry in ([0-9.]+)s/) || lower.match(/retrydelay"?\s*:\s*"?(\d+)s/);
      if (matchSeconds && matchSeconds[1]) {
        retryAfterSeconds = Math.ceil(parseFloat(matchSeconds[1]));
      }

      const isSafetyBlock =
        lower.includes('safety') ||
        lower.includes('finishreason') ||
        lower.includes('blocked due to safety') ||
        lower.includes('harm_category');

      let userFacingMessage = error?.message || 'Có lỗi xảy ra khi gọi Gemini API';
      if (isSafetyBlock) {
        userFacingMessage = 'Nội dung cụm này bị bộ lọc an toàn (Safety Filter) của Google chặn do chứa cảnh bạo lực, nhạy cảm hoặc từ ngữ nhạy cảm.';
      } else if (isPermissionDenied) {
        userFacingMessage = 'API Key bị từ chối truy cập (403: Project bị chặn hoặc chưa kích hoạt Gemini API). Vui lòng đổi sang API Key khác.';
      } else if (isDailyQuotaExceeded) {
        userFacingMessage = 'API Key đã đạt giới hạn lượt dùng ngày của Model này. Vui lòng chuyển sang Model có hạn mức cao hơn (như Gemini 3.1 Flash Lite 500 lượt/ngày) hoặc dùng Key khác.';
      } else if (isHighDemand) {
        userFacingMessage = 'Mô hình Gemini đang tạm thời quá tải tại máy chủ Google (503 High Demand). Đang chuyển sang API Key khác hoặc thử lại sau.';
      } else if (isRateLimit) {
        userFacingMessage = `API Key bị giới hạn tốc độ gọi (429 Rate Limit). Cần chờ giãn cách ${retryAfterSeconds}s hoặc chuyển sang Key tiếp theo.`;
      }

      return res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
        error: userFacingMessage,
        isSafetyBlock,
        isPermissionDenied,
        isKeyBlocked: isPermissionDenied,
        isHighDemand,
        isQuotaExceeded: isDailyQuotaExceeded,
        isDailyQuotaExceeded,
        isRateLimit,
        retryAfterSeconds: isRateLimit ? retryAfterSeconds : undefined,
        rawMessage: error?.message,
      });
    }
  });

  // Batch or Multi-chunk validation endpoint
  app.post('/api/gemini/verify-key', async (req, res) => {
    try {
      let { apiKey, model = 'gemini-3.1-flash-lite' } = req.body;
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return res.status(400).json({ error: 'API Key là bắt buộc.' });
      }

      const ai = new GoogleGenAI({
        apiKey: apiKey.trim(),
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const result = await ai.models.generateContent({
        model: model.trim(),
        contents: 'Ping. Trả lời đúng 1 chữ: OK',
      });

      return res.json({ success: true, text: result.text || 'OK' });
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      let friendlyError = err.message || 'Key không hợp lệ hoặc hết quota';
      if (msg.includes('403') || msg.includes('denied access')) {
        friendlyError = 'API Key bị từ chối truy cập (403: Project bị chặn hoặc chưa kích hoạt Gemini API).';
      } else if (msg.includes('429') || msg.includes('quota')) {
        friendlyError = 'API Key đã chạm giới hạn Quota hoặc Rate Limit.';
      } else if (msg.includes('503') || msg.includes('high demand')) {
        friendlyError = 'Máy chủ Google đang quá tải tạm thời (503 High Demand). Key vẫn hợp lệ, vui lòng thử lại sau.';
      }

      return res.status(400).json({
        success: false,
        error: friendlyError,
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
