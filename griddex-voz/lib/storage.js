// Persistencia opcional de estudios. Si el proyecto de Vercel tiene conectado
// un almacenamiento Redis (integración "Upstash Redis" / "KV" desde el
// Marketplace de Vercel), esto se activa automáticamente leyendo las
// variables de entorno estándar. Si no hay ninguna configurada, todas las
// funciones se convierten en no-ops seguros: la app sigue funcionando, solo
// que el historial de estudios no persiste entre despliegues.

let redisClient = null;
let checked = false;

function getRedis() {
  if (checked) return redisClient;
  checked = true;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisClient = null;
    return null;
  }
  try {
    const { Redis } = require("@upstash/redis");
    redisClient = new Redis({ url, token });
  } catch (e) {
    console.warn("No se pudo inicializar Redis para persistencia:", e.message);
    redisClient = null;
  }
  return redisClient;
}

async function saveStudy(id, data) {
  const redis = getRedis();
  if (!redis) return { ok: false, reason: "sin_almacenamiento" };
  await redis.set(`estudio:${id}`, JSON.stringify(data));
  await redis.zadd("estudios:index", { score: Date.now(), member: id });
  return { ok: true };
}

async function listStudies(limit) {
  const redis = getRedis();
  if (!redis) return { ok: false, reason: "sin_almacenamiento", items: [] };
  const ids = await redis.zrange("estudios:index", 0, (limit || 30) - 1, { rev: true });
  const items = [];
  for (const id of ids) {
    const raw = await redis.get(`estudio:${id}`);
    if (raw) items.push(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  return { ok: true, items };
}

function storageAvailable() {
  return !!getRedis();
}

module.exports = { saveStudy, listStudies, storageAvailable };
