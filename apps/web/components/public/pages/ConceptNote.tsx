import type { ReactNode } from "react";

type ConceptNoteProps = {
  children?: ReactNode;
};

/**
 * Concept note — returns null in the production interface. Content
 * verification is tracked in PROJECT-STATUS.md, not in the UI.
 */
export default function ConceptNote(_props: ConceptNoteProps) {
  return null;
}
