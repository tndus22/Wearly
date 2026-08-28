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
    outputSegmentationMasks: false,
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

export async function detectBodyGuide(source: string): Promise<BodyGuide | null> {
  const [landmarker, image] = await Promise.all([getPoseLandmarker(), loadImage(source)]);
  const pose = landmarker.detect(image).landmarks[0];
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

  return {
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    confidence,
    points,
  };
}
