import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DirectSources, assertDirectReadUrl, directSourcesRoot, parseDirectSourceRequest, type DirectSourceBackend } from "../directSources.js";
import { stableResourceId } from "../resourceManifest.js";
const origin="https://university.example", url=origin+"/mod/resource/view.php?id=7";
async function setup() {
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),"direct-source-test-"))), root=path.join(directory,"direct-sources");
  const backend: DirectSourceBackend={ courses:async()=>({complete:true,links:[{title:"Mechanics",url:origin+"/course/view.php?id=2"},{title:"Chemistry",url:origin+"/course/view.php?id=3"}]}),
    page:async link=>({title:"First assessment",url:link,text:"Exact assessment announcement, date and scope",links:[{title:"Original slides",url}]}),
    download:async (_url,dir,id)=>{const file=path.join(dir,id+".pdf");await writeFile(file,"%PDF original");return{path:file,resolvedUrl:url};},
    text:async()=>({text:"Original page one\fOriginal page two\f",pageCount:2,status:"partial"}),
    pages:async (_file,pages,dir)=>Promise.all(pages.map(async page=>{const file=path.join(dir,`original-${page}.png`);await writeFile(file,`composed page${page}`);return {page,path:file};})), };
  return {directory,root,backend,tools:new DirectSources(root,[origin],backend,async()=>undefined)};
}
describe("direct read-only owner sources",()=>{
  it("preserves explicit mailto contacts separately from navigable sources",async()=>{
    const f=await setup();try{
      const pageUrl=origin+"/course/view.php?id=2";
      f.backend.page=async()=>({title:"History",url:pageUrl,text:"Teaching staff: Dr Ada Example",links:[
        {title:"Dr Ada Example",url:"mailto:ada%40college.example?subject=Hello&cc=other@example.org",section:"Teaching staff"},
        {title:"Contact",url:"mailto:other@college.example"},
        {title:"Malformed",url:"mailto:bad%0D%0Aaddress@example.org"},
        {title:"Only query",url:"mailto:?to=guessed@example.org"},
        {title:"mailto:blank@college.example?body=not-contact-evidence",url:"mailto:blank@college.example?body=not-contact-evidence"},
        {title:"Original slides",url},
      ]});
      const result=await f.tools.run({op:"page",url:pageUrl});
      expect(result.contacts).toEqual([
        {label:"Dr Ada Example",email:"ada@college.example",sourceUrl:pageUrl,section:"Teaching staff"},
        {label:"Contact",email:"other@college.example",sourceUrl:pageUrl},
        {label:"blank@college.example",email:"blank@college.example",sourceUrl:pageUrl},
      ]);
      expect(result.links).toEqual([expect.objectContaining({url})]);
      const manifest=JSON.parse(await readFile(result.manifestPath as string,"utf8"));
      expect(manifest.sources.find((item:any)=>item.id===result.sourceID).contacts).toEqual(result.contacts);
      expect(manifest.sources.every((item:any)=>item.url.startsWith("https:"))).toBe(true);
      const pageSpy=vi.spyOn(f.backend,"page"),downloadSpy=vi.spyOn(f.backend,"download");
      await expect(f.tools.run({op:"page",url:"mailto:ada@college.example"})).rejects.toThrow();
      await expect(f.tools.run({op:"download",url:"mailto:ada@college.example"})).rejects.toThrow();
      expect(pageSpy).not.toHaveBeenCalled();expect(downloadSpy).not.toHaveBeenCalled();
      await f.tools.run({op:"download",url:pageUrl});
      const reused=await f.tools.run({op:"courses"});
      const updated=JSON.parse(await readFile(reused.manifestPath as string,"utf8"));
      expect(updated.sources.find((item:any)=>item.id===result.sourceID).contacts).toEqual(result.contacts);
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("keeps contact provenance and navigation visible when a native tool truncates long page text",async()=>{
    const f=await setup();try{
      const pageUrl=origin+"/course/view.php?id=2",longText="Course material ".repeat(10000);
      f.backend.page=async()=>({title:"History",url:pageUrl,text:longText,links:[
        {title:"Dr Ada Example",url:"mailto:ada@college.example",section:"Teaching staff"},
        {title:"Course details",url:origin+"/details?id=2"},
      ]});
      const result=await f.tools.run({op:"page",url:pageUrl});
      const nativePrefix=JSON.stringify(result).slice(0,2000);
      expect(nativePrefix).toContain('"email":"ada@college.example"');
      expect(nativePrefix).toContain('"sourceUrl":"'+pageUrl+'"');
      expect(nativePrefix).toContain('"title":"Course details"');
      expect(await readFile(result.textPath as string,"utf8")).toBe(longText);
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("exposes public configured targets while removing credentials and preserving course IDs",async()=>{
    const f=await setup();try{
      const tools=new DirectSources(f.root,[origin],f.backend,async()=>undefined,{portals:[
        {kind:"moodle",dashboard:origin+"/course/view.php?id=42&access_token=private-access#section-2"},
        {kind:"cis",dashboard:"https://user:password@university.example/cis.php?page=1&secret=private-secret"},
      ],calendarUrl:"https://calendar.example/private-feed"});
      const result=await tools.run({op:"inventory"});
      expect(result.portals).toEqual([{kind:"moodle",dashboard:origin+"/course/view.php?id=42"},{kind:"cis",dashboard:origin+"/cis.php?page=1"}]);
      expect(result.calendarConfigured).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/private-|password|user:/);
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("reads a calendar-only source with event provenance and no private feed URL in result/artifact",async()=>{
    const f=await setup();try{
      const feed="https://calendar.example/private-feed";
      const ics=["BEGIN:VCALENDAR","VERSION:2.0","BEGIN:VEVENT","UID:history-test","DTSTART:20260701T090000Z","DTEND:20260701T100000Z","SUMMARY:History minitest",`DESCRIPTION:Personal feed ${feed}`,"ORGANIZER;CN=Calendar service:mailto:calendar@college.example","END:VEVENT","END:VCALENDAR"].join("\r\n");
      const fetchImpl=vi.fn(async()=>new Response(ics));
      const tools=new DirectSources(f.root,[],f.backend,async()=>undefined,{calendarUrl:feed,calendarOptions:{now:new Date("2026-07-01T08:00:00Z"),fetchImpl}});
      expect(await tools.run({op:"inventory"})).toMatchObject({portals:[],calendarConfigured:true});
      const result=await tools.run({op:"calendar",prompt:"today"});
      expect(result).toMatchObject({status:"success",complete:true,events:[{uid:"history-test",contacts:[{property:"organizer",email:"calendar@college.example",name:"Calendar service"}]}],provenance:{source:"configured_calendar",observedAt:"2026-07-01T08:00:00.000Z"}});
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(feed);
      expect(await readFile(result.artifactPath as string,"utf8")).not.toContain(feed);
      const promptWithFeed=await tools.run({op:"calendar",prompt:`today ${feed}`});
      expect(JSON.stringify(promptWithFeed)).not.toContain(feed);
      expect(await readFile(promptWithFeed.artifactPath as string,"utf8")).not.toContain(feed);
      const unconfigured=new DirectSources(f.root,[],f.backend,async()=>undefined);
      expect(await unconfigured.run({op:"calendar",prompt:"heute"})).toMatchObject({status:"failed",events:[],needsCisFallback:true});
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("keeps the original communication prompt while selecting today's ongoing evidence",async()=>{
    const f=await setup();try{
      const originalPrompt="Schreib bitte eine Entschuldigung an meinen Kinetik-Prof: Mein Zug hat Verspätung und ich werde verspätet am Minitest teilnehmen.";
      const fixture=["BEGIN:VCALENDAR","VERSION:2.0",...["20261005","20261012"].map((date,index)=>[
        "BEGIN:VEVENT",`UID:event-${index}`,`DTSTART:${date}T080000Z`,`DTEND:${date}T090000Z`,"SUMMARY:Kinetik Minitest","END:VEVENT",
      ].join("\r\n")),"END:VCALENDAR"].join("\r\n");
      const tools=new DirectSources(f.root,[],f.backend,async()=>undefined,{calendarUrl:"https://calendar.example/feed",calendarOptions:{now:new Date("2026-10-05T08:15:00Z"),fetchImpl:vi.fn(async()=>new Response(fixture))}});
      const implicit=await tools.run({op:"calendar",prompt:originalPrompt});
      expect((implicit.events as any[]).map(event=>event.uid)).toEqual(["event-1"]);
      const current=await tools.run({op:"calendar",prompt:originalPrompt,scope:"today"});
      expect((current.events as any[]).map(event=>event.uid)).toEqual(["event-0"]);
      expect(current.provenance).toMatchObject({originalPrompt,selectionScope:"today"});
      expect(current.requestedRange).toEqual({start:"2026-10-04T22:00:00.000Z",end:"2026-10-05T21:59:59.999Z"});
      const unknown=await tools.run({op:"calendar",prompt:"Write an apology to the professor for course Thermodynamik",scope:"today"});
      expect((unknown.events as any[]).map(event=>event.uid)).toEqual(["event-0"]);
      expect(unknown.detail).toContain("not a confirmed course match");
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("accepts only server-owned inventory and calendar requests",()=>{
    expect(parseDirectSourceRequest({op:"inventory"})).toEqual({op:"inventory"});
    expect(parseDirectSourceRequest({op:"calendar",prompt:"today"})).toEqual({op:"calendar",prompt:"today"});
    expect(parseDirectSourceRequest({op:"calendar",prompt:"original request",scope:"today"})).toEqual({op:"calendar",prompt:"original request",scope:"today"});
    for(const input of [{op:"inventory",url:origin},{op:"calendar",prompt:"today",url:origin},{op:"calendar"},{op:"calendar",prompt:""},{op:"calendar",prompt:"today",scope:"tomorrow"}])expect(()=>parseDirectSourceRequest(input)).toThrow();
  });
  it("retains observed page/download identity across catalog backlinks and permits explicit refresh",async()=>{
    const f=await setup();try{
      const course=origin+"/course/view.php?id=2", quiz=origin+"/mod/quiz/view.php?id=4", unknown=origin+"/mod/resource/view.php?id=99";
      let refreshed=false;
      f.backend.page=async target=>target===course
        ?{title:refreshed?"Updated native course title":"Native course title",url:course,text:refreshed?"Updated native course text":"Native course text",links:[{title:"Original slides",url}]}
        :{title:"Actual assessment",url:quiz,text:"Assessment text",links:[{title:"Grading criteria",url:course+"#gradingcriteria"},{title:"Renamed navigation label",url},{title:"New resource",url:unknown}]};
      const observed=await f.tools.run({op:"page",url:course});
      const downloaded=await f.tools.run({op:"download",url});
      const snapshot=JSON.parse(await readFile(observed.manifestPath as string,"utf8"));
      const backlink=await f.tools.run({op:"page",url:quiz});
      await f.tools.run({op:"courses"});
      const manifest=JSON.parse(await readFile(observed.manifestPath as string,"utf8"));
      for(const id of [observed.sourceID,downloaded.sourceID])expect(manifest.sources.find((item:any)=>item.id===id)).toEqual(snapshot.sources.find((item:any)=>item.id===id));
      expect(backlink.links).toContainEqual(expect.objectContaining({title:"Grading criteria",url:course+"#gradingcriteria"}));
      expect(manifest.sources).toContainEqual(expect.objectContaining({id:stableResourceId(unknown),title:"New resource",url:unknown}));
      refreshed=true;
      await f.tools.run({op:"page",url:course});
      const updated=JSON.parse(await readFile(observed.manifestPath as string,"utf8"));
      const record=updated.sources.find((item:any)=>item.id===observed.sourceID);
      expect(record).toMatchObject({title:"Updated native course title",url:course,resolvedUrl:course,textPath:observed.textPath});
      expect(await readFile(record.textPath,"utf8")).toBe("Updated native course text");
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("preserves an observed native title when downloading by URL",async()=>{
    const f=await setup();try{
      await f.tools.run({op:"page",url:origin+"/course/view.php?id=2"});
      const acquired=await f.tools.run({op:"download",url});
      expect(acquired.title).toBe("Original slides");
      const manifest=JSON.parse(await readFile(acquired.manifestPath as string,"utf8"));
      expect(manifest.sources.find((item:any)=>item.id===acquired.sourceID)).toMatchObject({title:"Original slides",url});
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("lists courses and preserves native announcement/catalog, download/text/page provenance across calls",async()=>{
    const f=await setup();try{
      const courses=await f.tools.run({op:"courses",query:"mechanics"});expect(courses.courses).toEqual([{title:"Mechanics",url:origin+"/course/view.php?id=2",id:stableResourceId(origin+"/course/view.php?id=2")}]);
      const page=await f.tools.run({op:"page",url:origin+"/mod/quiz/view.php?id=4"});expect(page.text).toContain("Exact assessment announcement");
      const acquired=await f.tools.run({op:"download",resourceID:stableResourceId(url)});expect(acquired.sourceID).toBe(stableResourceId(url));expect(acquired.title).toBe("Original slides");
      const reused=new DirectSources(f.root,[origin],f.backend,async()=>undefined);
      const text=await reused.run({op:"text",sourceID:acquired.sourceID,pages:[2]});expect(text.text).toBe("Original page two");expect(text.readability).toBe("partial");
      const pages=await reused.run({op:"pages",sourceID:acquired.sourceID,pages:[2,1]});expect(pages.pages).toEqual([expect.objectContaining({page:2,sha256:expect.any(String)}),expect.objectContaining({page:1})]);
      const manifest=JSON.parse(await readFile(pages.manifestPath as string,"utf8"));expect(manifest.untrusted).toBe(true);expect(manifest.sources.find((item:any)=>item.id===acquired.sourceID)).toMatchObject({url,title:"Original slides",sha256:acquired.sha256,pageCount:2});
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it.each([origin+"/mod/quiz/attempt.php?attempt=1",origin+"/mod/quiz/review.php?attempt=1",origin+"/mod/quiz/processattempt.php",origin+"/course/delete.php",origin+"/course/editsection.php?id=4",origin+"/mod/resource/editadvanced.php?id=7",origin+"/course/view.php?sesskey=secret","https://other.example/file.pdf","http://university.example/file.pdf"])("blocks forbidden URL before any backend call: %s",async target=>{
    const f=await setup();try{const spy=vi.spyOn(f.backend,"page");await expect(f.tools.run({op:"page",url:target})).rejects.toThrow();expect(spy).not.toHaveBeenCalled();}finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("rejects unknown IDs, arbitrary paths, changed download bytes and invalid pages",async()=>{
    const f=await setup();try{
      await expect(f.tools.run({op:"text",path:"/etc/passwd"})).rejects.toThrow();await expect(f.tools.run({op:"download",resourceID:"unknown"})).rejects.toThrow();
      const acquired=await f.tools.run({op:"download",url});await expect(f.tools.run({op:"pages",sourceID:acquired.sourceID,pages:[3]})).rejects.toThrow("outside");
      await writeFile(acquired.localPath as string,"changed");await expect(f.tools.run({op:"text",sourceID:acquired.sourceID})).rejects.toThrow("bytes changed");
      for(const pages of [[],[0],[1,1],Array.from({length:13},(_,i)=>i+1)])expect(()=>parseDirectSourceRequest({op:"pages",sourceID:"a",pages})).toThrow();
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("rejects records and source-root symlinks without reading outside files",async()=>{
    const f=await setup();try{
      await mkdir(path.join(f.root,"records"),{recursive:true});const sentinel=path.join(f.directory,"private.json");await writeFile(sentinel,JSON.stringify({secret:"must-not-be-read"}));
      await symlink(sentinel,path.join(f.root,"records",stableResourceId(url)+".json"));await expect(f.tools.run({op:"courses"})).rejects.toThrow("regular owned");
      await rm(f.root,{recursive:true,force:true});await symlink(f.directory,f.root);await expect(f.tools.run({op:"courses"})).rejects.toThrow("symlinks");expect(await readFile(sentinel,"utf8")).toContain("must-not-be-read");
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("rejects unknown record fields and mismatched identity",async()=>{
    const f=await setup();try{
      await mkdir(path.join(f.root,"records"),{recursive:true});await writeFile(path.join(f.root,"records",stableResourceId(url)+".json"),JSON.stringify({id:stableResourceId(url),title:"A",url,foreign:"no"}));
      await expect(f.tools.run({op:"courses"})).rejects.toThrow();
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
  it("uses stable native owner thread rather than per-call broker UUID",()=>{
    const workspace=process.cwd(), common={STUDY_BUDDY_WORKSPACE:workspace,STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID:"stable-owner"};
    expect(directSourcesRoot({...common,STUDY_BUDDY_THREAD_ID:"broker-one"})).toBe(directSourcesRoot({...common,STUDY_BUDDY_THREAD_ID:"broker-two"}));
    expect(directSourcesRoot(common)).toContain(path.join("threads","stable-owner","direct-sources"));
    expect(assertDirectReadUrl(origin+"/mod/quiz/view.php?id=4",[origin])).toContain("view.php");
  });
  it("preserves native page title when section anchors share the source identity",async()=>{
    const f=await setup();try {
      const course=origin+"/course/view.php?id=2";
      f.backend.page=async()=>({title:"Actual native course title",url:course,text:"Exact assessment announcement",links:[{title:"Last section navigation label",url:course+"#section-9"}]});
      const observed=await f.tools.run({op:"page",url:course});
      const manifest=JSON.parse(await readFile(observed.manifestPath as string,"utf8"));
      expect(manifest.sources.find((item:any)=>item.id===observed.sourceID)).toMatchObject({title:"Actual native course title",url:course});
      expect(observed.links).toEqual([expect.objectContaining({title:"Last section navigation label"})]);
    }finally{await rm(f.directory,{recursive:true,force:true});}
  });
});
