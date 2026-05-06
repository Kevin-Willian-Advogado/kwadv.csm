import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ArticleListItem, ArticlesService } from '../../../../core/articles.service';
import { CommonModule } from '@angular/common';
import { ArticleStatusFilter, ArticlesListTableInterface } from './articles-list-table.interface';
import { ShortNumberPipe } from '../../../../shared/pipes/short-number-pipe';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

type PageControl = number | 'start-ellipsis' | 'end-ellipsis';

@Component({
  selector: 'app-articles-list-table',
  imports: [ CommonModule, ShortNumberPipe ],
  templateUrl: './articles-list-table.html',
  styleUrl: './articles-list-table.css',
})
export class ArticlesListTable implements OnInit, OnDestroy {
  private articlesService = inject(ArticlesService);
  private router = inject(Router);
  private readonly publishedStatus = 1;
  private readonly draftStatuses = 2;
  private loadingIndicatorTimeoutId: ReturnType<typeof setTimeout> | null = null;
  public readonly itemsPerPage = 50;
  public readonly skeletonRows = [0, 1, 2, 3, 4];

  public articles: ArticlesListTableInterface[] = [];
  public filteredArticles: ArticlesListTableInterface[] = [];
  public selectedStatusFilter: ArticleStatusFilter = 'all';
  public searchTerm = '';
  public currentPage = 1;
  public isLoading = true;
  public showLoadingState = false;
  public hasLoadedOnce = false;
  public errorMessage = '';

  ngOnInit(): void {
    this.loadArticles();
  }

  ngOnDestroy(): void {
    this.clearLoadingIndicatorDelay();
  }

  public setStatusFilter(filter: ArticleStatusFilter): void {
    if (this.selectedStatusFilter === filter) {
      return;
    }

    this.selectedStatusFilter = filter;
    this.currentPage = 1;
    this.applyFilters();
  }

  public onSearchChange(value: string): void {
    this.searchTerm = value;
    this.currentPage = 1;
    this.applyFilters();
  }

  public isStatusFilterActive(filter: ArticleStatusFilter): boolean {
    return this.selectedStatusFilter === filter;
  }

  public getStatusButtonClasses(filter: ArticleStatusFilter): string {
    if (this.isStatusFilterActive(filter)) {
      return 'px-4 py-1.5 text-sm font-semibold bg-white text-slate-900 shadow-sm rounded-md';
    }

    return 'px-4 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-md transition';
  }

  public get resultsCount(): number {
    return this.filteredArticles.length;
  }

  public get totalPages(): number {
    if (this.resultsCount === 0) {
      return 1;
    }

    return Math.ceil(this.resultsCount / this.itemsPerPage);
  }

  public get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, index) => index + 1);
  }

  public get pageControls(): PageControl[] {
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

  public get displayFrom(): number {
    if (this.resultsCount === 0) {
      return 0;
    }

    return (this.currentPage - 1) * this.itemsPerPage + 1;
  }

  public get displayTo(): number {
    return Math.min(this.currentPage * this.itemsPerPage, this.resultsCount);
  }

  public get paginatedArticles(): ArticlesListTableInterface[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;

    return this.filteredArticles.slice(startIndex, endIndex);
  }

  public goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
  }

  public goToPreviousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  public goToNextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  public getPageButtonClasses(page: number): string {
    if (page === this.currentPage) {
      return 'px-3 py-1.5 bg-(--color-1) text-white rounded-md text-sm font-medium';
    }

    return 'px-3 py-1.5 hover:bg-(--color-3) hover:text-white text-(--color-1) rounded-md text-sm font-medium';
  }

  public isPageNumber(page: PageControl): page is number {
    return typeof page === 'number';
  }

  public retryLoad(): void {
    this.loadArticles(true);
  }

  public getDateLabel(value: string): string {
    if (!value.trim()) {
      return '--';
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? '--' : value;
  }

  public openArticle(slug: string): void {
    if (!slug.trim()) {
      return;
    }

    this.router.navigate(['/artigos', slug]);
  }

  loadArticles(forceRefresh = false): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.startLoadingIndicatorDelay();

    this.articlesService
      .getArticlesForListing(forceRefresh)
      .pipe(finalize(() => {
        this.isLoading = false;
        this.clearLoadingIndicatorDelay();
      }))
      .subscribe({
        next: (data) => {
          this.articles = data.map((item: ArticleListItem) => ({
            title: this.normalizeText(item.title, 'Sem titulo'),
            subtitle: this.normalizeText(item.subtitle),
            slug: this.normalizeText(item.slug),
            category: this.normalizeText(item.categories?.name, 'Sem categoria'),
            views: this.normalizeViews(item.views),
            publishedAt: item.published_at ?? item.created_at ?? '',
            updatedAt: item.updated_at ?? '',
            status: this.normalizeStatus(item.status),
          }));

          this.applyFilters();
          this.hasLoadedOnce = true;
        },
        error: (err) => {
          this.errorMessage = 'Nao foi possivel carregar a tabela de artigos.';
          this.hasLoadedOnce = true;
          console.error('Erro ao buscar artigos:', err);
        }
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

  private applyFilters(): void {
    const normalizedSearch = this.searchTerm.trim().toLocaleLowerCase();

    this.filteredArticles = this.articles.filter((article) => {
      if (!this.matchesStatusFilter(article)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [article.title, article.subtitle, article.category].some((field) =>
        field.toLocaleLowerCase().includes(normalizedSearch)
      );
    });

    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }

    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }

  private matchesStatusFilter(article: ArticlesListTableInterface): boolean {
    if (this.selectedStatusFilter === 'published') {
      return article.status === this.publishedStatus;
    }

    if (this.selectedStatusFilter === 'draft') {
      return article.status === this.draftStatuses;
    }

    return true;
  }

  private normalizeText(value: string | null | undefined, fallback = ''): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim();
    return normalized || fallback;
  }

  private normalizeViews(value: number | null | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }

    return value;
  }

  private normalizeStatus(value: number | null | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }

    return value;
  }
}
