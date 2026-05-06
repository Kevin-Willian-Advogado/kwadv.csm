import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { LoginService } from '../../../core/login.service';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  private readonly loginService = inject(LoginService);
  private readonly router = inject(Router);

  logout(): void {
    this.loginService.clearSession();
    this.router.navigate(['/login']);
  }
}
