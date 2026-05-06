import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { finalize, forkJoin } from 'rxjs';

import { ArticleListItem, ArticlesService } from '../../../../core/articles.service';
import { CategoriesService, CategoryListItem } from '../../../../core/categories.service';

type PageControl = number | 'start-ellipsis' | 'end-ellipsis';

interface CategoriesTableItem {
  id: number;
  name: string;
  description: string;
  articleCount: number;
  hasArticles: boolean;
}

@Component({
  selector: 'app-categories-list-table',
  imports: [CommonModule],
  templateUrl: './categories-list-table.html',
  styleUrl: './categories-list-table.css',
})
export class CategoriesListTable implements OnInit, OnDestroy {
  private readonly categoriesService = inject(CategoriesService);
  private readonly articlesService = inject(ArticlesService);
  private loadingIndicatorTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @Output() categorySelected = new EventEmitter<number>();

  readonly itemsPerPage = 25;
  readonly skeletonRows = [0, 1, 2, 3, 4];

  categories: CategoriesTableItem[] = [];
  filteredCategories: CategoriesTableItem[] = [];
  currentPage = 1;
  isLoading = true;
  showLoadingState = false;
  hasLoadedOnce = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadCategories();
  }

  ngOnDestroy(): void {
    this.clearLoadingIndicatorDelay();
  }

  get resultsCount(): number {
    return this.filteredCategories.length;
  }

  get totalPages(): number {
    if (this.resultsCount === 0) {
      return 1;
    }

    return Math.ceil(this.resultsCount / this.itemsPerPage);
  }

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  get pageControls(): PageControl[] {
    if (this.resultsCount === 0) {
      return [];
    }

    if (this.totalPages <= 7) {
      return this.pageNumbers;
    }

    if (this.currentPage <= 4) {
      return [1, 2, 3, 4, 5, 'end-ellipsis', this.totalPages];
    }

    if (this.currentPage >= this.totalPages - 3) {
      return [1, 'start-ellipsis', this.totalPages - 4, this.totalPages - 3, this.totalPages - 2, this.totalPages - 1, this.totalPages];
    }

    return [
      1,
      'start-ellipsis',
      this.currentPage - 1,
      this.currentPage,
      this.currentPage + 1,
      'end-ellipsis',
      this.totalPages,
    ];
  }

  get displayFrom(): number {
    if (this.resultsCount === 0) {
      return 0;
    }

    return (this.currentPage - 1) * this.itemsPerPage + 1;
  }

  get displayTo(): number {
    return Math.min(this.currentPage * this.itemsPerPage, this.resultsCount);
  }

  get paginatedCategories(): CategoriesTableItem[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;

    return this.filteredCategories.slice(startIndex, endIndex);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
  }

  goToPreviousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  goToNextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  getPageButtonClasses(page: number): string {
    if (page === this.currentPage) {
      return 'px-3 py-1.5 bg-(--color-1) text-white rounded-md text-sm font-medium';
    }

    return 'px-3 py-1.5 hover:bg-(--color-3) hover:text-white text-(--color-1) rounded-md text-sm font-medium';
  }

  isPageNumber(page: PageControl): page is number {
    return typeof page === 'number';
  }

  retryLoad(): void {
    this.loadCategories(true);
  }

  refresh(): void {
    this.loadCategories(true);
  }

  openCategory(categoryId: number): void {
    this.categorySelected.emit(categoryId);
  }

  getStatusClasses(category: CategoriesTableItem): string {
    if (category.hasArticles) {
      return 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20';
    }

    return 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300';
  }

  private loadCategories(forceRefresh = false): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.startLoadingIndicatorDelay();

    forkJoin({
      categories: this.categoriesService.getCategories(forceRefresh),
      articles: this.articlesService.getArticlesForListing(forceRefresh),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.clearLoadingIndicatorDelay();
      }))
      .subscribe({
        next: ({ categories, articles }) => {
          this.categories = this.mapCategories(categories, articles);
          this.applyFilters();
          this.hasLoadedOnce = true;
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar a listagem de categorias.';
          this.hasLoadedOnce = true;
          console.error('Erro ao carregar categorias:', error);
        },
      });
  }

  private mapCategories(categories: CategoryListItem[], articles: ArticleListItem[]): CategoriesTableItem[] {
    const articleCountByCategoryName = new Map<string, number>();

    for (const article of articles) {
      const categoryName = this.normalizeKey(article.categories?.name);
      if (!categoryName) {
        continue;
      }

      articleCountByCategoryName.set(categoryName, (articleCountByCategoryName.get(categoryName) ?? 0) + 1);
    }

    return categories.map((category) => {
      const normalizedCategoryName = this.normalizeKey(category.name);
      const articleCount = normalizedCategoryName ? (articleCountByCategoryName.get(normalizedCategoryName) ?? 0) : 0;

      return {
        id: category.id,
        name: this.normalizeText(category.name, 'Categoria sem nome'),
        description: this.normalizeText(category.description, 'Sem descricao cadastrada'),
        articleCount,
        hasArticles: articleCount > 0,
      };
    });
  }

  private applyFilters(): void {
    this.filteredCategories = [...this.categories];

    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }

    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }

  private normalizeText(value: string | null | undefined, fallback = ''): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim();
    return normalized || fallback;
  }

  private normalizeKey(value: string | null | undefined): string {
    return this.normalizeText(value).toLocaleLowerCase();
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
}
