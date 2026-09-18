import http from "k6/http";
import { check } from "k6";

const TARGET = __ENV.TARGET || "http://localhost:8081";
const RATE = Number(__ENV.RATE || 150);
const DURATION = __ENV.DURATION || "60s";

export const options = {
  scenarios: {
    notifications: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(99)<500"],
  },
};

export default function () {
  const payload = JSON.stringify({
    userId: "123",
    channel: "email",
    template: "welcome",
    data: { name: "Shalin", seq: `${__VU}-${__ITER}` },
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `k6-${__VU}-${__ITER}`,
    },
  };
  const res = http.post(`${TARGET}/notifications-v2`, payload, params);
  check(res, { "status is 202": (r) => r.status === 202 });
}
