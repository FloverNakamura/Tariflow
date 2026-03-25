function getBackendUrl(env) {
  return env?.BACKEND_URL || 'https://tariflow.up.railway.app';
}

export async function onRequest({ env }) {
  try {
    const backendUrl = getBackendUrl(env);
    const response = await fetch(`${backendUrl}/api/market-live`, {
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
