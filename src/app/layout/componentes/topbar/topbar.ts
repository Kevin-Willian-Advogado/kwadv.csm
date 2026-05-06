import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { Subscription, filter } from 'rxjs';

@Component({
  selector: 'app-topbar',
  imports: [RouterLink],
  templateUrl: './topbar.html',
  styleUrl: './topbar.css',
})
export class Topbar implements OnDestroy {
  pageTitle = 'Artigos';
  pageDescription = 'Gerencie as publicacoes do portal juridico.';
  primaryActionLabel = 'Novo artigo';
  primaryActionLink = '/artigos/novo';
  showPrimaryAction = true;

  private readonly navigationSubscription: Subscription;

  constructor(private readonly router: Router) {
    this.syncViewState(this.router.url);
    this.navigationSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.syncViewState(event.urlAfterRedirects);
      });
  }

  ngOnDestroy(): void {
    this.navigationSubscription.unsubscribe();
  }

  private syncViewState(url: string): void {
    const normalizedUrl = url.split('?')[0];

    if (normalizedUrl === '/autores') {
      this.pageTitle = 'Autores';
      this.pageDescription = 'Gerencie perfis editoriais, foto publica e vinculos com usuarios.';
      this.primaryActionLabel = 'Novo autor';
      this.primaryActionLink = '/autores/novo';
      this.showPrimaryAction = true;
      return;
    }

    if (normalizedUrl === '/autores/novo' || /^\/autores\/\d+$/.test(normalizedUrl)) {
      this.pageTitle = 'Autores';
      this.pageDescription = 'Gerencie perfis editoriais, foto publica e vinculos com usuarios.';
      this.showPrimaryAction = false;
      return;
    }

    if (normalizedUrl === '/usuarios') {
      this.pageTitle = 'Usuarios';
      this.pageDescription = 'Gerencie perfis internos, status de acesso e relacionamento com autores.';
      this.primaryActionLabel = 'Novo usuario';
      this.primaryActionLink = '/usuarios/novo';
      this.showPrimaryAction = true;
      return;
    }

    if (normalizedUrl === '/usuarios/novo' || /^\/usuarios\/\d+$/.test(normalizedUrl)) {
      this.pageTitle = 'Usuarios';
      this.pageDescription = 'Gerencie perfis internos, status de acesso e relacionamento com autores.';
      this.showPrimaryAction = false;
      return;
    }

    if (normalizedUrl === '/categorias') {
      this.pageTitle = 'Categorias';
      this.pageDescription = 'Organize a taxonomia editorial e acompanhe o uso no conteudo.';
      this.primaryActionLabel = 'Nova categoria';
      this.primaryActionLink = '/categorias/nova';
      this.showPrimaryAction = true;
      return;
    }

    if (normalizedUrl === '/categorias/nova' || /^\/categorias\/\d+$/.test(normalizedUrl)) {
      this.pageTitle = 'Categorias';
      this.pageDescription = 'Organize a taxonomia editorial e acompanhe o uso no conteudo.';
      this.showPrimaryAction = false;
      return;
    }

    if (normalizedUrl === '/mensagens') {
      this.pageTitle = 'Mensagens';
      this.pageDescription = 'Modulo em validacao visual antes da integracao final.';
      this.showPrimaryAction = false;
      return;
    }

    if (normalizedUrl === '/artigos/novo' || /^\/artigos\/[^/]+$/.test(normalizedUrl)) {
      this.pageTitle = 'Editor de Artigo';
      this.pageDescription = 'Edite conteudo, autores, SEO e fluxo de publicacao.';
      this.showPrimaryAction = false;
      return;
    }

    this.pageTitle = 'Artigos';
    this.pageDescription = 'Gerencie as publicacoes do portal juridico.';
    this.primaryActionLabel = 'Novo artigo';
    this.primaryActionLink = '/artigos/novo';
    this.showPrimaryAction = true;
  }
}
