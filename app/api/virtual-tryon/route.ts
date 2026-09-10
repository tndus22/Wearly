import { Client, handle_file } from '@gradio/client';
import { NextResponse } from 'next/server';
import sharp, { type OverlayOptions } from 'sharp';
import type { BodyGuide, BodyPointName } from '@/lib/body-guide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const FASHN_SPACE_ID = 'fashn-ai/FASHN-VTON-1.5';
const FASHN_SPACE_ORIGIN = 'https://fashn-ai-fashn-vton-1-5.hf.space';
const CATVTON_SPACE_ID = 'zhengchong/CatVTON';
const CATVTON_SPACE_ORIGIN = 'https://zhengchong-catvton.hf.space';
const PRECISION_SPACES = [
  {
    name: 'FASHN VTON 1.5',
    infoUrl: FASHN_SPACE_ORIGIN + '/gradio_api/info',
  },
  {
    name: 'CatVTON',
    infoUrl: CATVTON_SPACE_ORIGIN + '/gradio_api/info',
  },
] as const;
const SPACE_RESULT_ORIGINS = new Set([FASHN_SPACE_ORIGIN, CATVTON_SPACE_ORIGIN]);
const MAX_PERSON_DATA_LENGTH = 3_900_000;
const MAX_PERSON_MASK_DATA_LENGTH = 900_000;
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PRODUCTS = 4;
const dataImagePattern = /^data:image\/(?:jpe?g|png|webp);base64,/i;
const dataMaskPattern = /^data:image\/png;base64,/i;

type FitProduct = {
  id: string;
  name: string;
  category: string;
  imageUrl: string;
  sourceUrl?: string;
};

type FitProfile = {
  heightCm?: number;
  weightKg?: number;
  fatDistribution?: 'upper' | 'balanced' | 'lower';
};

type TryOnPayload = {
  personImage?: string;
  products?: FitProduct[];
};

type GradioImage = {
  path?: string | null;
  url?: string | null;
};

type GradioClient = Awaited<ReturnType<typeof Client.connect>>;

type AppliedItem = Pick<FitProduct, 'id' | 'name' | 'category'>;

type OverlayPlacement = {
  width: number;
  height: number;
  left: number;
  top: number;
};

type CanvasPoint = {
  x: number;
  y: number;
  visibility: number;
};

type BodyMetrics = {
  centerX: number;
  headTop: number;
  shoulderY: number;
  hipY: number;
  kneeY: number;
  ankleY: number;
  shoulderWidth: number;
  hipWidth: number;
  source: 'pose' | 'silhouette' | 'default';
};

type SubjectBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  topWidthRatio?: number;
};

const CANVAS_WIDTH = 768;
const CANVAS_HEIGHT = 1_024;

function isValidHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return !(
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host)
    );
  } catch {
    return false;
  }
}

function isAllowedProductImageUrl(value: string) {
  if (isValidHttpsUrl(value)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function clothTypeForCategory(category: string) {
  if (category === '상의' || category === '아우터') return 'upper';
  if (category === '하의') return 'lower';
  if (category === '원피스') return 'overall';
  return null;
}

function fashnCategoryForCategory(category: string) {
  if (category === '상의' || category === '아우터') return 'tops';
  if (category === '하의') return 'bottoms';
  if (category === '원피스') return 'one-pieces';
  return null;
}

function decodePersonImage(value: string) {
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) throw new Error('INVALID_PERSON_IMAGE');
  const buffer = Buffer.from(value.slice(commaIndex + 1), 'base64');
  if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error('INVALID_PERSON_IMAGE');
  }
  return buffer;
}

async function toPng(input: Buffer) {
  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .png({ compressionLevel: 7 })
    .toBuffer();
}

function pngFile(input: Buffer, name: string) {
  return new File([new Uint8Array(input)], name, { type: 'image/png' });
}

async function fetchImage(url: string, referer?: string) {
  if (!isAllowedProductImageUrl(url)) throw new Error('INVALID_PRODUCT_IMAGE');

  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      ...(referer && isValidHttpsUrl(referer) ? { Referer: referer } : {}),
    },
  });

  if (!response.ok || !isAllowedProductImageUrl(response.url)) {
    throw new Error('PRODUCT_IMAGE_UNAVAILABLE');
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (!contentType.startsWith('image/') || contentLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error('PRODUCT_IMAGE_UNAVAILABLE');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error('PRODUCT_IMAGE_UNAVAILABLE');
  }
  return buffer;
}

async function fetchSpaceResult(url: string) {
  const parsed = new URL(url);
  if (!SPACE_RESULT_ORIGINS.has(parsed.origin)) throw new Error('INVALID_SPACE_RESULT');
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !SPACE_RESULT_ORIGINS.has(new URL(response.url).origin)) {
    throw new Error('SPACE_RESULT_UNAVAILABLE');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error('SPACE_RESULT_UNAVAILABLE');
  }
  return buffer;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Retained with the offline diagnostic compositor below.
function sanitizeBodyGuide(value: unknown): BodyGuide | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<BodyGuide>;
  const imageWidth = Number(candidate.imageWidth);
  const imageHeight = Number(candidate.imageHeight);
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth < 32 ||
    imageHeight < 32 ||
    imageWidth > 12_000 ||
    imageHeight > 12_000 ||
    !candidate.points ||
    typeof candidate.points !== 'object'
  ) {
    return null;
  }

  const pointNames: BodyPointName[] = [
    'nose',
    'leftEar',
    'rightEar',
    'leftShoulder',
    'rightShoulder',
    'leftElbow',
    'rightElbow',
    'leftWrist',
    'rightWrist',
    'leftHip',
    'rightHip',
    'leftKnee',
    'rightKnee',
    'leftAnkle',
    'rightAnkle',
    'leftHeel',
    'rightHeel',
    'leftFoot',
    'rightFoot',
  ];
  const points: BodyGuide['points'] = {};

  for (const name of pointNames) {
    const point = candidate.points[name];
    if (!point) continue;
    const x = Number(point.x);
    const y = Number(point.y);
    const visibility = Number(point.visibility);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) {
      continue;
    }
    points[name] = {
      x: clampNumber(x, 0, 1),
      y: clampNumber(y, 0, 1),
      visibility: Number.isFinite(visibility) ? clampNumber(visibility, 0, 1) : 0,
    };
  }

  const required: BodyPointName[] = ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'];
  if (required.some((name) => !points[name] || (points[name]?.visibility ?? 0) < 0.25)) {
    return null;
  }

  const segmentationMask =
    typeof candidate.segmentationMask === 'string' &&
    candidate.segmentationMask.length <= MAX_PERSON_MASK_DATA_LENGTH &&
    dataMaskPattern.test(candidate.segmentationMask)
      ? candidate.segmentationMask
      : undefined;

  return {
    imageWidth,
    imageHeight,
    confidence: clampNumber(Number(candidate.confidence) || 0, 0, 1),
    points,
    segmentationMask,
  };
}

