import { handlePriceChartingSearch, jsonResponse } from '../../server/pricecharting.js'

export async function handler(event) {
  try {
    const params = event.queryStringParameters ?? {}
    const result = await handlePriceChartingSearch(params.q ?? '', params.region ?? 'jp')
    return jsonResponse(result.status, result.body)
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error?.message ?? 'PriceCharting request failed' })
  }
}
