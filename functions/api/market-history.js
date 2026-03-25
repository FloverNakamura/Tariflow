const BACKEND_URL = 'https://tariflow.up.railway.app';

export async function onRequest({ request }) {
  try {
    const url = new URL(request.url);
    const hours = url.searchParams.get('hours') || '168';
    
    const response = await fetch(`${BACKEND_URL}/api/market-history?hours=${hours}`, {
      method: 'GET',
      headers: { 'accept': 'application/json' }
    });
    
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 502,
      headers: { 'content-type': 'application/json' }
    });
  }
}
