import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { validateAndSanitize } = require('../../backend-api/dist/validation/validateCalculationRequest');
const { runCalculation } = require('../../backend-api/dist/services/calcService');

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestPost({ request }) {
  try {
    const raw = await request.json().catch(() => ({}));
    const sanitized = validateAndSanitize(raw);
    const result = await runCalculation(sanitized);
    return jsonResponse(200, result);
  } catch (error) {
    if (error && error.message) {
      return jsonResponse(422, { success: false, error: error.message });
    }
    return jsonResponse(500, { success: false, error: 'Server error' });
  }
}

export async function onRequest() {
  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
