/**
 * Unit tests for AigcSpecNodeResponseSchema (autopilot-capability-bridge-aigc-node, task 4).
 *
 * Validates the schema contract documented in:
 *   - requirements.md 3.1 / 3.2 / 3.3
 *   - design.md §2.D9 / §4.4
 *   - tasks.md 4.1–4.8
 *
 * Every test case is example-based per requirements 9.3 (no PBT in this spec).
 * We exercise `safeParse` so we can assert on `.success` without throwing.
 */

import { describe, expect, it } from "vitest";

import {
  AigcSpecNodeResponseSchema,
  type AigcSpecNodeResponse,
} from "./schema.js";

describe("AigcSpecNodeResponseSchema", () => {
  describe("happy paths (task 4.1)", () => {
    it("accepts a minimal payload with single subsystem and empty risks", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ subsystems: ["A"], riskNotes: [] });
      }
    });

    it("accepts a full payload with dataFlowSketch and confidence", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A", "B", "C"],
        riskNotes: ["r1", "r2"],
        dataFlowSketch: "x→y→z",
        confidence: 0.78,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const data: AigcSpecNodeResponse = result.data;
        expect(data.subsystems).toEqual(["A", "B", "C"]);
        expect(data.riskNotes).toEqual(["r1", "r2"]);
        expect(data.dataFlowSketch).toBe("x→y→z");
        expect(data.confidence).toBe(0.78);
      }
    });
  });

  describe("subsystems validation (tasks 4.2–4.4)", () => {
    it("rejects when subsystems is missing (task 4.2)", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({ riskNotes: [] });
      expect(result.success).toBe(false);
    });

    it("rejects empty subsystems array (task 4.3: min 1)", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: [],
        riskNotes: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects subsystems array with 11 items (task 4.3: max 10)", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: Array.from({ length: 11 }, (_, i) => `s${i}`),
        riskNotes: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects subsystems item longer than 80 chars (task 4.4)", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["a".repeat(81)],
        riskNotes: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty string subsystems item (task 4.4: min 1)", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: [""],
        riskNotes: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("riskNotes validation (task 4.5)", () => {
    it("rejects riskNotes item longer than 200 chars", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: ["a".repeat(201)],
      });
      expect(result.success).toBe(false);
    });

    it("rejects riskNotes with 11 items (max 10)", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: Array(11).fill("x"),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("dataFlowSketch validation (task 4.6)", () => {
    it("rejects dataFlowSketch longer than 500 chars", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: [],
        dataFlowSketch: "a".repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-string dataFlowSketch", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: [],
        dataFlowSketch: 123,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("confidence validation (task 4.7)", () => {
    it("rejects confidence below 0", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: [],
        confidence: -0.1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects confidence above 1", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: [],
        confidence: 1.1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects string confidence", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: [],
        confidence: "0.5",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("unknown field stripping (task 4.8)", () => {
    it("accepts unknown top-level fields and strips them silently", () => {
      const result = AigcSpecNodeResponseSchema.safeParse({
        subsystems: ["A"],
        riskNotes: [],
        domainOntology: { entities: ["e1"] },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ subsystems: ["A"], riskNotes: [] });
        expect("domainOntology" in result.data).toBe(false);
      }
    });
  });
});
