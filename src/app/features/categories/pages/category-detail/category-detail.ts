import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, of } from 'rxjs';

import { ArticleListItem, ArticlesService } from '../../../../core/articles.service';
import { CategoriesService, CategoryListItem, CategoryUpsertPayload } from '../../../../core/categories.service';

@Component({
  selector: 'app-category-detail',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './category-detail.html',
  styleUrl: './category-detail.css',
})
export class CategoryDetail implements OnInit, OnChanges {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly categoriesService = inject(CategoriesService);
  private readonly articlesService = inject(ArticlesService);

  readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: ['', [Validators.maxLength(280)]],
  });

  @Input() modalMode = false;
  @Input() selectedCategoryId: number | null | undefined = undefined;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<CategoryListItem>();
  @Output() deleted = new EventEmitter<void>();

  categoryId: number | null = null;
  currentCategory: CategoryListItem | null = null;
  relatedArticleCount = 0;
  isCreating = true;
  isLoading = true;
  isSaving = false;
  isDeleting = false;
  errorMessage = '';
  feedbackMessage = '';

  ngOnInit(): void {
    this.loadCategory();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedCategoryId'] && !changes['selectedCategoryId'].firstChange) {
      this.loadCategory();
    }
  }

  closeDetail(): void {
    if (this.modalMode) {
      this.closed.emit();
      return;
    }

    this.router.navigate(['/categorias']);
  }

  saveCategory(): void {
    this.errorMessage = '';
    this.feedbackMessage = '';
    this.form.markAllAsTouched();

    if (this.form.invalid) {
      return;
    }

    this.isSaving = true;

    const payload: CategoryUpsertPayload = {
      name: this.form.controls.name.value.trim(),
      description: this.form.controls.description.value.trim(),
    };

    const request$ = this.isCreating || this.categoryId === null
      ? this.categoriesService.createCategory(payload)
      : this.categoriesService.updateCategory(this.categoryId, payload);

    request$
      .pipe(finalize(() => {
        this.isSaving = false;
      }))
      .subscribe({
        next: (category) => {
          this.currentCategory = category;
          this.categoryId = category.id;
          this.isCreating = false;
          this.feedbackMessage = 'Categoria salva com sucesso.';
          this.saved.emit(category);
          if (!this.modalMode) {
            this.router.navigate(['/categorias', category.id]);
          }
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel salvar a categoria.';
          console.error('Erro ao salvar categoria:', error);
        },
      });
  }

  deleteCategory(): void {
    if (this.categoryId === null || this.isCreating || this.isDeleting) {
      return;
    }

    const shouldDelete = window.confirm('Deseja realmente excluir esta categoria?');
    if (!shouldDelete) {
      return;
    }

    this.isDeleting = true;
    this.errorMessage = '';
    this.feedbackMessage = '';

    this.categoriesService.deleteCategory(this.categoryId)
      .pipe(finalize(() => {
        this.isDeleting = false;
      }))
      .subscribe({
        next: () => {
          this.deleted.emit();
          if (this.modalMode) {
            this.closed.emit();
          } else {
            this.router.navigate(['/categorias']);
          }
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel excluir a categoria.';
          console.error('Erro ao excluir categoria:', error);
        },
      });
  }

  private loadCategory(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.feedbackMessage = '';

    const categoryId = this.selectedCategoryId !== undefined
      ? this.parseInputId(this.selectedCategoryId)
      : this.parseRouteId(this.route.snapshot.paramMap.get('id'));
    this.categoryId = categoryId;
    this.isCreating = categoryId === null;

    forkJoin({
      category: categoryId === null ? of(null) : this.categoriesService.getCategoryById(categoryId),
      articles: this.articlesService.getArticlesForListing(),
      bootstrap: this.categoriesService.getCategories().pipe(catchError(() => of([]))),
    })
      .pipe(finalize(() => {
        this.isLoading = false;
      }))
      .subscribe({
        next: ({ category, articles }) => {
          this.currentCategory = category;

          if (!this.isCreating && !category) {
            this.errorMessage = 'Categoria nao encontrada.';
            return;
          }

          this.form.patchValue({
            name: category?.name ?? '',
            description: category?.description ?? '',
          });

          this.relatedArticleCount = this.countRelatedArticles(category?.name ?? '', articles);
        },
        error: (error: unknown) => {
          this.errorMessage = 'Nao foi possivel carregar o cadastro da categoria.';
          console.error('Erro ao carregar categoria:', error);
        },
      });
  }

  private countRelatedArticles(categoryName: string, articles: ArticleListItem[]): number {
    const normalizedCategoryName = categoryName.trim().toLocaleLowerCase();
    if (!normalizedCategoryName) {
      return 0;
    }

    return articles.filter((article) => {
      const currentName = typeof article.categories?.name === 'string'
        ? article.categories.name.trim().toLocaleLowerCase()
        : '';
      return currentName === normalizedCategoryName;
    }).length;
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
}
