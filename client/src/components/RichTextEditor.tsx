import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useCallback, useState } from 'react';
import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote,
  Heading1, Heading2, Heading3, Link2, Image as ImageIcon,
  Undo, Redo, Minus, Code2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssetPicker } from './AssetPicker';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  allowedExtensions?: string[] | null;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      className={cn(
        'p-1.5 rounded text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors',
        active && 'bg-zinc-200 text-zinc-900'
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, allowed }: { editor: Editor; allowed: Set<string> | null }) {
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const setLink = useCallback(() => {
    const url = window.prompt('URL:');
    if (!url) return;
    editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  // null means all allowed
  const show = (key: string) => allowed === null || allowed.has(key);

  const hasHeadings = show('heading');
  const hasInline = show('bold') || show('italic') || show('strike') || show('code');
  const hasLists = show('bulletList') || show('orderedList');
  const hasBlocks = show('blockquote') || show('codeBlock') || show('horizontalRule');
  const hasEmbeds = show('link') || show('image');

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5 p-2 border-b border-zinc-200 bg-zinc-50 sticky top-[61px] z-10 rounded-t-md">
        {hasHeadings && (
          <>
            <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="H1">
              <Heading1 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="H2">
              <Heading2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="H3">
              <Heading3 className="h-4 w-4" />
            </ToolbarButton>
          </>
        )}
        {hasHeadings && hasInline && <div className="w-px h-5 bg-zinc-200 mx-1" />}
        {show('bold') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
            <Bold className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('italic') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
            <Italic className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('strike') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
            <Strikethrough className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('code') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
            <Code className="h-4 w-4" />
          </ToolbarButton>
        )}
        {hasInline && (hasLists || hasBlocks) && <div className="w-px h-5 bg-zinc-200 mx-1" />}
        {show('bulletList') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
            <List className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('orderedList') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered list">
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('blockquote') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
            <Quote className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('codeBlock') && (
          <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
            <Code2 className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('horizontalRule') && (
          <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="Horizontal rule">
            <Minus className="h-4 w-4" />
          </ToolbarButton>
        )}
        {(hasLists || hasBlocks) && hasEmbeds && <div className="w-px h-5 bg-zinc-200 mx-1" />}
        {show('link') && (
          <ToolbarButton onClick={setLink} active={editor.isActive('link')} title="Link">
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
        )}
        {show('image') && (
          <ToolbarButton onClick={() => setAssetPickerOpen(true)} active={false} title="Insert image">
            <ImageIcon className="h-4 w-4" />
          </ToolbarButton>
        )}
        <div className="w-px h-5 bg-zinc-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} active={false} title="Undo">
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} active={false} title="Redo">
          <Redo className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {show('image') && (
        <AssetPicker
          open={assetPickerOpen}
          onClose={() => setAssetPickerOpen(false)}
          onSelect={(url) => {
            editor.chain().focus().setImage({ src: url }).run();
            setAssetPickerOpen(false);
          }}
        />
      )}
    </>
  );
}

// StarterKit extensions that can be individually disabled
const STARTER_KIT_KEYS = ['heading', 'bold', 'italic', 'strike', 'code', 'codeBlock', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule'] as const;

function buildExtensions(allowedExtensions: string[] | null | undefined, placeholder: string) {
  const allowed = allowedExtensions ? new Set(allowedExtensions) : null;

  // Build StarterKit config — disable extensions not in the allowed set
  const starterKitConfig: Record<string, false | object> = {};
  if (allowed) {
    for (const key of STARTER_KIT_KEYS) {
      if (!allowed.has(key)) starterKitConfig[key] = false;
    }
  }

  return [
    StarterKit.configure(starterKitConfig),
    ...(allowed === null || allowed.has('link')
      ? [Link.configure({ openOnClick: false, autolink: true })]
      : []),
    ...(allowed === null || allowed.has('image') ? [Image] : []),
    Placeholder.configure({ placeholder }),
  ];
}

export function RichTextEditor({ value, onChange, placeholder, allowedExtensions }: RichTextEditorProps) {
  const allowed = allowedExtensions ? new Set(allowedExtensions) : null;

  const editor = useEditor({
    extensions: buildExtensions(allowedExtensions, placeholder ?? 'Start writing...'),
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sync external value changes
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="border border-zinc-200 rounded-md">
      <Toolbar editor={editor} allowed={allowed} />
      <EditorContent editor={editor} className="tiptap-wrapper" />
    </div>
  );
}

// Controlled version that returns a ref for imperative access
export function useRichTextEditor(initialValue: string) {
  const [value, setValue] = useState(initialValue);
  return { value, setValue };
}

// Standalone read-only display
export function RichTextDisplay({ html }: { html: string }) {
  return (
    <div
      className="tiptap prose prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
