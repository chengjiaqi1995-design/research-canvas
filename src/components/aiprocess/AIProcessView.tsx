import { memo } from 'react';

export const AIProcessView = memo(function AIProcessView() {
  return (
    <div className="flex w-full h-full bg-slate-50 text-slate-800">
      <div className="flex-1 flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-slate-700 mb-2">AI Process 工作台</h1>
        <p className="text-slate-500 max-w-lg text-center">
          在这里进行多源音频的大模型转录，以及多篇独立文档的深度提炼合并。完成的加工素材支持一键派发入左侧研究画布系统。
        </p>
      </div>
    </div>
  );
});
