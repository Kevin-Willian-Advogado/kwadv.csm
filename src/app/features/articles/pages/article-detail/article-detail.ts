import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subject, catchError, debounceTime, distinctUntilChanged, finalize, map, of, switchMap, takeUntil } from 'rxjs';
import {
  ArticleEditorData,
  ArticleEditorAuthor,
  ArticleUpsertPayload,
  ArticlesService,
} from '../../../../core/articles.service';
import { AuthorsService, CurrentAuthorContext } from '../../../../core/authors.service';
import {
  ArticleEditorFormData,
  ArticleEditorValidationErrors,
  ARTICLE_STATUS_DRAFT,
  ARTICLE_STATUS_PROCESSING,
  ARTICLE_STATUS_PUBLISHED,
  createEmptyArticleEditorFormData,
} from '../../article-editor.models';
import { ArticleForm } from '../../componentes/article-form/article-form';
import {
  ArticlePipelineAction,
  ArticleSaveAction,
  ArticleTopbar,
} from '../../componentes/article-topbar/article-topbar';
import { ArticleTextEditor } from '../../componentes/article-text-editor/article-text-editor';
import { ToastNotification, ToastNotificationType } from '../../../../shared/toast-notification/toast-notification';

interface ArticleDetailToastState {
  kind: 'success' | 'error' | 'validation' | 'pipeline';
  type: ToastNotificationType;
  title: string;
  messages: string[];
  autoCloseMs: number;
}

type SlugValidationStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'error';

