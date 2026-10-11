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
    else if(pathname==="/api/disk/trash")body={days:30};
    else if(pathname==="/api/disk/chronicles")body={groups:[],metrics:[],summary:{total:0,ready:0,files:2,bytes:11,folders:3}};
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto("http://127.0.0.1:"+port+"/#/disk");
  const tree=page.locator(".dk-side");
  await tree.locator(".dk-tree-sort").selectOption("created");
  assert.equal(await tree.locator(".dk-tree-sort").inputValue(),"created");
  await tree.locator(".dk-section",{hasText:"Недавние"}).click();
  await page.locator(".dk-file",{hasText:"recent.txt"}).waitFor();
  assert.equal(await page.locator(".dk-file",{hasText:"old.txt"}).count(),0);
  const beforeNavigation=catalogRequests;
  await tree.locator(".dk-node-label").filter({hasText:"Проекты"}).first().click();
  await page.locator(".dk-crumb.now",{hasText:"Проекты"}).waitFor();
  assert.equal(catalogRequests-beforeNavigation,0,"Folder navigation should reuse the loaded catalogue");
  await tree.locator(".dk-node",{hasText:"Проекты"}).first().locator(".dk-node-more").click();
  await page.getByRole("menuitem",{name:"Переместить папку"}).click();
  const dialog=page.locator(".disk-destination-dialog");
  await dialog.waitFor();
  await dialog.getByRole("option",{name:/Архив/}).click();
  await dialog.getByRole("button",{name:"Переместить сюда"}).click();
  await dialog.waitFor({state:"hidden"});
  for(const mode of ["large","list","table","tiles"]){
    await page.locator(`.dk-modes [data-mode=${mode}]`).click();
    assert.ok(await page.locator(".dk-files").evaluate((node,m)=>node.classList.contains("mode-"+m),mode));
  }
  await page.locator(".dk-node-label").filter({hasText:"Архив"}).first().click();
  await page.locator(".dk-file",{hasText:"old.txt"}).waitFor();
  await page.locator(".dk-filters>summary").click();
  await page.getByLabel("Минимальный размер в КБ").fill("1");
  assert.equal(await page.locator(".dk-file").count(),0);
  await page.getByLabel("Минимальный размер в КБ").fill("");
  await page.locator(".dk-file",{hasText:"old.txt"}).waitFor();
  for(let i=0;i<250;i++)entries.push({
    id:"33333333-3333-4333-8333-"+String(i).padStart(12,"0"),
    name:"bulk-"+String(i).padStart(3,"0")+".txt",
    folder:"Архив",size:100,uploadedAt:new Date().toISOString(),sha256:"c".repeat(64)
  });
  await page.reload();
  await page.getByRole("button",{name:"Искать по всем папкам"}).click();
  await page.locator(".dk-more-files").waitFor();
  assert.ok(await page.locator(".dk-file").count()<=150,"A big folder must not render more than 150 cards at once");
  await page.locator(".dk-more-files").click();
  assert.ok(await page.locator(".dk-file").count()>150,"«Показать ещё» adds the next cards");
  await page.locator(".dk-file").first().focus();
  await page.keyboard.press("Control+a");
  assert.ok(await page.locator(".dk-file.picked").count()>150,"Ctrl+A selects every shown file");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".dk-file.picked").count(),0,"Esc clears the selection");
  console.log("Browser smoke passed: folder sort, sections, destination picker, views, filters, paging, selection");
}finally{await browser?.close();if(process.platform==="win32")server.kill();else if(server.pid){try{process.kill(-server.pid,"SIGTERM");}catch{}}}
