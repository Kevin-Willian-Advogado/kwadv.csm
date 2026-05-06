import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { finalize } from 'rxjs';
import { ArticleListItem, ArticlesService } from '../../../../core/articles.service';
import { ShortNumberPipe } from '../../../../shared/pipes/short-number-pipe';

@Component({
  selector: 'app-articles-cards-panel',
  imports: [CommonModule, ShortNumberPipe],
  templateUrl: './articles-cards-panel.html',
  styleUrl: './articles-cards-panel.css',
})
export class ArticlesCardsPanel implements OnInit {
  private readonly articlesService = inject(ArticlesService);
  private readonly publishedStatus = 1;
  private readonly draftStatuses = new Set<number>([2]);

  public totalArticles = 0;
  public publishedArticles = 0;
  public draftArticles = 0;
  public totalViews = 0;
  public isLoading = true;
  public hasError = false;

  ngOnInit(): void {
    this.loadPanelData();
  }

  public loadPanelData(): void {
    this.isLoading = true;
    this.hasError = false;

    this.articlesService
      .getArticlesForListing()
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (data: ArticleListItem[]) => {
          this.totalArticles = data.length;
          this.publishedArticles = data.filter((article) => article.status === this.publishedStatus).length;
          this.draftArticles = data.filter((article) => this.isDraftStatus(article.status)).length;
          this.totalViews = data.reduce((total, article) => total + this.normalizeViews(article.views), 0);
        },
        error: (err: unknown) => {
          this.hasError = true;
          console.error('Erro ao carregar painel de artigos:', err);
        },
      });
  }

  private isDraftStatus(status: number | null | undefined): boolean {
    return typeof status === 'number' && this.draftStatuses.has(status);
  }

  private normalizeViews(views: number | null | undefined): number {
    if (typeof views !== 'number' || Number.isNaN(views)) {
      return 0;
    }

    return views;
  }
}
