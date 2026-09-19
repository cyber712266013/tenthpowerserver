// ─── GEMINI API KEYS ROTATION & COOLDOWN MANAGER ─────────────────────────
const exhaustedKeysCooldown = new Map();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 دقائق راحة لأي مفتاح ينفد رصيده

export function getGeminiApiKeys() {
  const rawKeys = [];
  if (process.env.GOOGLE_AI_API_KEY) rawKeys.push(...process.env.GOOGLE_AI_API_KEY.split(','));
  if (process.env.GOOGLE_AI_API_KEYS) rawKeys.push(...process.env.GOOGLE_AI_API_KEYS.split(','));
  if (process.env.GEMINI_API_KEY) rawKeys.push(...process.env.GEMINI_API_KEY.split(','));

  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GOOGLE_AI_API_KEY_${i}`] || process.env[`GEMINI_API_KEY_${i}`];
    if (key) rawKeys.push(...key.split(','));
  }

  const now = Date.now();
  const cleanedKeys = Array.from(new Set(rawKeys.map((k) => k.trim()).filter(Boolean)));

  const validKeys = cleanedKeys.filter((key) => {
    const until = exhaustedKeysCooldown.get(key);
    return !until || now >= until;
  });

  return validKeys.length > 0 ? validKeys : cleanedKeys;
}

export function markKeyExhausted(key, reason = 'quota') {
  console.warn(`[Gemini Keys] Key ending with ...${key.slice(-6)} exhausted (${reason}). Cooling down for 5m.`);
  exhaustedKeysCooldown.set(key, Date.now() + COOLDOWN_MS);
}

export function markKeyHealthy(key) {
  exhaustedKeysCooldown.delete(key);
}
