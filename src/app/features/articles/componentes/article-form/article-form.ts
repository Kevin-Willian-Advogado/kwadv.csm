import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArticleEditorAuthor, ArticleEditorCategory, ArticleEditorRelatedArticle } from '../../../../core/articles.service';
import { ArticleEditorFormData, ArticleEditorValidationErrors } from '../../article-editor.models';
import { ArticleAuthorModal } from '../../../../shared/modal/article-author-modal/article-author-modal';
import { ArticleRelatedModal } from '../../../../shared/modal/article-related-modal/article-related-modal';

@Component({
  selector: 'app-article-form',
  imports: [CommonModule, FormsModule, ArticleAuthorModal, ArticleRelatedModal],
  templateUrl: './article-form.html',
  styleUrl: './article-form.css',
})
export class ArticleForm implements OnChanges {
  @Input({ required: true }) formData!: ArticleEditorFormData;
  @Input() categories: ArticleEditorCategory[] = [];
  @Input() currentAuthor: ArticleEditorAuthor | null = null;
  @Input() isSaving = false;
  @Input() isUploadingCoverImage = false;
  @Input() validationErrors: ArticleEditorValidationErrors = {};
  @Input() slugValidationStatus: 'idle' | 'checking' | 'available' | 'unavailable' | 'error' = 'idle';
  @Input() slugValidationMessage = '';
  @Output() formDataChange = new EventEmitter<ArticleEditorFormData>();
  @Output() coverImageFileSelected = new EventEmitter<File>();
  @ViewChild('categoryContainer') private categoryContainer?: ElementRef<HTMLElement>;

