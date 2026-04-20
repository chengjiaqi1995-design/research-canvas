import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2, Minimize2, Maximize2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { aiApi } from '../../db/apiClient.ts';
import { IconButton } from '../ui/index.ts';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// ─── Tool definitions for the AI ─────────────────────────────
const TOOLS_DESCRIPTION = `你是 Research Canvas 的 AI 助理，可以帮用户操作软件。

你可以执行以下操作，请用 JSON 格式返回操作指令：

1. 创建文件夹（支持批量）：
   {"action": "create_folders", "names": ["文件夹A", "文件夹B"]}

2. 重命名文件夹：
   {"action": "rename_folder", "oldName": "旧名称", "newName": "新名称"}

3. 删除文件夹：
   {"action": "delete_folders", "names": ["文件夹A"]}

4. 列出所有文件夹：
   {"action": "list_folders"}

5. 创建画布（在指定文件夹下）：
   {"action": "create_canvas", "folderName": "文件夹名", "canvasTitle": "画布标题"}

6. 移动画布到其他文件夹：
   {"action": "move_canvas", "canvasTitle": "画布标题", "targetFolder": "目标文件夹"}

规则：
- 如果用户的请求需要执行操作，在回复中包含一个 JSON 代码块（用 \`\`\`json 包裹）
- 可以在 JSON 前后加上说明文字
- 如果用户只是聊天或提问，正常回复即可
- 如果需要执行多个操作，可以返回数组：[{...}, {...}]
- 对于危险操作（删除），先确认再执行`;

// ─── Execute tool actions ─────────────────────────────────────
async function executeAction(
  action: Record<string, unknown>,
  stores: {
    workspaceStore: ReturnType<typeof useWorkspaceStore.getState>;
    canvasStore: ReturnType<typeof useCanvasStore.getState>;
  }
): Promise<string> {
  const { workspaceStore } = stores;

  switch (action.action) {
    case 'create_folders': {
      const names = action.names as string[];
      const existing = workspaceStore.workspaces.map((w) => w.name);
      const created: string[] = [];
      const skipped: string[] = [];
      for (const name of names) {
        if (existing.includes(name)) {
          skipped.push(name);
        } else {
          await workspaceStore.createWorkspace(name, '📁');
          created.push(name);
        }
      }
      await workspaceStore.loadWorkspaces();
      let msg = '';
      if (created.length) msg += `✅ 已创建 ${created.length} 个文件夹：${created.join('、')}`;
      if (skipped.length) msg += `\n⚠️ 跳过 ${skipped.length} 个已存在：${skipped.join('、')}`;
      return msg || '没有需要创建的文件夹';
    }

    case 'rename_folder': {
      const ws = workspaceStore.workspaces.find((w) => w.name === action.oldName);
      if (!ws) return `❌ 未找到文件夹「${action.oldName}」`;
      await workspaceStore.renameWorkspace(ws.id, action.newName as string);
      return `✅ 已将「${action.oldName}」重命名为「${action.newName}」`;
    }

    case 'delete_folders': {
      const names = action.names as string[];
      const deleted: string[] = [];
      const notFound: string[] = [];
      for (const name of names) {
        const ws = workspaceStore.workspaces.find((w) => w.name === name);
        if (ws) {
          await workspaceStore.deleteWorkspace(ws.id);
          deleted.push(name);
        } else {
          notFound.push(name);
        }
      }
      await workspaceStore.loadWorkspaces();
      let msg = '';
      if (deleted.length) msg += `✅ 已删除：${deleted.join('、')}`;
      if (notFound.length) msg += `\n⚠️ 未找到：${notFound.join('、')}`;
      return msg;
    }

    case 'list_folders': {
      const names = workspaceStore.workspaces.map((w) => w.name);
      return `📁 共 ${names.length} 个文件夹：\n${names.join('\n')}`;
    }

    case 'create_canvas': {
      const ws = workspaceStore.workspaces.find((w) => w.name === action.folderName);
      if (!ws) return `❌ 未找到文件夹「${action.folderName}」`;
      await workspaceStore.createCanvas(ws.id, action.canvasTitle as string);
      return `✅ 已在「${action.folderName}」下创建画布「${action.canvasTitle}」`;
    }

    case 'move_canvas': {
      const targetWs = workspaceStore.workspaces.find((w) => w.name === action.targetFolder);
      if (!targetWs) return `❌ 未找到目标文件夹「${action.targetFolder}」`;
      // Find canvas across all workspaces
      for (const ws of workspaceStore.workspaces) {
        await workspaceStore.loadCanvases(ws.id);
        const canvases = workspaceStore.canvases;
        const canvas = canvases.find((c) => c.title === action.canvasTitle);
        if (canvas) {
          await workspaceStore.moveCanvas(canvas.id, targetWs.id);
          return `✅ 已将画布「${action.canvasTitle}」移动到「${action.targetFolder}」`;
        }
      }
      return `❌ 未找到画布「${action.canvasTitle}」`;
    }

    default:
      return `❌ 未知操作：${action.action}`;
  }
}

