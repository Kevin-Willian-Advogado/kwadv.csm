import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';

import { AuthorListItem, AuthorsService } from '../../../core/authors.service';
import { UserListItem, UsersService, UserUpsertPayload } from '../../../core/users.service';

type UserStatusOption = 'active' | 'inactive';

@Component({
  selector: 'app-user-detail',
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './user-detail.html',
  styleUrl: './user-detail.css',
})
export class UserDetail implements OnInit, OnChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly usersService = inject(UsersService);
  private readonly authorsService = inject(AuthorsService);

  readonly form = this.formBuilder.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(180)]],
    status: ['active' as UserStatusOption],
    authorId: [null as number | null],
  });
  readonly newAuthorForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    headline: ['', [Validators.required, Validators.maxLength(180)]],
    profileImageUrl: [''],
  });

  @Input() modalMode = false;
  @Input() selectedUserId: number | null | undefined = undefined;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<UserListItem>();
  @Output() deleted = new EventEmitter<void>();

  userId: number | null = null;
  currentUser: UserListItem | null = null;
  authors: AuthorListItem[] = [];
  currentLinkedAuthorId: number | null = null;
  authorSearchTerm = '';
  isAuthorPickerOpen = false;
  isAuthorCreateOpen = false;
  isCreating = true;
  isLoading = true;
  isSaving = false;
  isSavingNewAuthor = false;
  isDeleting = false;
  errorMessage = '';
  feedbackMessage = '';
  newAuthorErrorMessage = '';

  ngOnInit(): void {
    this.loadUser();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedUserId'] && !changes['selectedUserId'].firstChange) {
      this.loadUser();
    }
  }

  get availableAuthors(): AuthorListItem[] {
    return this.authors.filter((author) => author.userId === null || author.userId === this.userId);
  }

  get selectedAuthor(): AuthorListItem | null {
    const authorId = this.form.controls.authorId.value;
    return this.authors.find((author) => author.id === authorId) ?? null;
  }

  get filteredAuthors(): AuthorListItem[] {
    const search = this.normalizeForSearch(this.authorSearchTerm);
    const authors = this.availableAuthors;

    if (!search) {
      return authors;
    }

    return authors.filter((author) =>
      this.normalizeForSearch(`${author.name} ${author.headline} ${author.id}`).includes(search),
    );
  }

  get isActive(): boolean {
    return this.form.controls.status.value === 'active';
  }

  closeDetail(): void {
    if (this.modalMode) {
      this.closed.emit();
      return;
    }

    this.router.navigate(['/usuarios']);
  }

  openAuthorPicker(): void {
    this.authorSearchTerm = '';
    this.isAuthorCreateOpen = false;
    this.newAuthorErrorMessage = '';
    this.isAuthorPickerOpen = true;
  }

  closeAuthorPicker(): void {
    this.isAuthorPickerOpen = false;
  }

  selectAuthor(author: AuthorListItem): void {
    this.form.controls.authorId.setValue(author.id);
    this.form.controls.authorId.markAsDirty();
    this.closeAuthorPicker();
  }

  clearAuthorLink(): void {
    this.form.controls.authorId.setValue(null);
    this.form.controls.authorId.markAsDirty();
  }

  setActiveStatus(isActive: boolean): void {
    this.form.controls.status.setValue(isActive ? 'active' : 'inactive');
    this.form.controls.status.markAsDirty();
  }

  openAuthorCreate(): void {
    this.newAuthorErrorMessage = '';
    this.newAuthorForm.reset({
      name: this.form.controls.displayName.value.trim() || this.formatDisplayName(this.form.controls.email.value),
      headline: '',
      profileImageUrl: '',
    });
    this.isAuthorCreateOpen = true;
  }

  closeAuthorCreate(): void {
    this.isAuthorCreateOpen = false;
    this.newAuthorErrorMessage = '';
  }

  createAndSelectAuthor(): void {
    this.newAuthorErrorMessage = '';
    this.newAuthorForm.markAllAsTouched();

    if (this.newAuthorForm.invalid || this.isSavingNewAuthor) {
      return;
    }

    this.isSavingNewAuthor = true;

    this.authorsService
      .createAuthor({
        name: this.newAuthorForm.controls.name.value.trim(),
        headline: this.newAuthorForm.controls.headline.value.trim(),
        profileImageUrl: this.newAuthorForm.controls.profileImageUrl.value.trim(),
        linkedinUrl: '',
        websiteUrl: '',
        userId: null,
      })
      .pipe(finalize(() => {
        this.isSavingNewAuthor = false;
      }))
      .subscribe({
        next: (author) => {
          this.authors = [author, ...this.authors.filter((item) => item.id !== author.id)];
          this.form.controls.authorId.setValue(author.id);
          this.form.controls.authorId.markAsDirty();
          this.closeAuthorCreate();
          this.closeAuthorPicker();
        },
        error: (error: unknown) => {
          this.newAuthorErrorMessage = 'Nao foi possivel criar o autor.';
          console.error('Erro ao criar autor pelo cadastro de usuario:', error);
        },
      });
  }

  saveUser(): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.isSaving = true;

    const payload: UserUpsertPayload = {
      email: this.form.controls.email.value.trim(),
      displayName: this.form.controls.displayName.value.trim(),
      isActive: this.mapStatusControlToValue(this.form.controls.status.value),
    };

    const request$ = this.isCreating || this.userId === null
      ? this.usersService.createUser(payload)
      : this.usersService.updateUser(this.userId, payload);

    request$
      .pipe(
        switchMap((user) =>
          this.syncAuthorLink(user.id).pipe(
            map(() => user),
          ),
        ),
        finalize(() => {
          this.isSaving = false;
        }),
      )
      .subscribe({
        next: (user) => {
          this.currentUser = user;
          this.userId = user.id;
          this.isCreating = false;
          this.currentLinkedAuthorId = this.form.controls.authorId.value;
          this.feedbackMessage = user.emailChangeValidationSent && user.pendingEmail
            ? `Usuario salvo. Enviamos um link para validar ${user.pendingEmail}. O e-mail de acesso sera alterado apos a validacao.`
            : 'Usuario salvo com sucesso.';
          this.saved.emit(user);
          if (!this.modalMode) {
            this.router.navigate(['/usuarios', user.id]);
          }
        },
        error: (error: unknown) => {
          this.errorMessage = this.getUserSaveErrorMessage(error);
          console.error('Erro ao salvar usuario:', error);
        },
      });
  }

  deleteUser(): void {
    if (this.userId === null || this.isCreating || this.isDeleting) {
      return;
    }

    const shouldDelete = window.confirm('Deseja realmente excluir este usuario?');
    if (!shouldDelete) {
      return;
    }

    this.isDeleting = true;
    this.errorMessage = '';
    this.feedbackMessage = '';

    this.syncAuthorLink(null)
      .pipe(
        switchMap(() => this.usersService.deleteUser(this.userId as number)),
        finalize(() => {
          this.isDeleting = false;
        }),
      )
      .subscribe({
        next: () => {
          this.deleted.emit();
          if (this.modalMode) {
            this.closed.emit();
          } else {
            this.router.navigate(['/usuarios']);
          }
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel excluir o usuario.';
          console.error('Erro ao excluir usuario:', error);
        },
      });
  }

  private loadUser(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.feedbackMessage = '';

    const userId = this.selectedUserId !== undefined
      ? this.parseInputId(this.selectedUserId)
      : this.parseRouteId(this.route.snapshot.paramMap.get('id'));
    this.userId = userId;
    this.isCreating = userId === null;

    forkJoin({
      users: this.usersService.getUsers().pipe(catchError(() => of([]))),
      authors: this.authorsService.getAuthorsForListing().pipe(catchError(() => of([]))),
      user: userId === null ? of(null) : this.usersService.getUserById(userId),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
      }))
      .subscribe({
        next: ({ authors, user }) => {
          this.currentUser = user;
          this.authors = authors;
          this.currentLinkedAuthorId = authors.find((author) => author.userId === user?.id)?.id ?? null;

          if (!this.isCreating && !user) {
            this.errorMessage = 'Usuario nao encontrado.';
            return;
          }

          this.form.patchValue({
            displayName: user?.displayName ?? '',
            email: user?.email ?? '',
            status: this.isCreating ? 'active' : this.mapUserStatusToControl(user?.isActive ?? true),
            authorId: this.currentLinkedAuthorId,
          });
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar o cadastro do usuario.';
          console.error('Erro ao carregar usuario:', error);
        },
      });
  }

  private syncAuthorLink(targetUserId: number | null) {
    const requestedAuthorId = this.form.controls.authorId.value;
    let request$: Observable<void> = of(void 0);

    if (this.currentLinkedAuthorId !== null && this.currentLinkedAuthorId !== requestedAuthorId) {
      request$ = request$.pipe(
        switchMap(() => this.authorsService.setAuthorUserLink(this.currentLinkedAuthorId as number, null)),
      );
    }

    if (requestedAuthorId !== null && targetUserId !== null && requestedAuthorId !== this.currentLinkedAuthorId) {
      request$ = request$.pipe(
        switchMap(() => this.authorsService.setAuthorUserLink(requestedAuthorId, targetUserId)),
      );
    }

    return request$;
  }

  private mapUserStatusToControl(isActive: boolean | null): UserStatusOption {
    return isActive === false ? 'inactive' : 'active';
  }

  private mapStatusControlToValue(status: UserStatusOption): boolean {
    return status === 'active';
  }

  private parseRouteId(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  private parseInputId(value: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value;
  }

  private normalizeForSearch(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private formatDisplayName(email: string): string {
    const localPart = email.split('@')[0]?.trim();
    if (!localPart) {
      return 'Usuario';
    }

    return localPart
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter((token) => token.length > 0)
      .map((token) => token[0].toUpperCase() + token.slice(1))
      .join(' ') || 'Usuario';
  }

  private getUserSaveErrorMessage(error: unknown): string {
    const message = this.extractErrorMessage(error);
    if (message) {
      return message;
    }

    return 'Nao foi possivel salvar o usuario.';
  }

  private extractErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }

    const record = error as Record<string, unknown>;
    const nested = record['error'];
    if (typeof nested === 'string' && nested.trim()) {
      return nested.trim();
    }

    if (nested && typeof nested === 'object') {
      const nestedRecord = nested as Record<string, unknown>;
      const nestedMessage = [
        nestedRecord['message'],
        nestedRecord['details'],
        nestedRecord['hint'],
        nestedRecord['error'],
        nestedRecord['erro'],
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ');

      if (nestedMessage) {
        return nestedMessage;
      }
    }

    return [
      record['message'],
      record['error'],
      record['erro'],
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ');
  }
}
