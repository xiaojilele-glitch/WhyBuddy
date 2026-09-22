import { describe, expect, it } from "vitest";
import { rewritePreviewHostHeader } from "./tunnel-stream";

const SSLIP = "rt-pop-874a3787c0e842659ca163c282fb839a.preview.156.239.47.108.sslip.io";

describe("rewritePreviewHostHeader", () => {
  it("rewrites the iframe Host to loopback and leaves the body", () => {
    const raw = Buffer.from(
      `GET / HTTP/1.1\r\nHost: ${SSLIP}\r\nAccept: text/html\r\n\r\n<body>`,
      "latin1",
    );
    const out = rewritePreviewHostHeader(raw).toString("latin1");
    expect(out).toContain("Host: 127.0.0.1");
    expect(out).not.toContain(SSLIP);
    expect(out.endsWith("\r\n\r\n<body>")).toBe(true);
  });

  it("does not rewrite non-HTTP bytes or responses", () => {
    const ws = Buffer.from("hmr-update");
    expect(rewritePreviewHostHeader(ws).equals(ws)).toBe(true);
    const response = Buffer.from("HTTP/1.1 200 OK\r\nHost: example\r\n\r\n");
    expect(rewritePreviewHostHeader(response).equals(response)).toBe(true);
  });
});
