import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';

import { AuthorDetail } from '../../components/author-detail/author-detail';
import { AuthorsListTable } from '../../components/authors-list-table/authors-list-table';

@Component({
  selector: 'app-author-list',
  imports: [AuthorDetail, AuthorsListTable],
  templateUrl: './author-list.html',
  styleUrl: './author-list.css',
})
export class AuthorList implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private navigationSubscription?: Subscription;

  @ViewChild(AuthorsListTable) private readonly table?: AuthorsListTable;

  selectedAuthorId: number | null = null;
  isEditorOpen = false;

  ngOnInit(): void {
    this.syncEditorFromUrl();
    this.navigationSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.syncEditorFromUrl());
  }

  ngOnDestroy(): void {
    this.navigationSubscription?.unsubscribe();
  }

  openCreateModal(): void {
    this.router.navigate(['/autores/novo']);
  }

  openEditModal(authorId: number): void {
    this.router.navigate(['/autores', authorId]);
  }

  closeEditor(): void {
    this.isEditorOpen = false;
    this.selectedAuthorId = null;

    if (this.router.url.split('?')[0] !== '/autores') {
      this.router.navigate(['/autores']);
    }
  }

  refreshList(): void {
    this.table?.refresh();
  }

  handleMutation(): void {
    this.refreshList();
    this.closeEditor();
  }

  private showCreateModal(): void {
    this.selectedAuthorId = null;
    this.isEditorOpen = true;
  }

  private showEditModal(authorId: number): void {
    this.selectedAuthorId = authorId;
    this.isEditorOpen = true;
  }

  private syncEditorFromUrl(): void {
    const path = this.router.url.split('?')[0];
    const routeId = this.parseRouteId(this.route.snapshot.paramMap.get('id'));

    if (path === '/autores/novo') {
      this.showCreateModal();
      return;
    }

    if (routeId !== null) {
      this.showEditModal(routeId);
      return;
    }

    this.isEditorOpen = false;
    this.selectedAuthorId = null;
  }

  private parseRouteId(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
}
