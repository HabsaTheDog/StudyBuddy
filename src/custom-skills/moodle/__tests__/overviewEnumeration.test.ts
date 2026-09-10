import { describe, expect, it } from "vitest";
import { enumerateCourseOverview } from "../overviewEnumeration.js";

const page = (id: number, next: boolean, count?: number) => ({
  origin: "https://moodle.example/my/", refs: { c: { name: `Course ${id}` } },
  snapshot: `${count ? `${count} Kurse - filtern\n` : ""}link "Course ${id}" [ref=c, url=https://moodle.example/course/view.php?id=${id}]\n${next ? 'button "Next page" [ref=next]' : ''}`,
});
describe("course overview enumeration", () => {
  it("retains all pages and avoids reference ID collisions", async () => {
    let index = 0;
    const pages = [page(1, true, 3), page(2, true, 3), page(3, false, 3)];
    const result = await enumerateCourseOverview({ snapshot: async () => pages[index], click: async () => { index++; }, wait: async () => {} }, pages[0]);
    expect(result).toMatchObject({ complete: true, pages: 3, courseCount: 3 });
    expect(result.snapshot.refs['overview-0-c'].name).toBe('Course 1');
    expect(result.snapshot.refs['overview-2-c'].name).toBe('Course 3');
  });
  it("does not claim completeness when advertised courses are missing", async () => {
    const first = page(1, false, 46);
    expect(await enumerateCourseOverview({ snapshot: async () => first, click: async () => {}, wait: async () => {} }, first)).toMatchObject({ complete: false, advertisedCount: 46, courseCount: 1 });
  });
  it("stops a pagination loop as incomplete", async () => {
    const first = page(1, true);
    expect(await enumerateCourseOverview({ snapshot: async () => first, click: async () => {}, wait: async () => {} }, first)).toMatchObject({ complete: false, pages: 2 });
  });
});
