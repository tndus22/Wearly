import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GeocodingResult = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
};

type GeocodingResponse = {
  results?: GeocodingResult[];
};

type ForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    rain?: number;
    showers?: number;
    snowfall?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    is_day?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
  timezone?: string;
};

const knownKoreanLocations: Array<
  GeocodingResult & { aliases: string[] }
> = [
  { name: '서울', latitude: 37.5665, longitude: 126.978, country: '대한민국', country_code: 'KR', admin1: '서울특별시', timezone: 'Asia/Seoul', aliases: ['서울'] },
  { name: '부산', latitude: 35.1796, longitude: 129.0756, country: '대한민국', country_code: 'KR', admin1: '부산광역시', timezone: 'Asia/Seoul', aliases: ['부산'] },
  { name: '제주', latitude: 33.4996, longitude: 126.5312, country: '대한민국', country_code: 'KR', admin1: '제주특별자치도', timezone: 'Asia/Seoul', aliases: ['제주'] },
  { name: '인천', latitude: 37.4563, longitude: 126.7052, country: '대한민국', country_code: 'KR', admin1: '인천광역시', timezone: 'Asia/Seoul', aliases: ['인천'] },
  { name: '대전', latitude: 36.3504, longitude: 127.3845, country: '대한민국', country_code: 'KR', admin1: '대전광역시', timezone: 'Asia/Seoul', aliases: ['대전'] },
  { name: '대구', latitude: 35.8714, longitude: 128.6014, country: '대한민국', country_code: 'KR', admin1: '대구광역시', timezone: 'Asia/Seoul', aliases: ['대구'] },
  { name: '광주', latitude: 35.1595, longitude: 126.8526, country: '대한민국', country_code: 'KR', admin1: '광주광역시', timezone: 'Asia/Seoul', aliases: ['광주'] },
  { name: '울산', latitude: 35.5384, longitude: 129.3114, country: '대한민국', country_code: 'KR', admin1: '울산광역시', timezone: 'Asia/Seoul', aliases: ['울산'] },
  { name: '수원', latitude: 37.2636, longitude: 127.0286, country: '대한민국', country_code: 'KR', admin1: '경기도', timezone: 'Asia/Seoul', aliases: ['수원'] },
  { name: '성남', latitude: 37.4201, longitude: 127.1265, country: '대한민국', country_code: 'KR', admin1: '경기도', timezone: 'Asia/Seoul', aliases: ['성남', '분당'] },
  { name: '고양', latitude: 37.6584, longitude: 126.832, country: '대한민국', country_code: 'KR', admin1: '경기도', timezone: 'Asia/Seoul', aliases: ['고양', '일산'] },
  { name: '용인', latitude: 37.2411, longitude: 127.1776, country: '대한민국', country_code: 'KR', admin1: '경기도', timezone: 'Asia/Seoul', aliases: ['용인'] },
  { name: '세종', latitude: 36.48, longitude: 127.289, country: '대한민국', country_code: 'KR', admin1: '세종특별자치시', timezone: 'Asia/Seoul', aliases: ['세종'] },
  { name: '청주', latitude: 36.6424, longitude: 127.489, country: '대한민국', country_code: 'KR', admin1: '충청북도', timezone: 'Asia/Seoul', aliases: ['청주'] },
  { name: '천안', latitude: 36.8151, longitude: 127.1139, country: '대한민국', country_code: 'KR', admin1: '충청남도', timezone: 'Asia/Seoul', aliases: ['천안'] },
  { name: '전주', latitude: 35.8242, longitude: 127.148, country: '대한민국', country_code: 'KR', admin1: '전북특별자치도', timezone: 'Asia/Seoul', aliases: ['전주'] },
  { name: '춘천', latitude: 37.8813, longitude: 127.7298, country: '대한민국', country_code: 'KR', admin1: '강원특별자치도', timezone: 'Asia/Seoul', aliases: ['춘천'] },
  { name: '강릉', latitude: 37.7519, longitude: 128.8761, country: '대한민국', country_code: 'KR', admin1: '강원특별자치도', timezone: 'Asia/Seoul', aliases: ['강릉'] },
  { name: '포항', latitude: 36.019, longitude: 129.3435, country: '대한민국', country_code: 'KR', admin1: '경상북도', timezone: 'Asia/Seoul', aliases: ['포항'] },
  { name: '창원', latitude: 35.228, longitude: 128.6811, country: '대한민국', country_code: 'KR', admin1: '경상남도', timezone: 'Asia/Seoul', aliases: ['창원'] },
];

