import type { FormatTemplate } from '../types/index';

export const FORMAT_TEMPLATES: FormatTemplate[] = [
  {
    id: 'format_markdown',
    name: '标准排版',
    description: '结构清晰的多级标题与列表排版，重点加粗呈现',
    content: '请使用结构清晰的 Markdown 格式输出。需包含：\n1. 适当层级的标题（#，##，### 等）\n2. 要点和细则尽量使用列表项（- 或数字）展现\n3. 对核心观点、关键数据及专有名词进行加粗（**关键词**）突出显示。'
  },
  {
    id: 'format_table',
    name: '表格总结',
    description: '使用 Markdown 表格进行并列对比与展示',
    content: '请务必使用 Markdown 表格形式直观地汇总和输出你的结论。表格需要具备清晰完整的表头字段，并保持排版对齐。'
  },
  {
    id: 'format_bullet',
    name: '精简提纲',
    description: '极简列点式要点输出，适合快速通读',
    content: '请不要生成大段落的描述。每一部分内容必须完全使用高度浓缩的子弹点（列表项）列出，做到字斟句酌、言简意赅。'
  },
  {
    id: 'format_json',
    name: '纯 JSON',
    description: '标准 JSON 数据结构输出，可供下游程序或复制调用',
    content: '请以合法的 JSON 格式数据输出。返回内容必须从左花括号或中括号开始，不要输出任何额外的描述文字，也不要使用 ```json 等代码块包裹。'
  }
];
