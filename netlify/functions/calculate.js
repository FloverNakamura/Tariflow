const { validateAndSanitize } = require('../../backend-api/dist/validation/validateCalculationRequest');
const { runCalculation } = require('../../backend-api/dist/services/calcService');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed' });
  }

  try {
    const raw = event.body ? JSON.parse(event.body) : {};
    const sanitized = validateAndSanitize(raw);
    const result = await runCalculation(sanitized);
    return json(200, result);
  } catch (error) {
    if (error && error.message) {
      return json(422, { success: false, error: error.message });
    }
    return json(500, { success: false, error: 'Server error' });
  }
};
