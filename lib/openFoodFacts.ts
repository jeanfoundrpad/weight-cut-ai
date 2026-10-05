import type { ScanEstimate } from './repo'

/**
 * Open Food Facts' public barcode API — free, no auth, no rate-limit key
 * needed for reasonable use, but their terms require it either way: (1) a
 * custom User-Agent identifying the app on every call, sent below, and
 * (2) visible attribution wherever their data is shown — see the "Data
 * from Open Food Facts" credit on the Nutrition screen. ODbL is actually
 * two obligations, attribution *and* share-alike, not just the one this
 * comment used to reason about.
 *
 * Deliberately queried live at scan time, never bundled or rehosted: OFF's
 * dataset is ODbL-licensed with a share-alike clause, so building a
 * private database FROM it would force that database open. Calling their
 * API as a live lookup service each time is a different, legitimate use —
 * no local copy of their data is ever made or distributed, same as calling
 * any other third-party API.
 *
 * Values come back per 100g; grams defaults to 100 and the caller can
 * adjust it (and everything else) via the same editable review screen
 * photo-scanned meals already use — this app never pretends a lookup or
 * an AI guess is more precise than it actually is.
 */
export async function lookupBarcode(barcode: string): Promise<ScanEstimate | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
      headers: { 'User-Agent': 'WeightCutAI/1.0 (contact: jnsaintfelix@gmail.com)' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      status: number
      product?: {
        product_name?: string
        nutriments?: {
          'energy-kcal_100g'?: number
          proteins_100g?: number
          carbohydrates_100g?: number
          fat_100g?: number
        }
      }
    }
    if (data.status !== 1 || !data.product) return null

    const name = data.product.product_name?.trim()
    if (!name) return null

    const n = data.product.nutriments ?? {}
    return {
      label: name,
      servingLabel: '100 g', // OFF values are always per 100g — a real, accurate serving description, not a guess
      grams: 100,
      calories: n['energy-kcal_100g'] ?? 0,
      proteinG: n.proteins_100g ?? 0,
      carbsG: n.carbohydrates_100g ?? 0,
      fatG: n.fat_100g ?? 0,
    }
  } catch (e) {
    console.error('[openFoodFacts] lookupBarcode failed', e)
    return null
  }
}
