import { Buffer } from 'node:buffer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface ExtractedSourcePoRecord {
  pgNumber: string;
  poNumber: string;
  color: string;
  qty: number;
}

export interface ExtractImageRequest {
  imageBase64: string;
  mimeType: string;
}

export interface ExtractImageResponse {
  sourceRecords: ExtractedSourcePoRecord[];
}

export class ExtractImageValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ExtractImageValidationError';
    this.status = status;
  }
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

function normalizeMimeType(raw: string): string {
  const clean = raw.trim().toLowerCase().split(';')[0].trim();
  if (clean === 'image/jpg') return 'image/jpeg';
  return clean;
}

function hasValidImageSignature(bytes: Buffer, mimeType: string): boolean {
  if (bytes.length < 12) return false;
  if (mimeType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === 'image/webp') {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

export function validateImageUploadPayload(input: {
  imageBase64?: unknown;
  mimeType?: unknown;
}): { cleanBase64: string; mimeType: string } {
  const rawInput = typeof input.imageBase64 === 'string' ? input.imageBase64.trim() : '';
  if (!rawInput) {
    throw new ExtractImageValidationError('Image payload (imageBase64) is required.', 400);
  }

  let detectedMimeFromDataUri = '';
  let rawBase64 = rawInput;
  if (rawInput.startsWith('data:')) {
    const commaIdx = rawInput.indexOf(',');
    if (commaIdx <= 5) {
      throw new ExtractImageValidationError('Invalid image data URI.', 400);
    }
    const header = rawInput.slice(5, commaIdx);
    detectedMimeFromDataUri = header.split(';')[0] || '';
    rawBase64 = rawInput.slice(commaIdx + 1).trim();
  }

  const rawMime =
    typeof input.mimeType === 'string' && input.mimeType.trim()
      ? input.mimeType
      : detectedMimeFromDataUri;
  const mimeType = normalizeMimeType(rawMime);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new ExtractImageValidationError(
      'Unsupported image format. Please upload a JPG, PNG, or WebP photo.',
      400
    );
  }

  const compactBase64 = rawBase64.replace(/\s+/g, '');
  if (!compactBase64 || !/^[A-Za-z0-9+/=]+$/.test(compactBase64)) {
    throw new ExtractImageValidationError('Invalid base64 image data.', 400);
  }

  const estimatedBytes = Math.ceil((compactBase64.length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new ExtractImageValidationError('Uploaded image exceeds the 10 MB size limit.', 413);
  }

  const buffer = Buffer.from(compactBase64, 'base64');
  if (buffer.length === 0) {
    throw new ExtractImageValidationError('Uploaded image is empty.', 400);
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ExtractImageValidationError('Uploaded image exceeds the 10 MB size limit.', 413);
  }

  if (!hasValidImageSignature(buffer, mimeType)) {
    throw new ExtractImageValidationError(
      'File contents do not match the declared JPG, PNG, or WebP image format.',
      400
    );
  }

  return {
    cleanBase64: compactBase64,
    mimeType,
  };
}

function parseOcrJson(rawText: string): Partial<ExtractImageResponse> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const cand of candidates) {
    try {
      return JSON.parse(cand) as Partial<ExtractImageResponse>;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function extractPoRecordsFromImageCore(
  req: { imageBase64?: unknown; mimeType?: unknown },
  runtime: { geminiApiKey: string }
): Promise<ExtractImageResponse> {
  const { cleanBase64, mimeType } = validateImageUploadPayload(req);

  const apiKey = (runtime.geminiApiKey || '').trim();
  if (!apiKey) {
    throw new ExtractImageValidationError(
      'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in Settings > Secrets to enable AI photo OCR.',
      503
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const prompt = [
    'Read this apparel manufacturing PO allocation slip, factory table, or shipping list image carefully.',
    'Extract every PO allocation row into structured JSON inside `sourceRecords`.',
    'Rules:',
    '1. `pgNumber`: Extract the PG# value (for example "PG#36280" or "36280"). If a PG# appears once in a section header above multiple PO rows, apply that PG# to each row below it. Return "" if not visible.',
    '2. `poNumber`: Extract the exact Purchase Order / PO number as a STRING and PRESERVE ALL LEADING ZEROS exactly as printed (for example "0021548218" must stay "0021548218", never strip leading zeros).',
    '3. `color`: Extract garment color name/code if shown (e.g., "BLACK", "NAVY BLAZER", "RED"), or "" if not listed.',
    '4. `qty`: Extract numeric integer quantity (pcs). Strip commas. Return 0 if missing or illegible.',
    '5. Never invent fake rows. Only return rows clearly visible in the image.',
  ].join('\n');

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      sourceRecords: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            pgNumber: {
              type: Type.STRING,
              description: 'PG number (e.g. PG#36280 or 36280), or empty string if absent.',
            },
            poNumber: {
              type: Type.STRING,
              description: 'Exact PO number string preserving all leading zeros (e.g. 0021548218).',
            },
            color: {
              type: Type.STRING,
              description: 'Garment color name or code, or empty string if absent.',
            },
            qty: {
              type: Type.NUMBER,
              description: 'Numeric piece quantity (integer), or 0 if not shown.',
            },
          },
          required: ['pgNumber', 'poNumber', 'color', 'qty'],
        },
      },
    },
    required: ['sourceRecords'],
  };

  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28_000);
    try {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64,
                },
              },
            ],
          },
        ],
        config: {
          abortSignal: controller.signal,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      clearTimeout(timer);
      break;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const errText = err instanceof Error ? err.message : String(err);
      const isTransient =
        /\b(503|502|504|unavailable|high demand|overloaded|timed?\s*out|abort)\b/i.test(errText) ||
        (err instanceof Error && err.name === 'AbortError');
      if (!isTransient || attempt >= 1) {
        let parsedMsg = errText;
        try {
          const jsonErr = JSON.parse(errText) as { error?: { message?: string } };
          if (jsonErr?.error?.message) parsedMsg = jsonErr.error.message;
        } catch {
          // keep raw errText
        }
        throw new Error(parsedMsg);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  const rawText = (response?.text ?? '').trim();
  if (!rawText) {
    if (lastError instanceof Error) throw lastError;
    throw new Error('Gemini OCR did not return a readable response.');
  }

  const parsed = parseOcrJson(rawText);
  if (!parsed || !Array.isArray(parsed.sourceRecords)) {
    return { sourceRecords: [] };
  }

  const sanitized: ExtractedSourcePoRecord[] = [];
  for (const item of parsed.sourceRecords.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue;
    const rawPg = typeof item.pgNumber === 'string' ? item.pgNumber.trim().slice(0, 60) : '';
    const rawPo = typeof item.poNumber === 'string' ? item.poNumber.trim().slice(0, 60) : '';
    const rawColor = typeof item.color === 'string' ? item.color.trim().slice(0, 80) : '';
    const numQty =
      typeof item.qty === 'number' && Number.isFinite(item.qty) && item.qty >= 0
        ? Math.round(item.qty)
        : 0;
    if (!rawPg && !rawPo) continue;
    sanitized.push({
      pgNumber: rawPg,
      poNumber: rawPo,
      color: rawColor,
      qty: numQty,
    });
  }

  return { sourceRecords: sanitized };
}
