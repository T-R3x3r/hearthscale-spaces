/**
 * One page: its title, and its words in a Tiptap editor that takes
 * Markdown as it is typed: `#` to `###` for headings, `-` and `1.` for
 * lists, `[ ]` for a checklist, `>` for a quote and three backticks for
 * code. A shared page's editor writes to the page's Yjs document, and
 * shows the changes of the others as they come.
 */
import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import type { Doc } from 'yjs';
import type { PageBody } from './pages.ts';
import { pageExtensions } from './schema.ts';

const placeholder = Placeholder.configure({ placeholder: 'Write something' });
const prose = { attributes: { class: 'spaces-prose', 'aria-label': 'Page' } };

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
  const editor = useEditor({
    extensions: [...pageExtensions(), placeholder],
    content: body.doc,
    editorProps: prose,
    onUpdate: ({ editor: changed }) =>
      onBody({ doc: changed.getJSON(), text: changed.getText({ blockSeparator: '\n' }) }),
  });
  return (
    <div className="spaces-sheet">
      <Title initial={title} onTitle={onTitle} onDown={() => editor?.commands.focus('start')} />
      <EditorContent editor={editor} />
    </div>
  );
}

/** A page in a room: its words bound to `doc`, its title to the
 *  document's `page` map. */
export function SharedEditor({ doc, onTitle }: { doc: Doc; onTitle: (title: string) => void }) {
  const meta = doc.getMap('page');
  const [title, setTitle] = useState(() => String(meta.get('title') ?? ''));
  useEffect(() => {
    const read = () => setTitle(String(meta.get('title') ?? ''));
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [meta]);
  const editor = useEditor(
    { extensions: [...pageExtensions(doc), placeholder], editorProps: prose },
    [doc],
  );
  return (
    <div className="spaces-sheet">
      <Title
        value={title}
        onTitle={(next) => {
          setTitle(next);
          onTitle(next);
        }}
        onDown={() => editor?.commands.focus('start')}
      />
      <EditorContent editor={editor} />
    </div>
  );
}

/** A page's title: Enter and the down arrow go on to its words. The title
 *  holds `value` where it is given, else the person's own typing from
 *  `initial`. */
function Title({
  initial = '',
  value,
  onTitle,
  onDown,
}: {
  initial?: string;
  value?: string;
  onTitle: (title: string) => void;
  onDown: () => void;
}) {
  const [named, setNamed] = useState(initial);
  const shown = value ?? named;
  return (
    <input
      className="spaces-title"
      aria-label="Title"
      placeholder="Untitled"
      value={shown}
      autoFocus={!shown}
      onChange={(e) => {
        setNamed(e.target.value);
        onTitle(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        onDown();
      }}
    />
  );
}
