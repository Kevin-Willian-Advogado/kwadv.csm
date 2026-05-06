import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArticleEditorRelatedArticle, ArticlesService } from '../../../core/articles.service';

@Component({
  selector: 'app-article-related-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './article-related-modal.html',
  styleUrl: './article-related-modal.css',
})
export class ArticleRelatedModal implements OnInit {
  private readonly articlesService = inject(ArticlesService);

  @Input() existingRelatedArticleIds: number[] = [];
  @Input() currentArticleId: number | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() articleSelected = new EventEmitter<ArticleEditorRelatedArticle>();

  readonly fallbackImageUrl = 'https://placehold.co/1200x630/e2e8f0/64748b?text=Sem+Imagem';

  articles: ArticleEditorRelatedArticle[] = [];
  searchTerm = '';
  isLoading = true;
  errorMessage = '';

  ngOnInit(): void {
    this.loadArticles();
  }

  get filteredArticles(): ArticleEditorRelatedArticle[] {
    const normalizedSearch = this.normalizeText(this.searchTerm);

    return this.articles
      .filter((article) => article.id !== this.currentArticleId)
      .filter((article) => {
        if (!normalizedSearch) {
          return true;
        }

        const haystack = this.normalizeText(
          `${article.title} ${article.subtitle} ${article.categoryName} ${article.slug}`,
        );
        return haystack.includes(normalizedSearch);
      });
  }

  closeModal(): void {
    this.closed.emit();
  }

  selectArticle(article: ArticleEditorRelatedArticle): void {
    if (this.isArticleSelected(article.id) || article.id === this.currentArticleId) {
      return;
    }

    this.articleSelected.emit(article);
  }

  isArticleSelected(articleId: number): boolean {
    return this.existingRelatedArticleIds.includes(articleId);
  }

  private loadArticles(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.articlesService.getArticlesForRelatedSelection().subscribe({
      next: (articles) => {
        this.articles = articles;
        this.isLoading = false;
      },
      error: (error: unknown) => {
        console.error('Erro ao carregar artigos relacionados:', error);
        this.errorMessage = 'Nao foi possivel carregar os artigos disponiveis.';
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
