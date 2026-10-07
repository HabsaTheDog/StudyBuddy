import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import { extractQuizPage, fillVisibleQuestion, generateAnswerSpec } from "../nodes/quizReviewNode.js";
import type { AnswerSpec } from "../nodes/quizReviewNode.js";
import type { MoodleRuntimeConfig, QuizSafetyPolicy } from "../types.js";

async function fixture(run: (client: ReturnType<typeof createPlaywrightBrowserClient>) => Promise<void>, delayed: boolean | "never" = false) {
  const server = createServer((_request, response) => {
    if (_request.url?.split('?')[0].endsWith('.svg')) {
      response.setHeader('content-type','image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>');return;
    }
    response.setHeader("content-type", "text/html");
    response.end(`<form><div class="que ddimageortext" id="question-42-1">
      <div class="qtext">Place the labels on the diagram</div><div class="ddarea">
      <div class="droparea"><div class="dropzones">
        <div class="dropzone place1 group1" tabindex="0">Left</div>
        <div class="dropzone place2 group1" tabindex="0">Right</div>
      </div></div><div class="draghomes">
        <div class="draghome choice1 group1">Alpha</div>
        <div class="draghome choice2 group1">Beta</div>
      </div><input type="hidden" class="placeinput place1 group1" name="q42:1_p1" value="2">
      <input type="hidden" class="placeinput place2 group1" name="q42:1_p2" value="1"></div>
      </div><button type="submit">Submit all and finish</button></form>
      <script>
      document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitted=true;};
      if (${JSON.stringify(delayed)}) {
        const zoneRoot=document.querySelector('.dropzones');
        const original=zoneRoot.innerHTML;zoneRoot.innerHTML='';
        if (${JSON.stringify(delayed)} !== "never") setTimeout(()=>{zoneRoot.innerHTML=original;window.initialized=true;},300);
      }
      document.addEventListener('keydown', e=>{
        const drop=e.target.closest('.dropzone'); if(!drop)return;
        const place=[...drop.classList].find(c=>/^place[0-9]+$/.test(c));
        const input=document.querySelector('input.'+place);
        if(e.keyCode===27)input.value='0';
        else if(e.keyCode===39){
          const occupied=[...document.querySelectorAll('input.placeinput')].filter(i=>i!==input).map(i=>i.value);
          let value=Number(input.value)+1; while(occupied.includes(String(value)))value++;
          input.value=value>2?'0':String(value);
        }
      });
      </script>`);
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client=createPlaywrightBrowserClient({headless:true,baseUrl:origin} as MoodleRuntimeConfig);
  try { await client.open(origin); await run(client); }
  finally { await client.close(); server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
}

const answer: AnswerSpec = { confidence:0.99, citations:["Visible diagram"], risk_flags:[],
  control_answers:[{control_id:"q42:1_p1",answer:"1",selected:false},{control_id:"q42:1_p2",answer:"2",selected:false}] };

// These negative cases deliberately exhaust the production four-second widget
// readiness wait. Allow Chromium startup/teardown without changing that bound.
const readinessRejectionTestTimeout = 10_000;
// Every browser fixture starts and closes Chromium plus a loopback HTTP server.
// Windows CI exceeded the default five seconds in both screenshot (5,002ms)
// and async-zone (5,004ms) cases; a passing readiness rejection took 5,049ms.
// Allow a ten-second test deadline for that shared lifecycle, keeping production's
// four-second readiness wait and the explicit rejection-case budgets unchanged.
const browserFixtureTestTimeout = 10_000;

describe("Moodle image drag and drop", { timeout: browserFixtureTestTimeout }, () => {
  it("waits for Moodle's asynchronously created visible zones before extracting and using the existing UI adapter", async () => {
    await fixture(async (client) => {
      const q = (await extractQuizPage(client)).questions[0];
      expect(q.response_model).toMatchObject({
        adapter: "drag-drop-image",
        support: "supported",
        controlCount: 2,
      });
      expect(await client.evalJson("JSON.stringify(Boolean(window.initialized))")).toBe(true);
      expect(await fillVisibleQuestion(client, q, answer)).toMatchObject({ filled: true });
      expect(
        await client.evalJson(
          "JSON.stringify([...document.querySelectorAll('input.placeinput')].map(i=>i.value))",
        ),
      ).toEqual(["1", "2"]);
      expect(await client.evalJson("JSON.stringify(Boolean(window.submitted))")).toBe(false);
    }, true);
  });

  it("leaves a widget without initialized zones unsupported after the bounded wait", async () => {
    await fixture(async (client) => {
      const q = (await extractQuizPage(client)).questions[0];
      expect(q.response_model).toMatchObject({
        adapter: "drag-drop-image",
        support: "adapter_required",
        controlCount: 0,
      });
      expect(
        await client.evalJson(
          "JSON.stringify([...document.querySelectorAll('input.placeinput')].map(i=>i.value))",
        ),
      ).toEqual(["2", "1"]);
      expect(await client.evalJson("JSON.stringify(Boolean(window.submitted))")).toBe(false);
    }, "never");
  }, readinessRejectionTestTimeout);


  it("extracts the complete response surface, captures its image, and persists a keyboard swap in the form", async () => {
    await fixture(async client=>{
      const page=await extractQuizPage(client); const q=page.questions[0];
      expect(q.response_model).toMatchObject({adapter:"drag-drop-image",support:"supported",controlCount:2});
      expect(q.controls[0]).toMatchObject({control_id:"q42:1_p1",value:"2",options:[{value:"1",text:"Alpha"},{value:"2",text:"Beta"}]});
      const dir=await mkdtemp(path.join(os.tmpdir(),"quiz-image-"));
      try {
        const file=path.join(dir,"question.png");
        await client.captureQuestionImage!(q.question_id,file);
        expect((await stat(file)).size).toBeGreaterThan(0);
        expect((await readFile(file)).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
      }
      finally { await rm(dir,{recursive:true,force:true}); }
      expect(await fillVisibleQuestion(client,q,answer)).toMatchObject({filled:true,reason:"filled-dragdrop-keyboard-plan"});
      expect(await client.evalJson("JSON.stringify([...document.querySelectorAll('input.placeinput')].map(i=>i.value))")).toEqual(["1","2"]);
      expect(await client.evalJson("JSON.stringify(Boolean(window.submitted))")).toBe(false);
    });
  });

  it.each(["incomplete","unknown","reused"])("rejects a %s plan before changing any existing response", async kind=>{
    await fixture(async client=>{
      const q=(await extractQuizPage(client)).questions[0];
      const plan=structuredClone(answer);
      if(kind==='incomplete')plan.control_answers!.pop();
      if(kind==='unknown')plan.control_answers![0].answer='999';
      if(kind==='reused')plan.control_answers![1].answer='1';
      expect(await fillVisibleQuestion(client,q,plan)).toMatchObject({filled:false});
      expect(await client.evalJson("JSON.stringify([...document.querySelectorAll('input.placeinput')].map(i=>i.value))")).toEqual(["2","1"]);
    });
  });

  it("honors the existing-answer permission boundary", async ()=>{
    await fixture(async client=>{
      const q=(await extractQuizPage(client)).questions[0];
      expect(await fillVisibleQuestion(client,q,answer,{allowFillingAnswers:true,fillConfidenceThreshold:0.9,allowChangingExistingAnswers:false} as QuizSafetyPolicy))
        .toMatchObject({filled:false,reason:"changing-existing-answers-disabled"});
      expect(await client.evalJson("JSON.stringify([...document.querySelectorAll('input.placeinput')].map(i=>i.value))")).toEqual(["2","1"]);
    });
  });

  it("uses original public target geometry when filled zones are hidden and place numbers are not visual order", async () => {
    await fixture(async client => {
      await client.evalJson(`JSON.stringify((() => {
        document.querySelector('.dropzones').style.cssText='position:relative;height:180px;';
        document.querySelectorAll('.dropzone').forEach((e,i)=>e.style.cssText='display:none;position:absolute;left:0px;top:'+(i===0?100:20)+'px;width:120px;height:55px;');
        document.querySelector('.choice1').classList.add('placed','inplace2');
        document.querySelector('.choice2').classList.add('placed','inplace1');
        return true;
      })())`);
      const q=(await extractQuizPage(client)).questions[0];
      const first=q.controls[0].bounds as {y:number;height:number};
      const second=q.controls[1].bounds as {y:number;height:number};
      expect(first.height).toBeGreaterThan(0);
      expect(second.height).toBeGreaterThan(0);
      expect(first.y).toBeGreaterThan(second.y);
    });
  });

  it("preserves original target geometry and sorted source choices through padded placed-image clones and DOM reorder", async () => {
    await fixture(async client => {
      await client.evalJson(`JSON.stringify((() => {
        const root=document.getElementById('question-42-1');
        root.querySelector('.dropzones').style.cssText='position:relative;height:180px;';
        root.querySelectorAll('.dropzone').forEach((drop,index)=>drop.style.cssText=
          'position:absolute;box-sizing:border-box;width:120px;height:55px;left:209.015px;top:'+(55.046+index*45.473)+'px;transform:scale(0.797768);transform-origin:left top;');
        root.querySelectorAll('.draghome').forEach((home,index)=> {
          const image=document.createElement('img');image.className=home.className+' infinite';image.alt=home.textContent;
          image.src=index===0?'/alpha.svg?revision=2&id=1&sesskey=private-source-canary':'/beta.svg?revision=2&id=2&sesskey=private-source-canary';
          image.style.cssText='box-sizing:border-box;width:122px;height:57px;padding-top:11px;';
          home.replaceWith(image);
        });return true;
      })())`);
      const before=(await extractQuizPage(client)).questions[0];
      expect(JSON.stringify(before.controls)).not.toContain('private-source-canary');
      expect((before.controls[0].options as Array<{image_src:string}>)[0].image_src).toContain('revision=2&id=1');
      await client.evalJson(`JSON.stringify((() => {
        const root=document.getElementById('question-42-1');
        for(const place of ['1','2']) {
          const drop=root.querySelector('.dropzone.place'+place);
          const image=root.querySelector('.draghomes .choice'+place).cloneNode(true);
          image.classList.add('placed','inplace'+place);image.style.position='absolute';
          image.style.left=drop.style.left;image.style.top=drop.style.top;
          image.style.transform=drop.style.transform;image.style.transformOrigin='left top';
          drop.after(image);root.querySelector('input.place'+place).value=place;
        }
        // Reorder independent visual homes, as native placements and reusable clones do.
        const homes=root.querySelector('.draghomes');homes.prepend(homes.querySelector('.choice2'));
        return true;
      })())`);
      const visible=(await extractQuizPage(client)).questions[0];
      expect(visible.controls.map(c=>c.bounds)).toEqual(before.controls.map(c=>c.bounds));
      expect(visible.controls[0].options).toEqual(expect.arrayContaining([
        expect.objectContaining({value:'1',text:'Alpha',reusable:true,image_src:expect.stringContaining('/alpha.svg')}),
        expect.objectContaining({value:'2',text:'Beta',reusable:true,image_src:expect.stringContaining('/beta.svg')}),
      ]));
      expect((visible.controls[0].options as Array<{value:string}>).map(o=>o.value)).toEqual(['1','2']);
      await client.evalJson(`JSON.stringify((() => {document.querySelectorAll('.dropzone').forEach(drop=>drop.style.display='none');return true;})())`);
      const hidden=(await extractQuizPage(client)).questions[0];
      expect(hidden.controls.map(c=>c.bounds)).toEqual(before.controls.map(c=>c.bounds));
      await client.evalJson(`JSON.stringify((() => {document.querySelector('.place1.dropzone').style.left='219.015px';return true;})())`);
      const changed=(await extractQuizPage(client)).questions[0];
      expect(changed.controls[0].bounds).not.toEqual(before.controls[0].bounds);
    });
  });

  it.each(["text","reusable","source"])("refuses a conflicting %s clone of the same visible choice", async field => {
    await fixture(async client => {
      await client.evalJson(`JSON.stringify((() => {
        const original=document.querySelector('.choice1');const clone=original.cloneNode(true);
        if (${JSON.stringify(field)}==='text') clone.textContent='Different source text';
        if (${JSON.stringify(field)}==='reusable') clone.classList.add('infinite');
        if (${JSON.stringify(field)}==='source') {original.setAttribute('src','/alpha.svg');clone.setAttribute('src','/beta.svg');}
        original.after(clone);return true;
      })())`);
      const q=(await extractQuizPage(client)).questions[0];
      expect(q.response_model?.support).toBe('adapter_required');
      expect(q.controls).toEqual([]);
      expect(await fillVisibleQuestion(client,q,answer)).toMatchObject({filled:false});
      expect(await client.evalJson("JSON.stringify([...document.querySelectorAll('input.placeinput')].map(i=>i.value))")).toEqual(["2","1"]);
      expect(await client.evalJson("JSON.stringify(Boolean(window.submitted))")).toBe(false);
    });
  }, readinessRejectionTestTimeout);

  it("binds per-choice query variants and external public source URLs without fetching or exposing auth values", async () => {
    await fixture(async client => {
      await client.evalJson(`JSON.stringify((() => {
        document.querySelector('.choice1').setAttribute('src','https://assets.example/choice.svg?id=1&revision=9&token=private-source-canary');
        document.querySelector('.choice2').setAttribute('src','https://assets.example/choice.svg?id=2&revision=9&token=private-source-canary');return true;
      })())`);
      const before=(await extractQuizPage(client)).questions[0];
      const first=before.controls[0].options as Array<{value:string,image_src:string}>;
      expect(first.map(o=>o.image_src)).toEqual([
        'https://assets.example/choice.svg?id=1&revision=9&token=[REDACTED]',
        'https://assets.example/choice.svg?id=2&revision=9&token=[REDACTED]',
      ]);
      await client.evalJson(`JSON.stringify((() => {const a=document.querySelector('.choice1'),b=document.querySelector('.choice2');
        const source=a.getAttribute('src');a.setAttribute('src',b.getAttribute('src'));b.setAttribute('src',source);return true;})())`);
      const after=(await extractQuizPage(client)).questions[0];
      const last=after.controls[0].options as Array<{value:string,image_src:string}>;
      expect(new Set(last.map(o=>o.image_src))).toEqual(new Set(first.map(o=>o.image_src)));
      expect(last).not.toEqual(first);
      expect(JSON.stringify(last)).not.toContain('private-source-canary');
    });
  });

  it("binds complete public inline target geometry independently from measured layout while preserving real target changes", async () => {
    await fixture(async client => {
      await client.evalJson(`JSON.stringify((() => {
        document.querySelector('.dropzones').style.cssText='position:relative;height:160px;';
        document.querySelectorAll('.dropzone').forEach((drop,index)=>drop.style.cssText=
          'position:absolute;left:10px;top:'+(20+index*70)+'px;width:120px;height:55px;transform:scale(0.8);transform-origin:left top;');return true;
      })())`);
      const before=(await extractQuizPage(client)).questions[0];
      expect(before.controls[0].target_geometry).toEqual({left:10,top:20,width:120,height:55,
        transform:[expect.closeTo(0.8,6),0,0,expect.closeTo(0.8,6),0,0],transform_origin:[0,0]});
      await client.evalJson(`JSON.stringify((() => {document.querySelector('.dropzones').style.marginTop='10px';return true;})())`);
      const layout=(await extractQuizPage(client)).questions[0];
      expect(layout.controls[0].bounds).not.toEqual(before.controls[0].bounds);
      expect(layout.controls[0].target_geometry).toEqual(before.controls[0].target_geometry);
      for(const [field,value] of [['left','11px'],['width','121px'],['transform','scale(0.9)']]) {
        await client.evalJson(`JSON.stringify((() => {document.querySelector('.dropzone').style[${JSON.stringify(field)}]=${JSON.stringify(value)};return true;})())`);
        const changed=(await extractQuizPage(client)).questions[0];
        expect(changed.controls[0].target_geometry).not.toEqual(layout.controls[0].target_geometry);
      }
    });
  });

  it("keeps bounds as the only geometry proof when inline target source geometry is incomplete", async () => {
    await fixture(async client => {
      const plain=(await extractQuizPage(client)).questions[0];
      expect(plain.controls[0].target_geometry).toBeNull();
      await client.evalJson(`JSON.stringify((() => {
        document.querySelector('.dropzone').style.cssText='position:absolute;left:10px;top:20px;width:calc(120px + 0px);height:55px;transform:scale(0.8);transform-origin:left top;';return true;
      })())`);
      const complex=(await extractQuizPage(client)).questions[0];
      expect(complex.controls[0].target_geometry).toBeNull();
      expect((complex.controls[0].bounds as {width:number}).width).toBeGreaterThan(0);
    });
  });

  it("forwards the captured question image to the solver",async()=>{
    const codex={run:vi.fn(async()=>JSON.stringify(answer))};
    await generateAnswerSpec(codex,{image_paths:["/run/question.png"]});
    expect(codex.run).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({imagePaths:["/run/question.png"]}));
  });

  it("uses the independent visual check instead of a confident but wrong first proposal", async () => {
    const corrected = { ...answer, control_answers: [{control_id:"p1",answer:"2",selected:false}] };
    const codex = {run:vi.fn().mockResolvedValueOnce(JSON.stringify({...corrected,control_answers:[{control_id:"p1",answer:"1",selected:false}]})).mockResolvedValueOnce(JSON.stringify(corrected))};
    const result = await generateAnswerSpec(codex,{image_paths:["/run/question.png"],question:{prompt:"Match the values"}});
    expect(result.control_answers).toEqual(corrected.control_answers);
    expect(codex.run).toHaveBeenNthCalledWith(2,expect.stringContaining("Independently verify"),expect.objectContaining({operation:"quiz_verification",attempt:1,imagePaths:["/run/question.png"]}));
  });
});
