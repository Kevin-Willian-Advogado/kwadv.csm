import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Sidebar } from '../componentes/sidebar/sidebar';
import { Topbar } from '../componentes/topbar/topbar';

@Component({
  selector: 'app-layout',
  imports: [ Sidebar, Topbar, RouterOutlet ],
  templateUrl: './layout.html',
  styleUrl: './layout.css',
})
export class Layout {

}
