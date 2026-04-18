import { expect, test } from "@playwright/test";
import { buildRunScopedFileTargetDir } from "../../../helpers/file-target-dir";
import { analyzerResultsUrlById } from "../../../helpers/results-ui";
import { resultValueSearchVariants } from "../../../helpers/results-ui";

test.describe("Harness helper invariants", () => {
  test("buildRunScopedFileTargetDir creates unique incoming directories", () => {
    const base = "/data/analyzer-imports/demo--quantstudio-7/incoming";
    const a = buildRunScopedFileTargetDir(base);
    const b = buildRunScopedFileTargetDir(base);

    expect(a).toContain("/data/analyzer-imports/demo--quantstudio-7/run-");
    expect(a.endsWith("/incoming")).toBeTruthy();
    expect(b.endsWith("/incoming")).toBeTruthy();
    expect(a).not.toEqual(b);
  });

  test("analyzerResultsUrlById uses id query parameter", () => {
    expect(analyzerResultsUrlById("1234")).toBe("AnalyzerResults?id=1234");
  });

  test("resultValueSearchVariants handles numeric formatting differences", () => {
    expect(resultValueSearchVariants("45200.0")).toEqual(
      expect.arrayContaining(["45200.0", "45200"]),
    );
    expect(resultValueSearchVariants("45200")).toEqual(
      expect.arrayContaining(["45200", "45200.0"]),
    );
  });
});
