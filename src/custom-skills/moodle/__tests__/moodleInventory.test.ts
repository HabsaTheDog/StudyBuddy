import { afterAll, beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright";
import { readEnrolledCourses, readCourseActivities, readActivityIndex, readActivityLanding, moodleRead } from "../moodleInventory.js";
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

it("serializes browser readers under the packaged tsx runtime", async () => {
  const script = `import {chromium} from 'playwright';
    import {readCourseActivities} from './src/custom-skills/moodle/moodleInventory.ts';
    (async()=>{const b=await chromium.launch({headless:true});try {
      const p=await b.newPage();await p.route('https://m.example/**',r=>r.fulfill({contentType:'text/html',body:'<main><a href="/mod/quiz/view.php?id=91">Quiz</a></main>'}));
      const result=await readCourseActivities(p,{id:'course-12',courseId:12,label:'Math',url:'https://m.example/course/view.php?id=12',start:null,end:null});
      if(result.activities.length!==1)throw Error('Activity was lost');
    }finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});`;
  await expect(promisify(execFile)(process.execPath, ["node_modules/tsx/dist/cli.mjs", "-e", script], { timeout: 15000 })).resolves.toBeDefined();
}, 20000);

it("enumerates130 enrollments beyond the first page and does not include navigation courses", async () => {
  const page = await browser.newPage();
  await page.route("https://m.example/**", route => route.fulfill({ contentType: "text/html", body: `<main>My courses</main><nav><a href='/course/view.php?id=999'>Help</a></nav><script>
    window.require = function(deps, done) { done({ call: function(requests) {
      var offset = requests[0].args.offset;
      var courses = Array.from({length: Math.max(0,Math.min(100,130-offset))}, function(_,i) {
        return { id: offset+i+2, fullname: 'Enrolled '+(offset+i+2), viewurl: 'https://m.example/course/view.php?id='+(offset+i+2) };
      });
      return [Promise.resolve({courses:courses,nextoffset:offset+courses.length})];
    }}); };
  </script>` }));
  const result = await readEnrolledCourses(page, "https://m.example/my/");
  expect(result.complete).toBe(true);
  expect(result.courses).toHaveLength(130);
  expect(result.courses.some(c => c.courseId === 999)).toBe(false);
  await expect(moodleRead(page, "core_course_delete_courses", {})).rejects.toThrow("Unsupported");
  await page.close();
});

it("reads collapsed course activities and table date/status evidence without invoking controls", async () => {
  const page = await browser.newPage();
  await page.route("https://m.example/**", route => route.fulfill({ contentType: "text/html", body: route.request().url().includes("index.php")
    ? `<main><table><thead><tr><th>Name</th><th>Abgabefrist</th><th>Status</th></tr></thead><tbody><tr><td><a href='view.php?id=91'>Worksheet</a></td><td>9. September 2026</td><td>Nicht abgegeben</td></tr></tbody></table></main>`
    : `<nav><a href='/mod/quiz/view.php?id=999'>Other course quiz</a></nav><main><li class='section' style='display:none'><h3>Präsenz 9.9.2026</h3><li class='activity'><a href='/mod/assign/view.php?id=91'>Worksheet</a><span>Abgabe bis 9. September 2026</span></li></li></main>` }));
  const course = { id: "course-12", courseId: 12, label: "Math", url: "https://m.example/course/view.php?id=12", start: null, end: null };
  const result = await readCourseActivities(page, course);
  expect(result.activities).toHaveLength(1);
  expect(result.activities[0].id).toBe("assign-91");
  const index = await readActivityIndex(page, course, "assign");
  expect(index.get("https://m.example/mod/assign/view.php?id=91")).toContain("Abgabefrist: 9. September 2026");
  expect(index.get("https://m.example/mod/assign/view.php?id=91")).toContain("Nicht abgegeben");
  await page.close();
});

it("does not attach the entire course's task instructions to an unrelated inline resource", async () => {
  const page = await browser.newPage();
  await page.route("https://m.example/**", r => r.fulfill({ contentType: "text/html", body: `<main><div><a href='/mod/page/view.php?id=93'>Technical guide</a><p>Abgabefrist: 9. September 2026 for a different task</p></div></main>` }));
  const result = await readCourseActivities(page, { id: "course-12", courseId: 12, label: "Math", url: "https://m.example/course/view.php?id=12", start: null, end: null });
  expect(result.activities[0].text).toBe("Technical guide");
  await page.close();
});

it("keeps inline support references separate from graded instructions in their enclosing activity", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main><li id='module-90' class='activity'><div class='activity-item'><p>Upload your graded assignment before tomorrow.</p><p>Optional questions: <a href='/mod/hotquestion/view.php?id=91'>Questions</a></p></div></li><li id='module-92' class='activity'><div class='activityname'><a href='/mod/assign/view.php?id=92'>Actual task</a></div><p>Due date: 9 September 2026</p></li></main>` }));
  const result = await readCourseActivities(page, { id: 'course-12', courseId: 12, label: 'Math', url: 'https://m.example/course/view.php?id=12', start: null, end: null });
  expect(result.activities.find(c => c.id === 'hotquestion-91')?.text).toBe('Optional questions: Questions');
  expect(result.activities.find(c => c.id === 'assign-92')?.text).toContain('Due date: 9 September 2026');
  await page.close();
});

it("reads an external activity popup and closes it without pressing controls or retaining query tokens", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main>Opened in a new window<script>window.open('https://tool.example/overview?token=private');</script></main>` }));
  await page.context().route('https://tool.example/**', r => r.fulfill({ contentType: 'text/html', body: '<main>Assignment overview. Due date: 9 September 2026. Status: not submitted.<button onclick="throw Error(\'must not click\')">Start attempt</button><div class="question">Private question text</div></main>' }));
  const text = await readActivityLanding(page, { id: 'lti-91', kind: 'lti', courseId: 12, label: 'External task', url: 'https://m.example/mod/lti/view.php?id=91', context: '', dates: [] });
  expect(text).toContain('Due date: 9 September 2026');
  expect(text).not.toContain('token=private');
  expect(text).not.toContain('Private question text');
  expect(page.context().pages()).toHaveLength(1);
  await page.close();
});
it("retains a course section heading for a prose reference in a course-format section", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main><div data-for='section'><h3>Unit 7: Alternating current</h3><li class='activity' id='module-90'><p>Homework <a href='/mod/quiz/view.php?id=91'>here</a></p></li></div></main>` }));
  const result = await readCourseActivities(page, { id: 'course-12', courseId: 12, label: 'Electronics', url: 'https://m.example/course/view.php?id=12', start: null, end: null });
  expect(result.activities[0].context).toContain('Unit 7: Alternating current');
  await page.close();
});

it("uses preceding non-activity headings for custom course formats without standard section wrappers", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main><h2>Unit 7: Alternating current</h2><div class='activity'><h3>Unrelated previous activity</h3></div><div class='custom-topic'><a href='/mod/quiz/view.php?id=91'>Homework</a></div></main>` }));
  const result = await readCourseActivities(page, { id: 'course-12', courseId: 12, label: 'Electronics', url: 'https://m.example/course/view.php?id=12', start: null, end: null });
  expect(result.activities[0].context).toBe('Unit 7: Alternating current');
  await page.close();
});

