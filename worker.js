require("dotenv").config();
const mongoose = require("mongoose");
const Redis = require("ioredis");

const WORKERS = parseInt(process.env.WORKERS || "5", 10);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

const QUEUE_KEY = "notifications";
const PROCESSING_KEY = "notifications:processing";
const DLQ_KEY = "notifications:dlq";

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");
const metrics = {
  processed: 0,
  failed: 0,
  startedAt: Date.now(),
};

const notificationSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  channel: { type: String, required: true },
  template: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, default: "PENDING" },
  createdAt: { type: Date, default: Date.now },
}, { bufferCommands: false });

const Notification = mongoose.model("Notification", notificationSchema);

async function requeueStuckJobs() {
  const stuck = await redis.lrange(PROCESSING_KEY, 0, -1);
  if (stuck.length > 0) {
    for (const job of stuck) {
      await redis.lpush(QUEUE_KEY, job);
    }
    await redis.del(PROCESSING_KEY);
    console.log(`Requeued ${stuck.length} stuck jobs from processing list`);
  }
}

async function processJob(job) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await Notification.create({ ...job, status: "PENDING" });
      return true;
    } catch (err) {
      if (err.code === 11000) {
        console.log(`DUPLICATE (jobId ${job.jobId}) — already processed`);
        return true;
      }
      console.error(`Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.log(`Retrying jobId=${job.jobId} in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  return false;
}

async function worker(id) {
  while (true) {
    try {
      const result = await redis.brpoplpush(QUEUE_KEY, PROCESSING_KEY, 5);

      if (!result) continue;

      const job = JSON.parse(result);
      console.log(`Worker ${id} processing jobId=${job.jobId}`);

      const success = await processJob(job);

      if (success) {
        await redis.lrem(PROCESSING_KEY, 1, result);
        metrics.processed++;
      } else {
        await redis.lrem(PROCESSING_KEY, 1, result);
        await redis.lpush(DLQ_KEY, JSON.stringify({ job, failedAt: new Date() }));
        metrics.failed++;
        console.log(`Worker ${id} DLQ pushed jobId=${job.jobId}`);
      }

      const queueLen = await redis.llen(QUEUE_KEY);
      const elapsedSeconds = Math.max((Date.now() - metrics.startedAt) / 1000, 1);
      const rate = (metrics.processed / elapsedSeconds).toFixed(2);
      console.log(
        `Worker ${id} done | PROCESSED: ${metrics.processed} | ` +
        `RATE: ${rate} jobs/sec | FAILED: ${metrics.failed} | ` +
        `QUEUE: ${queueLen} | WORKERS: ${WORKERS}`
      );
    } catch (err) {
      console.error(`Worker ${id} error:`, err.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      maxPoolSize: 10,
      minPoolSize: 10,
      serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || "30000", 10),
    });
    console.log("Worker connected to MongoDB");
  } catch (err) {
    console.error(`MongoDB connection failed; worker will retry jobs: ${err.message}`);
  }

  await requeueStuckJobs();

  const proc = process.env.WORKER_PROC || "1";
  console.log(`Starting ${WORKERS} workers (proc ${proc})`);

  for (let i = 0; i < WORKERS; i++) {
    worker(`${proc}-${i + 1}`);
  }
}

start();
