import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

    rows.push({
      url: href.startsWith('http') ? href : `https://www.pricecharting.com${href}`,
      title: stripTags(titleRaw),
      setName: stripTags(setRaw),
      ungraded: normalizeMoney(ungradedRaw),
    })
  }

  return rows
}

function pickBestSearchRow(rows, { cardName = '', setName = '', cardNumber = '' }) {
  if (!rows.length) return { row: null, confidence: 0 }
  const cardNameN = normalizeText(cardName)
  const setNameN = normalizeText(setName)
  const cardNumberN = String(cardNumber).toUpperCase().trim()
  const expectedRaw = Number(arguments[1]?.expectedRawPrice)
  const wantsManga = /manga|super alternate|super alt|red super/.test(cardNameN)
  const cardTokens = cardNameN.split(' ').filter((token) => token.length > 2 && !['art', 'card', 'piece', 'one'].includes(token))

  const scored = rows.map((row) => {
    let score = 0
    const titleN = normalizeText(row.title)
    const setN = normalizeText(row.setName)
    const titleUpper = row.title.toUpperCase()
    const hasAltHint = /alternate art|alt art|spr/.test(titleN)
    const hasMangaHint = /manga|red manga/.test(titleN)
    const wantsAlt = /alternate art|alt|spr|\(p\d+\)/.test(cardNameN)

    if (cardNumberN && titleUpper.includes(cardNumberN)) score += 100
    if (cardNameN && titleN.includes(cardNameN)) score += 55
    if (setNameN && setN.includes(setNameN)) score += 30

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
    bgs10Pristine: map.get('BGS 10') ?? null,
    bgs10BlackLabel: map.get('BGS 10 Black') ?? null,
  }
}

function loadGradedOverrides() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const filePath = path.join(currentDir, 'graded-price-overrides.json')
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      byImageId: parsed?.by_image_id ?? {},
      byCardAndName: parsed?.by_card_number_and_name ?? {},
    }
  } catch {
    return { byImageId: {}, byCardAndName: {} }
  }
}

const gradedOverrides = loadGradedOverrides()

function resolveOverrideUrl({ imageId = '', cardName = '', cardNumber = '' }) {
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

function gradedPricePlugin() {
  const handler = async (req, res, next) => {
    if (!req.url?.startsWith('/api/graded-prices')) return next()

    try {
      const url = new URL(req.url, 'http://localhost')
      const cardName = url.searchParams.get('cardName') ?? ''
      const setName = url.searchParams.get('setName') ?? ''
      const cardNumber = url.searchParams.get('cardNumber') ?? ''
      const imageId = url.searchParams.get('imageId') ?? ''
      const expectedRawPrice = url.searchParams.get('expectedRawPrice') ?? ''
      const q = `${cardName} ${cardNumber}`.trim()
      if (!q) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: false, error: 'Missing query values' }))
        return
      }

      const override = resolveOverrideUrl({ imageId, cardName, cardNumber })
      let bestUrl = override?.url ?? null
      let bestTitle = ''
      let confidence = override ? 1 : 0
      let matchedBy = override ? `override:${override.key}` : 'search'

      if (!bestUrl) {
        const searchUrl = `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(q)}`
        const searchHtml = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 one-piece-card-finder' },
        }).then((r) => r.text())

        const rows = parseSearchRows(searchHtml)
        const bestPick = pickBestSearchRow(rows, { cardName, setName, cardNumber, expectedRawPrice })
        bestUrl = bestPick.row?.url ?? null
        bestTitle = bestPick.row?.title ?? ''
        confidence = bestPick.confidence ?? 0
      }

      if (!bestUrl) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, found: false, prices: null }))
        return
      }

      const detailHtml = await fetch(bestUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 one-piece-card-finder' },
      }).then((r) => r.text())

      const prices = parseFullPriceGuide(detailHtml)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        ok: true,
        found: true,
        sourceUrl: bestUrl,
        title: bestTitle,
        prices,
        confidence,
        matchedBy,
        verified: override ? true : confidence >= 0.86,
      }))
    } catch (error) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: error?.message ?? 'Failed to load graded prices' }))
    }
  }

  return {
    name: 'graded-price-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gradedPricePlugin()],
})
