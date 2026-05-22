import { handleGradedPrices, jsonResponse } from '../../server/pricecharting.js'

export async function handler(event) {
  try {
    const params = event.queryStringParameters ?? {}
    const result = await handleGradedPrices({
      cardName: params.cardName ?? '',
      setName: params.setName ?? '',
      cardNumber: params.cardNumber ?? '',
      imageId: params.imageId ?? '',
      expectedRawPrice: params.expectedRawPrice ?? '',
      region: params.region ?? 'EN',
      sourceUrl: params.sourceUrl ?? '',
    })
    return jsonResponse(result.status, result.body)
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error?.message ?? 'PriceCharting request failed' })
  }
}