@Component({
  selector: 'app-article-detail',
  imports: [CommonModule, ArticleTopbar, ArticleForm, ArticleTextEditor, ToastNotification],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.css',
})
export class ArticleDetail implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly articlesService = inject(ArticlesService);
  private readonly authorsService = inject(AuthorsService);
  private readonly destroy$ = new Subject<void>();
  private readonly slugValidation$ = new Subject<{ slug: string; articleId: number | null }>();
  private readonly fallbackUpdatedBy = 10447;
  private readonly processingStatus = ARTICLE_STATUS_PROCESSING;

  article: ArticleEditorFormData = createEmptyArticleEditorFormData();
  categories: Array<{ id: number; name: string }> = [];
  currentAuthor: ArticleEditorAuthor | null = null;
  currentUserId: number | null = null;

  isLoadingArticle = false;
  isLoadingCategories = false;
  isLoadingCurrentAuthor = false;
  isSaving = false;
  isCreating = true;
  isDirty = false;
  pendingPipelineAction: ArticlePipelineAction | null = null;
  lastSavedAt: string | null = null;
  pipelineQueuedAt: string | null = null;
  validationErrors: ArticleEditorValidationErrors = {};
  toastState: ArticleDetailToastState | null = null;
  slugValidationStatus: SlugValidationStatus = 'idle';
  slugValidationMessage = '';
  private hasAttemptedSave = false;
  private lastValidatedSlug = '';

  ngOnInit(): void {
    this.listenSlugValidation();
    this.loadCurrentAuthorContext();
    this.loadCategories();
    this.listenRouteChanges();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get isLoading(): boolean {
    return this.isLoadingArticle || this.isLoadingCategories || this.isLoadingCurrentAuthor;
  }

  onSave(action: ArticleSaveAction): void {
    if (this.isSaving || this.isLoading) {
      return;
    }

    this.dismissToast();

    if (action === 'unpublish') {
      this.persistArticle(action);
      return;
    }

    this.hasAttemptedSave = true;
    this.prepareArticleForValidation();
    this.validationErrors = this.getValidationErrors();

    if (this.hasValidationErrors(this.validationErrors)) {
      this.showValidationToast(this.validationErrors);
      return;
    }

    this.isSaving = true;
    this.ensureSlugAvailableForSave()
      .pipe(
        switchMap((isAvailable) => {
          if (!isAvailable) {
            this.validationErrors = this.getValidationErrors();
            this.showValidationToast(this.validationErrors);
            return EMPTY;
          }

          const payload = this.buildPayload(action);
          return this.article.id
            ? this.articlesService.updateArticle(this.article.id, payload)
            : this.articlesService.createArticle(payload);
        }),
        finalize(() => (this.isSaving = false)),
      )
      .subscribe({
        next: (savedArticle) => this.handlePersistSuccess(savedArticle, action),
        error: (error: unknown) => this.handlePersistError(error),
      });
  }

  onFormDataChange(data: ArticleEditorFormData): void {
    this.article = { ...this.article, ...data };
    if (!this.isLoading && !this.isSaving) {
      this.isDirty = true;
    }

    this.revalidateForm();
    this.queueSlugValidation();
  }

  onContentChange(content: string): void {
    if (!this.isLoading && !this.isSaving && this.article.content !== content) {
      this.isDirty = true;
    }

    this.article = { ...this.article, content };
    this.revalidateForm();
  }

  dismissToast(): void {
    this.toastState = null;
  }

  private listenRouteChanges(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const slug = params.get('slug');
      const isSameArticle =
        slug !== null && this.normalizeSlug(this.article.slug) === this.normalizeSlug(slug);

      if (!slug) {
        this.isCreating = true;
        this.article = createEmptyArticleEditorFormData();
        this.isDirty = false;
        this.clearPipelineFeedback();
        this.lastSavedAt = null;
        this.clearValidationState();
        this.resetSlugValidationState();
        this.dismissToast();
        this.applyCurrentAuthorAsDefault();
        return;
      }

      if (!isSameArticle) {
        this.clearPipelineFeedback();
      }

      this.isCreating = false;
      this.loadArticle(slug, isSameArticle && this.toastState?.kind === 'pipeline');
    });
  }

  private loadCategories(): void {
    this.isLoadingCategories = true;

    this.articlesService
      .getCategories()
      .pipe(finalize(() => (this.isLoadingCategories = false)))
      .subscribe({
        next: (categories) => {
          this.categories = categories;
        },
        error: (error: unknown) => {
          console.error('Erro ao carregar categorias:', error);
          this.showErrorToast('Nao foi possivel carregar as categorias.');
        },
      });
  }

  private loadCurrentAuthorContext(): void {
    this.isLoadingCurrentAuthor = true;

    this.authorsService
      .getCurrentAuthorContext()
      .pipe(finalize(() => (this.isLoadingCurrentAuthor = false)))
      .subscribe({
        next: (context) => {
          this.applyCurrentAuthorContext(context);
        },
        error: (error: unknown) => {
          console.error('Erro ao carregar autor do usuario logado:', error);
          this.showErrorToast('Nao foi possivel carregar o autor vinculado ao usuario logado.');
        },
      });
  }

  private loadArticle(slug: string, preserveToast = false): void {
    this.isLoadingArticle = true;
    if (!preserveToast) {
      this.dismissToast();
    }

    this.articlesService
      .getArticleBySlug(slug)
      .pipe(finalize(() => (this.isLoadingArticle = false)))
      .subscribe({
        next: (article) => {
          if (!article) {
            this.showErrorToast('Artigo nao encontrado para o slug informado.');
            return;
          }

          this.article = this.mapToFormData(article);
          this.lastSavedAt = article.updatedAt;
          this.isDirty = false;
          this.syncPipelineFeedbackFromArticle(article);
          this.clearValidationState();
          this.queueSlugValidation();
        },
        error: (error: unknown) => {
          console.error('Erro ao carregar artigo:', error);
          this.showErrorToast('Nao foi possivel carregar o artigo.');
        },
      });
  }

  private mapToFormData(article: ArticleEditorData): ArticleEditorFormData {
    return {
      ...article,
      id: article.id,
    };
  }

  private revalidateForm(): void {
    if (!this.hasAttemptedSave) {
      return;
    }

    this.prepareArticleForValidation();
    this.validationErrors = this.getValidationErrors();

    if (this.hasValidationErrors(this.validationErrors)) {
      this.showValidationToast(this.validationErrors);
      return;
    }

    if (this.toastState?.kind === 'validation') {
      this.dismissToast();
    }
  }

  private buildPayload(action: ArticleSaveAction): ArticleUpsertPayload {
    const actorId = this.currentUserId ?? this.fallbackUpdatedBy;
    const saveTimestamp = new Date().toISOString();
    const status =
      action === 'publish' || action === 'unpublish' ? ARTICLE_STATUS_PROCESSING : ARTICLE_STATUS_DRAFT;
    const publishedAt =
      action === 'publish'
        ? this.article.publishedAt ?? saveTimestamp
        : action === 'unpublish'
          ? null
          : this.article.publishedAt;
    const publishedBy = action === 'publish' ? actorId : action === 'unpublish' ? null : undefined;

    const selectedCategoryName = this.categories.find(
      (category) => category.id === this.article.categoryId,
    )?.name;
    if (selectedCategoryName) {
      this.article.categoryName = selectedCategoryName;
    }

    return {
      title: this.article.title.trim(),
      subtitle: this.article.subtitle.trim(),
      slug: this.normalizeSlug(this.article.slug || this.article.title),
      coverImageUrl: this.article.coverImageUrl.trim(),
      content: this.article.content,
      metaDescription: this.article.metaDescription.trim(),
      categoryId: this.article.categoryId,
      authorIds: this.article.authors
        .map((author) => author.id)
        .filter((authorId) => typeof authorId === 'number' && !Number.isNaN(authorId) && authorId > 0),
      relatedArticleIds: this.article.relatedArticles
        .map((relatedArticle) => relatedArticle.id)
        .filter((relatedArticleId) => typeof relatedArticleId === 'number' && !Number.isNaN(relatedArticleId) && relatedArticleId > 0),
      status,
      highlights: this.article.highlights,
      publishedAt,
      publishedBy,
      views: this.article.id ? undefined : 0,
      createdAt: this.article.id ? undefined : saveTimestamp,
      createdBy: this.article.id ? undefined : actorId,
      updatedAt: saveTimestamp,
      updatedBy: actorId,
    };
  }

  private prepareArticleForValidation(): void {
    this.article.slug = this.normalizeSlug(this.article.slug || this.article.title);
  }

  private getValidationErrors(): ArticleEditorValidationErrors {
    const errors: ArticleEditorValidationErrors = {};

    if (!this.article.title.trim()) {
      errors.title = 'Informe o titulo do artigo.';
    }

    if (!this.article.subtitle.trim()) {
      errors.subtitle = 'Informe o subtitulo do artigo.';
    }

    if (this.article.categoryId === null) {
      errors.categoryId = 'Selecione uma categoria.';
    }

    if (!this.article.slug.trim() || !this.isValidSlug(this.article.slug)) {
      errors.slug = 'Informe um slug valido.';
    } else if (this.isCurrentSlugUnavailable()) {
      errors.slug = 'Ja existe um artigo com este slug.';
    } else if (this.isCurrentSlugValidationErrored()) {
      errors.slug = 'Nao foi possivel validar a disponibilidade do slug.';
    }

    if (!this.article.coverImageUrl.trim()) {
      errors.coverImageUrl = 'Informe uma capa para o artigo.';
    }

    if (!this.article.metaDescription.trim()) {
      errors.metaDescription = 'Informe a meta description.';
    }

    if (!Array.isArray(this.article.authors) || this.article.authors.length === 0) {
      errors.authors = 'Adicione ao menos um autor.';
    }

    return errors;
  }

  private normalizeSlug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private isValidSlug(value: string): boolean {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim());
  }

  private hasValidationErrors(errors: ArticleEditorValidationErrors): boolean {
    return Object.keys(errors).length > 0;
  }

  private clearValidationState(): void {
    this.validationErrors = {};
    this.hasAttemptedSave = false;
  }

  private listenSlugValidation(): void {
    this.slugValidation$
      .pipe(
        map(({ slug, articleId }) => ({
          slug: this.normalizeSlug(slug),
          articleId,
        })),
        debounceTime(350),
        distinctUntilChanged(
          (previous, current) => previous.slug === current.slug && previous.articleId === current.articleId,
        ),
        switchMap(({ slug, articleId }) => {
          if (!slug || !this.isValidSlug(slug)) {
            this.resetSlugValidationState();
            return EMPTY;
          }

          this.setSlugValidationState('checking', slug, '');

          return this.articlesService.isSlugAvailable(slug, articleId).pipe(
            map((isAvailable) => ({
              slug,
              isAvailable,
            })),
            catchError((error: unknown) => {
              if (!this.isCurrentSlug(slug)) {
                return EMPTY;
              }

              console.error('Erro ao validar slug:', error);
              this.setSlugValidationState('error', slug, 'Nao foi possivel validar a disponibilidade do slug.');
              return EMPTY;
            }),
          );
        }),
        takeUntil(this.destroy$),
      )
      .subscribe(({ slug, isAvailable }) => {
        if (!this.isCurrentSlug(slug)) {
          return;
        }

        if (isAvailable) {
          this.setSlugValidationState('available', slug, '');
          return;
        }

        this.setSlugValidationState('unavailable', slug, 'Ja existe um artigo com este slug.');
      });
  }

  private queueSlugValidation(): void {
    const slug = this.normalizeSlug(this.article.slug || this.article.title);
    if (!slug || !this.isValidSlug(slug)) {
      this.resetSlugValidationState();
      this.slugValidation$.next({ slug: '', articleId: this.article.id });
      return;
    }

    if (slug !== this.lastValidatedSlug || this.slugValidationStatus === 'unavailable' || this.slugValidationStatus === 'error') {
      this.setSlugValidationState('checking', slug, '');
    }

    this.slugValidation$.next({
      slug,
      articleId: this.article.id,
    });
  }

  private ensureSlugAvailableForSave() {
    const slug = this.normalizeSlug(this.article.slug);
    if (!slug || !this.isValidSlug(slug)) {
      return of(false);
    }

    if (this.isCurrentSlugAvailable()) {
      return of(true);
    }

    this.setSlugValidationState('checking', slug, '');

    return this.articlesService.isSlugAvailable(slug, this.article.id).pipe(
      map((isAvailable) => {
        this.setSlugValidationState(
          isAvailable ? 'available' : 'unavailable',
          slug,
          isAvailable ? '' : 'Ja existe um artigo com este slug.',
        );
        return isAvailable;
      }),
      catchError((error: unknown) => {
        console.error('Erro ao validar slug antes do salvamento:', error);
        this.setSlugValidationState('error', slug, 'Nao foi possivel validar a disponibilidade do slug.');
        return of(false);
      }),
    );
  }

  private persistArticle(action: ArticleSaveAction): void {
    const payload = this.buildPayload(action);
    this.isSaving = true;

    const request$ = this.article.id
      ? this.articlesService.updateArticle(this.article.id, payload)
      : this.articlesService.createArticle(payload);

    request$.pipe(finalize(() => (this.isSaving = false))).subscribe({
      next: (savedArticle) => this.handlePersistSuccess(savedArticle, action),
      error: (error: unknown) => this.handlePersistError(error),
    });
  }

  private handlePersistSuccess(savedArticle: ArticleEditorData, action: ArticleSaveAction): void {
    const wasCreating = !this.article.id;
    const savedAt = savedArticle.updatedAt ?? new Date().toISOString();

    this.article = this.mapToFormData(savedArticle);
    this.isCreating = false;
    this.isDirty = false;
    this.lastSavedAt = savedAt;
    this.clearValidationState();
    this.queueSlugValidation();
    this.updatePipelineFeedback(action, savedAt);
    this.showPersistSuccessToast(action);

    if (wasCreating) {
      this.router.navigate(['/artigos', this.article.slug], { replaceUrl: true });
    }
  }

  private handlePersistError(error: unknown): void {
    console.error('Erro ao salvar artigo:', error);
    if (this.isDuplicateSlugError(error)) {
      this.setSlugValidationState('unavailable', this.article.slug, 'Ja existe um artigo com este slug.');
      this.validationErrors = this.getValidationErrors();
      this.showValidationToast(this.validationErrors);
      return;
    }

    this.showErrorToast(this.getSaveErrorMessage(error));
  }

  private updatePipelineFeedback(action: ArticleSaveAction, savedAt: string): void {
    if (action === 'publish' || action === 'unpublish') {
      this.pendingPipelineAction = action;
      this.pipelineQueuedAt = savedAt;
      return;
    }

    this.clearPipelineFeedback();
  }

  private clearPipelineFeedback(): void {
    this.pendingPipelineAction = null;
    this.pipelineQueuedAt = null;
  }

  private syncPipelineFeedbackFromArticle(article: ArticleEditorData): void {
    if (article.status !== this.processingStatus) {
      this.clearPipelineFeedback();
      return;
    }

    this.pendingPipelineAction = article.publishedAt ? 'publish' : 'unpublish';
    this.pipelineQueuedAt = article.updatedAt ?? article.publishedAt ?? new Date().toISOString();
  }

  private showPersistSuccessToast(action: ArticleSaveAction): void {
    if (action === 'publish') {
      this.showPublishQueuedToast();
      return;
    }

    if (action === 'unpublish') {
      this.showUnpublishQueuedToast();
      return;
    }

    this.showSuccessToast('Artigo salvo como rascunho com sucesso.');
  }

  private setSlugValidationState(status: SlugValidationStatus, slug: string, message: string): void {
    this.slugValidationStatus = status;
    this.lastValidatedSlug = this.normalizeSlug(slug);
    this.slugValidationMessage = message;

    if (this.hasAttemptedSave) {
      this.validationErrors = this.getValidationErrors();
    }
  }

  private resetSlugValidationState(): void {
    this.slugValidationStatus = 'idle';
    this.slugValidationMessage = '';
    this.lastValidatedSlug = '';

    if (this.hasAttemptedSave) {
      this.validationErrors = this.getValidationErrors();
    }
  }

  private isCurrentSlugAvailable(): boolean {
    return this.slugValidationStatus === 'available' && this.lastValidatedSlug === this.normalizeSlug(this.article.slug);
  }

  private isCurrentSlugUnavailable(): boolean {
    return this.slugValidationStatus === 'unavailable' && this.lastValidatedSlug === this.normalizeSlug(this.article.slug);
  }

  private isCurrentSlugValidationErrored(): boolean {
    return this.slugValidationStatus === 'error' && this.lastValidatedSlug === this.normalizeSlug(this.article.slug);
  }

  private isDuplicateSlugError(error: unknown): boolean {
    const response = (error ?? {}) as {
      error?: string | { message?: string; details?: string; hint?: string; error?: string };
      message?: string;
      details?: string;
      hint?: string;
    };

    const nestedError =
      typeof response.error === 'object' && response.error !== null
        ? [response.error.error, response.error.message, response.error.details, response.error.hint]
        : [];

    return [typeof response.error === 'string' ? response.error : null, response.message, response.details, response.hint, ...nestedError]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => {
        const normalizedValue = value.toLowerCase();
        return normalizedValue.includes('slug') && (normalizedValue.includes('duplicate') || normalizedValue.includes('unique'));
      });
  }

  private isCurrentSlug(slug: string): boolean {
    return this.normalizeSlug(this.article.slug || this.article.title) === this.normalizeSlug(slug);
  }

  private applyCurrentAuthorContext(context: CurrentAuthorContext): void {
    this.currentUserId = context.userId;
    this.currentAuthor = context.author;
    this.applyCurrentAuthorAsDefault();
  }

  private applyCurrentAuthorAsDefault(): void {
    if (!this.isCreating || !this.currentAuthor || this.article.authors.length > 0) {
      return;
    }

    this.article = {
      ...this.article,
      authors: [this.currentAuthor],
    };
  }

  private showSuccessToast(message: string): void {
    this.toastState = {
      kind: 'success',
      type: 'success',
      title: 'Tudo certo',
      messages: [message],
      autoCloseMs: 4000,
    };
  }

  private showPublishQueuedToast(): void {
    this.toastState = {
      kind: 'pipeline',
      type: 'info',
      title: 'Publicacao em processamento',
      messages: [
        'O artigo entrou no fluxo de publicacao.',
        'O status ficara como Processando ate o rebuild e o deploy terminarem.',
      ],
      autoCloseMs: 0,
    };
  }

  private showUnpublishQueuedToast(): void {
    this.toastState = {
      kind: 'pipeline',
      type: 'info',
      title: 'Remocao em processamento',
      messages: [
        'O artigo entrou no fluxo de remocao da publicacao.',
        'O status ficara como Processando ate o rebuild e o deploy terminarem.',
      ],
      autoCloseMs: 0,
    };
  }

  private showErrorToast(message: string): void {
    this.toastState = {
      kind: 'error',
      type: 'error',
      title: 'Algo deu errado',
      messages: [message],
      autoCloseMs: 0,
    };
  }

  private getSaveErrorMessage(error: unknown): string {
    const response = (error ?? {}) as {
      error?: string | { message?: string; details?: string; hint?: string; code?: string };
      message?: string;
      details?: string;
      hint?: string;
      status?: number;
    };

    const nested =
      typeof response.error === 'object' && response.error !== null
        ? response.error
        : null;

    const parts = [
      typeof response.error === 'string' ? response.error : null,
      response.message,
      response.details,
      response.hint,
      nested?.message,
      nested?.details,
      nested?.hint,
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (parts.length === 0) {
      return 'Nao foi possivel salvar o artigo. Tente novamente.';
    }

    return `Nao foi possivel salvar o artigo. ${parts[0]}`;
  }

  private showValidationToast(errors: ArticleEditorValidationErrors): void {
    this.toastState = {
      kind: 'validation',
      type: 'error',
      title: 'Revise o formulario antes de salvar',
      messages: this.getValidationMessages(errors),
      autoCloseMs: 0,
    };
  }

  private getValidationMessages(errors: ArticleEditorValidationErrors): string[] {
    return Object.values(errors).filter((message): message is string => typeof message === 'string');
  }
}