function mapGuideToCanvas(guide: BodyGuide) {
  const scale = Math.min(CANVAS_WIDTH / guide.imageWidth, CANVAS_HEIGHT / guide.imageHeight);
  const offsetX = (CANVAS_WIDTH - guide.imageWidth * scale) / 2;
  const offsetY = (CANVAS_HEIGHT - guide.imageHeight * scale) / 2;
  const points: Partial<Record<BodyPointName, CanvasPoint>> = {};

  for (const [name, point] of Object.entries(guide.points) as Array<
    [BodyPointName, BodyGuide['points'][BodyPointName]]
  >) {
    if (!point) continue;
    points[name] = {
      x: offsetX + point.x * guide.imageWidth * scale,
      y: offsetY + point.y * guide.imageHeight * scale,
      visibility: point.visibility,
    };
  }
  return points;
}

function visiblePoint(
  points: Partial<Record<BodyPointName, CanvasPoint>>,
  name: BodyPointName,
) {
  const point = points[name];
  return point && point.visibility >= 0.25 ? point : null;
}

function averageVisiblePoint(
  points: Partial<Record<BodyPointName, CanvasPoint>>,
  names: BodyPointName[],
) {
  const found = names
    .map((name) => visiblePoint(points, name))
    .filter((point): point is CanvasPoint => Boolean(point));
  if (!found.length) return null;
  return {
    x: average(found.map((point) => point.x)),
    y: average(found.map((point) => point.y)),
    visibility: average(found.map((point) => point.visibility)),
  };
}

function metricsFromGuide(guide: BodyGuide): BodyMetrics | null {
  const points = mapGuideToCanvas(guide);
  const leftShoulder = visiblePoint(points, 'leftShoulder');
  const rightShoulder = visiblePoint(points, 'rightShoulder');
  const leftHip = visiblePoint(points, 'leftHip');
  const rightHip = visiblePoint(points, 'rightHip');
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return null;

  const shoulderCenter = averageVisiblePoint(points, ['leftShoulder', 'rightShoulder']);
  const hipCenter = averageVisiblePoint(points, ['leftHip', 'rightHip']);
  if (!shoulderCenter || !hipCenter) return null;

  const knees = averageVisiblePoint(points, ['leftKnee', 'rightKnee']);
  const ankles = averageVisiblePoint(points, [
    'leftAnkle',
    'rightAnkle',
    'leftHeel',
    'rightHeel',
    'leftFoot',
    'rightFoot',
  ]);
  const nose = visiblePoint(points, 'nose');
  const ears = averageVisiblePoint(points, ['leftEar', 'rightEar']);
  const shoulderWidth = Math.max(56, Math.abs(leftShoulder.x - rightShoulder.x));
  const hipWidth = Math.max(48, Math.abs(leftHip.x - rightHip.x));
  const torsoHeight = Math.max(90, hipCenter.y - shoulderCenter.y);
  const estimatedAnkle = hipCenter.y + torsoHeight * 2.15;
  const ankleY = clampNumber(ankles?.y ?? estimatedAnkle, hipCenter.y + torsoHeight, CANVAS_HEIGHT - 14);
  const kneeY = clampNumber(knees?.y ?? hipCenter.y + (ankleY - hipCenter.y) * 0.5, hipCenter.y + 40, ankleY - 30);
  const faceCenterY = nose?.y ?? ears?.y ?? shoulderCenter.y - shoulderWidth * 0.52;
  const headTop = clampNumber(faceCenterY - shoulderWidth * 0.42, 0, shoulderCenter.y - 20);

  return {
    centerX: clampNumber((shoulderCenter.x * 0.58 + hipCenter.x * 0.42), 40, CANVAS_WIDTH - 40),
    headTop,
    shoulderY: shoulderCenter.y,
    hipY: hipCenter.y,
    kneeY,
    ankleY,
    shoulderWidth,
    hipWidth,
    source: 'pose',
  };
}

function metricsFromBounds(bounds: SubjectBounds): BodyMetrics {
  const bottom = bounds.top + bounds.height;
  const detectedCenter = bounds.left + bounds.width / 2;
  return {
    centerX: clampNumber(
      detectedCenter,
      CANVAS_WIDTH * 0.44,
      CANVAS_WIDTH * 0.56,
    ),
    headTop: bounds.top,
    shoulderY: bounds.top + bounds.height * 0.19,
    hipY: bounds.top + bounds.height * 0.52,
    kneeY: bounds.top + bounds.height * 0.73,
    ankleY: bottom - bounds.height * 0.025,
    shoulderWidth: clampNumber(
      Math.min(bounds.width * 0.58, bounds.height * 0.25),
      CANVAS_WIDTH * 0.18,
      CANVAS_WIDTH * 0.36,
    ),
    hipWidth: clampNumber(
      Math.min(bounds.width * 0.46, bounds.height * 0.19),
      CANVAS_WIDTH * 0.14,
      CANVAS_WIDTH * 0.3,
    ),
    source: 'silhouette',
  };
}

function defaultBodyMetrics(): BodyMetrics {
  return {
    centerX: CANVAS_WIDTH / 2,
    headTop: CANVAS_HEIGHT * 0.045,
    shoulderY: CANVAS_HEIGHT * 0.2,
    hipY: CANVAS_HEIGHT * 0.52,
    kneeY: CANVAS_HEIGHT * 0.73,
    ankleY: CANVAS_HEIGHT * 0.94,
    shoulderWidth: CANVAS_WIDTH * 0.29,
    hipWidth: CANVAS_WIDTH * 0.22,
    source: 'default',
  };
}

function constrainedPlacement(
  centerX: number,
  top: number,
  width: number,
  height: number,
): OverlayPlacement {
  const safeWidth = Math.round(clampNumber(width, 70, CANVAS_WIDTH * 0.82));
  const safeHeight = Math.round(clampNumber(height, 70, CANVAS_HEIGHT * 0.88));
  const safeLeft = Math.round(clampNumber(centerX - safeWidth / 2, 0, CANVAS_WIDTH - safeWidth));
  const safeTop = Math.round(clampNumber(top, 0, CANVAS_HEIGHT - safeHeight));
  return { width: safeWidth, height: safeHeight, left: safeLeft, top: safeTop };
}

