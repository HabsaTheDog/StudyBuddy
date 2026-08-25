import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const contractScript = resolve(repositoryRoot, "scripts/check-desktop-release-contract.mjs");
const releaseWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/alpha-release.yml"),
  "utf8",
);
const reviewEnvironment = {
  RELEASE_VERSION: "1.0.0",
  PUBLISH_DRAFT: "false",
  SIGNED: "false",
  ACKNOWLEDGE_UNSIGNED_WINDOWS: "false",
  RELEASE_REF: "refs/heads/release/stable-rc",
  VITE_POSTHOG_PROJECT_TOKEN: "phc_public-project-token",
};

function runContract(overrides: Partial<typeof reviewEnvironment> = {}) {
  return spawnSync(process.execPath, [contractScript], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...reviewEnvironment, ...overrides },
  });
}

describe("desktop release contract", () => {
  it("allows an unsigned review-only stable build without acknowledgement", () => {
    expect(runContract().status).toBe(0);
  });

  it("allows an explicitly acknowledged unsigned draft from the exact tag", () => {
    expect(runContract({
      PUBLISH_DRAFT: "true",
      ACKNOWLEDGE_UNSIGNED_WINDOWS: "true",
      RELEASE_REF: "refs/tags/v1.0.0",
    }).status).toBe(0);
  });

  it("rejects unsigned draft publication without acknowledgement", () => {
    const result = runContract({
      PUBLISH_DRAFT: "true",
      RELEASE_REF: "refs/tags/v1.0.0",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires explicit acknowledgement");
  });

  it("rejects draft publication from anything except the exact tag", () => {
    const result = runContract({
      PUBLISH_DRAFT: "true",
      ACKNOWLEDGE_UNSIGNED_WINDOWS: "true",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must run from refs/tags/v1.0.0");
  });

  it("keeps the unconfigured signed path fail-closed", () => {
    const result = runContract({ SIGNED: "true" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Signed Windows builds remain disabled");
  });

  it("supports stable, alpha, and beta versions but rejects unsupported channels", () => {
    expect(runContract({ RELEASE_VERSION: "1.1.0-alpha.1" }).status).toBe(0);
    expect(runContract({ RELEASE_VERSION: "1.1.0-beta.1" }).status).toBe(0);
    const result = runContract({ RELEASE_VERSION: "1.1.0-rc.1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Expected stable, alpha, or beta SemVer");
  });

  it("requires a public telemetry ingestion token but no administrative key", () => {
    const result = runContract({ VITE_POSTHOG_PROJECT_TOKEN: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("public PostHog project token");
    expect(releaseWorkflow).toContain("vars.VITE_POSTHOG_PROJECT_TOKEN");
    expect(releaseWorkflow).not.toMatch(/POSTHOG_(?:PERSONAL|ADMIN|API)_KEY/u);
  });

  it("binds draft publication to the exact commit that built the artifacts", () => {
    expect(releaseWorkflow).toContain('tag_ref="repos/${GITHUB_REPOSITORY}/git/ref/tags/v${RELEASE_VERSION}"');
    expect(releaseWorkflow).toContain('while [ "$tag_type" = "tag" ]');
    expect(releaseWorkflow).toContain('[ "$tag_sha" != "$GITHUB_SHA" ]');
  });
});
