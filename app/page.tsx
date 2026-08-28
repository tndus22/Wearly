'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import AvatarStudio from '@/components/avatar-studio';

type ProductPayload = {
  name: string;
  imageUrl: string;
  price: string;
  brand: string;
  sourceUrl: string;
  category: string;
  color: string;
  season: string;
  style: string;
  source: string;
};

type ClosetItem = ProductPayload & {
  id: string;
  visual: string;
  background: string;
};

type WeatherData = {
  location: string;
  country: string;
  temperature: number;
  apparentTemperature: number;
  high: number;
  low: number;
  precipitationProbability: number;
  precipitation: number;
  rain: number;
  snowfall: number;
  weatherCode: number;
  windSpeed: number;
  description: string;
  icon: string;
  observedAt: string;
  timezone: string;
};

type WeatherResponse = WeatherData & { error?: string };

const sampleProduct: ProductPayload = {
  name: '소프트 니트 카디건',
  imageUrl: '',
  price: '49,000원',
  brand: 'Wearly sample',
  sourceUrl: 'https://shop.example.com/products/soft-knit-cardigan',
  category: '상의',
  color: '크림',
  season: '간절기',
  style: '미니멀',
  source: 'sample',
};

const starterItems: ClosetItem[] = [
  {
    ...sampleProduct,
    id: 'starter-knit',
    name: '오트밀 리브 니트',
    sourceUrl: 'sample://oatmeal-knit',
    color: '베이지',
    season: '가을·겨울',
    visual: 'KNIT',
    background: 'linear-gradient(145deg, #e8dcc8, #c9b89e)',
  },
  {
    ...sampleProduct,
    id: 'starter-pants',
    name: '블랙 와이드 슬랙스',
    sourceUrl: 'sample://black-slacks',
    category: '하의',
    color: '블랙',
    season: '사계절',
    style: '포멀',
    visual: 'PANTS',
    background: 'linear-gradient(145deg, #545752, #1e211e)',
  },
  {
    ...sampleProduct,
    id: 'starter-shoes',
    name: '화이트 레더 스니커즈',
    sourceUrl: 'sample://white-sneakers',
    category: '신발',
    color: '화이트',
    season: '사계절',
    style: '캐주얼',
    visual: 'SHOES',
    background: 'linear-gradient(145deg, #ffffff, #d8d9d4)',
  },
  {
    ...sampleProduct,
    id: 'starter-shirt',
    name: '네이비 옥스퍼드 셔츠',
    sourceUrl: 'sample://navy-shirt',
    category: '상의',
    color: '네이비',
    season: '간절기',
    style: '포멀',
    visual: 'SHIRT',
    background: 'linear-gradient(145deg, #4f6075, #182333)',
  },
];

const situations = [
  { id: 'campus', label: '학교·캠퍼스', detail: '오래 편안하게' },
  { id: 'office', label: '회사·오피스', detail: '단정한 출근룩' },
  { id: 'date', label: '카페·데이트', detail: '분위기 있게' },
  { id: 'interview', label: '면접·발표', detail: '신뢰감 있게' },
  { id: 'walk', label: '공원·야외', detail: '활동성 우선' },
  { id: 'travel', label: '여행·나들이', detail: '레이어드 편하게' },
];

const destinationStyles: Record<string, string[]> = {
  campus: ['캐주얼', '미니멀', '스포티'],
  office: ['포멀', '미니멀'],
  date: ['미니멀', '캐주얼'],
  interview: ['포멀', '미니멀'],
  walk: ['스포티', '캐주얼'],
  travel: ['캐주얼', '스포티', '미니멀'],
};

const destinationTitles: Record<string, string> = {
  campus: '수업 사이를 편안하게 잇는 캠퍼스 룩',
  office: '날씨까지 계산한 단정한 출근 룩',
  date: '분위기와 체감온도를 함께 잡은 데이트 룩',
  interview: '신뢰감을 주는 면접·발표 룩',
  walk: '걷기 편하고 날씨 변화에 강한 야외 룩',
  travel: '오래 움직여도 편한 여행 레이어드 룩',
};

