import { memo } from 'react';
import LegacyApp from '../../aiprocess/App';

export const AIProcessView = memo(function AIProcessView() {
  return (
    <div className="w-full h-full bg-white relative overflow-hidden ai-process-root">
      <LegacyApp />
    </div>
  );
});