it("uses the complete read-only course state and canonical names even when the DOM shows one section and stale links", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main><a href='/mod/assign/view.php?id=101'>here</a><a href='/mod/quiz/view.php?id=999'>Old reference</a></main><script>
  window.require=(deps, done)=>done({call:(requests)=>{
    if(requests[0].methodname!=='core_courseformat_get_state')throw Error('Unexpected method');
    return [Promise.resolve(JSON.stringify({section:[{id:7,title:'Unit 7'}],cm:Array.from({length:110},(_,i)=>({id:101+i,module:'assign',sectionid:7,name:'Actual task '+(i+1),url:'https://m.example/mod/assign/view.php?id='+(101+i)}))}))];
  }});</script>` }));
  const result = await readCourseActivities(page, { id: 'course-12', courseId: 12, label: 'Electronics', url: 'https://m.example/course/view.php?id=12', start: null, end: null });
  expect(result).toMatchObject({ complete: true, method: 'course_state_api' });
  expect(result.activities).toHaveLength(110);
  expect(result.activities[0]).toMatchObject({ id: 'assign-101', label: 'Actual task 1', context: 'Unit 7' });
  expect(result.references.map(c => c.id)).toEqual(['quiz-999']);
  await page.close();
});
it("does not declare a DOM-only page a complete course inventory", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: '<main><a href="/mod/quiz/view.php?id=91">Quiz</a></main>' }));
  const result = await readCourseActivities(page, { id: 'course-12', courseId: 12, label: 'Math', url: 'https://m.example/course/view.php?id=12', start: null, end: null });
  expect(result).toMatchObject({ complete: false, method: 'course_dom_partial' });
  await page.close();
});


it("removes embedded session parameters before source text reaches evidence or models", async () => {
  const { redactSourceText } = await import("../moodleInventory.js");
  expect(redactSourceText("Feedback https://m.example/editor?a=1&amp;sesskey=canary-secret&amp;x=2"))
    .toBe("Feedback https://m.example/editor?a=1&amp;sesskey=[redacted]&amp;x=2");
});


it("retains access prerequisites for disabled modules without an anchor", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main><li id='module-91'><span>Group report</span><p>Submit your report</p><div class='availabilityinfo'>Not available unless:<ul><li>You belong to Group A</li><li>You belong to Group B</li></ul></div></li></main><script>window.require=(deps,done)=>done({call:()=>[Promise.resolve(JSON.stringify({section:[{id:7,title:'Reports'}],cm:[{id:'91',module:'assign',name:'Group report',uservisible:false,sectionid:7,url:'https://m.example/mod/assign/view.php?id=91'}]}))]});</script>` }));
  const result = await readCourseActivities(page, { id: 'course-12', courseId: 12, label: 'Lab', url: 'https://m.example/course/view.php?id=12', start: null, end: null });
  expect(result.activities[0]).toMatchObject({ accessible: false, accessRequirements: ['You belong to Group A', 'You belong to Group B'], text: expect.stringContaining('Submit your report') });
  await page.close();
});
it("reads visible external content from a zero-height body without accepting hidden templates", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main>Opened in a new window<script>window.open('https://tool.example/overview');</script></main>` }));
  await page.context().route('https://tool.example/**', r => r.fulfill({ contentType: 'text/html', body: `<body style='height:0;margin:0'><div style='position:fixed;inset:0'>Assignment overview. Due date: 9 September 2026. Status: not submitted.</div><div hidden>Fake hidden deadline: 1 January 2030</div></body>` }));
  const text = await readActivityLanding(page, { id: 'lti-91', kind: 'lti', courseId: 12, label: 'External task', url: 'https://m.example/mod/lti/view.php?id=91', context: '', dates: [] });
  expect(text).toContain('Due date: 9 September 2026');
  expect(text).not.toContain('Fake hidden deadline');
  await page.close();
});

it("reads an embedded external frame and ignores hidden frames without pressing task controls", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main>Abschlussbedingungen<iframe src='https://tool.example/overview?token=canary-secret'></iframe><iframe hidden src='https://tool.example/hidden'></iframe></main>` }));
  await page.context().route('https://tool.example/**', r => r.fulfill({ contentType: 'text/html', body: r.request().url().includes('/hidden') ? 'Hidden fake deadline: 1 January 2030' : `<body>External exercise. Due date: 9 September 2026.<button onclick="throw Error('must not click')">Record results</button></body>` }));
  const text = await readActivityLanding(page, { id: 'lti-91', kind: 'lti', courseId: 12, label: 'External exercise', url: 'https://m.example/mod/lti/view.php?id=91', context: '', dates: [] });
  expect(text).toContain('Due date: 9 September 2026');
  expect(text).toContain('Record results');
  expect(text).not.toContain('canary-secret');
  expect(text).not.toContain('Hidden fake');
  await page.close();
}, 15000);

