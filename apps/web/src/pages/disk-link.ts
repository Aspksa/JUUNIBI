/** Opening a file of «Диск» from another page (a to-do's attachment): the Disk page picks it up when it loads. */
let pending: string | null = null;
export function openDiskLink(id: string): void {
  pending = id;
  if (location.hash === "#/disk") dispatchEvent(new CustomEvent("juunibi:disk-link"));
  else location.hash = "#/disk";
}
export function takeDiskLink(): string | null { const id = pending; pending = null; return id; }
/** Drag type of files dragged out of the Disk (their ids as JSON): folders on the Disk and the chat window take them. */
export const DISK_DRAG = "application/x-juunibi-files";