function overlayPlacement(
  category: string,
  metrics: BodyMetrics,
  profile?: FitProfile,
): OverlayPlacement {
  const torsoHeight = Math.max(90, metrics.hipY - metrics.shoulderY);
  const legHeight = Math.max(180, metrics.ankleY - metrics.hipY);
  const bodyHeight = Math.max(420, metrics.ankleY - metrics.headTop);
  const upperBias = profile?.fatDistribution === 'upper' ? 1.05 : profile?.fatDistribution === 'lower' ? 0.98 : 1;
  const lowerBias = profile?.fatDistribution === 'lower' ? 1.05 : profile?.fatDistribution === 'upper' ? 0.98 : 1;
  const shoulderCenterX = metrics.centerX;

  if (category === '하의') {
    const waistY = metrics.hipY - torsoHeight * 0.32;
    const width =
      Math.max(metrics.hipWidth * 1.9, metrics.shoulderWidth * 1.24) * lowerBias;
    return constrainedPlacement(
      shoulderCenterX,
      waistY,
      width,
      metrics.ankleY - waistY + legHeight * 0.025,
    );
  }
  if (category === '원피스') {
    const width =
      Math.max(metrics.shoulderWidth * 1.55, metrics.hipWidth * 1.55) *
      Math.max(upperBias, lowerBias);
    return constrainedPlacement(
      shoulderCenterX,
      metrics.shoulderY - metrics.shoulderWidth * 0.2,
      width,
      metrics.ankleY - metrics.shoulderY + metrics.shoulderWidth * 0.08,
    );
  }
  if (category === '아우터') {
    const width =
      Math.max(metrics.shoulderWidth * 1.72, metrics.hipWidth * 1.48) * upperBias;
    return constrainedPlacement(
      shoulderCenterX,
      metrics.shoulderY - metrics.shoulderWidth * 0.24,
      width,
      Math.max(torsoHeight * 1.58, metrics.kneeY - metrics.shoulderY),
    );
  }
  if (category === '신발') {
    const width = Math.max(metrics.hipWidth * 1.45, metrics.shoulderWidth * 1.05);
    return constrainedPlacement(
      shoulderCenterX,
      metrics.ankleY - bodyHeight * 0.035,
      width,
      bodyHeight * 0.13,
    );
  }
  const width =
    Math.max(metrics.shoulderWidth * 1.58, metrics.hipWidth * 1.35) * upperBias;
  return constrainedPlacement(
    shoulderCenterX,
    metrics.shoulderY - metrics.shoulderWidth * 0.22,
    width,
    torsoHeight * 1.24,
  );
}

function colorDistance(first: number[], second: number[]) {
  return Math.sqrt(
    Math.pow(first[0] - second[0], 2) +
      Math.pow(first[1] - second[1], 2) +
      Math.pow(first[2] - second[2], 2),
  );
}

function median(values: number[]) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function detectSubjectBounds(
  input: Buffer,
  sourceWidth: number,
  sourceHeight: number,
): Promise<SubjectBounds | null> {
  const sampleWidth = 192;
  const sampleHeight = Math.max(128, Math.round(sampleWidth * (sourceHeight / sourceWidth)));
  const normalized = await sharp(input, { limitInputPixels: 40_000_000 })
    .resize(sampleWidth, sampleHeight, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = normalized;
  const channels = info.channels;
  const patchSize = Math.max(4, Math.round(Math.min(sampleWidth, sampleHeight) * 0.045));
  const borderSamples: number[][] = [];

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const inCorner =
        (x < patchSize || x >= sampleWidth - patchSize) &&
        (y < patchSize || y >= sampleHeight - patchSize);
      if (!inCorner) continue;
      const index = (y * sampleWidth + x) * channels;
      borderSamples.push([data[index], data[index + 1], data[index + 2]]);
    }
  }

  if (!borderSamples.length) return null;
  const background = [0, 1, 2].map((channel) =>
    median(borderSamples.map((color) => color[channel])),
  );
  const backgroundNoise = median(
    borderSamples.map((color) => colorDistance(color, background)),
  );
  const threshold = clampNumber(30 + backgroundNoise * 1.8, 32, 74);
  const mask = new Uint8Array(sampleWidth * sampleHeight);

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = y * sampleWidth + x;
      const pixelIndex = index * channels;
      const distance = colorDistance(
        [data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]],
        background,
      );
      if (distance > threshold) mask[index] = 1;
    }
  }

  const joinedMask = new Uint8Array(mask.length);
  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const index = y * sampleWidth + x;
      for (let offsetY = -1; offsetY <= 1 && !joinedMask[index]; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (mask[(y + offsetY) * sampleWidth + x + offsetX]) {
            joinedMask[index] = 1;
            break;
          }
        }
      }
    }
  }

  const visited = new Uint8Array(joinedMask.length);
  const queue = new Int32Array(joinedMask.length);
  let best: { left: number; top: number; right: number; bottom: number; score: number } | null = null;

  for (let start = 0; start < joinedMask.length; start += 1) {
    if (!joinedMask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let area = 0;
    let left = sampleWidth;
    let right = 0;
    let top = sampleHeight;
    let bottom = 0;

    while (head < tail) {
      const index = queue[head++];
      const x = index % sampleWidth;
      const y = Math.floor(index / sampleWidth);
      area += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= sampleWidth || nextY < 0 || nextY >= sampleHeight) continue;
          const nextIndex = nextY * sampleWidth + nextX;
          if (!joinedMask[nextIndex] || visited[nextIndex]) continue;
          visited[nextIndex] = 1;
          queue[tail++] = nextIndex;
        }
      }
    }

    const width = right - left + 1;
    const height = bottom - top + 1;
    if (area < sampleWidth * sampleHeight * 0.008 || height < sampleHeight * 0.3) continue;
    const componentCenter = (left + right) / 2;
    const centerDistance = Math.abs(componentCenter - sampleWidth / 2) / (sampleWidth / 2);
    const centerWeight = clampNumber(1.5 - centerDistance, 0.5, 1.5);
    const shapeWeight = clampNumber(height / Math.max(width, 1), 0.8, 3.2);
    const score = area * centerWeight * shapeWeight;
    if (!best || score > best.score) best = { left, right, top, bottom, score };
  }

  if (!best) return null;
  const widthRatio = (best.right - best.left + 1) / sampleWidth;
  const heightRatio = (best.bottom - best.top + 1) / sampleHeight;
  if (widthRatio > 0.9 || heightRatio < 0.42) return null;

  const expandX = sampleWidth * 0.012;
  const expandY = sampleHeight * 0.008;
  const left = clampNumber(best.left - expandX, 0, sampleWidth);
  const right = clampNumber(best.right + expandX, 0, sampleWidth);
  const top = clampNumber(best.top - expandY, 0, sampleHeight);
  const bottom = clampNumber(best.bottom + expandY, 0, sampleHeight);
  const headBandBottom = Math.min(
    best.bottom,
    Math.ceil(best.top + (best.bottom - best.top + 1) * 0.12),
  );
  let headLeft = sampleWidth;
  let headRight = -1;
  for (let y = best.top; y <= headBandBottom; y += 1) {
    for (let x = best.left; x <= best.right; x += 1) {
      if (!joinedMask[y * sampleWidth + x]) continue;
      headLeft = Math.min(headLeft, x);
      headRight = Math.max(headRight, x);
    }
  }
  const topWidthRatio =
    headRight >= headLeft
      ? (headRight - headLeft + 1) / Math.max(1, best.right - best.left + 1)
      : 1;
  return {
    left: (left / sampleWidth) * sourceWidth,
    top: (top / sampleHeight) * sourceHeight,
    width: ((right - left) / sampleWidth) * sourceWidth,
    height: ((bottom - top) / sampleHeight) * sourceHeight,
    topWidthRatio,
  };
}