it("does not mark an empty external launcher as read deadline evidence", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: '<main>Abschlussbedingungen</main>' }));
  await expect(readActivityLanding(page, { id: 'lti-91', kind: 'lti', courseId: 12, label: 'External exercise', url: 'https://m.example/mod/lti/view.php?id=91', context: '', dates: [] })).rejects.toThrow('empty launch page');
  await page.close();
}, 15000);


it("preserves attempt action labels while discarding editor/session form content", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main>Quiz closes: 9 September 2026<form onsubmit="throw Error('must not submit')"><input type='hidden' name='sesskey' value='secret-canary'><noscript>https://m.example/editor?sesskey=secret-canary</noscript><button>Start attempt</button></form></main>` }));
  const text = await readActivityLanding(page, { id: 'quiz-91', kind: 'quiz', courseId: 12, label: 'Quiz', url: 'https://m.example/mod/quiz/view.php?id=91', context: '', dates: [] });
  expect(text).toContain('Quiz closes: 9 September 2026');
  expect(text).toContain('Available action labels (not invoked): Start attempt');
  expect(text).not.toContain('secret-canary');
  await page.close();
});

it("reads visible H5P frame metadata without question bodies or submission", async () => {
  const page = await browser.newPage();
  const content = `<body><p>Due date: 9 September 2026</p><div class="h5p-question">PRIVATE QUESTION BODY</div><button onclick="parent.didSubmit=true">Summary &amp; submit</button></body>`;
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main>Completion requirements<iframe srcdoc="${content.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></main>` }));
  const text = await readActivityLanding(page, { id: 'hvp-91', kind: 'hvp', courseId: 12, label: 'Interactive book', url: 'https://m.example/mod/hvp/view.php?id=91', context: '', dates: [] });
  expect(text).toContain('Due date: 9 September 2026');
  expect(text).toContain('Summary & submit');
  expect(text).toContain('Embedded content from the activity page');
  expect(text).not.toContain('PRIVATE QUESTION BODY');
  expect(await page.evaluate(() => 'didSubmit' in window)).toBe(false);
  await page.close();
});

