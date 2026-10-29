import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';

const {
  BOT_TOKEN,
  GUILD_ID,
  CHANNEL_ID,
  PORT = 8080,
  CORS_ORIGIN = '*',
} = process.env;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env — see .env.example.');
  process.exit(1);
}
if (!GUILD_ID) {
  console.error('Missing GUILD_ID in .env — see .env.example.');
  process.exit(1);
}

const DISCORD_API = 'https://discord.com/api/v10';
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

function makeCache(ttlMs) {
  return { value: null, fetchedAt: 0, ttlMs };
}
function isFresh(cache) {
  return cache.value !== null && Date.now() - cache.fetchedAt < cache.ttlMs;
}

const statsCache = makeCache(30_000);
const feedCache = makeCache(30_000);

app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok' });
});

// جلب الإحصائيات باستخدام البوت مباشرة (بدون الحاجة لتفعيل Widget)
app.get('/api/stats', async (req, res) => {
  if (!isFresh(statsCache)) {
    try {
      const { data } = await axios.get(
        `${DISCORD_API}/guilds/${GUILD_ID}?with_counts=true`,
        { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
      );

      const online = data.approximate_presence_count ?? 0;
      const total = data.approximate_member_count ?? 0;
      const voice = 0; // الحصول على عدد الرومات الصوتية يحتاج قراءة حالة الأعضاء (Presence Intent)

      statsCache.value = { online, total, voice };
      statsCache.fetchedAt = Date.now();
    } catch (err) {
      console.error('[/api/stats]', err.response?.status, err.message);
      if (statsCache.value === null) {
        return res.status(502).json({
          error: 'stats_unavailable',
          detail: err.message,
        });
      }
    }
  }
  res.json(statsCache.value);
});

app.get('/api/feed', async (req, res) => {
  if (!CHANNEL_ID) {
    return res.status(500).json({ error: 'channel_not_configured' });
  }

  if (!isFresh(feedCache)) {
    try {
      const { data } = await axios.get(
        `${DISCORD_API}/channels/${CHANNEL_ID}/messages?limit=5`,
        { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
      );

      const posts = data
        .filter((msg) => !msg.author?.bot && msg.content?.trim().length > 0)
        .map((msg) => ({
          author: msg.author?.username ?? 'unknown',
          content: msg.content,
          timestamp: msg.timestamp,
        }));

      feedCache.value = posts;
      feedCache.fetchedAt = Date.now();
    } catch (err) {
      console.error('[/api/feed]', err.response?.status, err.message);
      if (feedCache.value === null) {
        const status = err.response?.status;
        const detail =
          status === 401
            ? 'Discord rejected the bot token. Check BOT_TOKEN in .env.'
            : status === 403
            ? "Bot lacks 'View Channel' / 'Read Message History' on this channel."
            : err.message;
        return res.status(502).json({ error: 'feed_unavailable', detail });
      }
    }
  }

  res.json({ posts: feedCache.value ?? [] });
});

app.listen(PORT, () => {
  console.log(`ExodusCode API listening on port ${PORT}`);
});
