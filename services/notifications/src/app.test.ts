import { describe, expect, it } from "vitest";
import { buildApp, SERVICE_NAME } from "./app.js";

describe(SERVICE_NAME, () => {
  it("responde /health", async () => {
    const app = await buildApp("silent");
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: SERVICE_NAME });
    await app.close();
  });
});
