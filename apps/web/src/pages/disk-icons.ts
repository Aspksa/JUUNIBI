/** Disk-only sprite: single SVG definition, accessible icons with no external requests. */
const NS="http://www.w3.org/2000/svg";
const paths={
  vault:"M4 7.5h16v12H4z M7 7.5V5h10v2.5 M8 12h8 M12 12v4 M10 16h4",
  constellation:"M4 17l6-9 5 5 5-8 M10 8l2-5 M15 13l5 6 M4 17l-1 3",
  shield:"M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z M8 12l3 3 5-6",
  archive:"M4 5h16v4H4z M6 9v11h12V9 M10 13h4",
  star:"M12 2l3 6.5L22 9l-5 5 1.5 7L12 17.5 5.5 21 7 14 2 9l7-.5z"
} as const;
type DiskIcon=keyof typeof paths;
const svg=(name:string)=>document.createElementNS(NS,name);
export function installDiskSprite():void{
  if(document.getElementById("juunibi-disk-icons"))return;
  const root=svg("svg");root.id="juunibi-disk-icons";root.setAttribute("aria-hidden","true");
  root.setAttribute("width","0");root.setAttribute("height","0");root.style.position="absolute";
  const defs=svg("defs");
  for(const [name,d] of Object.entries(paths)){
    const symbol=svg("symbol");symbol.id="disk-icon-"+name;symbol.setAttribute("viewBox","0 0 24 24");
    const path=svg("path");path.setAttribute("d",d);path.setAttribute("fill","none");
    path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width","1.6");
    path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round");
    symbol.append(path);defs.append(symbol);
  }
  root.append(defs);document.body.append(root);
}
export function diskIcon(name:DiskIcon,label?:string):SVGSVGElement{
  installDiskSprite();
  const node=document.createElementNS(NS,"svg") as SVGSVGElement;node.setAttribute("viewBox","0 0 24 24");node.classList.add("disk-glyph");
  if(label){node.setAttribute("role","img");node.setAttribute("aria-label",label);}else node.setAttribute("aria-hidden","true");
  const use=svg("use");use.setAttribute("href","#disk-icon-"+name);node.append(use);
  return node;
}
