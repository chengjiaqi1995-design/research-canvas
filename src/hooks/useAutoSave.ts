import { useEffect, useRef } from 'react';
import { useCanvasStore } from '../stores/canvasStore.ts';

const DEBOUNCE_MS = 500;

export function useAutoSave() {
  const isDirty = useCanvasStore((s) => s.isDirty);
  const saveCanvas = useCanvasStore((s) => s.saveCanvas);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDirty) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      saveCanvas();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isDirty, saveCanvas]);

  // Save on unmount / page close
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { isDirty: dirty, saveCanvas: save } = useCanvasStore.getState();
      if (dirty) {
        save();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handleBeforeUnload();
    };
  }, []);
}
