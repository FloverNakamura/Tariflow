function getBackendUrl(env) {
  return env?.BACKEND_URL || 'https://tariflow.up.railway.app';
}

export async function onRequestPost({ request, env }) {
  try {
    const backendUrl = getBackendUrl(env);
    const body = await request.text();
    const response = await fetch(`${backendUrl}/api/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
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

export async function onRequest() {
  return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
    status: 405,
    headers: { 'content-type': 'application/json' }
  });
}
