import {mkdtemp,readFile,rm,symlink,writeFile}from"node:fs/promises";import os from"node:os";import path from"node:path";
import{beforeEach,describe,expect,it,vi}from"vitest";
const mocks=vi.hoisted(()=>({goto:vi.fn(),close:vi.fn(),login:vi.fn(),cookies:vi.fn(async()=>[]),route:vi.fn(),page:null as any}));
vi.mock("../browserLaunch.js",()=>({launchMoodleBrowser:async()=>({newContext:async()=>({route:mocks.route,newPage:async()=>mocks.page}),close:mocks.close})}));
vi.mock("../browserAuth.js",()=>({ensureLoggedIn:mocks.login}));
vi.mock("../urlSecurity.js",()=>({assertPublicHttpsUrl:async()=>undefined}));
import{PlaywrightDirectSourceBackend}from"../directSourcesBackend.js";
import {runBoundedProcess} from "../../shared/boundedProcess.js";
describe("direct source transport",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.page={url:()=>"https://portal.example/my/",goto:mocks.goto,context:()=>({cookies:mocks.cookies})};});
 it("authenticates dashboard and downloads attachment redirects without page navigation",async()=>{
   const directory=await mkdtemp(path.join(os.tmpdir(),"direct-attachment-"));const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response(null,{status:302,headers:{location:"/pluginfile.php/7/original.pdf"}})).mockResolvedValueOnce(new Response("%PDF-1.7\noriginal",{headers:{"content-type":"application/pdf"}}));
   try{const backend=new PlaywrightDirectSourceBackend([{dashboard:"https://portal.example/my/",loginOrigins:[]}]);const result=await backend.download("https://portal.example/mod/resource/view.php?id=7",directory,"source");expect(mocks.goto).not.toHaveBeenCalled();expect(mocks.login).toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(2);expect(await readFile(result.path,"utf8")).toContain("%PDF");}finally{fetchMock.mockRestore();await rm(directory,{recursive:true,force:true});}
 });
 it("blocks off-origin redirects before sending any cookies or second GET",async()=>{
   const directory=await mkdtemp(path.join(os.tmpdir(),"direct-redirect-"));const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(null,{status:302,headers:{location:"https://foreign.example/file.pdf"}}));
   try{const backend=new PlaywrightDirectSourceBackend([{dashboard:"https://portal.example/my/",loginOrigins:[]}]);await expect(backend.download("https://portal.example/mod/resource/view.php?id=7",directory,"source")).rejects.toThrow("configured");expect(fetchMock).toHaveBeenCalledTimes(1);}finally{fetchMock.mockRestore();await rm(directory,{recursive:true,force:true});}
 });
 it("allows only login POST without evaluating the page paused in its own route",async()=>{
   const directory=await mkdtemp(path.join(os.tmpdir(),"direct-login-route-"));const fetchMock=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("%PDF-1.7",{headers:{"content-type":"application/pdf"}}));
   mocks.page.evaluate=vi.fn(()=>{throw Error("Route must never wait on navigation-owned DOM");});
   mocks.login.mockImplementationOnce(async()=>{
     const handler=mocks.route.mock.calls[0][1];
     for(const [url,method,allowed]of [["https://portal.example/login/index.php","POST",true],["https://portal.example/mod/quiz/attempt.php?id=1","GET",false],["https://portal.example/mod/resource/view.php?id=7","POST",false],["https://portal.example/login/index.php","PUT",false]]as const){
       const continued=vi.fn(),aborted=vi.fn();await handler({request:()=>({url:()=>url,method:()=>method}),continue:continued,abort:aborted});
       expect(continued).toHaveBeenCalledTimes(allowed?1:0);expect(aborted).toHaveBeenCalledTimes(allowed?0:1);
     }
   });
   try{await new PlaywrightDirectSourceBackend([{dashboard:"https://portal.example/my/",loginOrigins:[]}]).download("https://portal.example/mod/resource/view.php?id=7",directory,"source");expect(mocks.page.evaluate).not.toHaveBeenCalled();}finally{fetchMock.mockRestore();await rm(directory,{recursive:true,force:true});}
 });
 it("keeps corrected original page composition and never follows prepared extraction/render output links",async()=>{
   const directory=await mkdtemp(path.join(os.tmpdir(),"direct-composition-"));
   try {
     const typst=path.join(directory,"source.typ"),pdf=path.join(directory,"source.pdf"),sentinel=path.join(directory,"external.txt");
     await writeFile(sentinel,"preserve-external-sentinel");
     await writeFile(typst,'#set page(width:200pt,height:120pt,margin:0pt)\n#place(top+left,rect(width:200pt,height:120pt,fill:red,stroke:none))\n#place(top+left,dx:10pt,dy:20pt,rect(width:180pt,height:40pt,fill:white,stroke:none)[CORRECTED SOURCE])\n#place(top+left,dx:10pt,dy:110pt,rect(width:180pt,height:8pt,fill:blue,stroke:none))');
     const compiled=await runBoundedProcess("typst",["compile",typst,pdf]);expect(compiled.code,compiled.stderr).toBe(0);
     await symlink(sentinel,pdf.replace(/\.pdf$/,".extracted.txt"));await symlink(sentinel,path.join(directory,"source-page-1.png"));
     const backend=new PlaywrightDirectSourceBackend([]);const text=await backend.text(pdf);expect(text.text).toContain("CORRECTED SOURCE");
     const pages=await backend.pages(pdf,[1],directory);expect(pages[0].path).not.toBe(path.join(directory,"source-page-1.png"));
     const reference=path.join(directory,"reference");const rendered=await runBoundedProcess("pdftoppm",["-png","-singlefile","-f","1","-l","1","-r","144",pdf,reference]);expect(rendered.code).toBe(0);
     expect((await readFile(pages[0].path)).equals(await readFile(reference+".png"))).toBe(true);
     expect(await readFile(sentinel,"utf8")).toBe("preserve-external-sentinel");
   }finally{await rm(directory,{recursive:true,force:true});}
 });
});