function isWetWeather(weather: WeatherData | null) {
  if (!weather) return false;
  return (
    weather.precipitationProbability >= 50 ||
    weather.rain > 0 ||
    weather.snowfall > 0 ||
    (weather.weatherCode >= 51 && weather.weatherCode <= 86) ||
    weather.weatherCode >= 95
  );
}

function scoreClosetItem(
  item: ClosetItem,
  occasion: string,
  weather: WeatherData | null,
) {
  const preferredStyles = destinationStyles[occasion] ?? destinationStyles.campus;
  const feelsLike = weather?.apparentTemperature ?? 20;
  const wet = isWetWeather(weather);
  const descriptor = [
    item.name,
    item.category,
    item.style,
    item.season,
    item.color,
  ].join(' ').toLowerCase();
  let score = preferredStyles.includes(item.style) ? 6 - preferredStyles.indexOf(item.style) : 0;

  if (feelsLike <= 8) {
    if (/겨울|니트|울|기모|패딩|코트|재킷|자켓/.test(descriptor)) score += 5;
    if (/여름|린넨|반팔|쇼츠/.test(descriptor)) score -= 5;
  } else if (feelsLike <= 17) {
    if (/간절기|가을|봄|니트|셔츠|가디건|재킷|자켓/.test(descriptor)) score += 4;
    if (/여름|쇼츠/.test(descriptor)) score -= 2;
  } else if (feelsLike >= 27) {
    if (/여름|린넨|반팔|코튼|쇼츠/.test(descriptor)) score += 5;
    if (/겨울|울|기모|패딩|코트|니트/.test(descriptor)) score -= 6;
  } else if (/사계절|봄|여름|간절기/.test(descriptor)) {
    score += 2;
  }

  if (wet) {
    if (/블랙|검정|네이비|방수|레인|부츠/.test(descriptor)) score += 3;
    if (item.category === '신발' && /화이트|흰|스웨이드/.test(descriptor)) score -= 4;
  }

  if (occasion === 'interview' || occasion === 'office') {
    if (/포멀|셔츠|슬랙스|로퍼|블랙|네이비/.test(descriptor)) score += 4;
    if (/스포티|후드|트레이닝/.test(descriptor)) score -= 3;
  }
  if (occasion === 'walk' || occasion === 'travel') {
    if (/캐주얼|스포티|스니커즈|와이드|편안/.test(descriptor)) score += 3;
  }
  if (occasion === 'date' && item.category === '상의') {
    if (!/블랙|검정/.test(descriptor)) score += 2;
  }

  return score;
}

