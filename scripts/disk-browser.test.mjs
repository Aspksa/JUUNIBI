import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const port=5189;
const server=spawn("npm",["run","preview","-w","@juunibi/web","--","--host","127.0.0.1","--port",String(port)],{stdio:"ignore",shell:process.platform==="win32",detached:process.platform!=="win32"});
let browser;
try{
  let ready=false;
  for(let i=0;i<60;i++){
    if(server.exitCode!==null)throw new Error("Preview server exited");
    try{const r=await fetch("http://127.0.0.1:"+port);if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,"Preview server did not start");
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(10000);
  const folders=["Проекты","Проекты/Документы","Архив"];
  const entries=[
    {id:"11111111-1111-4111-8111-111111111111",name:"recent.txt",folder:"Проекты",size:6,uploadedAt:new Date().toISOString(),sha256:"a".repeat(64)},
    {id:"22222222-2222-4222-8222-222222222222",name:"old.txt",folder:"Архив",size:5,uploadedAt:"2020-01-01T00:00:00.000Z",sha256:"b".repeat(64)}
  ];
  let catalogRequests=0;
  await page.route("**/api/disk**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname;
    let body={};
    if(pathname==="/api/disk"){
      catalogRequests++;
      const folder=url.searchParams.get("folder");
      body={folders,files:folder===null?entries:entries.filter(e=>e.folder===folder),trash:[],usedBytes:11,maxFileBytes:52428800};
    }else if(pathname==="/api/disk/folders/styles")body={"Проекты":{color:"#b89cff",pinned:false,cover:"",createdAt:"2026-10-10T09:00:00.000Z"},"Архив":{color:"#b89cff",pinned:false,cover:"",createdAt:"2026-10-01T09:00:00.000Z"}};
    else if(pathname==="/api/disk/folders/move")body={name:"Архив/Проекты"};
    else if(pathname==="/api/disk/chronicles")body={groups:[],metrics:[],summary:{total:0,ready:0,files:2,bytes:11,folders:3}};
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto("http://127.0.0.1:"+port+"/#/disk");
  const tree=page.locator(".disk-tree");
  await tree.locator(":scope > select").selectOption("created");
  assert.equal(await tree.locator(":scope > select").inputValue(),"created");
  await tree.getByRole("button",{name:/Недавние/}).click();
  await page.getByText("recent.txt").first().waitFor();
  assert.equal(await page.getByText("old.txt").count(),0);
  const beforeNavigation=catalogRequests;
  await tree.getByRole("button",{name:/Проекты/}).first().click();
  await page.waitForTimeout(200);
  assert.equal(catalogRequests-beforeNavigation,1,"Folder navigation should fetch the catalog only once");
  await tree.locator(".disk-folder-actions").first().locator("summary").click();
  await tree.getByRole("button",{name:"Переместить папку"}).click();
  const dialog=page.locator(".disk-destination-dialog");
  await dialog.waitFor();
  await dialog.getByRole("button",{name:/Архив/}).click();
  await dialog.getByRole("button",{name:"Переместить сюда"}).click();
  await dialog.waitFor({state:"hidden"});
  const view=page.getByRole("button",{name:/Вид:/});
  await view.click();assert.ok(await page.locator(".disk-files").evaluate(node=>node.classList.contains("disk-large")));
  await view.click();assert.ok(await page.locator(".disk-files").evaluate(node=>node.classList.contains("disk-list")));
  await view.click();assert.ok(await page.locator(".disk-files").evaluate(node=>node.classList.contains("disk-table")));
  await page.getByText("Фильтры",{exact:true}).click();
  await page.getByLabel("Минимальный размер в КБ").fill("1");
  assert.equal(await page.locator(".disk-file").count(),0);
  await page.getByLabel("Минимальный размер в КБ").fill("");
  for(let i=0;i<250;i++)entries.push({
    id:"33333333-3333-4333-8333-"+String(i).padStart(12,"0"),
    name:"bulk-"+String(i).padStart(3,"0")+".txt",
    folder:"Архив",size:100,uploadedAt:new Date().toISOString(),sha256:"c".repeat(64)
  });
  await page.reload();
  await page.getByRole("button",{name:/Вид:/}).waitFor();
  const refreshed=page.getByRole("button",{name:/Вид:/});
  while((await refreshed.textContent())!=="Вид: Таблица")await refreshed.click();
  await page.getByLabel("Искать по всем папкам").check();
  await page.waitForTimeout(250);
  console.log("Virtual state:",await page.evaluate(()=>({
    mode:document.querySelector(".disk-files")?.className,
    shown:document.querySelectorAll(".disk-file").length,
    allFolders:(document.querySelector('input[aria-label="Искать по всем папкам"]'))?.checked,
    status:document.querySelector(".disk-status-line")?.textContent
  })));
  await page.locator(".disk-virtual").waitFor();
  const rows=page.locator(".disk-file");
  assert.ok(await rows.count()<=48,"Virtual list must not render more than 48 rows");
  const before=await rows.first().getAttribute("data-file-id");
  await page.locator(".disk-files").evaluate(node=>{node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event("scroll"));});
  await page.waitForFunction(prev=>document.querySelector(".disk-file")?.getAttribute("data-file-id")!==prev,before);
  assert.ok(await rows.count()<=48,"Virtual list must remain bounded after scrolling");
  console.log("Browser smoke passed: creation sort, recent files, destination picker");
}finally{await browser?.close();if(process.platform==="win32")server.kill();else if(server.pid){try{process.kill(-server.pid,"SIGTERM");}catch{}}}
