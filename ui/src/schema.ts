/**
 * What a page is made of: the editor's extensions, the schema they make,
 * and the way a page's plain text, which the search reads, comes out of
 * its document. A shared page's editor binds the same extensions to the
 * page's Yjs document, and takes its undo from it.
 */
import { getSchema, getText, getTextSerializersFromSchema, type AnyExtension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import Collaboration from '@tiptap/extension-collaboration';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import type { Doc } from 'yjs';

/** The extensions of a page's editor, bound to `shared` for a page in a
 *  room. */
export function pageExtensions(shared?: Doc): AnyExtension[] {
  return [
    StarterKit.configure({
      link: { openOnClick: false },
      ...(shared && { undoRedo: false }),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(shared ? [Collaboration.configure({ document: shared })] : []),
  ];
}

export const schema = getSchema(pageExtensions());

const serializers = getTextSerializersFromSchema(schema);

/** A document's plain text, a line for each block. */
export const textOf = (doc: Node) =>
  getText(doc, { blockSeparator: '\n', textSerializers: serializers });
