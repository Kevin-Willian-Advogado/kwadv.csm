import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';

@Component({
  selector: 'app-article-text-editor',
  imports: [],
  templateUrl: './article-text-editor.html',
  styleUrl: './article-text-editor.css',
})
export class ArticleTextEditor implements AfterViewInit, OnChanges, OnDestroy {
  @Input() content = '';
  @Input() isSaving = false;
  @Output() contentChange = new EventEmitter<string>();

  @ViewChild('editorElement') private editorElement?: ElementRef<HTMLElement>;

  editor: Editor | null = null;
  readonly insertToolsDisabled = true;

  constructor(private readonly changeDetectorRef: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    if (!this.editorElement) {
      return;
    }

    this.initializeEditor();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.editor) {
      return;
    }

    if (changes['content']) {
      const nextContent = changes['content'].currentValue;
      if (typeof nextContent === 'string' && this.editor.getHTML() !== nextContent) {
        this.editor.commands.setContent(nextContent);
      }
    }

    if (changes['isSaving']) {
      this.editor.setEditable(!this.isSaving);
    }
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
  }

  toggleHeading(level: 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
  }

  toggleParagraph(): void {
    this.editor?.chain().focus().setParagraph().run();
  }

  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleUnderline(): void {
    this.editor?.chain().focus().toggleUnderline().run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  addLink(): void {
    if (!this.editor || this.insertToolsDisabled) {
      return;
    }

    const previousUrl = this.editor.getAttributes('link')['href'] as string | undefined;
    const nextUrl = window.prompt('URL do link:', previousUrl ?? '');
    if (nextUrl === null) {
      return;
    }

    if (!nextUrl.trim()) {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    this.editor.chain().focus().extendMarkRange('link').setLink({ href: nextUrl.trim() }).run();
  }

  addImage(): void {
    if (!this.editor || this.insertToolsDisabled) {
      return;
    }

    const imageUrl = window.prompt('URL da imagem:');
    if (!imageUrl || !imageUrl.trim()) {
      return;
    }

    this.editor.chain().focus().setImage({ src: imageUrl.trim() }).run();
  }

  private initializeEditor(): void {
    this.editor?.destroy();

    this.editor = new Editor({
      element: this.editorElement!.nativeElement,
      extensions: [
        StarterKit.configure({
          link: false,
        }),
        Underline,
        Placeholder.configure({
          placeholder: 'Comece a escrever o artigo...',
        }),
        Image,
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
        }),
      ],
      content: this.content,
      editable: !this.isSaving,
      onUpdate: ({ editor }) => {
        this.contentChange.emit(editor.getHTML());
      },
      onCreate: () => {
        this.changeDetectorRef.detectChanges();
      },
    });
  }
}