function bestItem(
  pool: ClosetItem[],
  occasion: string,
  weather: WeatherData | null,
) {
  return pool
    .map((item, index) => ({
      item,
      index,
      score: scoreClosetItem(item, occasion, weather),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.item;
}

async function requestWeather(
  params: { city?: string; latitude?: number; longitude?: number },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (params.city) query.set('city', params.city);
  if (typeof params.latitude === 'number') query.set('lat', String(params.latitude));
  if (typeof params.longitude === 'number') query.set('lon', String(params.longitude));

  try {
    const response = await fetch('/api/weather?' + query.toString(), { signal });
    const data = (await response.json()) as WeatherResponse;
    if (!response.ok || data.error) {
      throw new Error(data.error || '날씨 정보를 불러오지 못했어요.');
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof TypeError) {
      throw new Error('웹 서버에 연결할 수 없어요. 서버를 실행한 뒤 새로고침해 주세요.');
    }
    throw error;
  }
}

function visualFor(category: string) {
  if (category === '하의') return 'BOTTOM';
  if (category === '신발') return 'SHOES';
  if (category === '아우터') return 'OUTER';
  if (category === '원피스') return 'DRESS';
  if (category === '액세서리') return 'ACC.';
  return 'TOP';
}

function backgroundFor(color: string) {
  const value = color.toLowerCase();
  if (/black|블랙|검정/.test(value)) return 'linear-gradient(145deg, #565954, #1d201d)';
  if (/white|화이트|흰/.test(value)) return 'linear-gradient(145deg, #ffffff, #d8d9d4)';
  if (/navy|네이비/.test(value)) return 'linear-gradient(145deg, #4f6075, #182333)';
  if (/blue|블루|파랑/.test(value)) return 'linear-gradient(145deg, #9bb7ca, #47768f)';
  if (/pink|핑크|분홍/.test(value)) return 'linear-gradient(145deg, #f0c9d5, #c68197)';
  if (/green|그린|초록/.test(value)) return 'linear-gradient(145deg, #b9cab2, #55715a)';
  if (/brown|브라운|갈색/.test(value)) return 'linear-gradient(145deg, #b89b80, #624b3b)';
  return 'linear-gradient(145deg, #eee2cf, #c9b79b)';
}

function toClosetItem(product: ProductPayload): ClosetItem {
  return {
    ...product,
    id: `item-${Date.now()}`,
    visual: visualFor(product.category),
    background: backgroundFor(product.color),
  };
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ProductPayload | null>(null);
  const [message, setMessage] = useState('');
  const [closet, setCloset] = useState<ClosetItem[]>(starterItems);
  const [occasion, setOccasion] = useState('campus');
  const [storageReady, setStorageReady] = useState(false);
  const [cityInput, setCityInput] = useState('서울');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState('');
  const [recommendationSignal, setRecommendationSignal] = useState(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- Browser storage is restored only after hydration. */
    try {
      const saved = window.localStorage.getItem('wearly-closet');
      if (saved) setCloset(JSON.parse(saved) as ClosetItem[]);
    } catch {
      // The demo remains usable when browser storage is unavailable.
    } finally {
      setStorageReady(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem('wearly-closet', JSON.stringify(closet));
  }, [closet, storageReady]);

  useEffect(() => {
    const controller = new AbortController();
    requestWeather({ city: '서울' }, controller.signal)
      .then((data) => {
        setWeather(data);
        setWeatherError('');
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setWeatherError(error instanceof Error ? error.message : '날씨 정보를 불러오지 못했어요.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setWeatherLoading(false);
      });
    return () => controller.abort();
  }, []);

  const recommendation = useMemo(() => {
    const topPool = closet.filter((item) => item.category === '상의');
    const bottomPool = closet.filter((item) => item.category === '하의');
    const outerPool = closet.filter((item) => item.category === '아우터');
    const dressPool = closet.filter((item) => item.category === '원피스');
    const shoePool = closet.filter((item) => item.category === '신발');
    const top = bestItem(topPool, occasion, weather);
    const bottom = bestItem(bottomPool, occasion, weather);
    const dress = bestItem(dressPool, occasion, weather);
    const outer = bestItem(outerPool, occasion, weather);
    const shoes = bestItem(shoePool, occasion, weather);
    const feelsLike = weather?.apparentTemperature ?? 20;
    const wet = isWetWeather(weather);
    const needsOuter = feelsLike < 18 || (weather?.windSpeed ?? 0) >= 20 || wet;
    const useDress = Boolean(
      dress && (occasion === 'date' || !top || !bottom) && feelsLike > 8,
    );
    const items = (
      useDress
        ? [dress, needsOuter ? outer : undefined, shoes]
        : [top, bottom, needsOuter ? outer : undefined, shoes]
    ).filter(Boolean) as ClosetItem[];

    const reasons: string[] = [];
    if (weather) {
      reasons.push(
        weather.location +
          ' 체감 ' +
          Math.round(weather.apparentTemperature) +
          '°·' +
          weather.description +
          ' 기준이에요.',
      );
    } else {
      reasons.push('날씨를 연결하는 동안 무난한 간절기 기준으로 골랐어요.');
    }
    if (feelsLike < 8) {
      reasons.push('보온성이 높은 소재와 겉옷을 우선했어요.');
    } else if (feelsLike < 18) {
      reasons.push('실내외 온도 차에 대응할 수 있도록 겹쳐 입기 좋은 조합을 골랐어요.');
    } else if (feelsLike >= 27) {
      reasons.push('덥지 않도록 가벼운 계절 소재와 밝은 조합을 우선했어요.');
    }
    if (wet) {
      reasons.push('비·눈 가능성을 고려해 오염이 덜 보이는 색과 신발을 우선했어요.');
    }
    if (occasion === 'office' || occasion === 'interview') {
      reasons.push('장소에 맞춰 포멀하고 안정적인 색을 더 높게 평가했어요.');
    } else if (occasion === 'walk' || occasion === 'travel') {
      reasons.push('오래 움직여도 편한 캐주얼·스포티 아이템을 더 높게 평가했어요.');
    }

    return {
      title: destinationTitles[occasion] ?? destinationTitles.campus,
      reason: reasons.join(' '),
      items,
      factors: [
        situations.find((item) => item.id === occasion)?.label ?? '학교·캠퍼스',
        weather ? '체감 ' + Math.round(weather.apparentTemperature) + '°' : '날씨 연결 중',
        weather ? '강수 ' + weather.precipitationProbability + '%' : '기본 날씨',
      ],
    };
  }, [closet, occasion, weather]);
  const selectedSituation =
    situations.find((item) => item.id === occasion) ?? situations[0];

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setPreview(null);

    if (!url.trim()) {
      window.setTimeout(() => {
        setPreview(sampleProduct);
        setLoading(false);
        setMessage('샘플 상품을 분석했어요. 옷장에 추가해 보세요.');
      }, 650);
      return;
    }

    try {
      const response = await fetch(
        `/api/parse-product?url=${encodeURIComponent(url.trim())}`,
      );
      const data = (await response.json()) as ProductPayload & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || '링크를 읽지 못했어요.');
      setPreview(data);
      setMessage(
        data.source === 'metadata'
          ? '상품 페이지 정보를 읽었어요.'
          : '제한된 페이지라 URL에서 확인 가능한 정보만 먼저 정리했어요.',
      );
    } catch (error) {
      setMessage(
        error instanceof TypeError
          ? '웹 서버에 연결할 수 없어요. 서버를 실행한 뒤 다시 시도해 주세요.'
          : error instanceof Error
            ? error.message
            : '상품 링크를 다시 확인해 주세요.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error();
      setUrl(text);
      setMessage('클립보드의 링크를 붙여넣었어요.');
    } catch {
      setMessage('주소창에서 상품 URL을 복사한 뒤 입력칸에 붙여넣어 주세요.');
    }
  }

  function addToCloset() {
    if (!preview) return;
    const exists = closet.some((item) => item.sourceUrl === preview.sourceUrl);
    if (exists) {
      setMessage('이미 내 옷장에 있는 상품이에요.');
      return;
    }
    setCloset((current) => [toClosetItem(preview), ...current]);
    setPreview(null);
    setUrl('');
    setMessage('내 옷장에 저장했어요. 실사 피팅과 오늘의 코디에 바로 반영됐어요.');
  }

  function removeItem(id: string) {
    setCloset((current) => current.filter((item) => item.id !== id));
  }

  function resetCloset() {
    setCloset(starterItems);
    setMessage('샘플 옷장으로 다시 채웠어요.');
  }

  async function loadWeather(params: {
    city?: string;
    latitude?: number;
    longitude?: number;
  }) {
    setWeatherLoading(true);
    setWeatherError('');
    try {
      const data = await requestWeather(params);
      setWeather(data);
      if (params.city) setCityInput(params.city);
      return true;
    } catch (error) {
      setWeatherError(error instanceof Error ? error.message : '날씨 정보를 불러오지 못했어요.');
      return false;
    } finally {
      setWeatherLoading(false);
    }
  }

  async function handleWeatherSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cityInput.trim().length < 2) {
      setWeatherError('두 글자 이상의 도시나 지역 이름을 입력해 주세요.');
      return;
    }
    await loadWeather({ city: cityInput.trim() });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setWeatherError('이 브라우저에서는 현재 위치를 사용할 수 없어요.');
      return;
    }

    setWeatherLoading(true);
    setWeatherError('');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const success = await loadWeather({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        if (success) setCityInput('현재 위치');
      },
      () => {
        setWeatherLoading(false);
        setWeatherError('위치 권한을 허용하거나 도시 이름을 직접 입력해 주세요.');
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 600_000 },
    );
  }

  function sendRecommendationToFitting() {
    setRecommendationSignal((current) => current + 1);
    window.requestAnimationFrame(() => {
      document.getElementById('avatar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <main className="site-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Wearly 홈">
          <span className="brand-mark">W</span>
          <span>Wearly</span>
        </a>
        <nav className="main-nav" aria-label="주요 메뉴">
          <a href="#closet">내 옷장</a>
          <a href="#styling">날씨 코디</a>
          <a href="#avatar">실사 피팅</a>
        </nav>
        <div
          className={weatherLoading ? 'weather-pill is-loading' : 'weather-pill'}
          aria-label={
            weather
              ? weather.location +
                ' 현재 ' +
                Math.round(weather.temperature) +
                '도 ' +
                weather.description
              : '현재 날씨 불러오는 중'
          }
        >
          <span className="weather-symbol" aria-hidden="true">
            {weather?.icon ?? '·'}
          </span>
          {weather
            ? weather.location + ' ' + Math.round(weather.temperature) + '° · ' + weather.description
            : '날씨 연결 중'}
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AI CLOSET ASSISTANT</p>
          <h1>
            산 옷은 바로,
            <br />내 옷장으로.
          </h1>
          <p className="hero-description">
            쇼핑몰 상품 URL을 공유하면 옷의 색상과 스타일을 자동으로 읽고,
            내 전신사진에 실제 상품을 입혀본 뒤 여러 코디를 빠르게 비교해요.
          </p>
          <div className="hero-points" aria-label="서비스 장점">
            <span>계정 연동 없음</span>
            <span>공유 한 번</span>
            <span>실사 AI 피팅</span>
            <span>날씨·장소 자동 추천</span>
          </div>
        </div>

        <div className="import-panel">
          <div className="panel-heading">
            <div>
              <span className="step-label">STEP 01</span>
              <h2>상품 링크 가져오기</h2>
            </div>
            <span className="privacy-label">로그인 불필요</span>
          </div>

          <form className="url-form" onSubmit={handleImport}>
            <label htmlFor="product-url">쇼핑몰 상품 URL</label>
            <div className="input-row">
              <input
                id="product-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://shopping.com/product/..."
                aria-describedby="url-help"
              />
              <button className="paste-button" type="button" onClick={pasteFromClipboard}>
                붙여넣기
              </button>
              <button className="primary-button" type="submit" disabled={loading}>
                {loading ? '읽는 중…' : '불러오기'}
              </button>
            </div>
            <p id="url-help">공개 상품 페이지를 지원해요. 빈칸으로 누르면 샘플을 체험할 수 있어요.</p>
          </form>

          <div className="import-stage" aria-live="polite">
            {loading ? (
              <div className="loading-card">
                <span className="loading-visual" />
                <div>
                  <strong>상품 정보를 읽고 있어요</strong>
                  <p>제목 · 이미지 · 색상 · 카테고리를 확인 중이에요.</p>
                </div>
              </div>
            ) : preview ? (
              <div className="import-result">
                <div
                  className="product-visual"
                  style={{ background: backgroundFor(preview.color) }}
                >
                  {preview.imageUrl ? (
                    <Image
                      src={preview.imageUrl}
                      alt={preview.name}
                      width={132}
                      height={132}
                      unoptimized
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span>{visualFor(preview.category)}</span>
                  )}
                </div>
                <div className="product-summary">
                  <div className="product-status-line">
                    <span className="success-label">분석 완료</span>
                    <span className={preview.imageUrl ? 'image-read-label has-image' : 'image-read-label'}>
                      {preview.imageUrl ? '실제 상품 사진' : '사진 접근 제한'}
                    </span>
                  </div>
                  <h3>{preview.name}</h3>
                  <p>
                    {preview.category} · {preview.color} · {preview.season} · {preview.style}
                  </p>
                </div>
                <button className="add-button" type="button" onClick={addToCloset}>
                  옷장에 추가
                </button>
              </div>
            ) : (
              <ol className="import-steps">
                <li><span>1</span> 상품 링크 붙여넣기</li>
                <li><span>2</span> 정보 자동 태깅</li>
                <li><span>3</span> 옷장과 코디에 반영</li>
              </ol>
            )}
          </div>
          {message && <p className="status-message" role="status">{message}</p>}
        </div>
      </section>

      <section className="closet-section" id="closet" aria-labelledby="closet-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MY CLOSET</p>
            <h2 id="closet-heading">내 옷장</h2>
            <p>URL에서 읽은 실제 상품 사진과 정보가 이 기기의 브라우저에 저장돼요.</p>
          </div>
          <div className="closet-actions">
            <span>{closet.length} items</span>
            <button type="button" onClick={resetCloset}>샘플 초기화</button>
          </div>
        </div>

        {closet.length ? (
          <div className="closet-grid">
            {closet.map((item, index) => (
              <article className="closet-card" key={item.id}>
                <div className="closet-visual" style={{ background: item.background }}>
                  <span className="item-number">{String(index + 1).padStart(2, '0')}</span>
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.name}
                      width={480}
                      height={620}
                      unoptimized
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <strong>{item.visual}</strong>
                  )}
                  {item.imageUrl && item.source === 'metadata' && (
                    <span className="photo-badge">ACTUAL PRODUCT</span>
                  )}
                  <span className="color-chip">{item.color}</span>
                </div>
                <div className="closet-card-copy">
                  <div>
                    <p>{item.category} · {item.style}</p>
                    <h3>{item.name}</h3>
                  </div>
                  <div className="closet-card-actions">
                    {item.sourceUrl.startsWith('http') && (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">상품 보기</a>
                    )}
                    <button type="button" onClick={() => removeItem(item.id)} aria-label={`${item.name} 삭제`}>
                      삭제
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-closet">
            <strong>옷장이 비어 있어요.</strong>
            <p>위에서 첫 상품 링크를 추가해 주세요.</p>
          </div>
        )}
      </section>

      <section
        className="styling-section smart-styling-section"
        id="styling"
        aria-labelledby="styling-heading"
      >
        <div className="styling-controls">
          <p className="eyebrow">WEATHER × DESTINATION</p>
          <h2 id="styling-heading">날씨와 장소에 맞춰 자동으로.</h2>
          <p>가는 지역과 장소를 고르면 지금 내 옷장 안에서 가장 잘 맞는 한 벌을 골라요.</p>

          <div className="weather-search-card">
            <div className="weather-search-heading">
              <span>01</span>
              <div>
                <strong>가는 지역의 실시간 날씨</strong>
                <p>도시·구 이름을 검색하거나 현재 위치를 사용할 수 있어요.</p>
              </div>
            </div>
            <form className="weather-search-form" onSubmit={handleWeatherSearch}>
              <label htmlFor="weather-city">지역</label>
              <div>
                <input
                  id="weather-city"
                  value={cityInput}
                  onChange={(event) => setCityInput(event.target.value)}
                  placeholder="예: 서울, 부산, 제주"
                  maxLength={50}
                />
                <button type="submit" disabled={weatherLoading}>
                  {weatherLoading ? '확인 중…' : '날씨 확인'}
                </button>
              </div>
            </form>
            <div className="weather-shortcuts">
              {['서울', '부산', '제주'].map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => void loadWeather({ city })}
                  disabled={weatherLoading}
                >
                  {city}
                </button>
              ))}
              <button type="button" onClick={useCurrentLocation} disabled={weatherLoading}>
                현재 위치
              </button>
            </div>

            <div className={weather ? 'live-weather-card has-data' : 'live-weather-card'}>
              <span className="live-weather-icon" aria-hidden="true">
                {weather?.icon ?? '…'}
              </span>
              {weather ? (
                <>
                  <div className="live-weather-main">
                    <small>{weather.location}</small>
                    <strong>{Math.round(weather.temperature)}°</strong>
                    <p>{weather.description} · 체감 {Math.round(weather.apparentTemperature)}°</p>
                  </div>
                  <dl className="weather-metrics">
                    <div><dt>최고/최저</dt><dd>{Math.round(weather.high)}° / {Math.round(weather.low)}°</dd></div>
                    <div><dt>강수확률</dt><dd>{weather.precipitationProbability}%</dd></div>
                    <div><dt>바람</dt><dd>{Math.round(weather.windSpeed)} km/h</dd></div>
                  </dl>
                </>
              ) : (
                <div className="live-weather-main">
                  <small>LIVE WEATHER</small>
                  <strong>날씨 연결 중</strong>
                  <p>연결에 실패해도 기본 기온 기준으로 코디를 추천해요.</p>
                </div>
              )}
            </div>
            {weatherError && <p className="weather-error" role="status">{weatherError}</p>}
          </div>

          <div className="destination-heading">
            <span>02</span>
            <div>
              <strong>어디에 가나요?</strong>
              <p>장소에 필요한 격식과 활동량을 추천에 반영해요.</p>
            </div>
          </div>
          <div className="situation-list" role="group" aria-label="오늘의 일정">
            {situations.map((situation) => (
              <button
                key={situation.id}
                type="button"
                className={occasion === situation.id ? 'is-active' : ''}
                onClick={() => setOccasion(situation.id)}
                aria-pressed={occasion === situation.id}
              >
                <strong>{situation.label}</strong>
                <span>{situation.detail}</span>
              </button>
            ))}
          </div>
          <div className="auto-update-note">
            <span>자동 갱신</span>
            <p>날씨나 장소를 바꾸면 옷장 안의 추천 조합이 바로 다시 계산돼요.</p>
          </div>
        </div>

        <article className="recommendation-card">
          <div className="recommendation-topline">
            <span>MY CLOSET · AUTO PICK</span>
            <span>{selectedSituation.label}</span>
          </div>
          <div className="recommendation-context-tags" aria-label="추천 기준">
            {recommendation.factors.map((factor) => <span key={factor}>{factor}</span>)}
          </div>
          <div
            className={'outfit-stack outfit-count-' + Math.min(recommendation.items.length, 4)}
          >
            {recommendation.items.length ? recommendation.items.map((item) => (
              <div className="outfit-item" key={item.id}>
                <div style={{ background: item.background }}>
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      width={360}
                      height={440}
                      unoptimized
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span>{item.visual}</span>
                  )}
                </div>
                <small>{item.category} · {item.style}</small>
                <p>{item.name}</p>
              </div>
            )) : (
              <p className="outfit-empty">코디를 만들려면 옷을 조금 더 추가해 주세요.</p>
            )}
          </div>
          <div className="recommendation-copy">
            <p>WEARLY&apos;S PICK</p>
            <h3>{recommendation.title}</h3>
            <p>{recommendation.reason}</p>
            <button
              className="send-to-fitting-button"
              type="button"
              onClick={sendRecommendationToFitting}
              disabled={!recommendation.items.some((item) => item.imageUrl)}
            >
              {recommendation.items.some((item) => item.imageUrl)
                ? '이 추천을 실사 피팅에서 입어보기'
                : '실제 상품사진을 추가하면 피팅할 수 있어요'}
            </button>
            <small className="weather-source-note">
              실시간 날씨는 Open-Meteo 데이터를 사용하며, 추천은 현재 옷장 안에서만 만들어요.
            </small>
          </div>
        </article>
      </section>

      <AvatarStudio
        items={closet}
        suggestedItems={recommendation.items}
        occasionLabel={selectedSituation.label}
        recommendationSignal={recommendationSignal}
      />

      <footer>
        <a className="brand" href="#top"><span className="brand-mark">W</span>Wearly</a>
        <p>공유 한 번으로 완성되는 나만의 AI 옷장과 실사 가상 피팅.</p>
        <span>2-day MVP · 2026</span>
      </footer>
    </main>
  );
}
