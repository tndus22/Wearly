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

type FitSlot = 'top' | 'bottom' | 'dress' | 'outer' | 'shoes';
type FitStatus = 'idle' | 'preparing' | 'generating' | 'done' | 'error';
type EngineState = 'checking' | 'ready' | 'offline';
type PoseState = 'idle' | 'detecting' | 'ready' | 'fallback';

type FitSelections = Partial<Record<FitSlot, string | null>>;

type ComparisonLook = {
  id: string;
  image: string;
  label: string;
  itemNames: string[];
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
  const [personImage, setPersonImage] = useState('');
  const [personFileName, setPersonFileName] = useState('');
  const [poseState, setPoseState] = useState<PoseState>('idle');
  const [activeSlot, setActiveSlot] = useState<FitSlot>('top');
  const [selections, setSelections] = useState<FitSelections>({});
  const [consent, setConsent] = useState(false);
  const [fitStatus, setFitStatus] = useState<FitStatus>('idle');
  const [fitMessage, setFitMessage] = useState('');
  const [engineState, setEngineState] = useState<EngineState>('checking');
  const [precisionEngineAvailable, setPrecisionEngineAvailable] = useState(true);
  const [resultImage, setResultImage] = useState('');
  const [resultItemNames, setResultItemNames] = useState<string[]>([]);
  const [resultEngine, setResultEngine] = useState('');
  const [comparisons, setComparisons] = useState<ComparisonLook[]>([]);
  const consumedRecommendationSignal = useRef(0);

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
  const estimatedSeconds = generationItemCount * 40;
  const canGenerate =
    engineState === 'ready' &&
    Boolean(personImage) &&
    supportedSelectedItems.length > 0 &&
    consent &&
    fitStatus !== 'preparing' &&
    fitStatus !== 'generating';

  async function handlePhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFitStatus('preparing');
    setPoseState('detecting');
    setFitMessage('전신사진을 안전한 크기로 준비하고 있어요.');

    try {
      const compressed = await compressPersonPhoto(file);
      setPersonImage(compressed);
      setPersonFileName(file.name);
      setResultImage('');
      setResultItemNames([]);
      setResultEngine('');
      setComparisons([]);
      setFitMessage('사진에서 사람 실루엣과 어깨·허리·무릎·발목 위치를 찾고 있어요.');

      let detectedGuide: BodyGuide | null = null;
      try {
        const { detectBodyGuide } = await import('@/lib/body-guide');
        detectedGuide = await detectBodyGuide(compressed);
      } catch {
        // A silhouette-based server fallback still aligns the clothes if pose detection is unavailable.
      }

      setPoseState(detectedGuide ? 'ready' : 'fallback');
      setFitStatus('idle');
      setFitMessage(
        detectedGuide
          ? '사람 실루엣을 찾았어요. 기존 옷 영역을 먼저 지운 뒤 상의·하의를 각각 교체해요.'
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
    setPoseState('idle');
    setResultImage('');
    setResultItemNames([]);
    setResultEngine('');
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
    if (!supportedSelectedItems.length) {
      setFitStatus('error');
      setFitMessage('신발과 함께 입혀볼 상의·하의·아우터·원피스를 하나 이상 골라 주세요.');
      return;
    }
    if (!consent) {
      setFitStatus('error');
      setFitMessage('사진 사용 동의를 확인해 주세요.');
      return;
    }

    setFitStatus('generating');
    setResultImage('');
    setResultItemNames([]);
    setResultEngine('');
    setFitMessage(
      '선택한 ' +
        generationItemCount +
        '개 상품의 기존 옷을 지우고 정밀 생성하고 있어요. 이 창을 닫지 말아 주세요.',
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
      };

      setResultImage(data.resultImage);
      setResultItemNames(itemNames);
      setResultEngine(data.engine ?? 'Wearly');
      setComparisons((current) => [look, ...current].slice(0, 3));
      setFitStatus('done');
      setFitMessage(
        data.notice
          ? data.notice
          : data.skippedItems?.length
          ? '무료 실사 피팅이 완성됐어요. 신발은 지원 대상이 아니라 코디 선택에만 남겨 두었어요.'
          : '생성형 실사 피팅이 완성됐어요. 다른 옷을 선택해 바로 다음 룩과 비교할 수 있어요.',
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
          <p className="eyebrow">WEARLY FITTING STUDIO</p>
          <h2 id="avatar-heading">내사진에 진짜처럼 입혀보기</h2>
          <p>
            사진 속 체형은 그대로 두고 기존 옷만 지운 뒤, 선택한 상품을 새로 생성해요.
          </p>
        </div>
        <span className="feature-pill">정밀 실사 생성</span>
      </div>

      <ol className="fit-flow" aria-label="가상 피팅 순서">
        <li><b>1</b><span>정면 전신사진 올리기</span></li>
        <li><b>2</b><span>입혀볼 실제 상품 고르기</span></li>
        <li><b>3</b><span>AI 피팅 결과 비교하기</span></li>
      </ol>

      <div className="virtual-fit-grid">
        <aside className="fit-panel fit-profile-panel" aria-label="내 전신사진">
          <div className="fit-panel-heading">
            <span>01</span>
            <div>
              <strong>내 사진</strong>
              <p>키·몸무게 대신 사진 속 실제 체형을 그대로 사용해요.</p>
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
                      ? '사람·의상 교체 영역 감지 완료'
                      : '사람 윤곽 기준 자동 맞춤'}
                </strong>
                <small>
                  {poseState === 'ready'
                    ? '사람 마스크와 어깨·골반·발목 좌표로 기존 옷을 지우고 새 옷을 맞춰요.'
                    : '배경 여백과 사람 크기를 분석해 옷 위치를 보정해요.'}
                </small>
              </div>
            </div>
          )}
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
              <a href="#add-item">상품 URL 추가하러 가기</a>
            </div>
          )}

          <p className="product-photo-tip">
            정면으로 펼쳐진 선명한 상품사진일수록 로고·패턴·소재 디테일이 더 잘 유지돼요.
            <span>모델 착용컷과 단독 상품컷을 자동 구분해요. 현재 생성 대상은 상의·하의·아우터·원피스예요.</span>
          </p>
        </section>

        <section className="fit-panel fit-result-panel" aria-label="실사 가상 피팅 결과">
          <div className="fit-panel-heading fit-result-heading">
            <span>03</span>
            <div>
              <strong>AI 피팅 결과</strong>
              <p>원래 얼굴과 체형은 유지하고 선택한 옷만 바꿔요.</p>
            </div>
          </div>

          <div className={'fit-engine-status is-' + engineState} role="status">
            <span aria-hidden="true" />
            <div>
              <strong>
                {engineState === 'ready'
                  ? precisionEngineAvailable
                    ? '정밀 피팅 준비 완료'
                    : 'AI 피팅 준비 중'
                    : engineState === 'offline'
                      ? '웹 서버 연결 끊김'
                      : '피팅 준비 상태 확인 중'}
              </strong>
              <p>
                {engineState === 'ready'
                  ? precisionEngineAvailable
                    ? '기존 옷을 지우고 한 번의 정밀 생성으로 새 옷을 입혀요.'
                    : '첫 생성은 AI 준비 때문에 조금 더 오래 걸릴 수 있어요.'
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
                <strong>AI가 실제 옷을 입히는 중</strong>
                <p>기존 옷을 지우고 허리선·다리 윤곽·주름과 가림을 새로 만들고 있어요.</p>
              </div>
            )}
          </div>

          {resultImage && (
            <div className="result-actions">
              <span>
                {resultItemNames.length}개 상품 적용 완료
                {resultEngine ? ' · ' + resultEngine : ''}
              </span>
              <a href={resultImage} download="wearly-virtual-fit.jpg">결과 저장</a>
            </div>
          )}

          <div className="fit-time-estimate">
            <span>정밀 실사 생성</span>
            <strong>
              {generationItemCount
                ? '약 ' + estimatedSeconds + '초 전후'
                : '상품 선택 후 계산'}
            </strong>
            <small>기존 옷을 지운 뒤 새로 생성하며, 공개 GPU 대기열에 따라 더 오래 걸릴 수 있어요.</small>
          </div>

          <label className="photo-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              본인 또는 사용 동의를 받은 사진이며, 실루엣 분석과 외부 AI 처리에 동의해요.
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
                        ? supportedSelectedItems.length
                          ? supportedSelectedItems.length + '개 옷 정밀 실사 피팅 시작'
                          : '상의·하의·원피스를 선택해 주세요'
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
          <p className="credit-note">무료 데모 · API 키 불필요 · 생성에 실패하면 원본 사진을 유지해요.</p>
        </section>
      </div>

      <section className="look-comparison" aria-labelledby="comparison-heading">
        <div className="comparison-heading">
          <div>
            <p className="eyebrow">QUICK COMPARISON</p>
            <h3 id="comparison-heading">입어보는 수고 없이, Look 비교</h3>
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
          localStorage에 저장하지 않아요. 생성할 때만 이 사이트의 서버와 Hugging Face의 공개
          FASHN VTON 엔진으로 전달되며, 실패하면 CatVTON을 보조로 사용합니다. 결과는 현재
          화면에서만 비교합니다.{' '}
          <a href="https://huggingface.co/fashn-ai/fashn-vton-1.5" target="_blank" rel="noreferrer">
            FASHN VTON 1.5 · Apache 2.0
          </a>
          {' · '}
          <a href="https://github.com/Zheng-Chong/CatVTON" target="_blank" rel="noreferrer">
            CatVTON · CC BY-NC-SA 4.0 · 비상업용
          </a>
        </p>
      </div>
    </section>
  );
}
