import gradedOverridesFile from '../graded-price-overrides.json' with { type: 'json' }

const PC_HEADERS = { 'User-Agent': 'Mozilla/5.0 one-piece-card-finder' }

function stripTags(input = '') {
  return input.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#43;/g, '+').replace(/\s+/g, ' ').trim()
}

function normalizeText(input = '') {
  return String(input).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function normalizeCardNameKey(input = '') {
  return normalizeText(input).replace(/\b(art|alternate|super|card)\b/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeMoney(raw = '') {
  if (!raw || raw.trim() === '-' || raw.trim() === '') return null
  const n = Number(raw.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizePcImageUrl(url = '') {
  if (!url) return null
  const absolute = url.startsWith('http') ? url : `https:${url}`
  const match = absolute.match(/^(https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^/]+)\/\d+\.jpg/i)
  return match ? `${match[1]}/240.jpg` : absolute
}

function parseProductImageFromDetail(html = '') {
  const match = html.match(/https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^/'"]+\/\d+\.jpg/i)
    ?? html.match(/storage\.googleapis\.com\/images\.pricecharting\.com\/[^/'"]+\/\d+\.jpg/i)
  if (!match) return null
  const url = match[0].startsWith('http') ? match[0] : `https://${match[0]}`
  return normalizePcImageUrl(url)
}

function isJapaneseSet(setName = '') {
  return /japanese|japan/i.test(setName)
}

function extractCardNumber(title = '') {
  const match = title.match(/\b(OP|ST|EB|P|PRB)(\d{2})-(\d{3}[A-Z]?)\b/i)
  if (!match) return ''
  return `${match[1].toUpperCase()}${match[2]}-${match[3].toUpperCase()}`
}

function parseSearchRows(html = '') {
  const rows = []
  const rowMatches = html.match(/<tr id="product-[^"]+"[\s\S]*?<\/tr>/g) ?? []

  for (const row of rowMatches) {
    const href = row.match(/<td class="title">[\s\S]*?<a href="([^"]+)"/)?.[1]
    if (!href) continue
    const titleRaw = row.match(/<td class="title">[\s\S]*?<a [^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1] ?? ''
    const setRaw = row.match(/<td class="console[\s\S]*?<a [^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1]
      ?? row.match(/<div class="console-in-title">[\s\S]*?<a [^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1]
      ?? ''
    const ungradedRaw = row.match(/<td class="price numeric used_price">[\s\S]*?<span class="js-price">([^<]*)<\/span>/)?.[1] ?? ''
    const imageRaw = row.match(/<td class="image">[\s\S]*?<img[^>]+src="([^"]+)"/)?.[1] ?? ''

    const setName = stripTags(setRaw)
    rows.push({
      url: href.startsWith('http') ? href : `https://www.pricecharting.com${href}`,
      title: stripTags(titleRaw),
      setName,
      ungraded: normalizeMoney(ungradedRaw),
      imageUrl: normalizePcImageUrl(imageRaw),
      region: isJapaneseSet(setName) ? 'JP' : 'EN',
      cardNumber: extractCardNumber(stripTags(titleRaw)),
    })
  }

  return rows
}

function pickBestSearchRow(rows, opts = {}) {
  if (!rows.length) return { row: null, confidence: 0 }

  const {
    cardName = '',
    setName = '',
    cardNumber = '',
    expectedRawPrice,
    region = 'EN',
  } = opts

  const cardNameN = normalizeText(cardName)
  const setNameN = normalizeText(setName)
  const cardNumberN = String(cardNumber).toUpperCase().trim()
  const expectedRaw = Number(expectedRawPrice)
  const wantsManga = /manga|super alternate|super alt|red super/.test(cardNameN)
  const cardTokens = cardNameN.split(' ').filter((token) => token.length > 2 && !['art', 'card', 'piece', 'one'].includes(token))

  let pool = rows
  if (region === 'JP') {
    const jpRows = rows.filter((row) => row.region === 'JP')
    pool = jpRows.length ? jpRows : rows
  } else if (region === 'EN') {
    const enRows = rows.filter((row) => row.region === 'EN')
    pool = enRows.length ? enRows : rows
  }

  const scored = pool.map((row) => {
    let score = 0
    const titleN = normalizeText(row.title)
    const setN = normalizeText(row.setName)
    const titleUpper = row.title.toUpperCase()
    const hasAltHint = /alternate art|alt art|spr/.test(titleN)
    const hasMangaHint = /manga|red manga/.test(titleN)
    const wantsAlt = /alternate art|alt|spr|\(p\d+\)/.test(cardNameN)

    if (cardNumberN && (titleUpper.includes(cardNumberN) || row.cardNumber === cardNumberN)) score += 100
    if (cardNameN && titleN.includes(cardNameN)) score += 55
    if (setNameN && setN.includes(setNameN)) score += 30
    if (region === 'JP' && row.region === 'JP') score += 40
    if (region === 'EN' && row.region === 'EN') score += 20
    if (region === 'EN' && row.region === 'JP') score -= 35

    if (cardTokens.length) {
      const matched = cardTokens.filter((token) => titleN.includes(token)).length
      score += Math.min(24, matched * 4)
    }

    if (wantsManga && hasMangaHint) score += 55
    if (wantsManga && !hasMangaHint) score -= 20
    if (wantsAlt && hasAltHint) score += 25
    if (!wantsAlt && hasAltHint && !wantsManga) score -= 10

    if (Number.isFinite(expectedRaw) && expectedRaw > 0 && Number.isFinite(row.ungraded) && row.ungraded > 0) {
      const ratio = row.ungraded / expectedRaw
      const distance = Math.abs(Math.log(ratio))
      score += Math.max(0, 45 - distance * 28)
    }

    if (row.ungraded) score += 5

    return { row, score }
  }).sort((a, b) => b.score - a.score)

  const best = scored[0]
  const second = scored[1]
  if (!best) return { row: null, confidence: 0 }
  const gap = best.score - (second?.score ?? 0)
  let confidence = 0.45 + Math.min(0.45, Math.max(0, gap) / 70) + Math.min(0.1, best.score / 320)
  confidence = Math.max(0, Math.min(1, confidence))
  return { row: best.row, confidence }
}

function parseFullPriceGuide(html = '') {
  const section = html.match(/<div id="full-prices">[\s\S]*?<table>([\s\S]*?)<\/table>/)?.[1] ?? ''
  const rows = section.match(/<tr>[\s\S]*?<\/tr>/g) ?? []
  const map = new Map()

  for (const row of rows) {
    const label = stripTags(row.match(/<td>([\s\S]*?)<\/td>/)?.[1] ?? '')
    const valueRaw = row.match(/<td class="price js-price">([\s\S]*?)<\/td>/)?.[1] ?? ''
    map.set(label, normalizeMoney(stripTags(valueRaw)))
  }

  return {
    raw_market_price: map.get('Ungraded') ?? null,
    raw_listing_price: map.get('Ungraded') ?? null,
    psa9: map.get('Grade 9') ?? null,
    psa10: map.get('PSA 10') ?? null,
    cgc10: map.get('CGC 10') ?? null,
    cgc10Pristine: map.get('CGC 10 Pristine') ?? null,
    bgs9_5: map.get('BGS 9.5') ?? map.get('Grade 9.5') ?? null,
    bgs10Pristine: map.get('BGS 10') ?? null,
    bgs10BlackLabel: map.get('BGS 10 Black') ?? null,
  }
}

function loadGradedOverrides() {
  return {
    byImageId: gradedOverridesFile?.by_image_id ?? {},
    byCardAndName: gradedOverridesFile?.by_card_number_and_name ?? {},
    byRegionCard: gradedOverridesFile?.by_region_card ?? {},
  }
}

const gradedOverrides = loadGradedOverrides()

function resolveOverrideUrl({ imageId = '', cardName = '', cardNumber = '', region = 'EN' }) {
  const regionKey = `${region}|${String(cardNumber || '').toUpperCase().trim()}|${normalizeCardNameKey(cardName)}`
  if (gradedOverrides.byRegionCard[regionKey]) {
    return { url: gradedOverrides.byRegionCard[regionKey], key: `region:${regionKey}` }
  }

  const idKey = String(imageId || '').trim()
  if (idKey && gradedOverrides.byImageId[idKey]) {
    return { url: gradedOverrides.byImageId[idKey], key: `image:${idKey}` }
  }

  const fallbackKey = `${String(cardNumber || '').toUpperCase().trim()}|${normalizeCardNameKey(cardName)}`
  if (gradedOverrides.byCardAndName[fallbackKey]) {
    return { url: gradedOverrides.byCardAndName[fallbackKey], key: `name:${fallbackKey}` }
  }

  return null
}

async function fetchPriceChartingHtml(targetUrl) {
  return fetch(targetUrl, { headers: PC_HEADERS }).then((r) => r.text())
}

export async function handlePriceChartingSearch(q, region = 'jp') {
  if (!q?.trim()) {
    return { status: 400, body: { ok: false, error: 'Missing query' } }
  }

  const searchUrl = `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(q.trim())}`
  const searchHtml = await fetchPriceChartingHtml(searchUrl)
  let cards = parseSearchRows(searchHtml)

  if (region === 'jp') cards = cards.filter((row) => row.region === 'JP')
  else if (region === 'en') cards = cards.filter((row) => row.region === 'EN')

  cards.sort((a, b) => (b.ungraded ?? 0) - (a.ungraded ?? 0))
  return { status: 200, body: { ok: true, cards } }
}

export async function handleTopJapanese() {
  const searchUrl = 'https://www.pricecharting.com/search-products?type=prices&q=one+piece+japanese&sort=price-highest'
  const searchHtml = await fetchPriceChartingHtml(searchUrl)
  const cards = parseSearchRows(searchHtml)
    .filter((row) => row.region === 'JP' && row.ungraded)
    .sort((a, b) => b.ungraded - a.ungraded)
    .slice(0, 10)

  return { status: 200, body: { ok: true, cards } }
}

export async function handleGradedPrices({
  cardName = '',
  setName = '',
  cardNumber = '',
  imageId = '',
  expectedRawPrice = '',
  region = 'EN',
  sourceUrl = '',
} = {}) {
  const directUrl = sourceUrl
  const q = `${cardName} ${cardNumber}`.trim()

  if (!q && !directUrl) {
    return { status: 400, body: { ok: false, error: 'Missing query values' } }
  }

  const override = resolveOverrideUrl({ imageId, cardName, cardNumber, region })
  let bestUrl = directUrl || override?.url || null
  let bestTitle = ''
  let confidence = override || directUrl ? 1 : 0
  let matchedBy = directUrl ? 'direct-url' : override ? `override:${override.key}` : 'search'

  if (!bestUrl) {
    const searchUrl = `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(q)}`
    const searchHtml = await fetchPriceChartingHtml(searchUrl)
    const rows = parseSearchRows(searchHtml)
    const bestPick = pickBestSearchRow(rows, { cardName, setName, cardNumber, expectedRawPrice, region })
    bestUrl = bestPick.row?.url ?? null
    bestTitle = bestPick.row?.title ?? ''
    confidence = bestPick.confidence ?? 0
  }

  if (!bestUrl) {
    return { status: 200, body: { ok: true, found: false, prices: null } }
  }

  const detailHtml = await fetchPriceChartingHtml(bestUrl)
  const prices = parseFullPriceGuide(detailHtml)
  const imageUrl = parseProductImageFromDetail(detailHtml)
  if (!bestTitle) {
    bestTitle = detailHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    bestTitle = stripTags(bestTitle ?? '')
  }

  return {
    status: 200,
    body: {
      ok: true,
      found: true,
      sourceUrl: bestUrl,
      title: bestTitle,
      imageUrl,
      prices,
      confidence,
      matchedBy,
      verified: Boolean(override || directUrl || confidence >= 0.86),
    },
  }
}

export function createPriceChartingHandler() {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next()

    try {
      const url = new URL(req.url, 'http://localhost')
      const pathname = url.pathname

      if (pathname === '/api/pricecharting/search') {
        const result = await handlePriceChartingSearch(
          url.searchParams.get('q') ?? '',
          url.searchParams.get('region') ?? 'jp',
        )
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result.body))
        return
      }

      if (pathname === '/api/pricecharting/top-japanese') {
        const result = await handleTopJapanese()
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result.body))
        return
      }

      if (pathname === '/api/graded-prices') {
        const result = await handleGradedPrices({
          cardName: url.searchParams.get('cardName') ?? '',
          setName: url.searchParams.get('setName') ?? '',
          cardNumber: url.searchParams.get('cardNumber') ?? '',
          imageId: url.searchParams.get('imageId') ?? '',
          expectedRawPrice: url.searchParams.get('expectedRawPrice') ?? '',
          region: url.searchParams.get('region') ?? 'EN',
          sourceUrl: url.searchParams.get('sourceUrl') ?? '',
        })
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result.body))
        return
      }
    } catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: error?.message ?? 'PriceCharting request failed' }))
      return
    }

    return next()
  }
}

export function jsonResponse(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
