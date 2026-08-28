'use client';

import Image from 'next/image';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyGuide } from '@/lib/body-guide';

export type AvatarClosetItem = {
  id: string;
  name: string;
  imageUrl: string;
  category: string;
  color: string;
  style: string;
  source: string;
  sourceUrl: string;
  visual: string;
  background: string;
};

type Gender = 'woman' | 'man' | 'neutral';
type Age = 'teen' | '20s' | '30s' | '40plus';
type FatDistribution = 'upper' | 'balanced' | 'lower';
type FitSlot = 'top' | 'bottom' | 'dress' | 'outer' | 'shoes';
type FitMode = 'balanced' | 'quality';
type FitStatus = 'idle' | 'preparing' | 'generating' | 'done' | 'error';
type EngineState = 'checking' | 'ready' | 'offline';
type PoseState = 'idle' | 'detecting' | 'ready' | 'fallback';

type AvatarProfile = {
  gender: Gender;
  age: Age;
  heightCm: number;
  weightKg: number;
  fatDistribution: FatDistribution;
};

type FitSelections = Partial<Record<FitSlot, string | null>>;

type ComparisonLook = {
  id: string;
  image: string;
  label: string;
  itemNames: string[];
  mode: FitMode;
};

type AvatarStudioProps = {
  items: AvatarClosetItem[];
  suggestedItems: AvatarClosetItem[];
  occasionLabel: string;
  recommendationSignal?: number;
};

type TryOnResponse = {
  resultImage?: string;
  engine?: string;
  free?: boolean;
  appliedItems?: Array<{ id: string; name: string; category: string }>;
  skippedItems?: Array<{ id: string; name: string; category: string }>;
  fallback?: boolean;
  notice?: string;
  error?: string;
};

type EngineResponse = {
  configured?: boolean;
  available?: boolean;
  free?: boolean;
  engine?: string;
};

const defaultProfile: AvatarProfile = {
  gender: 'neutral',
  age: '20s',
  heightCm: 165,
  weightKg: 58,
  fatDistribution: 'balanced',
};

const genderOptions: Array<{ value: Gender; label: string }> = [
  { value: 'woman', label: '여성' },
  { value: 'man', label: '남성' },
  { value: 'neutral', label: '선택 안 함' },
];

const ageOptions: Array<{ value: Age; label: string }> = [
  { value: 'teen', label: '10대' },
  { value: '20s', label: '20대' },
  { value: '30s', label: '30대' },
  { value: '40plus', label: '40대+' },
];

const distributionOptions: Array<{
  value: FatDistribution;
  label: string;
  detail: string;
}> = [
  { value: 'upper', label: '상체 중심', detail: '복부·팔·가슴 쪽' },
  { value: 'balanced', label: '균형형', detail: '상·하체가 비슷함' },
  { value: 'lower', label: '하체 중심', detail: '골반·허벅지 쪽' },
];

const fitSlots: Array<{ value: FitSlot; label: string }> = [
  { value: 'top', label: '상의' },
  { value: 'bottom', label: '하의' },
  { value: 'outer', label: '아우터' },
  { value: 'dress', label: '원피스' },
  { value: 'shoes', label: '신발' },
];

