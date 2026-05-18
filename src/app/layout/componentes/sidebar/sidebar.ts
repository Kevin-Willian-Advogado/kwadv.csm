import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription } from 'rxjs';

import { ArticleListItem, ArticlesService } from '../../../core/articles.service';
import { ContactMessagesService } from '../../../core/contact-messages.service';
import { LoginService } from '../../../core/login.service';
import { SettingsService } from '../../../core/settings.service';

interface GithubWorkflowRun {
  status?: string | null;
}

interface GithubWorkflowRunsResponse {
  workflow_runs?: GithubWorkflowRun[] | null;
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar implements OnInit, OnDestroy {
  private readonly loginService = inject(LoginService);
  private readonly articlesService = inject(ArticlesService);
  private readonly contactMessagesService = inject(ContactMessagesService);
  private readonly settingsService = inject(SettingsService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly processingStatus = 0;
  private readonly summaryRefreshMs = 10_000;
  private readonly githubActionsUrl =
    'https://api.github.com/repos/Kevin-Willian-Advogado/kwadv.page/actions/runs?per_page=10';
  private summaryIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly settingsSubscription = new Subscription();

  articlesEnabled = true;
  isLoadingArticlesSummary = true;
  isLoadingActionsSummary = true;
  articlesSummaryError = '';
  actionsSummaryError = '';
  processingArticlesCount = 0;
  runningActionsCount = 0;
  unreadMessagesCount = 0;

  ngOnInit(): void {
    this.settingsSubscription.add(
      this.settingsService.settingsChanges$.subscribe((settings) => {
        if (settings) {
          this.applyArticlesEnabled(settings.articlesEnabled);
        }
      }),
    );

    this.settingsService.getSettings().subscribe({
      next: (settings) => {
        this.applyArticlesEnabled(settings.articlesEnabled);
        this.loadSummary();
      },
      error: (error: unknown) => {
        console.error('Erro ao consultar configuracoes do site:', error);
        this.articlesEnabled = true;
        this.loadSummary();
      },
    });

    this.summaryIntervalId = setInterval(() => {
      this.loadSummary(true);
    }, this.summaryRefreshMs);
  }

  ngOnDestroy(): void {
    if (this.summaryIntervalId !== null) {
      clearInterval(this.summaryIntervalId);
      this.summaryIntervalId = null;
    }

    this.settingsSubscription.unsubscribe();
  }

  get homeLink(): string {
    return this.articlesEnabled ? '/artigos' : '/configuracoes';
  }

  get hasProcessingArticles(): boolean {
    return this.processingArticlesCount > 0;
  }

  get hasRunningActions(): boolean {
    return this.runningActionsCount > 0;
  }

  get processingArticlesLabel(): string {
    if (this.isLoadingArticlesSummary && !this.articlesSummaryError) {
      return 'Consultando artigos';
    }

    if (this.articlesSummaryError) {
      return 'Artigos indisponiveis';
    }

    if (this.hasProcessingArticles) {
      return this.processingArticlesCount === 1
        ? '1 artigo processando'
        : `${this.processingArticlesCount} artigos processando`;
    }

    return '0 artigos processando';
  }

  get actionsStatusLabel(): string {
    if (this.isLoadingActionsSummary && !this.actionsSummaryError) {
      return 'Consultando Actions';
    }

    if (this.actionsSummaryError) {
      return 'Actions indisponiveis';
    }

    if (this.hasRunningActions) {
      return this.runningActionsCount === 1
        ? '1 Action rodando'
        : `${this.runningActionsCount} Actions rodando`;
    }

    return 'Nenhuma Action rodando';
  }

  get summaryDotClasses(): string {
    const baseClasses = 'mt-1 h-2.5 w-2.5 shrink-0 rounded-full';

    if (this.hasProcessingArticles || this.hasRunningActions) {
      return `${baseClasses} bg-orange-600`;
    }

    if (this.articlesSummaryError || this.actionsSummaryError) {
      return `${baseClasses} bg-orange-400`;
    }

    return `${baseClasses} bg-green-600`;
  }

  get hasUnreadMessages(): boolean {
    return this.unreadMessagesCount > 0;
  }

  get unreadMessagesBadgeLabel(): string {
    return this.unreadMessagesCount > 9 ? '9+' : `${this.unreadMessagesCount}`;
  }

  logout(): void {
    this.loginService.clearSession();
    this.router.navigate(['/login']);
  }

  private loadSummary(forceRefresh = false): void {
    if (this.articlesEnabled) {
      this.loadArticlesSummary(forceRefresh);
      this.loadActionsSummary(forceRefresh);
    } else {
      this.resetPublicationSummary();
    }

    this.loadMessagesSummary(forceRefresh);
  }

  private applyArticlesEnabled(articlesEnabled: boolean): void {
    const wasEnabled = this.articlesEnabled;

    this.articlesEnabled = articlesEnabled;

    if (!articlesEnabled) {
      this.resetPublicationSummary();
      return;
    }

    if (!wasEnabled) {
      this.loadSummary(true);
    }
  }

  private resetPublicationSummary(): void {
    this.processingArticlesCount = 0;
    this.runningActionsCount = 0;
    this.articlesSummaryError = '';
    this.actionsSummaryError = '';
    this.isLoadingArticlesSummary = false;
    this.isLoadingActionsSummary = false;
  }

  private loadArticlesSummary(forceRefresh = false): void {
    this.isLoadingArticlesSummary = !forceRefresh && this.processingArticlesCount === 0 && !this.articlesSummaryError;

    this.articlesService.getArticlesForListing(forceRefresh).subscribe({
      next: (articles) => {
        this.processingArticlesCount = articles.filter((article) => article.status === this.processingStatus).length;
        this.articlesSummaryError = '';
        this.isLoadingArticlesSummary = false;
      },
      error: (error: unknown) => {
        console.error('Erro ao consultar atualizacoes pendentes do site:', error);
        this.articlesSummaryError = 'Nao foi possivel consultar artigos.';
        this.isLoadingArticlesSummary = false;
      },
    });
  }

  private loadActionsSummary(forceRefresh = false): void {
    this.isLoadingActionsSummary = !forceRefresh && this.runningActionsCount === 0 && !this.actionsSummaryError;

    this.http.get<GithubWorkflowRunsResponse>(this.githubActionsUrl).subscribe({
      next: (response) => {
        const runs = Array.isArray(response.workflow_runs) ? response.workflow_runs : [];
        this.runningActionsCount = runs.filter((run) => this.isRunningActionStatus(run.status)).length;
        this.actionsSummaryError = '';
        this.isLoadingActionsSummary = false;
      },
      error: (error: unknown) => {
        console.error('Erro ao consultar status das Actions:', error);
        this.actionsSummaryError = 'Nao foi possivel consultar Actions.';
        this.isLoadingActionsSummary = false;
      },
    });
  }

  private loadMessagesSummary(forceRefresh = false): void {
    this.contactMessagesService.getMessages(forceRefresh).subscribe({
      next: (messages) => {
        this.unreadMessagesCount = messages.filter((message) => message.status === 'unread').length;
      },
      error: (error: unknown) => {
        console.error('Erro ao consultar mensagens nao lidas:', error);
        this.unreadMessagesCount = 0;
      },
    });
  }

  private isRunningActionStatus(status: string | null | undefined): boolean {
    return status === 'queued' || status === 'in_progress' || status === 'waiting' || status === 'requested' || status === 'pending';
  }
}
