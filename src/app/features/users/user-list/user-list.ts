import { Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription, filter } from 'rxjs';

import { UsersListTable } from '../components/users-list-table/users-list-table';
import { UserDetail } from '../user-detail/user-detail';
import { UserListItem } from '../../../core/users.service';

@Component({
  selector: 'app-user-list',
  imports: [UserDetail, UsersListTable],
  templateUrl: './user-list.html',
  styleUrl: './user-list.css',
})
export class UserList implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private navigationSubscription?: Subscription;

  @ViewChild(UsersListTable) private readonly table?: UsersListTable;

  selectedUserId: number | null = null;
  isEditorOpen = false;
  feedbackMessage = '';

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
    this.feedbackMessage = '';
    this.router.navigate(['/usuarios/novo']);
  }

  openEditModal(userId: number): void {
    this.feedbackMessage = '';
    this.router.navigate(['/usuarios', userId]);
  }

  closeEditor(): void {
    this.isEditorOpen = false;
    this.selectedUserId = null;

    if (this.router.url.split('?')[0] !== '/usuarios') {
      this.router.navigate(['/usuarios']);
    }
  }

  refreshList(): void {
    this.table?.refresh();
  }

  handleMutation(user?: UserListItem): void {
    this.feedbackMessage = this.buildFeedbackMessage(user);
    this.refreshList();
    this.closeEditor();
  }

  private buildFeedbackMessage(user?: UserListItem): string {
    if (user?.emailChangeValidationSent && user.pendingEmail) {
      return `Enviamos um e-mail para ${user.pendingEmail}. O novo e-mail so sera liberado para login depois da validacao. O link expira em 30 minutos.`;
    }

    return user ? 'Usuario salvo com sucesso.' : '';
  }

  private syncEditorFromUrl(): void {
    const path = this.router.url.split('?')[0];
    const routeId = this.parseRouteId(this.route.snapshot.paramMap.get('id'));

    if (path === '/usuarios/novo') {
      this.showCreateModal();
      return;
    }

    if (routeId !== null) {
      this.showEditModal(routeId);
      return;
    }

    this.isEditorOpen = false;
    this.selectedUserId = null;
  }

  private showCreateModal(): void {
    this.selectedUserId = null;
    this.isEditorOpen = true;
  }

  private showEditModal(userId: number): void {
    this.selectedUserId = userId;
    this.isEditorOpen = true;
  }

  private parseRouteId(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
}