  readonly fallbackCoverImageUrl = 'https://placehold.co/1200x630/e2e8f0/64748b?text=Sem+Imagem';
  readonly fallbackRelatedArticleImageUrl = this.fallbackCoverImageUrl;
  readonly acceptedImageTypes = 'image/png,image/jpeg,image/webp,image/gif';
  categoryOpen = false;
  isAuthorModalOpen = false;
  isRelatedArticleModalOpen = false;
  private slugWasEditedManually = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['formData'] && this.formData) {
      this.slugWasEditedManually = this.shouldKeepManualSlug(this.formData.title, this.formData.slug);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.categoryOpen || !this.categoryContainer) {
      return;
    }

    const clickedInside = this.categoryContainer.nativeElement.contains(event.target as Node);
    if (!clickedInside) {
      this.categoryOpen = false;
    }
  }

  onTitleChange(value: string): void {
    this.formData.title = value;

    if (!this.slugWasEditedManually) {
      this.formData.slug = this.slugify(value);
    }

    this.emitChange();
  }

  onSubtitleChange(value: string): void {
    this.formData.subtitle = value;
    this.emitChange();
  }

  openCategories(): void {
    if (this.isSaving) {
      return;
    }

    this.categoryOpen = !this.categoryOpen;
  }

  closeCategories(categorySelected: number): void {
    this.categoryOpen = false;
    this.selectCategory(categorySelected);
  }

  onCategoryChange(value: string): void {
    const selectedCategoryId = Number(value);
    if (Number.isNaN(selectedCategoryId)) {
      this.selectCategory(null);
      return;
    }

    this.selectCategory(selectedCategoryId);
  }

  onCoverImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (input) {
      input.value = '';
    }

    if (!file || this.isSaving || this.isUploadingCoverImage) {
      return;
    }

    this.coverImageFileSelected.emit(file);
  }

  onSlugChange(value: string): void {
    this.formData.slug = value;
    this.slugWasEditedManually = this.shouldKeepManualSlug(this.formData.title, value);
    this.emitChange();
  }

  normalizeSlug(): void {
    this.formData.slug = this.slugify(this.formData.slug || this.formData.title);
    this.slugWasEditedManually = this.shouldKeepManualSlug(this.formData.title, this.formData.slug);
    this.emitChange();
  }

  onMetaDescriptionChange(value: string): void {
    this.formData.metaDescription = value;
    this.emitChange();
  }

  hasError(field: keyof ArticleEditorValidationErrors): boolean {
    return typeof this.validationErrors[field] === 'string';
  }

  hasSlugFeedbackError(): boolean {
    return this.hasError('slug') || this.slugValidationStatus === 'unavailable' || this.slugValidationStatus === 'error';
  }

  getSlugFeedbackMessage(): string {
    if (this.hasError('slug')) {
      return this.validationErrors.slug ?? '';
    }

    if (this.slugValidationStatus === 'unavailable' || this.slugValidationStatus === 'error') {
      return this.slugValidationMessage;
    }

    if (this.slugValidationStatus === 'checking') {
      return 'Verificando disponibilidade da URL...';
    }

    return '';
  }

  getInputClasses(field: keyof ArticleEditorValidationErrors): string {
    return [
      'w-full rounded-md border px-4 py-2 text-sm placeholder-slate-400 transition focus:outline-none focus:ring-2 disabled:opacity-70',
      this.hasError(field)
        ? 'border-red-300 focus:ring-red-100'
        : 'border-slate-300 focus:ring-slate-300/70',
    ].join(' ');
  }

  getCategoryButtonClasses(): string {
    return [
      'w-full bg-white border rounded-lg px-4 py-2 text-left flex items-center justify-between gap-2 cursor-pointer transition focus:outline-none focus:ring-2 disabled:opacity-70 disabled:cursor-not-allowed',
      this.hasError('categoryId')
        ? 'border-red-300 focus:ring-red-100'
        : 'border-slate-300 focus:ring-slate-300/70',
    ].join(' ');
  }

  getAuthorsContainerClasses(): string {
    return [
      'rounded-md border border-dashed px-4 py-4 text-sm',
      this.hasError('authors') ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-300 bg-slate-50 text-slate-500',
    ].join(' ');
  }

  clearCoverImage(): void {
    if (this.isSaving || this.isUploadingCoverImage) {
      return;
    }

    this.formData.coverImageUrl = '';
    this.emitChange();
  }

  canAddAuthor(): boolean {
    return this.formData.authors.length < 3;
  }

  get selectedAuthorIds(): number[] {
    return this.formData.authors.map((author) => author.id);
  }

  openAuthorModal(): void {
    if (this.isSaving || !this.canAddAuthor()) {
      return;
    }

    this.isAuthorModalOpen = true;
  }

  closeAuthorModal(): void {
    this.isAuthorModalOpen = false;
  }

  addAuthor(author: ArticleEditorAuthor): void {
    if (this.formData.authors.some((existingAuthor) => existingAuthor.id === author.id)) {
      this.closeAuthorModal();
      return;
    }

    this.formData.authors = [...this.formData.authors, author];
    this.closeAuthorModal();
    this.emitChange();
  }

  removeAuthor(authorId: number): void {
    this.formData.authors = this.formData.authors.filter((author) => author.id !== authorId);
    this.emitChange();
  }

  isCurrentAuthor(authorId: number): boolean {
    return this.currentAuthor?.id === authorId;
  }

  canAddRelatedArticle(): boolean {
    return this.formData.relatedArticles.length < 3;
  }

  get selectedRelatedArticleIds(): number[] {
    return this.formData.relatedArticles.map((article) => article.id);
  }

  openRelatedArticleModal(): void {
    if (this.isSaving || !this.canAddRelatedArticle()) {
      return;
    }

    this.isRelatedArticleModalOpen = true;
  }

  closeRelatedArticleModal(): void {
    this.isRelatedArticleModalOpen = false;
  }

  addRelatedArticle(article: ArticleEditorRelatedArticle): void {
    if (
      this.formData.relatedArticles.length >= 3 ||
      article.id === this.formData.id ||
      this.formData.relatedArticles.some((relatedArticle) => relatedArticle.id === article.id)
    ) {
      return;
    }

    const relatedArticles = [...this.formData.relatedArticles, article];
    this.formData.relatedArticles = relatedArticles;

    if (relatedArticles.length >= 3) {
      this.closeRelatedArticleModal();
    }

    this.emitChange();
  }

  removeRelatedArticle(articleId: number): void {
    this.formData.relatedArticles = this.formData.relatedArticles.filter((article) => article.id !== articleId);
    this.emitChange();
  }

  private emitChange(): void {
    this.formDataChange.emit({ ...this.formData });
  }

  private selectCategory(categoryId: number | null): void {
    if (categoryId === null) {
      this.formData.categoryId = null;
      this.formData.categoryName = '';
      this.emitChange();
      return;
    }

    this.formData.categoryId = categoryId;
    this.formData.categoryName = this.categories.find((category) => category.id === categoryId)?.name ?? '';
    this.emitChange();
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private shouldKeepManualSlug(title: string, slug: string): boolean {
    const normalizedSlug = this.slugify(slug);
    if (!normalizedSlug) {
      return false;
    }

    return normalizedSlug !== this.slugify(title);
  }
}
