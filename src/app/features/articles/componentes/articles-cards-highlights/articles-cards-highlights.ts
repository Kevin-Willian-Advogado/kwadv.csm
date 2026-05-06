import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { finalize, forkJoin, switchMap } from 'rxjs';
import { ArticlesService } from '../../../../core/articles.service';
import {
  HighlightsArticleModal,
  HighlightsArticleModalItem,
} from '../../../../shared/modal/highlights-article-modal/highlights-article-modal';

interface HighlightArticle extends HighlightsArticleModalItem {
  id: number;
  title: string;
  subtitle: string;
  slug: string;
  categoryName: string;
  coverImageUrl: string;
  updatedAt: string;
  publishedAt: string;
  status: number;
}

@Component({
  selector: 'app-articles-cards-highlights',
  imports: [CommonModule, HighlightsArticleModal],
  templateUrl: './articles-cards-highlights.html',
  styleUrl: './articles-cards-highlights.css',
})
export class ArticlesCardsHighlights implements OnInit, OnDestroy {
  private readonly articlesService = inject(ArticlesService);
  private readonly publishedStatus = 1;
  private loadingIndicatorTimeoutId: ReturnType<typeof setTimeout> | null = null;

  public readonly maxHighlights = 3;
  public readonly slotIndexes = [0, 1, 2];
  public readonly fallbackCoverImageUrl = 'https://placehold.co/400x300/e2e8f0/64748b?text=Sem+Imagem';

  public highlightedArticles: HighlightArticle[] = [];
  public publishedArticles: HighlightArticle[] = [];

  public isLoading = true;
  public showLoadingState = false;
  public hasLoadedOnce = false;
  public isModalOpen = false;
  public isSaving = false;
  public selectedSlotIndex: number | null = null;
  public searchTerm = '';
  public errorMessage = '';
  public modalErrorMessage = '';

  ngOnInit(): void {
    this.loadHighlightsData();
  }

  ngOnDestroy(): void {
    this.clearLoadingIndicatorDelay();
  }

  public get filledSlotsCount(): number {
    return this.highlightedArticles.length;
  }

  public get modalArticles(): HighlightArticle[] {
    const normalizedSearch = this.searchTerm.trim().toLocaleLowerCase();
    const selectedSlotArticleId = this.getSelectedSlotArticle()?.id;

    return this.publishedArticles.filter((article) => {
      const isAlreadyHighlighted = this.highlightedArticles.some((highlight) => highlight.id === article.id);

      if (isAlreadyHighlighted && article.id !== selectedSlotArticleId) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [article.title, article.subtitle, article.categoryName].some((field) =>
        field.toLocaleLowerCase().includes(normalizedSearch)
      );
    });
  }

  public articleForSlot(slotIndex: number): HighlightArticle | null {
    return this.highlightedArticles[slotIndex] ?? null;
  }

  public openAddModal(): void {
    if (this.highlightedArticles.length >= this.maxHighlights || this.isSaving) {
      return;
    }

    this.openModalForSlot(this.highlightedArticles.length);
  }

  public openReplaceModal(slotIndex: number): void {
    if (this.isSaving) {
      return;
    }

    this.openModalForSlot(slotIndex);
  }

  public closeModal(force = false): void {
    if (this.isSaving && !force) {
      return;
    }

    this.isModalOpen = false;
    this.selectedSlotIndex = null;
    this.searchTerm = '';
    this.modalErrorMessage = '';
  }

  public onSearchChange(value: string): void {
    this.searchTerm = value;
  }