const fitOrder: FitSlot[] = ['top', 'bottom', 'dress', 'outer', 'shoes'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 3_800_000;

function slotForCategory(category: string): FitSlot | null {
  if (category === '상의') return 'top';
  if (category === '하의') return 'bottom';
  if (category === '아우터') return 'outer';
  if (category === '원피스') return 'dress';
  if (category === '신발') return 'shoes';
  return null;
}

function isFreeTryOnSupported(category: string) {
  return category === '상의' || category === '하의' || category === '아우터' || category === '원피스';
}

function selectionsForSuggestedItems(items: AvatarClosetItem[]) {
  const next: FitSelections = {};
  for (const item of items.filter((candidate) => candidate.imageUrl)) {
    const slot = slotForCategory(item.category);
    if (!slot) continue;
    next[slot] = item.id;
    if (slot === 'dress') {
      next.top = null;
      next.bottom = null;
    }
    if (slot === 'top' || slot === 'bottom') next.dress = null;
  }
  return next;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function bodyLabel(bmi: number) {
  if (bmi < 18.5) return '가벼운 체형';
  if (bmi < 23) return '보통 체형';
  if (bmi < 25) return '탄탄한 체형';
  return '볼륨 체형';
}

async function compressPersonPhoto(file: File) {
  if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
    throw new Error('JPG, PNG 또는 WebP 사진만 사용할 수 있어요.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('사진은 10MB 이하로 올려 주세요.');
  }

  const bitmap = await createImageBitmap(file);
  const longestEdge = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1600 / longestEdge);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();
    throw new Error('이 브라우저에서는 사진을 준비할 수 없어요.');
  }

  context.fillStyle = '#f4f1ea';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.88, 0.78, 0.68]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl;
  }

  throw new Error('사진 용량을 줄인 뒤 다시 올려 주세요.');
}

function ProductArtwork({
  item,
  sizes,
  decorative = false,
}: {
  item: AvatarClosetItem;
  sizes: string;
  decorative?: boolean;
}) {
  return (
    <Image
      src={item.imageUrl}
      alt={decorative ? '' : item.name}
      fill
      sizes={sizes}
      unoptimized
      referrerPolicy="no-referrer"
    />
  );
}

