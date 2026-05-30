import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core';
import { AIInlineBlock } from './aiInlineBlock.tsx';
import { MathFormulaInline } from './mathFormulaInline.tsx';
import { MermaidBlock } from './mermaidBlock.tsx';

// createReactBlockSpec returns a factory function; call it to get the BlockSpec
const aiInlineSpec = AIInlineBlock();
const mermaidSpec = MermaidBlock();

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    aiInline: aiInlineSpec,
    mermaid: mermaidSpec,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mathFormula: MathFormulaInline,
  },
});
