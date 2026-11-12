import { useEffect, useState } from 'react';

export function useFileDrop(addFiles: (files: FileList | File[]) => Promise<void>) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (event.dataTransfer?.files.length) void addFiles(event.dataTransfer.files);
    };
    const paste = (event: ClipboardEvent) => {
      if (event.clipboardData?.files.length) void addFiles(event.clipboardData.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [addFiles]);
  return dragging;
}

export function useWorkspaceKeys({
  blocked, cropping, pick, save, saveImage, move, crop, filters, rotate, remove, cancel,
}: {
  blocked: boolean;
  cropping: boolean;
  pick: () => void;
  save: () => void;
  saveImage: () => void;
  move: (direction: number) => void;
  crop: () => void;
  filters: () => void;
  rotate: (direction: number) => void;
  remove: () => void;
  cancel: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (blocked || event.defaultPrevented || event.isComposing || event.repeat) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.code === 'KeyS') { event.preventDefault(); if (event.shiftKey) saveImage(); else save(); return; }
      if (event.target instanceof HTMLElement && (event.target.isContentEditable ||
          event.target.closest('input, select, textarea'))) return;
      if (mod && event.code === 'KeyO') { event.preventDefault(); pick(); return; }
      if (mod || event.altKey) return;
      if (event.key === 'Escape') { cancel(); return; }
      if (event.key === 'ArrowDown' || event.key === 'PageDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); move(-1); }
      else if (cropping) return;
      else if (event.code === 'KeyC') crop();
      else if (event.code === 'KeyF') filters();
      else if (event.code === 'KeyR') rotate(event.shiftKey ? -1 : 1);
      else if (event.key === 'Delete' && !((event.target as HTMLElement | null)?.closest?.('button'))) remove();
      else if (event.key === 'Enter' && !((event.target as HTMLElement | null)?.closest?.('button, a, [role="button"]'))) save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked, cropping, pick, save, move, crop, filters, rotate, remove, cancel]);
}
