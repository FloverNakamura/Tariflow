import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

export async function onRequest(context) {
  // Alle API-Requests werden durch die functions/api/* Handler bearbeitet
  // Das worker script hier ist nur für asset serving
  try {
    return await getAssetFromKV(context);
  } catch (e) {
    // Fallback auf 404 wenn asset nicht gefunden
    return new Response('Not Found', { status: 404 });
  }
}

export const config = {
  name: 'Tariflow Pages',
  compatible_flags: ['nodejs_compat_v2']
};
