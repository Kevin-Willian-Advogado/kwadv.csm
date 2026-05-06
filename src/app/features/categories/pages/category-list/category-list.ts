import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';

import { CategoriesListTable } from '../../components/categories-list-table/categories-list-table';
import { CategoryDetail } from '../category-detail/category-detail';

@Component({
  selector: 'app-category-list',
  imports: [CategoriesListTable, CategoryDetail],
  templateUrl: './category-list.html',
  styleUrl: './category-list.css',
})
export class CategoryList implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private navigationSubscription?: Subscription;

  @ViewChild(CategoriesListTable) private readonly table?: CategoriesListTable;

  selectedCategoryId: number | null = null;
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
    this.router.navigate(['/categorias/nova']);
  }

  openEditModal(categoryId: number): void {
    this.router.navigate(['/categorias', categoryId]);
  }

  closeEditor(): void {
    this.isEditorOpen = false;
    this.selectedCategoryId = null;

    if (this.router.url.split('?')[0] !== '/categorias') {
      this.router.navigate(['/categorias']);
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
    this.selectedCategoryId = null;
    this.isEditorOpen = true;
  }

  private showEditModal(categoryId: number): void {
    this.selectedCategoryId = categoryId;
    this.isEditorOpen = true;
  }

  private syncEditorFromUrl(): void {
    const path = this.router.url.split('?')[0];
    const routeId = this.parseRouteId(this.route.snapshot.paramMap.get('id'));

    if (path === '/categorias/nova') {
      this.showCreateModal();
      return;
    }

    if (routeId !== null) {
      this.showEditModal(routeId);
      return;
    }

    this.isEditorOpen = false;
    this.selectedCategoryId = null;
  }

  private parseRouteId(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
}