function mapBoundsToCanvas(
  bounds: SubjectBounds,
  sourceWidth: number,
  sourceHeight: number,
): SubjectBounds {
  const scale = Math.min(CANVAS_WIDTH / sourceWidth, CANVAS_HEIGHT / sourceHeight);
  const offsetX = (CANVAS_WIDTH - sourceWidth * scale) / 2;
  const offsetY = (CANVAS_HEIGHT - sourceHeight * scale) / 2;
  return {
    left: offsetX + bounds.left * scale,
    top: offsetY + bounds.top * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
    topWidthRatio: bounds.topWidthRatio,
  };
}

function visibleWidthRatioInBand(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
  startRatio: number,
  endRatio: number,
) {
  const startY = Math.floor(height * startRatio);
  const endY = Math.max(startY + 1, Math.ceil(height * endRatio));
  let left = width;
  let right = -1;
  for (let y = startY; y < Math.min(height, endY); y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * channels + 3];
      if (alpha < 48) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return right >= left ? (right - left + 1) / width : 0;
}

function categoryVerticalRange(category: string): [number, number] | null {
  if (category === '하의') return [0.45, 0.88];
  if (category === '상의' || category === '아우터') return [0.14, 0.56];
  if (category === '원피스') return [0.13, 0.84];
  if (category === '신발') return [0.79, 1];
  return null;
}

type ProductSource = {
  image: Buffer;
  width: number;
  height: number;
  crop?: { left: number; top: number; width: number; height: number };
};

async function cropSourcePhotoToGarment(input: Buffer, category: string) {
  const range = categoryVerticalRange(category);
  const oriented = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  const original: ProductSource = {
    image: oriented.data,
    width: oriented.info.width,
    height: oriented.info.height,
  };
  if (!range) return original;
  const bounds = await detectSubjectBounds(
    oriented.data,
    oriented.info.width,
    oriented.info.height,
  );
  if (!bounds) return original;

  const subjectAspect = bounds.height / Math.max(1, bounds.width);
  const subjectHeightRatio = bounds.height / oriented.info.height;
  const topWidthRatio = bounds.topWidthRatio ?? 1;
  const likelyFullPerson =
    subjectHeightRatio >= 0.58 &&
    topWidthRatio < 0.82 &&
    (subjectAspect >= 2.3 || (subjectHeightRatio >= 0.85 && topWidthRatio < 0.65));
  if (!likelyFullPerson) return original;

  const [startRatio, endRatio] = range;
  const detectedCenterX = bounds.left + bounds.width / 2;
  const centerX = clampNumber(
    detectedCenterX,
    oriented.info.width * 0.42,
    oriented.info.width * 0.58,
  );
  const horizontalRatio =
    category === '하의' ? 0.62 : category === '신발' ? 0.62 : 0.92;
  const cropWidth = Math.min(
    oriented.info.width * 0.78,
    Math.max(32, bounds.width * horizontalRatio),
  );
  const left = Math.floor(
    clampNumber(centerX - cropWidth / 2, 0, oriented.info.width - 1),
  );
  const right = Math.ceil(
    clampNumber(centerX + cropWidth / 2, left + 1, oriented.info.width),
  );
  const top = Math.floor(
    clampNumber(bounds.top + bounds.height * startRatio, 0, oriented.info.height - 1),
  );
  const bottom = Math.ceil(
    clampNumber(
      bounds.top + bounds.height * endRatio,
      top + 1,
      oriented.info.height,
    ),
  );
  return {
    ...original,
    crop: { left, top, width: right - left, height: bottom - top },
  };
}

