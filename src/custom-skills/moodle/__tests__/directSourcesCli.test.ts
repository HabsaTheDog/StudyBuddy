import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const execute = promisify(execFile);
describe("broker-owned direct source CLI configuration", () => {
  it("permits inventory with calendar-only configuration and no feed disclosure", async () => {
    const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "source-cli-calendar-")));
    try {
      const { stdout } = await execute(process.execPath, ["--import", "tsx", "src/custom-skills/moodle/directSourcesCli.ts", '{"op":"inventory"}'], {
        cwd: process.cwd(), env: { PATH: process.env.PATH, STUDY_BUDDY_BROKER_EXECUTION: "1", STUDY_BUDDY_WORKSPACE: workspace,
          STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "test-owner", CIS_CALENDAR_URL: "https://calendar.example/private-feed" },
      });
      expect(JSON.parse(stdout)).toMatchObject({ok:true,portals:[],calendarConfigured:true});
      expect(stdout).not.toContain("private-feed");
    } finally { await rm(workspace, { recursive:true,force:true }); }
  });
  it("keeps a public configured Moodle course target in CLI inventory", async () => {
    const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "source-cli-course-")));
    try {
      const { stdout } = await execute(process.execPath, ["--import", "tsx", "src/custom-skills/moodle/directSourcesCli.ts", '{"op":"inventory"}'], {
        cwd: process.cwd(), env: { PATH: process.env.PATH, STUDY_BUDDY_BROKER_EXECUTION: "1", STUDY_BUDDY_WORKSPACE: workspace,
          STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "test-owner", MOODLE_DASHBOARD_URL: "https://college.example/course/view.php?id=73&token=private-token" },
      });
      expect(JSON.parse(stdout)).toMatchObject({ok:true,portals:[{kind:"moodle",dashboard:"https://college.example/course/view.php?id=73"}],calendarConfigured:false});
      expect(stdout).not.toContain("private-token");
    } finally { await rm(workspace, { recursive:true,force:true }); }
  });
});
