import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { finalize } from 'rxjs';

import { AuthorListItem, AuthorsService } from '../../../../core/authors.service';

type PageControl = number | 'start-ellipsis' | 'end-ellipsis';

interface AuthorsTableItem {
  id: number;
  name: string;
  headline: string;
  profileImageUrl: string;
}

@Component({
  selector: 'app-authors-list-table',
  imports: [CommonModule],
  templateUrl: './authors-list-table.html',
  styleUrl: './authors-list-table.css',
})
export class AuthorsListTable implements OnInit, OnDestroy {
  private readonly authorsService = inject(AuthorsService);
  private loadingIndicatorTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @Output() authorSelected = new EventEmitter<number>();

  readonly itemsPerPage = 25;
  readonly skeletonRows = [0, 1, 2, 3, 4];

  authors: AuthorsTableItem[] = [];
  filteredAuthors: AuthorsTableItem[] = [];
  currentPage = 1;
  isLoading = true;
  showLoadingState = false;
  hasLoadedOnce = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadAuthors();
  }

  ngOnDestroy(): void {
    this.clearLoadingIndicatorDelay();
  }

  get resultsCount(): number {
    return this.filteredAuthors.length;
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

  get paginatedAuthors(): AuthorsTableItem[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;

    return this.filteredAuthors.slice(startIndex, endIndex);
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
    this.loadAuthors(true);
  }

  refresh(): void {
    this.loadAuthors(true);
  }

  openAuthor(authorId: number): void {
    this.authorSelected.emit(authorId);
  }

  private loadAuthors(forceRefresh = false): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.startLoadingIndicatorDelay();

    this.authorsService
      .getAuthorsForListing(forceRefresh)
      .pipe(finalize(() => {
        this.isLoading = false;
        this.clearLoadingIndicatorDelay();
      }))
      .subscribe({
        next: (authors) => {
          this.authors = this.mapAuthors(authors);
          this.applyFilters();
          this.hasLoadedOnce = true;
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar a listagem de autores.';
          this.hasLoadedOnce = true;
          console.error('Erro ao carregar autores:', error);
        },
      });
  }

  private mapAuthors(authors: AuthorListItem[]): AuthorsTableItem[] {
    return authors.map((author) => ({
      id: author.id,
      name: this.normalizeText(author.name, 'Autor sem nome'),
      headline: this.normalizeText(author.headline, 'Sem headline cadastrada'),
      profileImageUrl: this.normalizeText(author.profileImageUrl, '/images/avatar-placeholder.png'),
    }));
  }

  private applyFilters(): void {
    this.filteredAuthors = [...this.authors];

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
