import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { finalize, forkJoin } from 'rxjs';

import { AuthorListItem, AuthorsService } from '../../../../core/authors.service';
import { UserListItem, UsersService } from '../../../../core/users.service';

type PageControl = number | 'start-ellipsis' | 'end-ellipsis';

interface UsersTableItem {
  id: number;
  email: string;
  displayName: string;
  isActive: boolean | null;
  linkedAuthorName: string;
  linkedAuthorHeadline: string;
}

@Component({
  selector: 'app-users-list-table',
  imports: [CommonModule],
  templateUrl: './users-list-table.html',
  styleUrl: './users-list-table.css',
})
export class UsersListTable implements OnInit, OnDestroy {
  private readonly usersService = inject(UsersService);
  private readonly authorsService = inject(AuthorsService);
  private loadingIndicatorTimeoutId: ReturnType<typeof setTimeout> | null = null;
  @Output() userSelected = new EventEmitter<number>();

  readonly itemsPerPage = 25;
  readonly skeletonRows = [0, 1, 2, 3, 4];

  users: UsersTableItem[] = [];
  filteredUsers: UsersTableItem[] = [];
  currentPage = 1;
  isLoading = true;
  showLoadingState = false;
  hasLoadedOnce = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadUsers();
  }

  ngOnDestroy(): void {
    this.clearLoadingIndicatorDelay();
  }

  get resultsCount(): number {
    return this.filteredUsers.length;
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

  get paginatedUsers(): UsersTableItem[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;

    return this.filteredUsers.slice(startIndex, endIndex);
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
    this.loadUsers(true);
  }

  refresh(): void {
    this.loadUsers(true);
  }

  openUser(userId: number): void {
    this.userSelected.emit(userId);
  }

  getStatusClasses(user: UsersTableItem): string {
    const baseClasses = 'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold';

    if (user.isActive === true) {
      return `${baseClasses} bg-emerald-50 text-emerald-700`;
    }

    if (user.isActive === false) {
      return `${baseClasses} bg-red-50 text-red-700`;
    }

    return `${baseClasses} bg-slate-100 text-slate-500`;
  }

  getStatusLabel(user: UsersTableItem): string {
    if (user.isActive === true) {
      return 'Ativo';
    }

    if (user.isActive === false) {
      return 'Inativo';
    }

    return 'Sem status';
  }

  private loadUsers(forceRefresh = false): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.startLoadingIndicatorDelay();

    forkJoin({
      users: this.usersService.getUsers(forceRefresh),
      authors: this.authorsService.getAuthorsForListing(forceRefresh),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
        this.clearLoadingIndicatorDelay();
      }))
      .subscribe({
        next: ({ users, authors }) => {
          this.users = this.mapUsers(users, authors);
          this.applyFilters();
          this.hasLoadedOnce = true;
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar a listagem de usuarios.';
          this.hasLoadedOnce = true;
          console.error('Erro ao carregar usuarios:', error);
        },
      });
  }

  private mapUsers(users: UserListItem[], authors: AuthorListItem[]): UsersTableItem[] {
    const authorsByUserId = new Map<number, AuthorListItem>();

    for (const author of authors) {
      if (typeof author.userId === 'number' && author.userId > 0 && !authorsByUserId.has(author.userId)) {
        authorsByUserId.set(author.userId, author);
      }
    }

    return users.map((user) => {
      const linkedAuthor = authorsByUserId.get(user.id);

      return {
        id: user.id,
        email: this.normalizeText(user.email, 'Sem e-mail'),
        displayName: this.normalizeText(user.displayName, 'Usuario sem nome'),
        isActive: user.isActive,
        linkedAuthorName: linkedAuthor?.name ?? 'Sem autor vinculado',
        linkedAuthorHeadline: linkedAuthor?.headline || 'Aguardando vinculacao editorial',
      };
    });
  }

  private applyFilters(): void {
    this.filteredUsers = [...this.users];

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
