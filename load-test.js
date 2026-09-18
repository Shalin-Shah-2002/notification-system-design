import http from "k6/http";
import { check } from "k6";

const TARGET = __ENV.TARGET || "http://localhost:8081";

const payload = JSON.stringify({
  userId: "123",
  channel: "email",
  template: "welcome",
  data: { name: "Shalin" },
});

const params = { headers: { "Content-Type": "application/json" } };

export const options = {
  scenarios: {
    notifications: {
      executor: "constant-arrival-rate",
      rate: 150,
      timeUnit: "1s",
      duration: "30s",
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
  const res = http.post(`${TARGET}/notifications`, payload, params);
  check(res, { "status is 201": (r) => r.status === 201 });
}