it("keeps an empty H5P shell as failed acquisition", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: '<main>Completion requirements</main>' }));
  await expect(readActivityLanding(page, { id: 'hvp-91', kind: 'hvp', courseId: 12, label: 'Interactive book', url: 'https://m.example/mod/hvp/view.php?id=91', context: '', dates: [] })).rejects.toThrow('empty module shell');
  await page.close();
});

it("retains a loaded H5P interface and Check control while omitting its question text", async () => {
  const page = await browser.newPage();
  const content = `<body><div class="h5p-question"><p>PRIVATE QUESTION BODY</p><button onclick="parent.didSubmit=true">Check</button></div></body>`;
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main>Completion requirements<iframe srcdoc="${content.replace(/"/g, '&quot;')}"></iframe></main>` }));
  const text = await readActivityLanding(page, { id: 'hvp-91', kind: 'hvp', courseId: 12, label: 'Vocabulary', url: 'https://m.example/mod/hvp/view.php?id=91', context: '', dates: [] });
  expect(text).toContain('Reader observation: visible H5P question interface');
  expect(text).toContain('Available action labels (not invoked): Check');
  expect(text).not.toContain('PRIVATE QUESTION BODY');
  expect(await page.evaluate(() => 'didSubmit' in window)).toBe(false);
  await page.close();
});


it("does not treat an embedded browser navigation error as successful deadline evidence", async () => {
  const page = await browser.newPage();
  await page.route('https://m.example/**', r => r.fulfill({ contentType: 'text/html', body: `<main>Abschlussbedingungen<iframe src='https://unavailable.example/resource.pdf'></iframe></main>` }));
  await page.context().route('https://unavailable.example/**', r => r.abort('failed'));
  await expect(readActivityLanding(page, { id: 'lti-91', kind: 'lti', courseId: 12, label: 'External reference', url: 'https://m.example/mod/lti/view.php?id=91', context: '', dates: [] })).rejects.toThrow('browser error page');
  await page.close();
}, 15000);
