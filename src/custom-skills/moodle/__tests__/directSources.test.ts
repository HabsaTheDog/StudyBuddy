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