function weatherPresentation(code: number, isDay: boolean) {
  if (code === 0) return { description: '맑음', icon: isDay ? '☀️' : '🌙' };
  if (code <= 3) return { description: code === 1 ? '대체로 맑음' : '구름 많음', icon: '⛅' };
  if (code === 45 || code === 48) return { description: '안개', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { description: '이슬비', icon: '🌦️' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { description: code >= 65 ? '강한 비' : '비', icon: '🌧️' };
  }
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return { description: '눈', icon: '🌨️' };
  }
  if (code >= 95) return { description: '뇌우', icon: '⛈️' };
  return { description: '날씨 변화', icon: '🌤️' };
}

function isPrivateCoordinate(latitude: number, longitude: number) {
  return !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180;
}

async function geocodeCity(city: string) {
  const normalizedCity = city.replace(/\s+/g, '');
  const knownLocation = knownKoreanLocations.find((location) =>
    location.aliases.some((alias) => normalizedCity.startsWith(alias)),
  );
  if (knownLocation) return knownLocation;

  const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodingUrl.searchParams.set('name', city);
  geocodingUrl.searchParams.set('count', '5');
  geocodingUrl.searchParams.set('language', 'ko');
  geocodingUrl.searchParams.set('format', 'json');

  const response = await fetch(geocodingUrl, {
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('LOCATION_LOOKUP_FAILED');

  const data = (await response.json()) as GeocodingResponse;
  const results = data.results ?? [];
  const selected = results.find((result) => result.country_code === 'KR') ?? results[0];
  if (!selected) throw new Error('LOCATION_NOT_FOUND');
  return selected;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city')?.trim() ?? '';
  const latitudeParam = Number(searchParams.get('lat'));
  const longitudeParam = Number(searchParams.get('lon'));
  const hasCoordinates = searchParams.has('lat') && searchParams.has('lon');

  if (!hasCoordinates && (city.length < 2 || city.length > 50)) {
    return NextResponse.json(
      { error: '두 글자 이상의 도시나 지역 이름을 입력해 주세요.' },
      { status: 400 },
    );
  }
  if (hasCoordinates && isPrivateCoordinate(latitudeParam, longitudeParam)) {
    return NextResponse.json({ error: '위치 좌표를 확인해 주세요.' }, { status: 400 });
  }

  try {
    const location = hasCoordinates
      ? {
          name: '현재 위치',
          latitude: latitudeParam,
          longitude: longitudeParam,
          country: '대한민국',
          admin1: '',
          timezone: 'auto',
        }
      : await geocodeCity(city);

    const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
    forecastUrl.searchParams.set('latitude', String(location.latitude));
    forecastUrl.searchParams.set('longitude', String(location.longitude));
    forecastUrl.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,is_day',
    );
    forecastUrl.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    );
    forecastUrl.searchParams.set('forecast_days', '1');
    forecastUrl.searchParams.set('timezone', 'auto');

    const forecastResponse = await fetch(forecastUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!forecastResponse.ok) throw new Error('FORECAST_FAILED');

    const forecast = (await forecastResponse.json()) as ForecastResponse;
    const current = forecast.current;
    if (!current || typeof current.temperature_2m !== 'number') {
      throw new Error('FORECAST_MALFORMED');
    }

    const weatherCode = current.weather_code ?? 0;
    const presentation = weatherPresentation(weatherCode, current.is_day !== 0);
    const locationParts = [location.name, location.admin1]
      .filter((value, index, values) => value && values.indexOf(value) === index);

    return NextResponse.json(
      {
        location: locationParts.join(' · '),
        country: location.country ?? '',
        latitude: location.latitude,
        longitude: location.longitude,
        temperature: current.temperature_2m,
        apparentTemperature: current.apparent_temperature ?? current.temperature_2m,
        high: forecast.daily?.temperature_2m_max?.[0] ?? current.temperature_2m,
        low: forecast.daily?.temperature_2m_min?.[0] ?? current.temperature_2m,
        precipitationProbability: forecast.daily?.precipitation_probability_max?.[0] ?? 0,
        precipitation: current.precipitation ?? 0,
        rain: (current.rain ?? 0) + (current.showers ?? 0),
        snowfall: current.snowfall ?? 0,
        weatherCode,
        windSpeed: current.wind_speed_10m ?? 0,
        description: presentation.description,
        icon: presentation.icon,
        observedAt: current.time ?? '',
        timezone: forecast.timezone ?? location.timezone ?? '',
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message === 'LOCATION_NOT_FOUND'
        ? '해당 지역을 찾지 못했어요. 도시 이름을 조금 더 구체적으로 입력해 주세요.'
        : '날씨 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