async function preparePrecisionGarment(input: Buffer, category: string) {
  const source = await cropSourcePhotoToGarment(input, category);
  const image = await sharp(source.image, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1_200, height: 1_200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png({ compressionLevel: 7 })
    .toBuffer();

  return {
    image,
    photoType: source.crop ? ('model' as const) : ('flat-lay' as const),
  };
}

async function cropWornModelToCategory(input: Buffer, category: string) {
  const analysis = await sharp(input)
    .resize({ width: 360, height: 640, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = analysis.info;
  const aspectRatio = height / Math.max(1, width);
  const headBandWidth = visibleWidthRatioInBand(
    analysis.data,
    width,
    height,
    channels,
    0,
    0.1,
  );
  const torsoBandWidth = visibleWidthRatioInBand(
    analysis.data,
    width,
    height,
    channels,
    0.24,
    0.5,
  );
  const likelyFullPerson =
    aspectRatio >= 2.35 &&
    headBandWidth > 0 &&
    torsoBandWidth > 0 &&
    headBandWidth < Math.min(0.76, torsoBandWidth * 0.82);

  if (!likelyFullPerson) return input;

  const range = categoryVerticalRange(category);
  if (!range) return input;
  const [startRatio, endRatio] = range;

  const metadata = await sharp(input).metadata();
  const inputWidth = metadata.width ?? 0;
  const inputHeight = metadata.height ?? 0;
  if (!inputWidth || !inputHeight) return input;
  const top = Math.floor(inputHeight * startRatio);
  const cropHeight = Math.max(1, Math.min(inputHeight - top, Math.ceil(inputHeight * (endRatio - startRatio))));
  return sharp(input)
    .extract({ left: 0, top, width: inputWidth, height: cropHeight })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .png()
    .toBuffer();
}

function isLikelySkinTone(red: number, green: number, blue: number) {
  const cb = 128 - 0.168736 * red - 0.331264 * green + 0.5 * blue;
  const cr = 128 + 0.5 * red - 0.418688 * green - 0.081312 * blue;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 178 && red > 55;
}

async function removePeripheralSkin(input: Buffer, category: string) {
  if (category === '신발') return input;
  const source = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = source.info;
  const pixels = source.data;

  for (let y = 0; y < height; y += 1) {
    const yRatio = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const xRatio = x / Math.max(1, width - 1);
      const isPeripheral =
        category === '하의'
          ? yRatio < 0.34 && (xRatio < 0.33 || xRatio > 0.67)
          : xRatio < 0.25 || xRatio > 0.75;
      if (!isPeripheral) continue;
      const index = (y * width + x) * channels;
      if (pixels[index + 3] < 12) continue;
      if (isLikelySkinTone(pixels[index], pixels[index + 1], pixels[index + 2])) {
        pixels[index + 3] = 0;
      }
    }
  }

  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function removeProductBackground(
  input: Buffer,
  width: number,
  height: number,
  category: string,
) {
  const productSource = await cropSourcePhotoToGarment(input, category);
  const normalized = await sharp(productSource.image, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1_200, height: 1_200, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = normalized.data;
  const { width: sourceWidth, height: sourceHeight, channels } = normalized.info;
  let transparentPixels = 0;
  for (let index = 0; index < pixels.length; index += channels) {
    if (pixels[index + 3] < 245) transparentPixels += 1;
  }
  const hasExistingTransparency =
    transparentPixels / Math.max(1, sourceWidth * sourceHeight) > 0.005;

  if (!hasExistingTransparency) {
    const edgePositions = [0, 0.06, 0.18, 0.82, 0.94, 1];
    const sampleCoordinates: Array<[number, number]> = [];
    for (const position of edgePositions) {
      const x = Math.round((sourceWidth - 1) * position);
      const y = Math.round((sourceHeight - 1) * position);
      sampleCoordinates.push(
        [x, 0],
        [x, sourceHeight - 1],
        [0, y],
        [sourceWidth - 1, y],
      );
    }
    const backgroundSamples = sampleCoordinates.map(([x, y]) => {
      const index = (y * sourceWidth + x) * channels;
      return [pixels[index], pixels[index + 1], pixels[index + 2]];
    });
    const channelMedian = [0, 1, 2].map((channel) =>
      median(backgroundSamples.map((color) => color[channel])),
    );
    const backgroundSpread = median(
      backgroundSamples.map((color) => colorDistance(color, channelMedian)),
    );
    const transparentDistance = backgroundSpread > 55 ? 17 : 24;
    const featherDistance = transparentDistance + 56;

    for (let index = 0; index < pixels.length; index += channels) {
      if (pixels[index + 3] <= 4) continue;
      const color = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const distance = Math.min(
        ...backgroundSamples.map((background) => colorDistance(color, background)),
      );
      if (distance <= transparentDistance) {
        pixels[index + 3] = 0;
      } else if (distance < featherDistance) {
        pixels[index + 3] = Math.round(
          pixels[index + 3] * ((distance - transparentDistance) / 56),
        );
      }
    }
  }

  const transparentSource = await sharp(pixels, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 4 },
  })
    .png()
    .toBuffer();
  let croppedSource: Buffer = transparentSource;
  if (productSource.crop) {
    const scaleX = sourceWidth / productSource.width;
    const scaleY = sourceHeight / productSource.height;
    const left = Math.floor(
      clampNumber(productSource.crop.left * scaleX, 0, sourceWidth - 1),
    );
    const top = Math.floor(
      clampNumber(productSource.crop.top * scaleY, 0, sourceHeight - 1),
    );
    const right = Math.ceil(
      clampNumber(
        (productSource.crop.left + productSource.crop.width) * scaleX,
        left + 1,
        sourceWidth,
      ),
    );
    const bottom = Math.ceil(
      clampNumber(
        (productSource.crop.top + productSource.crop.height) * scaleY,
        top + 1,
        sourceHeight,
      ),
    );
    croppedSource = await sharp(transparentSource)
      .extract({
        left,
        top,
        width: right - left,
        height: bottom - top,
      })
      .png()
      .toBuffer();
    croppedSource = await removePeripheralSkin(croppedSource, category);
  }
  const foreground = await sharp(croppedSource)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .png()
    .toBuffer();
  const categoryForeground = productSource.crop
    ? foreground
    : await cropWornModelToCategory(foreground, category);

  return sharp(categoryForeground)
    .resize({
      width,
      height,
      fit: category === '신발' ? 'contain' : 'fill',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

function smoothStep(edgeStart: number, edgeEnd: number, value: number) {
  if (edgeStart === edgeEnd) return value >= edgeEnd ? 1 : 0;
  const normalized = clampNumber((value - edgeStart) / (edgeEnd - edgeStart), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function verticalRangeStrength(y: number, start: number, end: number, feather = 14) {
  const enters = smoothStep(start - feather, start + feather, y);
  const exits = 1 - smoothStep(end - feather, end + feather, y);
  return enters * exits;
}

function distanceToSegment(
  x: number,
  y: number,
  start: CanvasPoint,
  end: CanvasPoint,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(x - start.x, y - start.y);
  const position = clampNumber(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(x - (start.x + dx * position), y - (start.y + dy * position));
}

function capsuleStrength(distance: number, radius: number) {
  return 1 - smoothStep(radius * 0.72, radius * 1.2, distance);
}

function armPreserveStrength(
  x: number,
  y: number,
  points: Partial<Record<BodyPointName, CanvasPoint>> | null,
  shoulderWidth: number,
  preserveWholeArms: boolean,
) {
  if (!points) return 0;
  const radius = clampNumber(shoulderWidth * 0.085, 10, 24);
  let strength = 0;

  for (const side of ['left', 'right'] as const) {
    const shoulder = visiblePoint(points, `${side}Shoulder` as BodyPointName);
    const elbow = visiblePoint(points, `${side}Elbow` as BodyPointName);
    const wrist = visiblePoint(points, `${side}Wrist` as BodyPointName);
    if (!wrist) continue;

    strength = Math.max(
      strength,
      capsuleStrength(Math.hypot(x - wrist.x, y - wrist.y), radius * 1.35),
    );

    if (elbow) {
      const handStart: CanvasPoint = {
        x: elbow.x + (wrist.x - elbow.x) * 0.72,
        y: elbow.y + (wrist.y - elbow.y) * 0.72,
        visibility: Math.min(elbow.visibility, wrist.visibility),
      };
      strength = Math.max(
        strength,
        capsuleStrength(
          distanceToSegment(x, y, preserveWholeArms ? elbow : handStart, wrist),
          radius,
        ),
      );
    }

    if (preserveWholeArms && shoulder && elbow) {
      strength = Math.max(
        strength,
        capsuleStrength(distanceToSegment(x, y, shoulder, elbow), radius * 1.18),
      );
    }
  }

  return strength;
}

function replacementZoneStrength(y: number, products: FitProduct[], metrics: BodyMetrics) {
  const torsoHeight = Math.max(90, metrics.hipY - metrics.shoulderY);
  const bodyHeight = Math.max(420, metrics.ankleY - metrics.headTop);
  const replacesDress = products.some((product) => product.category === '원피스');
  const replacesUpper = products.some(
    (product) => product.category === '상의' || product.category === '아우터',
  );
  const replacesLower = products.some((product) => product.category === '하의');
  const replacesShoes = products.some((product) => product.category === '신발');
  let strength = 0;

  if (replacesDress) {
    strength = Math.max(
      strength,
      verticalRangeStrength(
        y,
        metrics.shoulderY - metrics.shoulderWidth * 0.3,
        metrics.ankleY + bodyHeight * 0.025,
      ),
    );
  }
  if (replacesUpper) {
    strength = Math.max(
      strength,
      verticalRangeStrength(
        y,
        metrics.shoulderY - metrics.shoulderWidth * 0.3,
        metrics.hipY + torsoHeight * 0.16,
      ),
    );
  }
  if (replacesLower) {
    strength = Math.max(
      strength,
      verticalRangeStrength(
        y,
        metrics.hipY - torsoHeight * 0.38,
        metrics.ankleY + bodyHeight * 0.025,
      ),
    );
  }
  if (replacesShoes) {
    strength = Math.max(
      strength,
      verticalRangeStrength(
        y,
        metrics.ankleY - bodyHeight * 0.045,
        Math.min(CANVAS_HEIGHT, metrics.ankleY + bodyHeight * 0.13),
        8,
      ),
    );
  }

  return strength;
}

function fallbackPersonStrength(x: number, y: number, metrics: BodyMetrics) {
  if (y < metrics.shoulderY - metrics.shoulderWidth * 0.35 || y > metrics.ankleY + 40) {
    return 0;
  }

  let halfWidth: number;
  if (y <= metrics.hipY) {
    const position = clampNumber(
      (y - metrics.shoulderY) / Math.max(1, metrics.hipY - metrics.shoulderY),
      0,
      1,
    );
    halfWidth =
      (metrics.shoulderWidth * 0.78) * (1 - position) +
      (Math.max(metrics.hipWidth * 1.02, metrics.shoulderWidth * 0.68)) * position;
  } else {
    const position = clampNumber(
      (y - metrics.hipY) / Math.max(1, metrics.ankleY - metrics.hipY),
      0,
      1,
    );
    halfWidth =
      Math.max(metrics.hipWidth * 1.25, metrics.shoulderWidth * 0.82) * (1 - position) +
      metrics.hipWidth * 0.45 * position;
  }

  return 1 - smoothStep(halfWidth - 8, halfWidth + 10, Math.abs(x - metrics.centerX));
}

async function normalizedPersonMask(bodyGuide?: BodyGuide | null) {
  const value = bodyGuide?.segmentationMask;
  if (!value || !dataMaskPattern.test(value) || value.length > MAX_PERSON_MASK_DATA_LENGTH) {
    return null;
  }
  const commaIndex = value.indexOf(',');
  if (commaIndex < 0) return null;
  const input = Buffer.from(value.slice(commaIndex + 1), 'base64');
  if (!input.length || input.length > MAX_PERSON_MASK_DATA_LENGTH) return null;

  const normalized = await sharp(input, { limitInputPixels: 4_000_000 })
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data: normalized.data,
    channels: normalized.info.channels,
  };
}

function createBackgroundPlate(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
  contentBounds: SubjectBounds,
) {
  const contentLeft = Math.round(clampNumber(contentBounds.left, 0, width - 1));
  const contentRight = Math.round(
    clampNumber(contentBounds.left + contentBounds.width - 1, contentLeft, width - 1),
  );
  const stripWidth = Math.max(8, Math.round(contentBounds.width * 0.065));
  const leftRows = new Float32Array(height * 3);
  const rightRows = new Float32Array(height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < stripWidth; x += 1) {
      const leftX = Math.min(contentRight, contentLeft + x);
      const rightX = Math.max(contentLeft, contentRight - x);
      const leftIndex = (y * width + leftX) * channels;
      const rightIndex = (y * width + rightX) * channels;
      for (let channel = 0; channel < 3; channel += 1) {
        leftRows[y * 3 + channel] += pixels[leftIndex + channel] / stripWidth;
        rightRows[y * 3 + channel] += pixels[rightIndex + channel] / stripWidth;
      }
    }
  }

  const output = Buffer.alloc(width * height * 3);
  const smoothingRadius = 7;
  for (let y = 0; y < height; y += 1) {
    const firstRow = Math.max(0, y - smoothingRadius);
    const lastRow = Math.min(height - 1, y + smoothingRadius);
    const rowCount = lastRow - firstRow + 1;
    const left = [0, 0, 0];
    const right = [0, 0, 0];
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        left[channel] += leftRows[row * 3 + channel] / rowCount;
        right[channel] += rightRows[row * 3 + channel] / rowCount;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const position = x / Math.max(1, width - 1);
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        output[index + channel] = Math.round(
          left[channel] * (1 - position) + right[channel] * position,
        );
      }
    }
  }
  return output;
}

async function prepareGarmentReplacementBase(
  baseImage: Buffer,
  products: FitProduct[],
  metrics: BodyMetrics,
  contentBounds: SubjectBounds,
  bodyGuide?: BodyGuide | null,
) {
  const original = await sharp(baseImage)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const personMask = await normalizedPersonMask(bodyGuide);
  const points = bodyGuide ? mapGuideToCanvas(bodyGuide) : null;
  const replacesUpper = products.some(
    (product) =>
      product.category === '상의' ||
      product.category === '아우터' ||
      product.category === '원피스',
  );
  const replacesLower = products.some(
    (product) => product.category === '하의' || product.category === '원피스',
  );
  const preserveWholeArms = replacesLower && !replacesUpper;
  const cleanupAlpha = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT);
  const preserveAlpha = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT);
  let hasCleanup = false;
  let hasPreserve = false;

  for (let y = 0; y < CANVAS_HEIGHT; y += 1) {
    const zoneStrength = replacementZoneStrength(y, products, metrics);
    if (zoneStrength <= 0) continue;
    for (let x = 0; x < CANVAS_WIDTH; x += 1) {
      const pixel = y * CANVAS_WIDTH + x;
      const personStrength = personMask
        ? personMask.data[pixel * personMask.channels] / 255
        : fallbackPersonStrength(x, y, metrics);
      if (personStrength <= 0.04) continue;

      const preserveStrength = armPreserveStrength(
        x,
        y,
        points,
        metrics.shoulderWidth,
        preserveWholeArms,
      );
      const eraseStrength = personStrength * zoneStrength * (1 - preserveStrength);
      const eraseValue = Math.round(clampNumber(eraseStrength, 0, 1) * 255);
      if (eraseValue > 0) {
        cleanupAlpha[pixel] = eraseValue;
        hasCleanup = true;
      }
      if (preserveStrength > 0.02) {
        preserveAlpha[pixel] = Math.round(clampNumber(preserveStrength, 0, 1) * 255);
        hasPreserve = true;
      }
    }
  }

  if (!hasCleanup) {
    return { image: baseImage, preservedForeground: null, method: 'none' as const };
  }

  const background = createBackgroundPlate(
    original.data,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    original.info.channels,
    contentBounds,
  );
  const backgroundCutout = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT * 4);
  const preservedCutout = hasPreserve
    ? Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT * 4)
    : null;

  for (let pixel = 0; pixel < CANVAS_WIDTH * CANVAS_HEIGHT; pixel += 1) {
    const backgroundIndex = pixel * 3;
    const originalIndex = pixel * original.info.channels;
    const outputIndex = pixel * 4;
    backgroundCutout[outputIndex] = background[backgroundIndex];
    backgroundCutout[outputIndex + 1] = background[backgroundIndex + 1];
    backgroundCutout[outputIndex + 2] = background[backgroundIndex + 2];
    backgroundCutout[outputIndex + 3] = cleanupAlpha[pixel];

    if (preservedCutout) {
      preservedCutout[outputIndex] = original.data[originalIndex];
      preservedCutout[outputIndex + 1] = original.data[originalIndex + 1];
      preservedCutout[outputIndex + 2] = original.data[originalIndex + 2];
      preservedCutout[outputIndex + 3] = preserveAlpha[pixel];
    }
  }

  const backgroundOverlay = await sharp(backgroundCutout, {
    raw: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, channels: 4 },
  })
    .png()
    .toBuffer();
  const preservedForeground = preservedCutout
      ? await sharp(preservedCutout, {
          raw: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, channels: 4 },
        })
        .png()
        .toBuffer()
    : null;

  return {
    image: await sharp(baseImage)
      .composite([{ input: backgroundOverlay, blend: 'over' }])
      .png()
      .toBuffer(),
    preservedForeground,
    method: personMask ? ('segmentation' as const) : ('geometry' as const),
  };
}

