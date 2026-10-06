/**
 * One page: its title, and its words in a Tiptap editor that takes
 * Markdown as it is typed: `#` to `###` for headings, `-` and `1.` for
 * lists, `[ ]` for a checklist, `>` for a quote and three backticks for
 * code.
 */
import { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import type { PageBody } from './pages.ts';

export function PageEditor({
  title,
  body,
  onTitle,
  onBody,
}: {
  title: string;
  body: PageBody;
  onTitle: (title: string) => void;
  onBody: (body: PageBody) => void;
}) {
  const [named, setNamed] = useState(title);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write something' }),
    ],
    content: body.doc,
    editorProps: { attributes: { class: 'spaces-prose', 'aria-label': 'Page' } },
    onUpdate: ({ editor: changed }) =>
      onBody({ doc: changed.getJSON(), text: changed.getText({ blockSeparator: '\n' }) }),
  });
  return (
    <div className="spaces-sheet">
      <input
        className="spaces-title"
        aria-label="Title"
        placeholder="Untitled"
        value={named}
        autoFocus={!title}
        onChange={(e) => {
          setNamed(e.target.value);
          onTitle(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          editor?.commands.focus('start');
        }}
      />
      <EditorContent editor={editor} />
    </div>
  );
}
