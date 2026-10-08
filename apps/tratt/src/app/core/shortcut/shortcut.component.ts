import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
} from '@angular/core';

@Component({
  selector: 'tratt-shortcut',
  templateUrl: './shortcut.component.html',
  styleUrls: ['./shortcut.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
})
export class ShortcutComponent implements OnInit {
  parts: {
    type: 'key' | 'separator';
    content: string;
  }[] = [];

  @Input() shortcut = '';
  @Input() theme: 'dark' | 'light' = 'light';

  ngOnInit(): void {
    const shortcut = this.replaceWithUTF8Symbols(this.shortcut);
    const splitted =
      shortcut !== '+'
        ? shortcut.split('+').filter((a) => a !== undefined && a !== '')
        : ['+'];

    this.parts = [];
    for (let i = 0; i < splitted.length; i++) {
      const part = splitted[i];

      this.parts.push({
        type: 'key',
        content: part,
      });
      if (i < splitted.length - 1) {
        this.parts.push({
          type: 'separator',
          content: '<i class="fa-solid fa-plus"></i>',
        });
      }
    }
  }

  private replaceWithUTF8Symbols(keyString: string) {
    let result = keyString;

    const regex = new RegExp(
      /((?:(ARROW)?(?:(?:UP)|(?:DOWN)|(?:LEFT)|(?:RIGHT)))|(?:STRG)|(?:CMD)|(?:ENTER)|(?:BACKSPACE)|(?:TAB)|(?:ESC)|(?:ALT)|(?:SHIFT))/g,
    );

    result = result.replace(regex, (g0, g1) => {
      switch (g1) {
        case 'ARROWUP':
        case 'UP':
          return '<i class="fa-solid fa-arrow-up"></i>';
        case 'ARROWLEFT':
        case 'LEFT':
          return '<i class="fa-solid fa-arrow-left"></i>';
        case 'ARROWRIGHT':
        case 'RIGHT':
          return '<i class="fa-solid fa-arrow-right"></i>';
        case 'ARROWDOWN':
        case 'DOWN':
          return '<i class="fa-solid fa-arrow-down"></i>';
        case 'STRG':
          return 'strg';
        case 'CMD':
          return '⌘';
        case 'ENTER':
          return '<i class="fa-solid fa-rotate-left"></i>';
        case 'BACKSPACE':
          return '<i class="fa-solid fa-delete-left"></i>';
        case 'TAB':
          return '<i class="fa-solid fa-indent"></i>';
        case 'SHIFT':
          return '<i class="fa-solid fa-arrow-up"></i>';
        default:
          return g1.toLowerCase();
      }
    });

    return `${result}`;
  }
}
