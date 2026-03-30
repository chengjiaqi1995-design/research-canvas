import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { AIInlineBlock } from './aiInlineBlock.tsx';

// createReactBlockSpec returns a factory function; call it to get the BlockSpec
const aiInlineSpec = AIInlineBlock();

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    aiInline: aiInlineSpec,
  },
});
