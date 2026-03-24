import { useState, useCallback } from 'react';
import { getStorageItem, setStorageItem } from '../utils/storage';

export function useLocalStorage<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => getStorageItem(key, fallback));

  const set = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = newValue instanceof Function ? newValue(prev) : newValue;
      setStorageItem(key, resolved);
      return resolved;
    });
  }, [key]);

  const remove = useCallback(() => {
    localStorage.removeItem(key);
    setValue(fallback);
  }, [key, fallback]);

  return [value, set, remove] as const;
}