export default function AvatarStudio({
  items,
  suggestedItems,
  occasionLabel,
  recommendationSignal = 0,
}: AvatarStudioProps) {
  const [profile, setProfile] = useState<AvatarProfile>(defaultProfile);
  const [storageReady, setStorageReady] = useState(false);
  const [personImage, setPersonImage] = useState('');
  const [personFileName, setPersonFileName] = useState('');
  const [bodyGuide, setBodyGuide] = useState<BodyGuide | null>(null);
  const [poseState, setPoseState] = useState<PoseState>('idle');
  const [activeSlot, setActiveSlot] = useState<FitSlot>('top');
  const [selections, setSelections] = useState<FitSelections>({});
  const [mode, setMode] = useState<FitMode>('balanced');
  const [consent, setConsent] = useState(false);
  const [fitStatus, setFitStatus] = useState<FitStatus>('idle');
  const [fitMessage, setFitMessage] = useState('');
  const [engineState, setEngineState] = useState<EngineState>('checking');
  const [precisionEngineAvailable, setPrecisionEngineAvailable] = useState(true);
  const [resultImage, setResultImage] = useState('');
  const [resultItemNames, setResultItemNames] = useState<string[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonLook[]>([]);
  const consumedRecommendationSignal = useRef(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- Restore the non-sensitive fit profile after hydration. */
    try {
      const savedProfile = window.localStorage.getItem('wearly-fit-profile');
      if (savedProfile) {
        const parsed = JSON.parse(savedProfile) as Partial<AvatarProfile>;
        setProfile({ ...defaultProfile, ...parsed });
      }
    } catch {
      // Keep defaults if browser storage is unavailable or malformed.
    } finally {
      setStorageReady(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem('wearly-fit-profile', JSON.stringify(profile));
  }, [profile, storageReady]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/virtual-tryon', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('status-check-failed');
        return (await response.json()) as EngineResponse;
      })
      .then((data) => {
        setPrecisionEngineAvailable(data.available !== false);
        setEngineState('ready');
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setEngineState('offline');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (
      recommendationSignal <= 0 ||
      consumedRecommendationSignal.current === recommendationSignal
    ) {
      return;
    }
    consumedRecommendationSignal.current = recommendationSignal;
    setSelections(selectionsForSuggestedItems(suggestedItems));
    setFitMessage('날씨와 장소에 맞춘 추천 코디를 선택했어요. 조합을 확인해 주세요.');
  }, [recommendationSignal, suggestedItems]);

  const bmi = useMemo(
    () => profile.weightKg / Math.pow(profile.heightCm / 100, 2),
    [profile.heightCm, profile.weightKg],
  );

  const realItems = useMemo(
    () => items.filter((item) => Boolean(item.imageUrl) && Boolean(slotForCategory(item.category))),
    [items],
  );

  const activeItems = useMemo(
    () => realItems.filter((item) => slotForCategory(item.category) === activeSlot),
    [activeSlot, realItems],
  );

  const selectedItems = useMemo(
    () =>
      fitOrder
        .map((slot) => realItems.find((item) => item.id === selections[slot]))
        .filter((item): item is AvatarClosetItem => Boolean(item)),
    [realItems, selections],
  );

  const supportedSelectedItems = useMemo(
    () => selectedItems.filter((item) => isFreeTryOnSupported(item.category)),
    [selectedItems],
  );

  const generationItemCount = supportedSelectedItems.length || selectedItems.length;
  const estimatedSeconds = mode === 'quality' ? generationItemCount * 45 : 3;
  const canGenerate =
    engineState === 'ready' &&
    Boolean(personImage) &&
    selectedItems.length > 0 &&
    consent &&
    fitStatus !== 'preparing' &&
    fitStatus !== 'generating';

  function updateProfile<Key extends keyof AvatarProfile>(key: Key, value: AvatarProfile[Key]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFitStatus('preparing');
    setPoseState('detecting');
    setBodyGuide(null);
    setFitMessage('전신사진을 안전한 크기로 준비하고 있어요.');

    try {
      const compressed = await compressPersonPhoto(file);
      setPersonImage(compressed);
      setPersonFileName(file.name);
      setResultImage('');
      setResultItemNames([]);
      setComparisons([]);
      setFitMessage('사진에서 어깨·허리·무릎·발목 위치를 찾고 있어요.');

      let detectedGuide: BodyGuide | null = null;
      try {
        const { detectBodyGuide } = await import('@/lib/body-guide');
        detectedGuide = await detectBodyGuide(compressed);
      } catch {
        // A silhouette-based server fallback still aligns the clothes if pose detection is unavailable.
      }

      setBodyGuide(detectedGuide);
      setPoseState(detectedGuide ? 'ready' : 'fallback');
      setFitStatus('idle');
      setFitMessage(
        detectedGuide
          ? '몸 기준점을 찾았어요. 선택한 옷을 어깨·허리·다리 비율에 맞춰 적용해요.'
          : '몸 기준점을 일부 찾지 못해 사진 속 사람 윤곽을 기준으로 크기를 자동 조정해요.',
      );
    } catch (error) {
      setPoseState('idle');
      setFitStatus('error');
      setFitMessage(error instanceof Error ? error.message : '사진을 불러오지 못했어요.');
    } finally {
      event.target.value = '';
    }
  }

  function removePersonPhoto() {
    setPersonImage('');
    setPersonFileName('');
    setBodyGuide(null);
    setPoseState('idle');
    setResultImage('');
    setResultItemNames([]);
    setComparisons([]);
    setConsent(false);
    setFitStatus('idle');
    setFitMessage('');
  }

  function toggleItem(item: AvatarClosetItem) {
    const slot = slotForCategory(item.category);
    if (!slot) return;

    setSelections((current) => {
      const next: FitSelections = {
        ...current,
        [slot]: current[slot] === item.id ? null : item.id,
      };
      if (next[slot] && slot === 'dress') {
        next.top = null;
        next.bottom = null;
      }
      if (next[slot] && (slot === 'top' || slot === 'bottom')) {
        next.dress = null;
      }
      return next;
    });
  }

  function applySuggestedLook() {
    setSelections(selectionsForSuggestedItems(suggestedItems));
    setFitMessage('날씨와 장소에 맞춘 추천 상품을 선택했어요. 조합을 확인해 주세요.');
  }

  async function generateTryOn() {
    if (engineState === 'checking') {
      setFitStatus('error');
      setFitMessage('실사 피팅 엔진 연결을 확인하고 있어요. 잠시 뒤 다시 눌러 주세요.');
      return;
    }
    if (engineState === 'offline') {
      setFitStatus('error');
      setFitMessage('웹 서버에 연결할 수 없어요. 로컬 서버를 실행한 뒤 페이지를 새로고침해 주세요.');
      return;
    }
    if (!personImage) {
      setFitStatus('error');
      setFitMessage('먼저 정면 전신사진을 올려 주세요.');
      return;
    }
    if (!selectedItems.length) {
      setFitStatus('error');
      setFitMessage('실제 상품사진이 있는 옷을 한 개 이상 골라 주세요.');
      return;
    }
    if (!consent) {
      setFitStatus('error');
      setFitMessage('사진 사용 동의를 확인해 주세요.');
      return;
    }

    setFitStatus('generating');
    setFitMessage(
      mode === 'quality'
        ? '선택한 ' +
            generationItemCount +
            '개 상품을 무료 정밀 AI 대기열에서 합성하고 있어요. 이 창을 닫지 말아 주세요.'
        : '실제 상품사진의 배경을 제거해 빠른 비교 미리보기를 만들고 있어요.',
    );

    try {
      const response = await fetch('/api/virtual-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personImage,
          products: selectedItems.map((item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            imageUrl: item.imageUrl,
            sourceUrl: item.sourceUrl,
          })),
          mode,
          profile: {
            heightCm: profile.heightCm,
            weightKg: profile.weightKg,
            fatDistribution: profile.fatDistribution,
          },
          bodyGuide,
        }),
      });
      const data = (await response.json()) as TryOnResponse;

      if (!response.ok || !data.resultImage) {
        throw new Error(data.error || '실사 피팅 결과를 만들지 못했어요.');
      }

      const itemNames =
        data.appliedItems?.map((item) => item.name) ??
        supportedSelectedItems.map((item) => item.name);
      const look: ComparisonLook = {
        id: String(Date.now()),
        image: data.resultImage,
        label: 'LOOK ' + (comparisons.length + 1),
        itemNames,
        mode,
      };

      setResultImage(data.resultImage);
      setResultItemNames(itemNames);
      setComparisons((current) => [look, ...current].slice(0, 3));
      setFitStatus('done');
      setFitMessage(
        data.notice
          ? data.notice
          : data.skippedItems?.length
          ? '무료 실사 피팅이 완성됐어요. 신발은 지원 대상이 아니라 코디 선택에만 남겨 두었어요.'
          : '무료 실사 피팅이 완성됐어요. 다른 옷을 선택해 바로 다음 룩과 비교할 수 있어요.',
      );
    } catch (error) {
      setFitStatus('error');
      setFitMessage(
        error instanceof TypeError
          ? '웹 서버와 연결이 끊겼어요. 서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.'
          : error instanceof Error
            ? error.message
            : '실사 피팅 결과를 만들지 못했어요.',
      );
    }
  }

  return (
    <section className="avatar-section virtual-fit-section" id="avatar" aria-labelledby="avatar-heading">
      <div className="section-heading avatar-section-heading">
        <div>
          <p className="eyebrow">PHOTOREAL VIRTUAL FITTING</p>
          <h2 id="avatar-heading">입어보지 않고, 실제 나에게 먼저.</h2>
          <p>
            내 전신사진을 기준으로 옷장 속 실제 상품을 합성하고, 여러 코디를 나란히 비교해요.
          </p>
        </div>
        <span className="feature-pill">FREE · REAL TRY-ON</span>
      </div>

      <ol className="fit-flow" aria-label="가상 피팅 순서">
        <li><b>01</b><span>내 전신사진과 체형 입력</span></li>
        <li><b>02</b><span>상의·하의·신발 조합</span></li>
        <li><b>03</b><span>실사 생성 후 Look 비교</span></li>
      </ol>

      <div className="virtual-fit-grid">
        <aside className="fit-panel fit-profile-panel" aria-label="내 사진과 체형 정보">
          <div className="fit-panel-heading">
            <span>01</span>
            <div>
              <strong>가상의 나 만들기</strong>
              <p>캐릭터가 아닌 실제 전신사진을 기준으로 해요.</p>
            </div>
          </div>

          <label className={personImage ? 'person-upload has-photo' : 'person-upload'}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoUpload}
              disabled={fitStatus === 'preparing' || fitStatus === 'generating'}
            />
            {personImage ? (
              <>
                <Image
                  src={personImage}
                  alt="업로드한 내 전신사진"
                  fill
                  sizes="320px"
                  unoptimized
                />
                <span className="photo-change-label">사진 바꾸기</span>
              </>
            ) : (
              <span className="person-upload-empty">
                <i aria-hidden="true">+</i>
                <strong>정면 전신사진 올리기</strong>
                <small>JPG · PNG · WebP / 최대 10MB</small>
              </span>
            )}
          </label>

          {personImage && (
            <div className="uploaded-photo-meta">
              <span title={personFileName}>{personFileName}</span>
              <button type="button" onClick={removePersonPhoto}>사진 지우기</button>
            </div>
          )}

          <div className="photo-guide">
            <span>정면</span>
            <span>전신</span>
            <span>팔·다리 분리</span>
            <span>밝은 조명</span>
          </div>

          {personImage && (
            <div className={'body-detection-status is-' + poseState} role="status">
              <span aria-hidden="true" />
              <div>
                <strong>
                  {poseState === 'detecting'
                    ? '몸 비율 분석 중'
                    : poseState === 'ready'
                      ? '몸맞춤 기준점 감지 완료'
                      : '사람 윤곽 기준 자동 맞춤'}
                </strong>
                <small>
                  {poseState === 'ready'
                    ? '어깨·골반·무릎·발목 좌표로 옷 크기를 계산해요.'
                    : '배경 여백과 사람 크기를 분석해 옷 위치를 보정해요.'}
                </small>
              </div>
            </div>
          )}

          <div className="measurement-grid">
            <label>
              <span>키</span>
              <div>
                <input
                  type="number"
                  min="130"
                  max="210"
                  value={profile.heightCm}
                  onChange={(event) =>
                    updateProfile('heightCm', clamp(Number(event.target.value), 130, 210))
                  }
                />
                <b>cm</b>
              </div>
            </label>
            <label>
              <span>몸무게</span>
              <div>
                <input
                  type="number"
                  min="35"
                  max="180"
                  value={profile.weightKg}
                  onChange={(event) =>
                    updateProfile('weightKg', clamp(Number(event.target.value), 35, 180))
                  }
                />
                <b>kg</b>
              </div>
            </label>
          </div>

          <div className="fit-profile-summary">
            <span>BMI {bmi.toFixed(1)}</span>
            <strong>{bodyLabel(bmi)}</strong>
            <small>수치로 몸을 바꾸지 않고 사진 속 실제 비율을 우선해요.</small>
          </div>

          <fieldset className="compact-fieldset">
            <legend>살이 붙는 위치</legend>
            <div className="distribution-options">
              {distributionOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={profile.fatDistribution === option.value ? 'is-active' : ''}
                  onClick={() => updateProfile('fatDistribution', option.value)}
                  aria-pressed={profile.fatDistribution === option.value}
                >
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="demographic-controls">
            <fieldset>
              <legend>성별</legend>
              <div>
                {genderOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={profile.gender === option.value ? 'is-active' : ''}
                    onClick={() => updateProfile('gender', option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>연령대</legend>
              <div>
                {ageOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={profile.age === option.value ? 'is-active' : ''}
                    onClick={() => updateProfile('age', option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </aside>

        <section className="fit-panel fit-closet-panel" aria-label="실제 상품 조합 선택">
          <div className="fit-panel-heading">
            <span>02</span>
            <div>
              <strong>실제 옷 조합하기</strong>
              <p>URL에서 가져온 상품사진만 실사 피팅에 사용해요.</p>
            </div>
          </div>

          <div className="selected-outfit">
            <div className="selected-outfit-topline">
              <span>선택한 코디 · {selectedItems.length}/4</span>
              <div>
                <button
                  type="button"
                  onClick={applySuggestedLook}
                  disabled={!suggestedItems.some((item) => item.imageUrl)}
                >
                  {occasionLabel} 추천 선택
                </button>
                <button type="button" onClick={() => setSelections({})}>비우기</button>
              </div>
            </div>
            <div className="selected-outfit-slots">
              {fitSlots.map((slot) => {
                const selected = realItems.find((item) => item.id === selections[slot.value]);
                return (
                  <button
                    key={slot.value}
                    type="button"
                    className={selected ? 'has-item' : ''}
                    onClick={() => setActiveSlot(slot.value)}
                  >
                    {selected ? (
                      <>
                        <span>
                          <ProductArtwork item={selected} sizes="64px" decorative />
                        </span>
                        <small>{slot.label}</small>
                      </>
                    ) : (
                      <>
                        <span className="empty-slot">+</span>
                        <small>{slot.label}</small>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="fit-slot-tabs" role="tablist" aria-label="상품 종류">
            {fitSlots.map((slot) => {
              const count = realItems.filter(
                (item) => slotForCategory(item.category) === slot.value,
              ).length;
              return (
                <button
                  key={slot.value}
                  type="button"
                  role="tab"
                  aria-selected={activeSlot === slot.value}
                  className={activeSlot === slot.value ? 'is-active' : ''}
                  onClick={() => setActiveSlot(slot.value)}
                >
                  {slot.label}<span>{count}</span>
                </button>
              );
            })}
          </div>

          {activeItems.length ? (
            <div className="fit-product-grid">
              {activeItems.map((item) => {
                const selected = selections[activeSlot] === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={selected ? 'is-selected' : ''}
                    onClick={() => toggleItem(item)}
                    aria-pressed={selected}
                  >
                    <span className="fit-product-image">
                      <ProductArtwork item={item} sizes="180px" />
                      <i>{selected ? '선택됨' : '입혀보기'}</i>
                    </span>
                    <strong>{item.name}</strong>
                    <small>{item.color} · {item.style}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="fit-products-empty">
              <span aria-hidden="true">URL</span>
              <strong>{fitSlots.find((slot) => slot.value === activeSlot)?.label} 상품사진이 없어요.</strong>
              <p>위의 상품 링크 가져오기에서 실제 상품 URL을 추가하면 바로 선택할 수 있어요.</p>
              <a href="#top">상품 URL 추가하러 가기</a>
            </div>
          )}

          <p className="product-photo-tip">
            정면으로 펼쳐진 선명한 상품사진일수록 로고·패턴·소재 디테일이 더 잘 유지돼요.
            <span>정밀 CatVTON은 의류를 합성하고, 신발은 실제 상품사진 즉시 미리보기 방식으로 함께 적용해요.</span>
          </p>
        </section>

        <section className="fit-panel fit-result-panel" aria-label="실사 가상 피팅 결과">
          <div className="fit-panel-heading fit-result-heading">
            <span>03</span>
            <div>
              <strong>실사 피팅 결과</strong>
              <p>원래 얼굴과 체형을 유지한 채 옷만 바꿔요.</p>
            </div>
          </div>

          <div className={'fit-engine-status is-' + engineState} role="status">
            <span aria-hidden="true" />
            <div>
              <strong>
                {engineState === 'ready'
                  ? precisionEngineAvailable
                    ? '무료 정밀 AI + 즉시 미리보기 준비됨'
                    : '무료 즉시 미리보기 준비됨'
                    : engineState === 'offline'
                      ? '웹 서버 연결 끊김'
                      : '실사 AI 엔진 확인 중'}
              </strong>
              <p>
                {engineState === 'ready'
                  ? precisionEngineAvailable
                    ? '먼저 CatVTON ZeroGPU를 사용하고, 무료 한도가 차면 실제 상품사진 즉시 미리보기로 자동 전환해요.'
                    : '공개 정밀 AI가 쉬는 동안 실제 상품사진을 배경 제거해 전신사진에 바로 배치해요.'
                    : engineState === 'offline'
                      ? '로컬 서버를 실행한 뒤 이 페이지를 새로고침해 주세요.'
                      : '잠시만 기다려 주세요.'}
              </p>
            </div>
          </div>

          <div className={resultImage ? 'fit-result-stage has-result' : 'fit-result-stage'}>
            {resultImage ? (
              <Image
                src={resultImage}
                alt={'실사 가상 피팅 결과: ' + resultItemNames.join(', ')}
                fill
                sizes="420px"
                unoptimized
              />
            ) : personImage ? (
              <>
                <Image
                  src={personImage}
                  alt="실사 피팅 전 원본 전신사진"
                  fill
                  sizes="420px"
                  unoptimized
                />
                <div className="result-waiting-overlay">
                  <span>{generationItemCount}개 상품 합성 준비</span>
                  <strong>이 사진에 옷을 입힐 준비가 됐어요.</strong>
                </div>
              </>
            ) : (
              <div className="result-placeholder">
                <span className="result-person-icon" aria-hidden="true"><i /><b /></span>
                <strong>내 사진이 결과 화면이 돼요.</strong>
                <p>왼쪽에서 정면 전신사진을 먼저 올려 주세요.</p>
              </div>
            )}

            {fitStatus === 'generating' && (
              <div className="fit-generating-overlay" role="status">
                <span className="fit-spinner" />
                <strong>{mode === 'quality' ? '정밀 AI가 실제 옷을 입히는 중' : '빠른 미리보기 만드는 중'}</strong>
                <p>
                  {mode === 'quality'
                    ? '옷의 디테일과 몸에 따른 주름·가림을 계산하고 있어요.'
                    : '어깨·허리·다리 기준으로 실제 상품사진 크기를 맞추고 있어요.'}
                </p>
              </div>
            )}
          </div>

          {resultImage && (
            <div className="result-actions">
              <span>{resultItemNames.length}개 상품 적용 완료</span>
              <a href={resultImage} download="wearly-virtual-fit.jpg">결과 저장</a>
            </div>
          )}

          <fieldset className="fit-mode-control">
            <legend>생성 모드</legend>
            <div>
              <button
                type="button"
                className={mode === 'balanced' ? 'is-active' : ''}
                onClick={() => setMode('balanced')}
              >
                <strong>빠른 비교 · 무제한</strong>
                <span>몸 좌표 맞춤 · 실제 상품사진</span>
              </button>
              <button
                type="button"
                className={mode === 'quality' ? 'is-active' : ''}
                onClick={() => setMode('quality')}
              >
                <strong>정밀 AI · 무료</strong>
                <span>CatVTON 주름·가림 생성</span>
              </button>
            </div>
          </fieldset>

          <div className="fit-time-estimate">
            <span>예상 대기</span>
            <strong>
              {generationItemCount
                ? '약 ' + estimatedSeconds + '초 전후'
                : '상품 선택 후 계산'}
            </strong>
            <small>
              {mode === 'quality'
                ? '공용 무료 GPU의 대기열과 상품 수에 따라 더 오래 걸릴 수 있어요.'
                : '공용 GPU 한도를 사용하지 않아 여러 코디를 빠르게 비교할 수 있어요.'}
            </small>
          </div>

          <label className="photo-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              본인 또는 사용 동의를 받은 사진이며, 외부 AI 처리에 동의해요.
            </span>
          </label>

          <button
            className="generate-fit-button"
            type="button"
            onClick={generateTryOn}
            disabled={!canGenerate}
          >
            {fitStatus === 'generating'
              ? '실사 피팅 생성 중…'
              : engineState === 'checking'
                ? '실사 엔진 연결 확인 중…'
                : engineState === 'offline'
                    ? '서버 연결 후 사용할 수 있어요'
                    : selectedItems.length
                        ? mode === 'quality'
                          ? selectedItems.length + '개 상품 정밀 AI 피팅'
                          : selectedItems.length + '개 상품 빠른 미리보기'
                        : '입혀볼 상품을 선택해 주세요'}
          </button>

          {fitMessage && (
            <p
              className={fitStatus === 'error' ? 'fit-message is-error' : 'fit-message'}
              role="status"
            >
              {fitMessage}
            </p>
          )}
          <p className="credit-note">API 키 없음 · 결제 크레딧 없음 · 공용 무료 사용량 제한 있음</p>
        </section>
      </div>

      <section className="look-comparison" aria-labelledby="comparison-heading">
        <div className="comparison-heading">
          <div>
            <p className="eyebrow">QUICK COMPARISON</p>
            <h3 id="comparison-heading">입어보는 수고 없이, Look A/B/C 비교</h3>
          </div>
          <p>새 조합을 생성할 때마다 최근 3개 룩이 자동으로 남아요.</p>
        </div>

        <div className="comparison-grid">
          <article className="comparison-card original-card">
            <div>
              {personImage ? (
                <Image
                  src={personImage}
                  alt="비교용 원본 전신사진"
                  fill
                  sizes="320px"
                  unoptimized
                />
              ) : (
                <span>ORIGINAL</span>
              )}
            </div>
            <footer>
              <strong>원본</strong>
              <small>나의 실제 체형 기준</small>
            </footer>
          </article>

          {comparisons.map((look, index) => (
            <article className="comparison-card" key={look.id}>
              <div>
                <Image
                  src={look.image}
                  alt={look.label + ' 가상 피팅 결과'}
                  fill
                  sizes="320px"
                  unoptimized
                />
                <span className="look-number">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <footer>
                <strong>{look.label}</strong>
                <small title={look.itemNames.join(', ')}>
                  {look.itemNames.join(' + ')}
                </small>
                <button
                  type="button"
                  onClick={() =>
                    setComparisons((current) => current.filter((candidate) => candidate.id !== look.id))
                  }
                >
                  비교에서 빼기
                </button>
              </footer>
            </article>
          ))}

          {!comparisons.length && (
            <article className="comparison-card empty-comparison-card">
              <div><span>LOOK A</span></div>
              <footer>
                <strong>첫 코디를 기다리는 중</strong>
                <small>실사 피팅을 생성하면 여기에 자동 저장돼요.</small>
              </footer>
            </article>
          )}
        </div>
      </section>

      <div className="fit-privacy-note">
        <strong>사진 처리 원칙</strong>
        <p>
          몸 기준점 분석은 MediaPipe로 브라우저 안에서 처리하고, 전신사진과 생성 결과는 옷장
          localStorage에 저장하지 않아요. 생성할 때만 이 사이트의 서버로 전송되고, 정밀 AI를
          선택했을 때만 Hugging Face의 공개 CatVTON 엔진으로 전달됩니다. 결과는 현재 화면에서만
          비교합니다.{' '}
          <a href="https://github.com/Zheng-Chong/CatVTON" target="_blank" rel="noreferrer">
            CatVTON · CC BY-NC-SA 4.0 · 비상업용
          </a>
        </p>
      </div>
    </section>
  );
}
