import { describe, it, expect } from "vitest";
import {
  loadScenarioFromText,
  isScenarioLoadError,
} from "../../src/scenario/loader";
import dynamoYaml from "../../../scenarios/dynamodb-hot-partition/scenario.yaml?raw";
import cascadeYaml from "../../../scenarios/cascading-timeout-misconfiguration/scenario.yaml?raw";
import sqsYaml from "../../../scenarios/sqs-visibility-timeout-memory-leak/scenario.yaml?raw";
import kinesisYaml from "../../../scenarios/kinesis-poison-pill/scenario.yaml?raw";

const noopResolve = (_: string): Promise<string> =>
  Promise.reject(new Error("not found"));

const scenarios = [
  { name: "dynamodb-hot-partition", yaml: dynamoYaml },
  { name: "cascading-timeout-misconfiguration", yaml: cascadeYaml },
  { name: "sqs-visibility-timeout-memory-leak", yaml: sqsYaml },
  { name: "kinesis-poison-pill", yaml: kinesisYaml },
];

describe("new hard scenarios — load validation", () => {
  for (const { name, yaml } of scenarios) {
    it(`${name} loads without errors`, async () => {
      const result = await loadScenarioFromText(yaml, noopResolve);
      if (isScenarioLoadError(result)) {
        console.error(
          `${name} ERRORS:`,
          JSON.stringify(result.errors, null, 2),
        );
      }
      expect(isScenarioLoadError(result)).toBe(false);
    });

    it(`${name} has no lint warnings`, async () => {
      const result = await loadScenarioFromText(yaml, noopResolve);
      if (
        !isScenarioLoadError(result) &&
        (result as any).warnings?.length > 0
      ) {
        console.warn(
          `${name} WARNINGS:`,
          JSON.stringify((result as any).warnings, null, 2),
        );
      }
      if (!isScenarioLoadError(result)) {
        expect((result as any).warnings ?? []).toHaveLength(0);
      }
    });
  }
});
