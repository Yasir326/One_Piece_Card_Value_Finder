import { handleTopJapanese, jsonResponse } from '../../server/pricecharting.js'

export async function handler(event) {
  try {
    const result = await handleTopJapanese()
    return jsonResponse(result.status, result.body)
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error?.message ?? 'PriceCharting request failed' })
  }
}