// ─── Parse JSON actions from AI response ──────────────────────
function parseActions(text: string): Record<string, unknown>[] {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[1].trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// ─── Component ────────────────────────────────────────────────
export const AIAssistant = memo(function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const models = useAICardStore((s) => s.models);
  const loadModels = useAICardStore((s) => s.loadModels);

  // Load models on mount
  useEffect(() => {
    if (models.length === 0) loadModels();
  }, [models.length, loadModels]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = {
      id: String(Date.now()),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Build conversation history for context
      const history = [...messages.slice(-10), userMsg].map((m) => ({
        role: m.role === 'system' ? 'assistant' : m.role,
        content: m.content,
      }));

      // Stream AI response
      let fullResponse = '';
      const model = models[0]?.id || 'gemini-3-flash-preview';

      const stream = aiApi.chatStream({
        model,
        messages: history,
        systemPrompt: TOOLS_DESCRIPTION,
      });

      const assistantId = String(Date.now() + 1);
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() },
      ]);

      for await (const event of stream) {
        if (event.type === 'content' && event.content) {
          fullResponse += event.content;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: fullResponse } : m))
          );
        }
      }

      // Check if response contains actions to execute
      const actions = parseActions(fullResponse);
      if (actions.length > 0) {
        const workspaceStore = useWorkspaceStore.getState();
        const canvasStore = useCanvasStore.getState();
        const results: string[] = [];

        for (const action of actions) {
          const result = await executeAction(action, { workspaceStore, canvasStore });
          results.push(result);
        }

        const resultMsg: Message = {
          id: String(Date.now() + 2),
          role: 'system',
          content: results.join('\n\n'),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, resultMsg]);
      }
    } catch (err) {
      const errMsg: Message = {
        id: String(Date.now() + 3),
        role: 'system',
        content: `❌ 错误：${(err as Error).message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, models]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Floating button when closed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-11 h-11 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-50"
        title="AI 助理"
      >
        <Bot size={20} />
      </button>
    );
  }

  // Minimized state
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 bg-white rounded shadow-lg border border-slate-200 z-50 flex items-center gap-1.5 pl-3 pr-1 py-1">
        <Bot size={14} className="text-blue-500" />
        <span className="text-xs font-semibold text-slate-700">AI 助理</span>
        <IconButton onClick={() => setIsMinimized(false)} title="展开">
          <Maximize2 size={12} />
        </IconButton>
        <IconButton onClick={() => setIsOpen(false)} title="关闭">
          <X size={12} />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-white rounded shadow-xl border border-slate-200 flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 border-b border-slate-200 bg-slate-50 shrink-0" style={{ minHeight: 38 }}>
        <div className="flex items-center gap-1.5">
          <Bot size={14} className="text-blue-500" />
          <span className="text-xs font-semibold text-slate-700">AI 助理</span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton onClick={() => setIsMinimized(true)} title="最小化">
            <Minimize2 size={12} />
          </IconButton>
          <IconButton onClick={() => setIsOpen(false)} title="关闭">
            <X size={12} />
          </IconButton>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-slate-50/30">
        {messages.length === 0 && (
          <div className="text-center text-xs text-slate-400 mt-6">
            <Bot size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-slate-500">你好！我是 AI 助理</p>
            <p className="text-[11px] mt-1 text-slate-400">
              我可以帮你创建文件夹、重命名、移动画布等操作
            </p>
            <div className="mt-4 space-y-1 text-[11px] text-left text-slate-500 px-2">
              <p className="font-medium text-slate-600">试试说：</p>
              <p className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setInput('帮我创建以下文件夹：新能源、半导体、消费')}>
                "帮我创建以下文件夹：新能源、半导体、消费"
              </p>
              <p className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setInput('列出所有文件夹')}>
                "列出所有文件夹"
              </p>
              <p className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => setInput('把「核电」重命名为「核电与核能」')}>
                "把「核电」重命名为「核电与核能」"
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : msg.role === 'system'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-white border border-slate-200 text-slate-700'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded px-2.5 py-1.5 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin text-blue-500" />
              <span className="text-xs text-slate-500">思考中...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-2 py-2 border-t border-slate-200 shrink-0 bg-white">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="告诉我你需要什么..."
            rows={1}
            className="flex-1 resize-none text-xs bg-slate-50 focus:bg-white border border-slate-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-400 transition-colors max-h-20 placeholder:text-slate-400"
            style={{ minHeight: 32 }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-colors"
            title="发送"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
});
