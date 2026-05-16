import { NextRequest, NextResponse } from 'next/server'

const SAINSBURYS_API = 'https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: 'Missing query parameter q' }, { status: 400 })
  }

  const params = new URLSearchParams({
    'filter[keyword]': query.trim(),
    'page_number': '1',
    'page_size': searchParams.get('limit') ?? '10',
  })

  const upstream = await fetch(`${SAINSBURYS_API}?${params}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Language': 'en-GB,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.sainsburys.co.uk/gol-ui/groceries',
    },
    next: { revalidate: 300 }, // cache results for 5 minutes
  })

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Sainsbury's returned ${upstream.status}` },
      { status: upstream.status === 403 ? 502 : upstream.status }
    )
  }

  const data = await upstream.json() as {
    products?: Array<{
      product_uid: string;
      name: string;
      assets?: { plp_image?: string };
      image?: string;
      retail_price?: { price: number };
      unit_price?: { price: number; measure: string };
      is_available: boolean;
      full_url: string;
    }>;
  }

  const products = (data.products ?? []).map((p) => ({
    product_uid: p.product_uid,
    name: p.name,
    image: p.assets?.plp_image ?? p.image,
    retail_price: p.retail_price?.price,
    unit_price: p.unit_price?.price,
    unit_measure: p.unit_price?.measure,
    is_available: p.is_available,
    full_url: p.full_url,
  }))

  return NextResponse.json({ products, total: data.products?.length ?? 0 })
}
