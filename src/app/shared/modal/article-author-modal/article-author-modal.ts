import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArticleEditorAuthor } from '../../../core/articles.service';
import { AuthorsService } from '../../../core/authors.service';

@Component({
  selector: 'app-article-author-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './article-author-modal.html',
  styleUrl: './article-author-modal.css',
})
export class ArticleAuthorModal implements OnInit {
  private readonly authorsService = inject(AuthorsService);

  @Input() existingAuthorIds: number[] = [];
  @Input() currentAuthorId: number | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() authorSelected = new EventEmitter<ArticleEditorAuthor>();

  authors: ArticleEditorAuthor[] = [];
  searchTerm = '';
  isLoading = true;
  errorMessage = '';

  ngOnInit(): void {
    this.loadAuthors();
  }

  get filteredAuthors(): ArticleEditorAuthor[] {
    const normalizedSearch = this.normalizeText(this.searchTerm);
    if (!normalizedSearch) {
      return this.authors;
    }

    return this.authors.filter((author) => {
      const haystack = this.normalizeText(`${author.name} ${author.headline}`);
      return haystack.includes(normalizedSearch);
    });
  }

  closeModal(): void {
    this.closed.emit();
  }

  selectAuthor(author: ArticleEditorAuthor): void {
    if (this.isAuthorSelected(author.id)) {
      return;
    }

    this.authorSelected.emit(author);
  }

  isAuthorSelected(authorId: number): boolean {
    return this.existingAuthorIds.includes(authorId);
  }

  isCurrentAuthor(authorId: number): boolean {
    return this.currentAuthorId === authorId;
  }

  private loadAuthors(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.authorsService.getAuthors().subscribe({
      next: (authors) => {
        this.authors = authors;
        this.isLoading = false;
      },
      error: (error: unknown) => {
        console.error('Erro ao carregar autores:', error);
        this.errorMessage = 'Nao foi possivel carregar os autores.';
        this.isLoading = false;
      },
    });
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
