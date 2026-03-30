import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { AIInlineBlock } from './aiInlineBlock.tsx';

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    aiInline: AIInlineBlock,
  },
});
