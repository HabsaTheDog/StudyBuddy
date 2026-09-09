import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import { extractQuizPage, fillVisibleQuestion, generateAnswerSpec } from "../nodes/quizReviewNode.js";
import type { AnswerSpec } from "../nodes/quizReviewNode.js";
import type { MoodleRuntimeConfig, QuizSafetyPolicy } from "../types.js";

async function fixture(run: (client: ReturnType<typeof createPlaywrightBrowserClient>) => Promise<void>) {
  const server = createServer((_request, response) => {
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

describe("Moodle image drag and drop", () => {
  it("extracts the complete response surface, captures its image, and persists a keyboard swap in the form", async () => {
    await fixture(async client=>{
      const page=await extractQuizPage(client); const q=page.questions[0];
      expect(q.response_model).toMatchObject({adapter:"drag-drop-image",support:"supported",controlCount:2});
      expect(q.controls[0]).toMatchObject({control_id:"q42:1_p1",value:"2",options:[{value:"1",text:"Alpha"},{value:"2",text:"Beta"}]});
      const dir=await mkdtemp(path.join(os.tmpdir(),"quiz-image-"));
      try { const file=path.join(dir,"question.png"); await client.captureQuestionImage!(q.question_id,file); expect((await stat(file)).size).toBeGreaterThan(0); }
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

  it("uses the placed item's location when filled drop zones are hidden and ordered differently", async () => {
    await fixture(async client => {
      await client.evalJson(`JSON.stringify((() => {
        document.querySelectorAll('.dropzone').forEach(e=>e.style.display='none');
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
    expect(codex.run).toHaveBeenNthCalledWith(2,expect.stringContaining("Independently verify"),expect.objectContaining({attempt:2,imagePaths:["/run/question.png"]}));
  });
});
