import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProductLike = {
  name?: unknown;
  image?: unknown;
  color?: unknown;
  category?: unknown;
  brand?: unknown;
  offers?: unknown;
};

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
];

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MAX_HTML_BYTES = 800_000;

function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
  };

  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, entity) => entities[entity] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

function readAttribute(tag: string, attribute: string) {
  const match = tag.match(
    new RegExp(`${attribute}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, 'i'),
  );
  return decodeEntities(match?.[1] ?? match?.[2] ?? '');
}

function collectMeta(html: string) {
  const values = new Map<string, string>();
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const key = readAttribute(tag, 'property') || readAttribute(tag, 'name');
    const content = readAttribute(tag, 'content');
    if (key && content) values.set(key.toLowerCase(), content);
  }

  return values;
}

function readLinkedImage(html: string) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = readAttribute(tag, 'rel').toLowerCase();
    if (!rel.split(/\s+/).includes('image_src')) continue;
    const href = readAttribute(tag, 'href');
    if (href) return href;
  }
  return '';
}

function findProduct(node: unknown): ProductLike | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }

  const record = node as Record<string, unknown>;
  const type = record['@type'];
  if (
    type === 'Product' ||
    (Array.isArray(type) && type.some((entry) => entry === 'Product'))
  ) {
    return record as ProductLike;
  }

  for (const value of Object.values(record)) {
    const found = findProduct(value);
    if (found) return found;
  }
  return null;
}

function readJsonLd(html: string) {
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(decodeEntities(script[1]).replace(/^<!--|-->$/g, ''));
      const product = findProduct(parsed);
      if (product) return product;
    } catch {
      // Some stores expose malformed JSON-LD. Metadata remains a safe fallback.
    }
  }
  return null;
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const next = firstString(entry);
      if (next) return next;
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      firstString(record.url) ||
      firstString(record.contentUrl) ||
      firstString(record.thumbnailUrl) ||
      firstString(record.name)
    );
  }
  return '';
}

function readOfferPrice(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const entry of value) {
      const next = readOfferPrice(entry);
      if (next) return next;
    }
    return '';
  }
  const record = value as Record<string, unknown>;
  const price = firstString(record.price) || firstString(record.lowPrice);
  if (!price) return '';
  const currency = firstString(record.priceCurrency);
  return currency === 'KRW'
    ? `${Number(price).toLocaleString('ko-KR')}원`
    : currency
      ? `${price} ${currency}`
      : price;
}

function inferCategory(text: string) {
  const value = text.toLowerCase();
  if (/coat|jacket|blazer|jumper|padding|코트|재킷|자켓|점퍼|패딩/.test(value)) return '아우터';
  if (/dress|one.?piece|원피스|드레스/.test(value)) return '원피스';
  if (/pants|trouser|jean|denim|skirt|slacks|팬츠|바지|슬랙스|데님|스커트|치마/.test(value)) return '하의';
  if (/shoe|sneaker|loafer|boot|heel|샌들|슈즈|운동화|스니커즈|로퍼|부츠|구두/.test(value)) return '신발';
  if (/bag|pouch|cap|hat|scarf|가방|백|모자|스카프/.test(value)) return '액세서리';
  return '상의';
}

function inferColor(text: string) {
  const colors: Array<[RegExp, string]> = [
    [/black|블랙|검정/, '블랙'],
    [/white|화이트|흰색/, '화이트'],
    [/ivory|아이보리/, '아이보리'],
    [/cream|크림/, '크림'],
    [/beige|베이지|oatmeal|오트밀/, '베이지'],
    [/navy|네이비/, '네이비'],
    [/blue|블루|파랑/, '블루'],
    [/gray|grey|그레이|회색/, '그레이'],
    [/brown|브라운|갈색/, '브라운'],
    [/green|그린|초록/, '그린'],
    [/pink|핑크|분홍/, '핑크'],
    [/red|레드|빨강/, '레드'],
    [/yellow|옐로|노랑/, '옐로'],
  ];
  return colors.find(([pattern]) => pattern.test(text.toLowerCase()))?.[1] ?? '뉴트럴';
}

function inferSeason(text: string) {
  const value = text.toLowerCase();
  if (/linen|short|sleeveless|summer|린넨|반팔|민소매|여름/.test(value)) return '봄·여름';
  if (/coat|padding|wool|knit|fur|코트|패딩|울|니트|기모/.test(value)) return '가을·겨울';
  if (/cardigan|shirt|jacket|가디건|셔츠|재킷|자켓/.test(value)) return '간절기';
  return '사계절';
}

function inferStyle(text: string) {
  const value = text.toLowerCase();
  if (/blazer|slacks|shirt|loafer|tailor|블레이저|슬랙스|셔츠|로퍼|테일러/.test(value)) return '포멀';
  if (/sport|track|hood|sneaker|스포츠|트랙|후드|스니커즈/.test(value)) return '스포티';
  if (/minimal|basic|classic|미니멀|베이직|클래식/.test(value)) return '미니멀';
  return '캐주얼';
}

function titleFromUrl(url: URL) {
  const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  return slug
    .replace(/[-_+]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || `${url.hostname.replace(/^www\./, '')} 상품`;
}

function normalizeImageUrl(value: string, productUrl: URL) {
  if (!value) return '';
  try {
    const imageUrl = new URL(value, productUrl);
    return imageUrl.protocol === 'https:' ? imageUrl.toString() : '';
  } catch {
    return '';
  }
}

function isBlockedHost(hostname: string) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(value)) ||
    value === '::' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    /^fe[89ab]/.test(value) ||
    value.startsWith('ff')
  );
}

async function assertPublicDestination(url: URL) {
  const validPort =
    !url.port ||
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443');

  if (!['http:', 'https:'].includes(url.protocol) || !validPort || isBlockedHost(url.hostname)) {
    throw new Error('Blocked destination');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedHost(address))) {
    throw new Error('Blocked destination');
  }
}

async function fetchPublicPage(startUrl: URL) {
  let currentUrl = startUrl;
  const signal = AbortSignal.timeout(7000);

  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await assertPublicDestination(currentUrl);
    const response = await fetch(currentUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; WearlyPreview/1.0)',
      },
      redirect: 'manual',
      signal,
    });

    if (!REDIRECT_STATUS.has(response.status)) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) return { response, finalUrl: currentUrl };
    currentUrl = new URL(location, currentUrl);
  }

  throw new Error('Too many redirects');
}

async function readHtml(response: Response) {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytesRead = 0;

  while (bytesRead < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = MAX_HTML_BYTES - bytesRead;
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
    bytesRead += chunk.byteLength;
    html += decoder.decode(chunk, { stream: true });
    if (chunk.byteLength < value.byteLength || bytesRead >= MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
  }

  return html + decoder.decode();
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url')?.trim();
  if (!rawUrl) {
    return NextResponse.json({ error: '상품 URL을 입력해 주세요.' }, { status: 400 });
  }

  let productUrl: URL;
  try {
    productUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: '올바른 상품 URL이 아니에요.' }, { status: 400 });
  }

  if (!['http:', 'https:'].includes(productUrl.protocol) || isBlockedHost(productUrl.hostname)) {
    return NextResponse.json({ error: '공개된 쇼핑몰 상품 링크만 사용할 수 있어요.' }, { status: 400 });
  }

  const fallbackName = titleFromUrl(productUrl);
  const fallback = {
    name: fallbackName,
    imageUrl: '',
    price: '',
    brand: productUrl.hostname.replace(/^www\./, ''),
    sourceUrl: productUrl.toString(),
    category: inferCategory(productUrl.toString()),
    color: inferColor(productUrl.toString()),
    season: inferSeason(productUrl.toString()),
    style: inferStyle(productUrl.toString()),
    source: 'url',
  };

  try {
    const { response, finalUrl } = await fetchPublicPage(productUrl);

    if (!response.ok) return NextResponse.json(fallback);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return NextResponse.json(fallback);

    const html = await readHtml(response);
    const meta = collectMeta(html);
    const product = readJsonLd(html);
    const title =
      firstString(product?.name) ||
      meta.get('og:title') ||
      meta.get('twitter:title') ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      fallbackName;
    const name = decodeEntities(title).replace(/\s*[|｜–—-]\s*[^|｜–—-]+$/, '').trim();
    const imageUrl = normalizeImageUrl(
      firstString(product?.image) ||
      meta.get('og:image:secure_url') ||
      meta.get('og:image:url') ||
      meta.get('og:image') ||
      meta.get('twitter:image:src') ||
      meta.get('twitter:image') ||
      readLinkedImage(html) ||
      '',
      finalUrl,
    );
    const price =
      readOfferPrice(product?.offers) ||
      meta.get('product:price:amount') ||
      meta.get('og:price:amount') ||
      '';
    const brand = firstString(product?.brand) || meta.get('og:site_name') || fallback.brand;
    const searchable = [name, firstString(product?.category), firstString(product?.color), productUrl.toString()].join(' ');

    return NextResponse.json({
      name,
      imageUrl,
      price,
      brand,
      sourceUrl: productUrl.toString(),
      category: inferCategory(searchable),
      color: firstString(product?.color) || inferColor(searchable),
      season: inferSeason(searchable),
      style: inferStyle(searchable),
      source: 'metadata',
    });
  } catch {
    return NextResponse.json(fallback);
  }
}
