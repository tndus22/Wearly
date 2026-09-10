export type BodyPointName =
  | 'nose'
  | 'leftEar'
  | 'rightEar'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle'
  | 'leftHeel'
  | 'rightHeel'
  | 'leftFoot'
  | 'rightFoot';

export type BodyPoint = {
  x: number;
  y: number;
  visibility: number;
};

export type BodyGuide = {
  imageWidth: number;
  imageHeight: number;
  confidence: number;
  points: Partial<Record<BodyPointName, BodyPoint>>;
  segmentationMask?: string;
};

const landmarkIndexes: Record<BodyPointName, number> = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
};

let poseLandmarkerPromise:
  | Promise<import('@mediapipe/tasks-vision').PoseLandmarker>
  | null = null;

async function createPoseLandmarker(delegate: 'GPU' | 'CPU') {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: '/models/pose_landmarker_lite.task',
      delegate,
    },
    runningMode: 'IMAGE',
    numPoses: 1,
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
    outputSegmentationMasks: true,
  });
}

function getPoseLandmarker() {
  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = createPoseLandmarker('GPU').catch(() => createPoseLandmarker('CPU'));
  }
  return poseLandmarkerPromise;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('POSE_IMAGE_LOAD_FAILED'));
    image.src = source;
  });
}

function usableVisibility(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value ?? 0)) : 0;
}

function encodeSegmentationMask(mask: import('@mediapipe/tasks-vision').MPMask) {
  const maskWidth = mask.width;
  const maskHeight = mask.height;
  if (!maskWidth || !maskHeight) return undefined;

  const values = mask.getAsFloat32Array();
  if (values.length !== maskWidth * maskHeight) return undefined;

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = maskWidth;
  sourceCanvas.height = maskHeight;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) return undefined;

  const pixels = sourceContext.createImageData(maskWidth, maskHeight);
  for (let index = 0; index < values.length; index += 1) {
    const confidence = Math.max(0, Math.min(1, (values[index] - 0.06) / 0.82));
    const value = Math.round(Math.pow(confidence, 0.72) * 255);
    const pixelIndex = index * 4;
    pixels.data[pixelIndex] = value;
    pixels.data[pixelIndex + 1] = value;
    pixels.data[pixelIndex + 2] = value;
    pixels.data[pixelIndex + 3] = 255;
  }
  sourceContext.putImageData(pixels, 0, 0);

  const maxEdge = 512;
  const scale = Math.min(1, maxEdge / Math.max(maskWidth, maskHeight));
  if (scale === 1) return sourceCanvas.toDataURL('image/png');

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = Math.max(1, Math.round(maskWidth * scale));
  outputCanvas.height = Math.max(1, Math.round(maskHeight * scale));
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) return sourceCanvas.toDataURL('image/png');
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(sourceCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
  return outputCanvas.toDataURL('image/png');
}

export async function detectBodyGuide(source: string): Promise<BodyGuide | null> {
  const [landmarker, image] = await Promise.all([getPoseLandmarker(), loadImage(source)]);
  const result = landmarker.detect(image);

  try {
    const pose = result.landmarks[0];
    if (!pose?.length) return null;

    const points: Partial<Record<BodyPointName, BodyPoint>> = {};
    for (const [name, index] of Object.entries(landmarkIndexes) as Array<
      [BodyPointName, number]
    >) {
      const landmark = pose[index];
      if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) continue;
      points[name] = {
        x: Math.max(0, Math.min(1, landmark.x)),
        y: Math.max(0, Math.min(1, landmark.y)),
        visibility: usableVisibility(landmark.visibility),
      };
    }

    const required = [
      points.leftShoulder,
      points.rightShoulder,
      points.leftHip,
      points.rightHip,
    ].filter((point): point is BodyPoint => Boolean(point));
    if (required.length < 4 || required.some((point) => point.visibility < 0.35)) return null;

    const confidence =
      Object.values(points).reduce((sum, point) => sum + (point?.visibility ?? 0), 0) /
      Math.max(1, Object.keys(points).length);
    const segmentationMask = result.segmentationMasks?.[0]
      ? encodeSegmentationMask(result.segmentationMasks[0])
      : undefined;

    return {
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      confidence,
      points,
      segmentationMask,
    };
  } finally {
    result.close();
  }
}