  public selectArticle(article: HighlightsArticleModalItem): void {
    if (this.isSaving || this.selectedSlotIndex === null) {
      return;
    }

    const currentSlotArticle = this.articleForSlot(this.selectedSlotIndex);
    if (currentSlotArticle?.id === article.id) {
      this.closeModal();
      return;
    }

    this.isSaving = true;
    this.modalErrorMessage = '';

    const request$ = currentSlotArticle
      ? this.articlesService.updateArticleHighlight(currentSlotArticle.id, false).pipe(
          switchMap(() => this.articlesService.updateArticleHighlight(article.id, true))
        )
      : this.articlesService.updateArticleHighlight(article.id, true);

    request$
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.closeModal(true);
          this.loadHighlightsData();
        },
        error: (err) => {
          this.modalErrorMessage = 'Nao foi possivel atualizar o destaque.';
          console.error('Erro ao salvar destaque:', err);
        },
      });
  }

  public removeHighlight(slotIndex: number): void {
    if (this.isSaving) {
      return;
    }

    const article = this.articleForSlot(slotIndex);
    if (!article) {
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';

    this.articlesService
      .updateArticleHighlight(article.id, false)
      .pipe(finalize(() => (this.isSaving = false)))
      .subscribe({
        next: () => {
          this.loadHighlightsData();
        },
        error: (err) => {
          this.errorMessage = 'Nao foi possivel remover o destaque.';
          console.error('Erro ao remover destaque:', err);
        },
      });
  }

  public retryLoad(): void {
    this.loadHighlightsData();
  }

  private openModalForSlot(slotIndex: number): void {
    this.selectedSlotIndex = slotIndex;
    this.searchTerm = '';
    this.modalErrorMessage = '';
    this.isModalOpen = true;
  }

  private loadHighlightsData(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.startLoadingIndicatorDelay();

    forkJoin({
      highlighted: this.articlesService.getHighlightedArticles(),
      published: this.articlesService.getPublishedArticles(),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.clearLoadingIndicatorDelay();
      }))
      .subscribe({
        next: ({ highlighted, published }) => {
          this.highlightedArticles = this.mapArticles(highlighted).slice(0, this.maxHighlights);
          this.publishedArticles = this.mapArticles(published).filter(
            (article) => article.status === this.publishedStatus
          );
          this.hasLoadedOnce = true;
        },
        error: (err) => {
          this.errorMessage = 'Nao foi possivel carregar os destaques.';
          this.hasLoadedOnce = true;
          console.error('Erro ao carregar destaques:', err);
        },
      });
  }

  private startLoadingIndicatorDelay(): void {
    this.clearLoadingIndicatorDelay();
    this.showLoadingState = false;

    if (this.hasLoadedOnce) {
      return;
    }

    this.loadingIndicatorTimeoutId = setTimeout(() => {
      this.showLoadingState = true;
    }, 140);
  }

  private clearLoadingIndicatorDelay(): void {
    if (this.loadingIndicatorTimeoutId !== null) {
      clearTimeout(this.loadingIndicatorTimeoutId);
      this.loadingIndicatorTimeoutId = null;
    }

    this.showLoadingState = false;
  }

  private mapArticles(data: unknown): HighlightArticle[] {
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((item) => {
      const mappedItem = item as {
        id?: number;
        title?: string;
        subtitle?: string;
        slug?: string;
        categories?: { name?: string } | null;
        cover_image_url?: string;
        coverImageUrl?: string;
        updated_at?: string;
        updatedAt?: string;
        published_at?: string;
        publishedAt?: string;
        status?: number;
      };

      return {
        id: mappedItem.id ?? 0,
        title: mappedItem.title ?? 'Sem titulo',
        subtitle: mappedItem.subtitle ?? '',
        slug: mappedItem.slug ?? '',
        categoryName: mappedItem.categories?.name ?? 'Sem categoria',
        coverImageUrl: mappedItem.cover_image_url ?? mappedItem.coverImageUrl ?? this.fallbackCoverImageUrl,
        publishedAt: mappedItem.published_at ?? mappedItem.publishedAt ?? '',
        updatedAt: mappedItem.updated_at ?? mappedItem.updatedAt ?? '',
        status: mappedItem.status ?? 0,
      };
    });
  }

  private getSelectedSlotArticle(): HighlightArticle | null {
    if (this.selectedSlotIndex === null) {
      return null;
    }

    return this.articleForSlot(this.selectedSlotIndex);
  }
}
