require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Redis = require("ioredis");

const app = express();
app.use(express.json());

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

const QUEUE_KEY = "notifications";
const MAX_QUEUE = 5000;
const IDEMPOTENCY_TTL_SECONDS = 86400;

const ENQUEUE_SCRIPT = `
  local existing = redis.call("GET", KEYS[1])
  if existing then
    return { 0, existing }
  end

  if redis.call("LLEN", KEYS[2]) >= tonumber(ARGV[1]) then
    return { -1, "" }
  end

  redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
  redis.call("LPUSH", KEYS[2], ARGV[2])
  return { 1, ARGV[2] }
`;

const notificationSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  channel: { type: String, required: true },
  template: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, default: "PENDING" },
  createdAt: { type: Date, default: Date.now },
});

const Notification = mongoose.model("Notification", notificationSchema);

app.post("/notifications", async (req, res) => {
  const requestStart = Date.now();

  const { userId, channel, template, data } = req.body;

  if (!userId || !channel || !template || !data) {
    return res.status(400).json({
      error: "Missing required fields: userId, channel, template, data",
    });
  }

  const dbStart = Date.now();

  const notification = await Notification.create({
    jobId: crypto.randomUUID(),
    userId,
    channel,
    template,
    data,
  });

  const dbTime = Date.now() - dbStart;
  const totalTime = Date.now() - requestStart;

  console.log(
    `DB: ${dbTime}ms | TOTAL: ${totalTime}ms`
  );

  res.status(201).json({
    notificationId: notification._id,
    status: notification.status,
  });
});

app.post("/notifications-v2", async (req, res) => {
  const requestStart = Date.now();

  const { userId, channel, template, data } = req.body;
  const idempotencyKey = req.get("Idempotency-Key");

  if (!userId || !channel || !template || !data || !idempotencyKey) {
    return res.status(400).json({
      error: "Missing required fields: userId, channel, template, data, Idempotency-Key",
    });
  }

  const jobId = crypto
    .createHash("sha256")
    .update(idempotencyKey)
    .digest("hex");
  const job = JSON.stringify({ jobId, userId, channel, template, data });
  const idempotencyRedisKey = `notifications:idempotency:${idempotencyKey}`;
  const result = await redis.eval(
    ENQUEUE_SCRIPT,
    2,
    idempotencyRedisKey,
    QUEUE_KEY,
    MAX_QUEUE,
    job,
    IDEMPOTENCY_TTL_SECONDS
  );

  if (result[0] === -1) {
    return res.status(429).json({ error: "Queue full" });
  }

  const alreadyQueued = result[0] === 0;
  const queuedJob = JSON.parse(result[1]);
  const queueDepth = await redis.llen(QUEUE_KEY);

  const totalTime = Date.now() - requestStart;
  console.log(
    `TOTAL: ${totalTime}ms | QUEUE: ${queueDepth} | ` +
    `${alreadyQueued ? "DUPLICATE" : "QUEUED"} | JOB: ${queuedJob.jobId}`
  );

  res.status(alreadyQueued ? 200 : 202).json({
    jobId: queuedJob.jobId,
    status: alreadyQueued ? "ALREADY_QUEUED" : "QUEUED",
    queueDepth,
    instance: process.env.INSTANCE_ID,
  });
});

app.get("/queue", async (req, res) => {
  const depth = await redis.llen(QUEUE_KEY);
  const jobs = await redis.lrange(QUEUE_KEY, 0, 19);
  res.json({ depth, jobs: jobs.map((j) => JSON.parse(j)) });
});

app.get("/dlq", async (req, res) => {
  const count = await redis.llen("notifications:dlq");
  const jobs = await redis.lrange("notifications:dlq", 0, 19);
  res.json({ count, jobs: jobs.map((j) => JSON.parse(j)) });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

mongoose.connect(process.env.MONGO_URL, {
  maxPoolSize: 10,
  minPoolSize: 10,
}).then(() => {
  console.log("Connected to MongoDB");
}).catch((err) => {
  console.error(`MongoDB connection failed: ${err.message}`);
});