async function compositeProductImages(
  baseImage: Buffer,
  products: FitProduct[],
  bodyGuide?: BodyGuide | null,
  profile?: FitProfile,
) {
  const oriented = await sharp(baseImage, { limitInputPixels: 40_000_000 })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  const base = await sharp(oriented.data)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, {
      fit: 'contain',
      position: 'centre',
      background: { r: 244, g: 241, b: 234, alpha: 1 },
    })
    .png()
    .toBuffer();
  const contentScale = Math.min(
    CANVAS_WIDTH / oriented.info.width,
    CANVAS_HEIGHT / oriented.info.height,
  );
  const contentBounds: SubjectBounds = {
    left: (CANVAS_WIDTH - oriented.info.width * contentScale) / 2,
    top: (CANVAS_HEIGHT - oriented.info.height * contentScale) / 2,
    width: oriented.info.width * contentScale,
    height: oriented.info.height * contentScale,
  };
  const poseMetrics = bodyGuide ? metricsFromGuide(bodyGuide) : null;
  const subjectBounds = poseMetrics
    ? null
    : await detectSubjectBounds(oriented.data, oriented.info.width, oriented.info.height);
  const metrics =
    poseMetrics ??
    (subjectBounds
      ? metricsFromBounds(
          mapBoundsToCanvas(subjectBounds, oriented.info.width, oriented.info.height),
        )
      : defaultBodyMetrics());
  const replacementBase = await prepareGarmentReplacementBase(
    base,
    products,
    metrics,
    contentBounds,
    bodyGuide,
  );
  const composites: OverlayOptions[] = [];

  for (const product of products) {
    const placement = overlayPlacement(product.category, metrics, profile);
    const productImage = await fetchImage(product.imageUrl, product.sourceUrl);
    composites.push({
      input: await removeProductBackground(
        productImage,
        placement.width,
        placement.height,
        product.category,
      ),
      left: placement.left,
      top: placement.top,
      blend: 'over',
    });
  }

  let composed = await sharp(replacementBase.image).composite(composites).png().toBuffer();
  if (replacementBase.preservedForeground) {
    composed = await sharp(composed)
      .composite([{ input: replacementBase.preservedForeground, blend: 'over' }])
      .png()
      .toBuffer();
  }

  return {
    image: composed,
    alignment: metrics.source,
    replacement: replacementBase.method,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Diagnostic-only; generative failures must never fall back to this compositor.
async function createInstantPreview(
  personImage: string,
  products: FitProduct[],
  reason: 'quick' | 'fallback' | 'unsupported' = 'fallback',
  bodyGuide?: BodyGuide | null,
  profile?: FitProfile,
) {
  const instantPreview = await compositeProductImages(
    decodePersonImage(personImage),
    products,
    bodyGuide,
    profile,
  );
  const jpegResult = await sharp(instantPreview.image)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return {
    resultImage: 'data:image/jpeg;base64,' + jpegResult.toString('base64'),
    engine: 'Wearly 의상 교체',
    free: true,
    fallback: true,
    alignment: instantPreview.alignment,
    replacement: instantPreview.replacement,
    notice:
      reason === 'quick'
        ? instantPreview.replacement === 'segmentation'
          ? '사람 실루엣에서 기존 옷을 먼저 지운 뒤, 상의는 상체에 하의는 허리부터 발목까지 맞춰 새 옷을 배치했어요.'
          : '몸 좌표로 기존 옷 영역을 가린 뒤 선택한 옷을 맞춰 배치했어요. 정면 전신사진일수록 자연스러워요.'
        : reason === 'unsupported'
          ? '신발은 정밀 CatVTON 지원 대상이 아니어서 발목 위치에 맞춘 실제 상품사진 방식으로 적용했어요.'
          : instantPreview.replacement === 'segmentation'
            ? '무료 정밀 AI 한도가 차서 기존 의상 영역을 먼저 지우고 선택한 옷으로 교체했어요. 주름 생성은 정밀 AI보다 단순해요.'
            : '무료 정밀 AI 한도가 차서 몸 좌표 기반 의상 교체로 전환했어요. 주름 생성은 정밀 AI보다 단순해요.',
    appliedItems: products.map(({ id, name, category }) => ({ id, name, category })),
    skippedItems: [],
  };
}

async function predictWithFashn(
  client: GradioClient,
  personImage: Buffer,
  garmentImage: Buffer,
  product: FitProduct,
  garmentPhotoType: 'model' | 'flat-lay',
  index: number,
) {
  const category = fashnCategoryForCategory(product.category);
  if (!category) throw new Error('UNSUPPORTED_GARMENT_CATEGORY');

  const prediction = await client.predict('/try_on', {
    person_image: handle_file(pngFile(personImage, `person-${index}.png`)),
    garment_image: handle_file(pngFile(garmentImage, `garment-${index}.png`)),
    category,
    garment_photo_type: garmentPhotoType,
    num_timesteps: 40,
    guidance_scale: 1.5,
    seed: 42 + index,
    // Explicit masking removes the old garment decisively for changes such as
    // a skirt to trousers. Outerwear stays mask-free so it can layer naturally.
    segmentation_free: product.category === '아우터',
  });
  const result = (prediction.data as unknown as GradioImage[])[0];
  if (!result?.url) throw new Error('SPACE_RESULT_UNAVAILABLE');
  return toPng(await fetchSpaceResult(result.url));
}

async function predictWithCatVton(
  client: GradioClient,
  personImage: Buffer,
  garmentImage: Buffer,
  product: FitProduct,
  blankMask: Buffer,
  index: number,
) {
  const clothType = clothTypeForCategory(product.category);
  if (!clothType) throw new Error('UNSUPPORTED_GARMENT_CATEGORY');

  const prediction = await client.predict('/submit_function', {
    person_image: {
      background: handle_file(pngFile(personImage, `person-${index}.png`)),
      layers: [handle_file(pngFile(blankMask, `mask-${index}.png`))],
      composite: null,
    },
    cloth_image: handle_file(pngFile(garmentImage, `cloth-${index}.png`)),
    cloth_type: clothType,
    num_inference_steps: 40,
    guidance_scale: 2.5,
    seed: 42 + index,
    show_type: 'result only',
  });
  const result = (prediction.data as unknown as GradioImage[])[0];
  if (!result?.url) throw new Error('SPACE_RESULT_UNAVAILABLE');
  return toPng(await fetchSpaceResult(result.url));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message === 'INVALID_PERSON_IMAGE') {
    return { status: 400, message: '전신사진을 다시 올려 주세요.' };
  }
  if (
    message === 'INVALID_PRODUCT_IMAGE' ||
    message === 'PRODUCT_IMAGE_UNAVAILABLE' ||
    message.includes('Input buffer contains unsupported image format')
  ) {
    return {
      status: 422,
      message: '상품사진을 가져오지 못했어요. 공개된 JPG, PNG 또는 WebP 상품 링크를 사용해 주세요.',
    };
  }
  if (/quota|exceeded|zero.?gpu|gpu.*limit|daily limit/i.test(message)) {
    return {
      status: 429,
      message: '오늘의 무료 AI 사용량이 찼어요. 무료 한도는 24시간 뒤 다시 열려요.',
    };
  }
  if (/queue|busy|paused|sleep|unavailable|timeout|fetch failed|network/i.test(message)) {
    return {
      status: 503,
      message: '무료 AI 서버가 붐비거나 잠시 쉬는 중이에요. 1~2분 뒤 다시 시도해 주세요.',
    };
  }
  if (/safety|unsafe|nsfw/i.test(message)) {
    return {
      status: 422,
      message: '안전 필터가 사진을 처리하지 못했어요. 다른 전신사진으로 다시 시도해 주세요.',
    };
  }
  return {
    status: 502,
    message: '무료 실사 피팅을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  };
}

export async function GET() {
  const statuses = await Promise.all(
    PRECISION_SPACES.map(async (space) => {
      try {
        const response = await fetch(space.infoUrl, {
          cache: 'no-store',
          signal: AbortSignal.timeout(7_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    }),
  );
  const availableEngines = PRECISION_SPACES.filter((_, index) => statuses[index]).map(
    (space) => space.name,
  );

  return NextResponse.json(
    {
      configured: true,
      available: availableEngines.length > 0,
      free: true,
      engine: 'FASHN VTON 1.5 + CatVTON',
      availableEngines,
      supports: ['상의', '하의', '아우터', '원피스'],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  let payload: TryOnPayload;

  try {
    payload = (await request.json()) as TryOnPayload;
  } catch {
    return NextResponse.json({ error: '요청 형식을 확인해 주세요.' }, { status: 400 });
  }

  const personImage = payload.personImage?.trim() ?? '';
  const products = Array.isArray(payload.products) ? payload.products.slice(0, MAX_PRODUCTS) : [];
  const supportedProducts = products.filter((product) => clothTypeForCategory(product.category));
  const skippedProducts = products.filter((product) => !clothTypeForCategory(product.category));
  if (!dataImagePattern.test(personImage) || personImage.length > MAX_PERSON_DATA_LENGTH) {
    return NextResponse.json(
      { error: '10MB 이하의 JPG, PNG 또는 WebP 전신사진을 사용해 주세요.' },
      { status: 400 },
    );
  }

  if (!products.length) {
    return NextResponse.json({ error: '입혀볼 실제 상품을 한 개 이상 골라 주세요.' }, { status: 400 });
  }

  const malformedProduct = products.find(
    (product) =>
      !product ||
      typeof product.id !== 'string' ||
      typeof product.name !== 'string' ||
      typeof product.category !== 'string' ||
      typeof product.imageUrl !== 'string' ||
      !isAllowedProductImageUrl(product.imageUrl),
  );

  if (malformedProduct) {
    return NextResponse.json({ error: '공개 HTTPS 상품사진만 실사 피팅에 사용할 수 있어요.' }, { status: 400 });
  }

  if (!supportedProducts.length) {
    return NextResponse.json(
      {
        error:
          '현재 생성형 피팅은 상의·하의·아우터·원피스를 지원해요. 신발과 함께 입혀볼 옷을 하나 이상 골라 주세요.',
      },
      { status: 422 },
    );
  }

  try {
    let fashnClient: GradioClient | null = null;
    let fashnConnectionError: unknown = null;
    try {
      fashnClient = await Client.connect(FASHN_SPACE_ID);
    } catch (error) {
      fashnConnectionError = error;
      console.error('FASHN connection failed', errorMessage(error));
    }

    let catVtonClient: GradioClient | null = null;
    let catVtonConnectionError: unknown = null;
    let catVtonConnectionAttempted = false;
    const ensureCatVtonClient = async () => {
      if (catVtonClient || catVtonConnectionAttempted) return catVtonClient;
      catVtonConnectionAttempted = true;
      try {
        catVtonClient = await Client.connect(CATVTON_SPACE_ID);
      } catch (error) {
        catVtonConnectionError = error;
        console.error('CatVTON connection failed', errorMessage(error));
      }
      return catVtonClient;
    };

    const blankMask = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    let fittedImage = await toPng(decodePersonImage(personImage));
    const appliedItems: AppliedItem[] = [];
    const enginesUsed = new Set<string>();

    for (let index = 0; index < supportedProducts.length; index += 1) {
      const product = supportedProducts[index];
      const productImage = await fetchImage(product.imageUrl, product.sourceUrl);
      const garment = await preparePrecisionGarment(productImage, product.category);
      const itemErrors: string[] = [];
      let generated: Buffer | null = null;

      if (fashnClient) {
        try {
          generated = await predictWithFashn(
            fashnClient,
            fittedImage,
            garment.image,
            product,
            garment.photoType,
            index,
          );
          enginesUsed.add('FASHN VTON 1.5');
        } catch (error) {
          itemErrors.push('FASHN: ' + errorMessage(error));
          console.error('FASHN item failed', product.id, errorMessage(error));
        }
      } else if (fashnConnectionError) {
        itemErrors.push('FASHN: ' + errorMessage(fashnConnectionError));
      }

      if (!generated) {
        const backupClient = await ensureCatVtonClient();
        if (backupClient) {
          try {
            generated = await predictWithCatVton(
              backupClient,
              fittedImage,
              garment.image,
              product,
              blankMask,
              index,
            );
            enginesUsed.add('CatVTON');
          } catch (error) {
            itemErrors.push('CatVTON: ' + errorMessage(error));
            console.error('CatVTON item failed', product.id, errorMessage(error));
          }
        } else if (catVtonConnectionError) {
          itemErrors.push('CatVTON: ' + errorMessage(catVtonConnectionError));
        }
      }

      if (!generated) {
        throw new Error(
          itemErrors.length
            ? itemErrors.join(' | ')
            : 'PRECISION_ENGINES_UNAVAILABLE',
        );
      }

      fittedImage = Buffer.from(generated);
      appliedItems.push({ id: product.id, name: product.name, category: product.category });
    }

    const jpegResult = await sharp(fittedImage).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return NextResponse.json({
      resultImage: 'data:image/jpeg;base64,' + jpegResult.toString('base64'),
      engine: [...enginesUsed].join(' + '),
      free: true,
      fallback: false,
      appliedItems,
      skippedItems: skippedProducts.map(({ id, name, category }) => ({ id, name, category })),
      notice: skippedProducts.length
        ? '의류는 생성형 AI로 실제 착용 형태를 만들었어요. 현재 신발은 생성 대상이 아니어서 원본 신발을 유지했어요.'
        : undefined,
    });
  } catch (error) {
    console.error('Free virtual try-on failed', error instanceof Error ? error.message : error);
    const normalized = publicError(error);
    return NextResponse.json(
      {
        error:
          normalized.message +
          ' 실제 착용 형태가 아닌 사진 덧씌우기 결과는 표시하지 않았어요.',
      },
      { status: normalized.status },
    );
  }
}
