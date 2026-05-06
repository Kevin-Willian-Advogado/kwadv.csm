import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize, forkJoin, of } from 'rxjs';

import { AuthorListItem, AuthorsService, AuthorUpsertPayload } from '../../../../core/authors.service';
import { ImageStorageService } from '../../../../core/image-storage.service';

@Component({
  selector: 'app-author-detail',
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: './author-detail.html',
  styleUrl: './author-detail.css',
})
export class AuthorDetail implements OnInit, OnChanges, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly authorsService = inject(AuthorsService);
  private readonly imageStorageService = inject(ImageStorageService);

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    headline: ['', [Validators.required, Validators.maxLength(180)]],
    profileImageUrl: [''],
    linkedinUrl: ['', [Validators.maxLength(500)]],
    websiteUrl: ['', [Validators.maxLength(500)]],
    userId: [null as number | null],
  });
  readonly acceptedImageTypes = 'image/png,image/jpeg,image/webp,image/gif';

  @Input() modalMode = false;
  @Input() selectedAuthorId: number | null | undefined = undefined;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<AuthorListItem>();
  @Output() deleted = new EventEmitter<void>();

  authorId: number | null = null;
  currentAuthor: AuthorListItem | null = null;
  articleCount = 0;
  isCreating = true;
  isLoading = true;
  isSaving = false;
  isDeleting = false;
  isUploadingImage = false;
  errorMessage = '';
  feedbackMessage = '';
  private draftUploadedImageUrls = new Set<string>();
  private persistedImageUrlsToDeleteOnSave = new Set<string>();
  private isDestroyed = false;

  ngOnInit(): void {
    this.loadAuthor();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedAuthorId'] && !changes['selectedAuthorId'].firstChange) {
      this.loadAuthor();
    }
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.deleteDraftImagesExcept('');
    this.persistedImageUrlsToDeleteOnSave.clear();
  }

  get previewImageUrl(): string {
    const value = this.form.controls.profileImageUrl.value.trim();
    return value || '/images/avatar-placeholder.png';
  }

  get hasProfileImage(): boolean {
    return this.form.controls.profileImageUrl.value.trim().length > 0;
  }

  get linkedinUrl(): string {
    return this.form.controls.linkedinUrl.value.trim();
  }

  get websiteUrl(): string {
    return this.form.controls.websiteUrl.value.trim();
  }

  closeDetail(): void {
    if (this.modalMode) {
      this.closed.emit();
      return;
    }

    this.router.navigate(['/autores']);
  }

  saveAuthor(): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.isSaving = true;

    const payload: AuthorUpsertPayload = {
      name: this.form.controls.name.value.trim(),
      headline: this.form.controls.headline.value.trim(),
      profileImageUrl: this.form.controls.profileImageUrl.value.trim(),
      linkedinUrl: this.form.controls.linkedinUrl.value.trim(),
      websiteUrl: this.form.controls.websiteUrl.value.trim(),
      userId: this.currentAuthor?.userId ?? null,
    };

    const request$ = this.isCreating || this.authorId === null
      ? this.authorsService.createAuthor(payload)
      : this.authorsService.updateAuthor(this.authorId, payload);

    request$
      .pipe(finalize(() => {
        this.isSaving = false;
      }))
      .subscribe({
        next: (author) => {
          this.currentAuthor = author;
          this.authorId = author.id;
          this.isCreating = false;
          this.commitImageChanges(author.profileImageUrl);
          this.feedbackMessage = 'Autor salvo com sucesso.';
          this.saved.emit(author);
          if (!this.modalMode) {
            this.router.navigate(['/autores', author.id]);
          }
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel salvar o autor.';
          console.error('Erro ao salvar autor:', error);
        },
      });
  }

  onProfileImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (input) {
      input.value = '';
    }

    if (!file || this.isSaving || this.isUploadingImage) {
      return;
    }

    this.errorMessage = '';
    this.feedbackMessage = '';
    this.isUploadingImage = true;
    const previousImageUrl = this.form.controls.profileImageUrl.value.trim();

    this.imageStorageService
      .uploadAuthorImage(file, this.authorId)
      .pipe(finalize(() => {
        this.isUploadingImage = false;
      }))
      .subscribe({
        next: (imageUrl) => {
          if (this.isDestroyed) {
            this.deleteStorageImage(imageUrl, 'rascunho');
            return;
          }

          this.form.controls.profileImageUrl.setValue(imageUrl);
          this.form.controls.profileImageUrl.markAsDirty();
          this.draftUploadedImageUrls.add(imageUrl);
          this.handleReplacedImage(previousImageUrl, imageUrl);
          this.feedbackMessage = 'Imagem enviada. Salve o autor para manter a nova foto.';
        },
        error: (error: unknown) => {
          this.errorMessage = this.getImageUploadErrorMessage(error);
          console.error('Erro ao enviar imagem do autor:', error);
        },
      });
  }

  removeProfileImage(): void {
    if (!this.hasProfileImage || this.isSaving || this.isUploadingImage) {
      return;
    }

    const currentImageUrl = this.form.controls.profileImageUrl.value.trim();
    if (this.draftUploadedImageUrls.has(currentImageUrl)) {
      this.deleteDraftImage(currentImageUrl);
    } else {
      this.queuePersistedImageDeletion(currentImageUrl);
    }

    this.form.controls.profileImageUrl.setValue('');
    this.form.controls.profileImageUrl.markAsDirty();
    this.errorMessage = '';
    this.feedbackMessage = 'Foto removida. Salve o autor para manter sem imagem.';
  }

  deleteAuthor(): void {
    if (this.authorId === null || this.isCreating || this.isDeleting || this.isUploadingImage) {
      return;
    }

    const shouldDelete = window.confirm('Deseja realmente excluir este autor?');
    if (!shouldDelete) {
      return;
    }

    this.isDeleting = true;
    this.errorMessage = '';
    this.feedbackMessage = '';

    this.authorsService.deleteAuthor(this.authorId)
      .pipe(finalize(() => {
        this.isDeleting = false;
      }))
      .subscribe({
        next: () => {
          this.deleted.emit();
          if (this.modalMode) {
            this.closed.emit();
          } else {
            this.router.navigate(['/autores']);
          }
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel excluir o autor.';
          console.error('Erro ao excluir autor:', error);
        },
      });
  }

  private loadAuthor(): void {
    this.deleteDraftImagesExcept('');
    this.isLoading = true;
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.persistedImageUrlsToDeleteOnSave.clear();

    const authorId = this.selectedAuthorId !== undefined
      ? this.parseInputId(this.selectedAuthorId)
      : this.parseRouteId(this.route.snapshot.paramMap.get('id'));
    this.authorId = authorId;
    this.isCreating = authorId === null;

    forkJoin({
      author: authorId === null ? of(null) : this.authorsService.getAuthorById(authorId),
      articleCount: authorId === null ? of(0) : this.authorsService.getArticleCountByAuthorId(authorId),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
      }))
      .subscribe({
        next: ({ author, articleCount }) => {
          this.currentAuthor = author;
          this.articleCount = articleCount;

          if (!this.isCreating && !author) {
            this.errorMessage = 'Autor nao encontrado.';
            return;
          }

          this.form.patchValue({
            name: author?.name ?? '',
            headline: author?.headline ?? '',
            profileImageUrl: author?.profileImageUrl ?? '',
            linkedinUrl: author?.linkedinUrl ?? '',
            websiteUrl: author?.websiteUrl ?? '',
            userId: author?.userId ?? null,
          });
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar o cadastro do autor.';
          console.error('Erro ao carregar autor:', error);
        },
      });
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

  private getImageUploadErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      const errorBody = record['error'];

      if (errorBody && typeof errorBody === 'object') {
        const message = (errorBody as Record<string, unknown>)['message'];
        if (typeof message === 'string' && message.trim()) {
          return message.trim();
        }
      }

      const message = record['message'];
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }

    return 'Nao foi possivel enviar a imagem.';
  }

  private handleReplacedImage(previousImageUrl: string, newImageUrl: string): void {
    const normalizedPreviousUrl = previousImageUrl.trim();
    const normalizedNewUrl = newImageUrl.trim();

    if (!normalizedPreviousUrl || normalizedPreviousUrl === normalizedNewUrl) {
      return;
    }

    if (this.draftUploadedImageUrls.has(normalizedPreviousUrl)) {
      this.deleteDraftImage(normalizedPreviousUrl);
      return;
    }

    this.queuePersistedImageDeletion(normalizedPreviousUrl);
  }

  private queuePersistedImageDeletion(imageUrl: string): void {
    const normalizedImageUrl = imageUrl.trim();
    if (!normalizedImageUrl) {
      return;
    }

    this.persistedImageUrlsToDeleteOnSave.add(normalizedImageUrl);
  }

  private commitImageChanges(currentImageUrl: string): void {
    this.deleteDraftImagesExcept(currentImageUrl);
    this.deletePersistedImagesExcept(currentImageUrl);
  }

  private deletePersistedImagesExcept(currentImageUrl: string): void {
    const normalizedCurrentUrl = currentImageUrl.trim();
    const urlsToDelete = Array.from(this.persistedImageUrlsToDeleteOnSave)
      .map((imageUrl) => imageUrl.trim())
      .filter((imageUrl) => imageUrl && imageUrl !== normalizedCurrentUrl);

    this.persistedImageUrlsToDeleteOnSave.clear();

    for (const imageUrl of urlsToDelete) {
      this.deleteStorageImage(imageUrl, 'persistida');
    }
  }

  private deleteDraftImagesExcept(currentImageUrl: string): void {
    const normalizedCurrentUrl = currentImageUrl.trim();
    const urlsToDelete = Array.from(this.draftUploadedImageUrls)
      .map((imageUrl) => imageUrl.trim())
      .filter((imageUrl) => imageUrl && imageUrl !== normalizedCurrentUrl);

    this.draftUploadedImageUrls.clear();

    for (const imageUrl of urlsToDelete) {
      this.deleteStorageImage(imageUrl, 'rascunho');
    }
  }

  private deleteDraftImage(imageUrl: string): void {
    const normalizedImageUrl = imageUrl.trim();
    if (!normalizedImageUrl || !this.draftUploadedImageUrls.delete(normalizedImageUrl)) {
      return;
    }

    this.deleteStorageImage(normalizedImageUrl, 'rascunho');
  }

  private deleteStorageImage(imageUrl: string, imageState: 'persistida' | 'rascunho'): void {
    this.imageStorageService.deleteImageByPublicUrl(imageUrl).subscribe({
      error: (error: unknown) => {
        console.warn(`Nao foi possivel remover a imagem ${imageState} do autor:`, error);
      },
    });
  }

}
