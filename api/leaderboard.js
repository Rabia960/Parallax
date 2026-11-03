// Vercel serverless function: GET = top 10 scores, POST = save a score.
// Storage: Upstash Redis (free) connected through the Vercel dashboard.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(commands) {
    const r = await fetch(URL_ + "/pipeline", {
        method: "POST",
        headers: { Authorization: "Bearer " + TOKEN },
        body: JSON.stringify(commands)
    });
    return r.json();
}

module.exports = async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!URL_ || !TOKEN) return res.status(503).json({ error: "Database not configured" });

    try {
        if (req.method === "POST") {
            const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
            const name = String(body.name || "").replace(/[^\w \-]/g, "").trim().slice(0, 16);
            const score = Math.floor(Number(body.score));
            const level = Math.floor(Number(body.level));
            if (!name || !(score >= 0 && score <= 20000) || !(level >= 1 && level <= 7)) {
                return res.status(400).json({ error: "Invalid data" });
            }
            // GT = only overwrite if the new score is higher than the saved one
            await redis([
                ["ZADD", "parallax:scores", "GT", score, name],
                ["HSET", "parallax:levels", name, level]
            ]);
        }

        const [top] = await redis([["ZRANGE", "parallax:scores", 0, 9, "REV", "WITHSCORES"]]);
        const flat = top.result || [];
        const names = flat.filter((_, i) => i % 2 === 0);
        const [lv] = names.length ? await redis([["HMGET", "parallax:levels", ...names]]) : [{ result: [] }];
        const rows = names.map((n, i) => ({ name: n, score: Number(flat[i * 2 + 1]), level: Number(lv.result[i]) || 1 }));
        return res.status(200).json(rows);
    } catch (e) {
        return res.status(500).json({ error: "Server error" });
    }
};
